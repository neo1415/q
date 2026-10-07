import { DECK_EXTRACTION_SCHEMA_VERSION } from "@capital-q/q-core";
import type { EventRegistry } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { verifyDeckReading, type PostgresDataRoom } from "@capital-q/evidence";
import {
  DECK_READER_PROMPT_VERSION,
  type DeckReader,
} from "@capital-q/model-gateway/q";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";

/**
 * Q reads a founder's pitch deck into the twelve standard sections
 * (overnight plan A5) once the document pipeline has read the file:
 * `evidence.document.ready` names a document; everything else is re-read
 * here, so a forged or stale message can name a document but never reach
 * one. Only the company's current, processed, unblocked PITCH_DECK version
 * is read, once per version and prompt version (the table's key makes
 * redelivery a no-op). The reader sees that version's own passages and its
 * title, nothing else (Context Firewall).
 *
 * Every way of storing nothing is an error line with a stable `alert` code
 * (Q.08 audit 2026-10-07: 21 ready decks, 94 successful model reads, 0
 * stored, because the insert double-encoded the sections and the table's
 * check rejected every row while the handler logged only a warning).
 */

const READY_EVENT = "evidence.document.ready";
/** Passages read: a long deck read from the top. */
const PASSAGES_MAX = 120;
/** A ready deck still unread after this long is an alert. */
export const DECK_READING_ALERT_AFTER_MINUTES = 10;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DeckReadingChunks = {
  readonly listActiveByVersion: (
    executor: DatabaseExecutor,
    tenantId: string,
    documentVersionId: string,
  ) => Promise<
    readonly {
      readonly content: string;
      readonly chunkIndex: number;
      readonly locator: {
        readonly pageEnd?: number | undefined;
        readonly pageStart?: number | undefined;
        readonly slide?: number | undefined;
      };
    }[]
  >;
};

export type DeckReadingOptions = {
  readonly sql: DatabaseExecutor;
  readonly reader: DeckReader;
  readonly chunks: DeckReadingChunks;
  readonly store: Pick<
    PostgresDataRoom,
    "insertExtraction" | "nextReadingNumber"
  >;
  readonly logger: RunnerLogger;
};

export type DeckReadingOutcome =
  /** Not a current, processed, unblocked PITCH_DECK, or already read. */
  | { readonly kind: "NOT_ELIGIBLE" }
  /** The pipeline stored no passages for the version. */
  | { readonly kind: "NO_TEXT"; readonly documentVersionId: string }
  /** The model (or its output validation) gave nothing back. */
  | { readonly kind: "EMPTY"; readonly documentVersionId: string }
  | {
      readonly kind: "READ";
      readonly documentVersionId: string;
      readonly stored: boolean;
    };

/** Which document a ready message names, if any. */
export function readyDocumentOf(type: string, data: unknown): string | null {
  if (type !== READY_EVENT || typeof data !== "object" || data === null)
    return null;
  const id = (data as Record<string, unknown>)["documentId"];
  return typeof id === "string" && UUID.test(id) ? id : null;
}

/**
 * Reads one document's current deck version into the twelve sections and
 * stores it: the single path the live handler and the backfill share. A
 * database failure throws (the caller decides on retry); a model that gives
 * nothing back is an outcome, logged at error level.
 */
