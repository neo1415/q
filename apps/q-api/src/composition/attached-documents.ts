import type { DatabaseExecutor } from "@capital-q/database";
import type { AttachedDocumentsPort } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

/**
 * Lane 8 (owner 2026-10-22): a document the person attached to Q, read for
 * them at once and found again later.
 *
 * Authorisation is Evidence's own, as the person, first: `get` and `list`
 * are the Evidence service's document reads (document.view inside their
 * own organisation), and a document they refuse is reported exactly like
 * one that does not exist. Only then does the privileged read below run,
 * named and kept to that one document, its current version and the
 * person's own tenant; nothing else reaches it.
 *
 * "Read immediately" is the existing pipeline (upload → job → isolated
 * parse → pages), which lands a small file's pages in a few seconds. A
 * question asked before then waits for it, bounded; past the bound Q says
 * it is still reading rather than answering from nothing.
 */

/** Whole when this short; otherwise the pages that answer the question. */
const WHOLE_CHARS = 6_000;
/** Pages a long document is read by, beside its first. */
const MATCHED_PAGES = 6;
const OTHERS_MAX = 10;

type Version = {
  readonly id: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly uploadedAt: string;
  readonly processingStatus: string;
  readonly malwareScanStatus: string;
  readonly textExtractionStatus: string;
};

type Held = {
  readonly document: {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    /** Evidence's own classification; HIGHLY_CONFIDENTIAL is never read. */
    readonly sensitivityClass?: string | undefined;
  };
  readonly currentVersion: Version | null;
};

export type AttachedDocumentReadsDependencies = {
  readonly sql: DatabaseExecutor;
  /** Evidence's getDocumentWithVersion, as the actor; throws when not theirs. */
  readonly get: (actor: ActorContext, documentId: string) => Promise<Held>;
  /** Evidence's listDocumentsWithVersions, as the actor: their newest first. */
  readonly list: (
    actor: ActorContext,
    limit: number,
  ) => Promise<readonly Held[]>;
  /** How long a question waits for a file still being read. */
  readonly waitMs?: number | undefined;
  readonly pollMs?: number | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly now?: (() => number) | undefined;
};

const DONE = new Set(["COMPLETED", "FAILED"]);

/** Why a file has no text, in words a person can act on. */
export function unreadableReason(version: Version): string | null {
  if (version.malwareScanStatus === "BLOCKED") {
    return "The file was stopped by the security check, so it was not opened.";
  }
  const mime = version.mimeType.toLowerCase();
  if (mime.startsWith("image/")) {
    return "It is an image, and Q can't read text in images yet. A PDF, Word, PowerPoint, spreadsheet or text file works.";
  }
  if (mime.startsWith("audio/")) {
    return "It is a recording; Q reads documents, not audio, here.";
  }
  if (
    version.processingStatus === "FAILED" ||
    version.textExtractionStatus === "FAILED"
  ) {
    return "The file couldn't be read: it may be damaged, password-protected or a scan with no text layer.";
  }
  return null;
}

/** Words of a title or file name, for "that contract" and "the Q3 pack". */
function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/\.[a-z0-9]{1,5}$/, "")
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3),
  );
}

