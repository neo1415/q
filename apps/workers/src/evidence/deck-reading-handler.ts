import { DECK_EXTRACTION_SCHEMA_VERSION } from "@capital-q/q-core";
import type { EventRegistry } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { PostgresDataRoom } from "@capital-q/evidence";
import {
  DECK_READER_PROMPT_VERSION,
  type DeckReader,
} from "@capital-q/model-gateway/q";

import type { RunnerLogger } from "../outbox-runner.js";
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
 * title, nothing else (Context Firewall). A model failure stores nothing;
 * the deck then shows without Q's sections and the founder can re-upload.
 */

const READY_EVENT = "evidence.document.ready";
/** Passages read: a long deck read from the top. */
const PASSAGES_MAX = 120;
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

/** Which document a ready message names, if any. */
export function readyDocumentOf(type: string, data: unknown): string | null {
  if (type !== READY_EVENT || typeof data !== "object" || data === null)
    return null;
  const id = (data as Record<string, unknown>)["documentId"];
  return typeof id === "string" && UUID.test(id) ? id : null;
}

export function withDeckReadings(
  inner: (message: QueueMessage) => Promise<MessageOutcome>,
  options: {
    readonly registry: EventRegistry;
    readonly sql: DatabaseExecutor;
    readonly reader: DeckReader;
    readonly chunks: DeckReadingChunks;
    readonly store: Pick<PostgresDataRoom, "insertExtraction">;
    readonly logger: RunnerLogger;
  },
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
             and not exists (
               select 1 from evidence.deck_extractions x
                where x.document_version_id = v.id
                  and x.prompt_version = ${DECK_READER_PROMPT_VERSION})`
      )[0];
      if (target !== undefined) {
        const chunks = (
          await options.chunks.listActiveByVersion(
            options.sql,
            target.tenant_id,
            target.version_id,
          )
        )
          .toSorted((a, b) => a.chunkIndex - b.chunkIndex)
          .slice(0, PASSAGES_MAX);
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
        const sections =
          chunks.length === 0
            ? null
            : await options.reader.read({
                title: target.title,
                pages: pages === 0 ? null : pages,
                passages: chunks.map((chunk) => ({
                  content: chunk.content,
                  slide: chunk.locator.slide ?? chunk.locator.pageStart ?? null,
                })),
                attribution: {
                  tenantId: target.tenant_id,
                  correlationId: `cor_deck_${parsed.message.id}`.slice(0, 128),
                },
              });
        if (sections !== null) {
          await options.store.insertExtraction(options.sql, {
            tenantId: target.tenant_id,
            companyId: target.company_id,
            documentId,
            documentVersionId: target.version_id,
            promptVersion: DECK_READER_PROMPT_VERSION,
            schemaVersion: DECK_EXTRACTION_SCHEMA_VERSION,
            pageCount: pages === 0 ? null : pages,
            sections,
          });
          options.logger.info(
            { msgId: message.msgId, documentVersionId: target.version_id },
            "Q read a pitch deck into its twelve sections",
          );
        }
      }
    } catch (error: unknown) {
      options.logger.warn(
        { msgId: message.msgId, err: error },
        "deck reading not written; retrying",
      );
      return { kind: "RETRY", errorCode: "DECK_READING_FAILED" };
    }
    return inner(message);
  };
}