export async function readDeckDocument(
  options: DeckReadingOptions,
  documentId: string,
  correlationId: string,
  /** F26: AGAIN appends a new reading of a version already read. */
  mode: "FIRST" | "AGAIN" = "FIRST",
): Promise<DeckReadingOutcome> {
  const again = mode === "AGAIN";
  const target = (
    await options.sql<
      {
        tenant_id: string;
        company_id: string;
        title: string;
        version_id: string;
      }[]
    >`
      select d.tenant_id, d.company_id, d.title, v.id as version_id
        from evidence.documents d
        join evidence.document_versions v
          on v.id = d.current_version_id and v.tenant_id = d.tenant_id
       where d.id = ${documentId}
         and d.document_type = 'PITCH_DECK'
         and d.status = 'ACTIVE'
         and d.company_id is not null
         and v.processing_status = 'COMPLETED'
         and v.malware_scan_status <> 'BLOCKED'
         and (${again} or not exists (
           select 1 from evidence.deck_extractions x
            where x.document_version_id = v.id
              and x.prompt_version = ${DECK_READER_PROMPT_VERSION}))`
  )[0];
  if (target === undefined) return { kind: "NOT_ELIGIBLE" };
  const chunks = (
    await options.chunks.listActiveByVersion(
      options.sql,
      target.tenant_id,
      target.version_id,
    )
  )
    .toSorted((a, b) => a.chunkIndex - b.chunkIndex)
    .slice(0, PASSAGES_MAX);
  if (chunks.length === 0) {
    options.logger.error(
      { documentVersionId: target.version_id, alert: "DECK_READING_NO_TEXT" },
      "a ready pitch deck has no passages to read",
    );
    return { kind: "NO_TEXT", documentVersionId: target.version_id };
  }
  const pages = chunks.reduce(
    (most, chunk) =>
      Math.max(
        most,
        chunk.locator.slide ?? 0,
        chunk.locator.pageEnd ?? 0,
        chunk.locator.pageStart ?? 0,
      ),
    0,
  );
  const sections = await options.reader.read({
    title: target.title,
    pages: pages === 0 ? null : pages,
    passages: chunks.map((chunk) => ({
      content: chunk.content,
      slide: chunk.locator.slide ?? chunk.locator.pageStart ?? null,
    })),
    attribution: {
      tenantId: target.tenant_id,
      correlationId: correlationId.slice(0, 128),
    },
  });
  if (sections === null) {
    options.logger.error(
      { documentVersionId: target.version_id, alert: "DECK_READING_EMPTY" },
      "Q could not read a pitch deck: the model returned no valid reading",
    );
    return { kind: "EMPTY", documentVersionId: target.version_id };
  }
  // F26: every figure Q cites as the deck's own must be in its text.
  const verified = verifyDeckReading(
    sections,
    chunks.map((chunk) => chunk.content).join("\n"),
  );
  const stored = await options.store.insertExtraction(options.sql, {
    tenantId: target.tenant_id,
    companyId: target.company_id,
    documentId,
    documentVersionId: target.version_id,
    promptVersion: DECK_READER_PROMPT_VERSION,
    schemaVersion: DECK_EXTRACTION_SCHEMA_VERSION,
    pageCount: pages === 0 ? null : pages,
    sections: verified.sections,
    setAside: verified.setAside,
    readingNumber: again
      ? await options.store.nextReadingNumber(
          options.sql,
          target.version_id,
          DECK_READER_PROMPT_VERSION,
        )
      : 1,
    origin: again ? "READ_AGAIN" : "FIRST_READ",
  });
  options.logger.info(
    {
      documentVersionId: target.version_id,
      stored,
      again,
      setAside: verified.setAside.length,
    },
    "Q read a pitch deck into its twelve sections",
  );
  return { kind: "READ", documentVersionId: target.version_id, stored };
}

/**
 * Ready decks Q has not read under the current prompt version, oldest
 * first: the backfill's work list and the alert's evidence. Ids only.
 */
export async function listUnreadDecks(
  sql: DatabaseExecutor,
  options: { readonly uploadedMinutesAgo: number; readonly limit: number },
): Promise<readonly { documentId: string; documentVersionId: string }[]> {
  const rows = await sql<{ document_id: string; version_id: string }[]>`
    select d.id as document_id, v.id as version_id
      from evidence.documents d
      join evidence.document_versions v
        on v.id = d.current_version_id and v.tenant_id = d.tenant_id
     where d.document_type = 'PITCH_DECK'
       and d.status = 'ACTIVE'
       and d.company_id is not null
       and v.processing_status = 'COMPLETED'
       and v.malware_scan_status <> 'BLOCKED'
       and v.uploaded_at < now() - make_interval(mins => ${options.uploadedMinutesAgo})
       and not exists (
         select 1 from evidence.deck_extractions x
          where x.document_version_id = v.id
            and x.prompt_version = ${DECK_READER_PROMPT_VERSION})
     order by v.uploaded_at asc
     limit ${options.limit}`;
  return rows.map((row) => ({
    documentId: row.document_id,
    documentVersionId: row.version_id,
  }));
}