/** Their upload whose title or file name shares most words with `name`. */
export function bestByName<T extends Held>(
  held: readonly T[],
  name: string,
): T | null {
  const wanted = words(name);
  if (wanted.size === 0) return null;
  let best: T | null = null;
  let bestScore = 0;
  for (const entry of held) {
    const have = words(
      `${entry.document.title} ${entry.currentVersion?.originalFilename ?? ""}`,
    );
    let score = 0;
    for (const word of wanted) if (have.has(word)) score += 1;
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

/** Under the tool's 300-character reason; the policy is heldBackFromQ's. */
const HELD_BACK =
  "It is classified highly confidential (financial material), so Q never reads its contents or sends them to a model. Its key figures, stated by them, become their own stated figures Q can use.";

export function createAttachedDocumentReads(
  dependencies: AttachedDocumentReadsDependencies,
): AttachedDocumentsPort {
  const { sql, get, list } = dependencies;
  const waitMs = dependencies.waitMs ?? 12_000;
  const pollMs = dependencies.pollMs ?? 400;
  const now = dependencies.now ?? Date.now;
  const sleep =
    dependencies.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const pagesOf = async (
    actor: ActorContext,
    documentId: string,
    versionId: string,
    question: string | undefined,
  ): Promise<{
    readonly pageCount: number;
    readonly whole: boolean;
    readonly pages: readonly { readonly page: number; readonly text: string }[];
  }> => {
    // The latest extraction of exactly this version, in their own tenant.
    const rows = await sql<
      {
        page_number: number;
        text: string;
        chars: number;
        rank: number;
      }[]
    >`
      with latest as (
        select p.extraction_id
          from evidence.document_pages p
          join evidence.document_extractions x on x.id = p.extraction_id
         where p.tenant_id = ${actor.tenantId}
           and p.document_id = ${documentId}
           and p.document_version_id = ${versionId}
         order by x.created_at desc, x.id desc
         limit 1)
      select p.page_number,
             p.text,
             char_length(p.text)::int as chars,
             coalesce(ts_rank(p.search,
               websearch_to_tsquery('simple', ${question ?? ""})), 0)::float8 as rank
        from evidence.document_pages p
        join latest l on l.extraction_id = p.extraction_id
       order by p.page_number`;
    if (rows.length > 0) {
      const total = rows.reduce((sum, row) => sum + row.chars, 0);
      if (total <= WHOLE_CHARS) {
        return {
          pageCount: rows.length,
          whole: true,
          pages: rows.map((row) => ({ page: row.page_number, text: row.text })),
        };
      }
      // A long document: its opening, and the pages that answer them.
      const matched = [...rows]
        .filter((row) => row.rank > 0)
        .sort((a, b) => b.rank - a.rank)
        .slice(0, MATCHED_PAGES)
        .map((row) => row.page_number);
      const keep = new Set([1, 2, ...matched]);
      return {
        pageCount: rows.length,
        whole: false,
        pages: rows
          .filter((row) => keep.has(row.page_number))
          .map((row) => ({ page: row.page_number, text: row.text })),
      };
    }
    // Not paged (a sheet, a text file before pages): its chunk set, in order.
    const chunks = await sql<{ content: string }[]>`
      select k.content
        from q_knowledge.chunk_sets s
        join q_knowledge.chunks k on k.chunk_set_id = s.id
       where s.tenant_id = ${actor.tenantId}
         and s.document_id = ${documentId}
         and s.document_version_id = ${versionId}
         and s.status = 'ACTIVE'
         and k.status = 'ACTIVE'
         and k.invalidated_at is null
       order by k.chunk_index
       limit 80`;
    const text = chunks.map((chunk) => chunk.content).join("\n");
    if (text.trim().length === 0) {
      return { pageCount: 0, whole: true, pages: [] };
    }
    return {
      pageCount: 1,
      whole: text.length <= WHOLE_CHARS,
      pages: [{ page: 1, text: text.slice(0, WHOLE_CHARS) }],
    };
  };

  return {
    read: async (actor, request) => {
      const recent = (await list(actor, 30).catch(() => []))
        .filter(
          (entry) =>
            entry.document.status === "ACTIVE" && entry.currentVersion !== null,
        )
        .sort((a, b) =>
          (b.currentVersion?.uploadedAt ?? "").localeCompare(
            a.currentVersion?.uploadedAt ?? "",
          ),
        );
      let held: Held | null = null;
      if (request.documentId !== undefined) {
        held = await get(actor, request.documentId).catch(() => null);
      } else if (request.name !== undefined) {
        held = bestByName(recent, request.name);
      } else {
        held = recent[0] ?? null;
      }
      const others = recent
        .filter((entry) => entry.document.id !== held?.document.id)
        .slice(0, OTHERS_MAX)
        .map((entry) => ({
          documentId: entry.document.id,
          title: entry.document.title,
          uploadedAt: entry.currentVersion?.uploadedAt ?? "",
        }));
      if (held === null || held.document.status !== "ACTIVE") {
        return { document: null, others };
      }

      // Still being read: wait for it, bounded, re-reading as the actor.
      const until = now() + waitMs;
      let version = held.currentVersion;
      while (
        (version === null || !DONE.has(version.processingStatus)) &&
        unreadableReason(version ?? BLANK) === null &&
        now() < until
      ) {
        await sleep(pollMs);
        const again = await get(actor, held.document.id).catch(() => null);
        if (again === null) return { document: null, others };
        version = again.currentVersion;
      }
      const identity = {
        documentId: held.document.id,
        title: held.document.title,
        filename: version?.originalFilename ?? held.document.title,
        uploadedAt: version?.uploadedAt ?? "",
      };
      if (version === null) {
        return { document: { ...identity, state: "READING" }, others };
      }
      // Stress 2026-10-28 (item 2): a HIGHLY_CONFIDENTIAL document (management
      // accounts, a financial model) is outside every firewall plan, and no
      // model provider may receive it. This read handed its pages to the
      // model for any of their own files; it no longer does, and says why.
      if (
        held.document.sensitivityClass === "HIGHLY_CONFIDENTIAL" ||
        held.document.sensitivityClass === "RESTRICTED"
      ) {
        return {
          document: { ...identity, state: "UNREADABLE", reason: HELD_BACK },
          others,
        };
      }
      const reason = unreadableReason(version);
      if (reason !== null) {
        return {
          document: { ...identity, state: "UNREADABLE", reason },
          others,
        };
      }
      if (!DONE.has(version.processingStatus)) {
        return { document: { ...identity, state: "READING" }, others };
      }
      const read = await pagesOf(
        actor,
        held.document.id,
        version.id,
        request.question,
      );
      if (read.pages.length === 0) {
        return {
          document: {
            ...identity,
            state: "UNREADABLE",
            reason:
              "It has no text Q can read: it may be a scan or made of pictures.",
          },
          others,
        };
      }
      return { document: { ...identity, state: "READ", ...read }, others };
    },
  };
}

const BLANK: Version = {
  id: "",
  originalFilename: "",
  mimeType: "",
  uploadedAt: "",
  processingStatus: "NOT_STARTED",
  malwareScanStatus: "PENDING",
  textExtractionStatus: "NOT_STARTED",
};