/**
 * The alert: a ready deck still unread ten minutes on is an error line
 * with a stable code, never a quiet absence.
 */
export async function checkUnreadDecks(
  sql: DatabaseExecutor,
  logger: RunnerLogger,
): Promise<number> {
  const unread = await listUnreadDecks(sql, {
    uploadedMinutesAgo: DECK_READING_ALERT_AFTER_MINUTES,
    limit: 50,
  });
  if (unread.length > 0) {
    logger.error(
      {
        alert: "DECK_READING_MISSING",
        unread: unread.length,
        documentVersionIds: unread
          .slice(0, 10)
          .map((deck) => deck.documentVersionId),
      },
      "ready pitch decks have no Q reading after 10 minutes",
    );
  }
  return unread.length;
}

export function withDeckReadings(
  inner: (message: QueueMessage) => Promise<MessageOutcome>,
  options: DeckReadingOptions & { readonly registry: EventRegistry },
): (message: QueueMessage) => Promise<MessageOutcome> {
  return async (message) => {
    const parsed = options.registry.parse(message.message);
    if (!parsed.ok) return inner(message);
    const documentId = readyDocumentOf(
      parsed.message.type,
      parsed.message.data,
    );
    if (documentId === null) return inner(message);
    try {
      await readDeckDocument(
        options,
        documentId,
        `cor_deck_${parsed.message.id}`,
      );
    } catch (error: unknown) {
      options.logger.error(
        {
          msgId: message.msgId,
          readCount: message.readCount,
          err: error,
          alert: "DECK_READING_FAILED",
        },
        "deck reading not written; retrying",
      );
      return { kind: "RETRY", errorCode: "DECK_READING_FAILED" };
    }
    return inner(message);
  };
}

/** The unread-deck alert, every `intervalMs` until shutdown. */
export async function runUnreadDeckAlerts(options: {
  readonly sql: DatabaseExecutor;
  readonly logger: RunnerLogger;
  readonly intervalMs: number;
  readonly signal: AbortSignal;
}): Promise<void> {
  while (!options.signal.aborted) {
    try {
      await checkUnreadDecks(options.sql, options.logger);
    } catch (error: unknown) {
      options.logger.warn({ err: error }, "unread-deck check failed");
    }
    await abortableSleep(options.intervalMs, options.signal);
  }
}

/**
 * F26: the founder's "Read again", oldest first. Each request is read once
 * (its outcome is recorded whatever happens) and the platform reads at most
 * `dailyMax` a day, so a burst of presses never becomes a burst of spend.
 */
export async function processReadAgain(options: {
  readonly reading: DeckReadingOptions;
  readonly queue: Pick<
    PostgresDataRoom,
    "pendingReadAgain" | "recordReadAgain" | "readAgainToday"
  >;
  readonly perSweep: number;
  readonly dailyMax: number;
}): Promise<number> {
  const { sql, logger } = options.reading;
  const room = options.dailyMax - (await options.queue.readAgainToday(sql));
  if (room <= 0) return 0;
  const pending = await options.queue.pendingReadAgain(
    sql,
    Math.min(options.perSweep, room),
  );
  for (const request of pending) {
    let outcome: "READ" | "EMPTY" | "NO_TEXT" | "NOT_ELIGIBLE" | "FAILED";
    try {
      const read = await readDeckDocument(
        options.reading,
        request.documentId,
        `cor_deckagain_${request.requestId}`,
        "AGAIN",
      );
      // The deck moved on (a new version) or was removed: nothing to read.
      outcome =
        read.kind === "READ" &&
        read.documentVersionId !== request.documentVersionId
          ? "NOT_ELIGIBLE"
          : read.kind;
    } catch (error: unknown) {
      logger.error(
        {
          requestId: request.requestId,
          err: error,
          alert: "DECK_READING_FAILED",
        },
        "read again failed",
      );
      outcome = "FAILED";
    }
    await options.queue.recordReadAgain(sql, {
      requestId: request.requestId,
      tenantId: request.tenantId,
      outcome,
    });
  }
  return pending.length;
}

/**
 * F26 heal: readings stored before the figure check get it now. The
 * founder's newest unconfirmed reading of each current deck version is
 * checked against the deck's own passages; where Q cited a figure the deck
 * never states, a corrected copy is appended as the next reading (no
 * model, no spend). The original stays, as history.
 */
export async function checkStoredDeckReadings(options: {
  readonly sql: DatabaseExecutor;
  readonly chunks: DeckReadingChunks;
  readonly store: Pick<PostgresDataRoom, "insertExtraction">;
  readonly logger: RunnerLogger;
  readonly limit: number;
}): Promise<number> {
  const rows = await options.sql<
    {
      tenant_id: string;
      company_id: string;
      document_id: string;
      document_version_id: string;
      prompt_version: number;
      schema_version: number;
      page_count: number | null;
      reading_number: number;
      sections: Parameters<typeof verifyDeckReading>[0];
    }[]
  >`
    select * from (
      select distinct on (x.document_version_id)
             x.id, x.tenant_id, x.company_id, x.document_id, x.document_version_id,
             x.prompt_version, x.schema_version, x.page_count, x.reading_number,
             x.sections, x.set_aside
        from evidence.deck_extractions x
        join evidence.documents d
          on d.id = x.document_id and d.current_version_id = x.document_version_id
       where d.status = 'ACTIVE'
       order by x.document_version_id, x.prompt_version desc,
                x.reading_number desc, x.created_at desc
    ) newest
     where newest.set_aside is null
       and not exists (select 1 from evidence.deck_extraction_confirmations c
                        where c.extraction_id = newest.id)
     limit ${options.limit}`;
  let healed = 0;
  for (const row of rows) {
    const passages = await options.chunks.listActiveByVersion(
      options.sql,
      row.tenant_id,
      row.document_version_id,
    );
    if (passages.length === 0) continue;
    const verified = verifyDeckReading(
      row.sections,
      passages
        .toSorted((a, b) => a.chunkIndex - b.chunkIndex)
        .slice(0, PASSAGES_MAX)
        .map((chunk) => chunk.content)
        .join("\n"),
    );
    if (verified.setAside.length === 0) continue;
    const stored = await options.store.insertExtraction(options.sql, {
      tenantId: row.tenant_id,
      companyId: row.company_id,
      documentId: row.document_id,
      documentVersionId: row.document_version_id,
      promptVersion: row.prompt_version,
      schemaVersion: row.schema_version,
      pageCount: row.page_count,
      sections: verified.sections,
      setAside: verified.setAside,
      readingNumber: row.reading_number + 1,
      origin: "FIGURE_CHECK",
    });
    if (stored) healed += 1;
    options.logger.info(
      {
        documentVersionId: row.document_version_id,
        setAside: verified.setAside.map((s) => s.section),
        stored,
      },
      "deck reading: figures the deck never states set aside",
    );
  }
  return healed;
}

/** F26: "Read again" requests, every `intervalMs` until shutdown. */
export async function runReadAgainLoop(options: {
  readonly reading: DeckReadingOptions;
  readonly queue: Parameters<typeof processReadAgain>[0]["queue"];
  readonly intervalMs: number;
  readonly perSweep: number;
  readonly dailyMax: number;
  readonly signal: AbortSignal;
}): Promise<void> {
  while (!options.signal.aborted) {
    try {
      await processReadAgain(options);
    } catch (error: unknown) {
      options.reading.logger.warn({ err: error }, "read-again sweep failed");
    }
    await abortableSleep(options.intervalMs, options.signal);
  }
}
