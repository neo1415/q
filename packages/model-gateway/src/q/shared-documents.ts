import type { AuthorisedFact } from "@capital-q/q-core";
import { documentScore } from "@capital-q/q-tools";

/**
 * Live 16 Nov 2026 (production 4f43012a6, investor Savanna Seed Partners
 * on Tensorgate, IN_DILIGENCE, eight documents shared through founder
 * grants): "What's Tensorgate's burn and runway right now?" was answered
 * "aren't recorded" and Q offered to request a document. No document was
 * listed or read: the data-room lane read documents only when the room was
 * on their screen, so management accounts the founder had shared (Q-readable
 * for this investor under ADR 0078) never reached the answer, and a later
 * turn asked for them again.
 *
 * Principle: on an investor's turn about a company, the documents that
 * company has made open to them -- shared through a grant or a fulfilled
 * diligence request, or open in its data room -- are listed by code
 * through read_company_data_room (their own Data room tab, as them: the
 * data room authorises it, so another investor's grants and founder-private
 * documents are never in it), and the most evidential ones are read
 * through read_document_pages under the run's plan before the model is
 * asked. What they state is the company's own material (USER_CLAIM,
 * DOCUMENT_SUPPORTED); the listing itself is the platform's record.
 */

/** One document the company's data room shows this investor. */
export type ListedDocument = {
  readonly documentId: string;
  readonly title: string;
  readonly folder: string;
  /**
   * SHARED: shared with them (a grant, or a request the founder fulfilled);
   * OPEN: open to them in the room (public to connected investors);
   * REQUESTED: they asked and the founder has not answered yet.
   */
  readonly access: "SHARED" | "OPEN" | "REQUESTED";
};

/** The words read_company_data_room gives each investor document. */
const STATUS: Readonly<Record<string, ListedDocument["access"]>> = {
  "shared with you": "SHARED",
  "open to you": "OPEN",
  "you asked; waiting": "REQUESTED",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/**
 * The investor's documents from read_company_data_room's own output; null
 * when it is not an investor's open room (the owner's view, a locked room,
 * or anything malformed). On-request documents they have not asked for
 * are not theirs to read and are left out.
 */
export function listedDocumentsOf(
  data: unknown,
): readonly ListedDocument[] | null {
  if (typeof data !== "object" || data === null) return null;
  if (Reflect.get(data, "viewer") !== "INVESTOR") return null;
  const documents: unknown = Reflect.get(data, "documents");
  if (!Array.isArray(documents)) return null;
  return documents.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const documentId = text(Reflect.get(entry, "documentId"));
    const title = text(Reflect.get(entry, "title"));
    const folder = text(Reflect.get(entry, "folder")) ?? "";
    const status = text(Reflect.get(entry, "status"));
    const access = status === null ? undefined : STATUS[status];
    if (
      documentId === null ||
      !UUID.test(documentId) ||
      title === null ||
      access === undefined
    ) {
      return [];
    }
    return [
      {
        documentId: documentId.toLowerCase(),
        title: title.slice(0, 200),
        folder: folder.slice(0, 80),
        access,
      },
    ];
  });
}

/** Documents open to them now (shared, or open in the room). */
export const readableListed = (
  documents: readonly ListedDocument[],
): readonly ListedDocument[] =>
  documents.filter(
    (document) => document.access === "SHARED" || document.access === "OPEN",
  );

const quoted = (document: ListedDocument): string =>
  `"${document.title}"${document.folder.length === 0 ? "" : ` (${document.folder})`}`;

const STATEMENT_MAX = 7_800;

/**
 * The fact: what the company has shared with them, by title (each title
 * names its period) and folder, and what they asked for that waits. Null
 * when nothing is open to them and nothing waits. Ids stay out of it: a
 * document is read or opened by meaning or by the listing's own read.
 */
export function sharedDocumentsFact(
  company: string,
  documents: readonly ListedDocument[],
): AuthorisedFact | null {
  const shared = documents.filter((document) => document.access === "SHARED");
  const open = documents.filter((document) => document.access === "OPEN");
  const waiting = documents.filter(
    (document) => document.access === "REQUESTED",
  );
  if (shared.length === 0 && open.length === 0 && waiting.length === 0) {
    return null;
  }
  const parts = [
    shared.length === 0
      ? `${company} has not shared any document with them individually.`
      : `DOCUMENTS ${company.toUpperCase()} HAS SHARED WITH THEM (in ${company}'s data room, open to them now; each title names its period): ${shared.map(quoted).join("; ")}.`,
    ...(open.length === 0
      ? []
      : [
          `Also open to them in ${company}'s data room: ${open.map(quoted).join("; ")}.`,
        ]),
    ...(waiting.length === 0
      ? []
      : [
          `They asked ${company} for these and the founder has not answered yet (pending, never ask again): ${waiting.map(quoted).join("; ")}.`,
        ]),
    shared.length + open.length === 0
      ? ""
      : `For any question about ${company}'s figures, performance or evidence, answer from these documents before saying a figure is not recorded: what was read of them is given as DATA ROOM DOCUMENT facts, and any other can be read now (read_document_pages or read_company_document). Name each document you rely on by its title and period, and offer to open it (open_company_document). Where a document and the deck differ, give both with their dates and explain the difference; never call one wrong. They are already shared: never offer to request any of them, and never say ${company} has not provided them. A document not named here is not open to them: never name or guess one.`,
  ];
  return {
    scope: "DATA_ROOM",
    statement: parts
      .filter((part) => part.length > 0)
      .join(" ")
      .slice(0, STATEMENT_MAX),
    truthClass: "VERIFIED",
    evidenceStatus: "PLATFORM_VERIFIED",
    source: `Their Data room tab for ${company}`.slice(0, 200),
  };
}

/** How many shared documents one turn reads, beside the listing. */
export const SHARED_READS_MAX = 2;

/**
 * What a document is, by its title and folder, for which to read first:
 * management accounts state the company's latest position (cash, burn,
 * runway); metrics packs and financial statements next. A pitch deck is
 * never read here: its figures come from read_company_deck, as the Deck
 * tab shows them. Language-independent of what was asked: the question
 * only breaks ties (documentScore).
 */
const KINDS: readonly (readonly [RegExp, number])[] = [
  [/\bmanagement\s+accounts?\b/iu, 0.6],
  [/\b(?:kpi|metrics?)\b/iu, 0.4],
  [/\b(?:financials?|revenue|accounts?|statements?)\b/iu, 0.3],
  [/\b(?:projections?|forecasts?|model)\b/iu, 0.2],
];
const DECK = /\b(?:deck|pitch|slides?)\b/iu;

function weightOf(document: ListedDocument): number {
  const words = `${document.title} ${document.folder}`;
  for (const [pattern, weight] of KINDS) {
    if (pattern.test(words)) return weight;
  }
  return 0;
}

/**
 * Which documents open to them to read for this turn: never a deck, never
 * one already read this turn, the most evidential first (KINDS), the
 * question breaking ties, at most SHARED_READS_MAX.
 */
export function sharedDocumentReads(input: {
  readonly documents: readonly ListedDocument[];
  readonly question: string;
  readonly alreadyRead: ReadonlySet<string>;
  readonly max?: number | undefined;
}): readonly ListedDocument[] {
  const max = input.max ?? SHARED_READS_MAX;
  return readableListed(input.documents)
    .filter(
      (document) =>
        !DECK.test(document.title) &&
        !input.alreadyRead.has(document.documentId),
    )
    .map((document) => ({
      document,
      score:
        weightOf(document) +
        documentScore(input.question, {
          title: document.title,
          documentType: null,
          folder: document.folder,
          opening: null,
        }),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, max)
    .map((entry) => entry.document);
}

/** The figures words an uncertainty or a request may be about. */
const FIGURES =
  /\b(?:burn|runway|cash|revenue|mrr|arr|margin|profit|loss|expenses?|costs?|spend|financials?|accounts?|figures?|p&l|ebitda|balance|headcount|payroll)\b/iu;

/**
 * Before offering to request a document about this company: one of the
 * documents it already shared with them that answers it, or null. Code's
 * own reading of the uncertainty's statement (or the offer's request) by
 * meaning, never the person's words: a figures question is answered by
 * shared management accounts or financials; otherwise the shared document
 * that matches the words best (documentScore).
 */
export function sharedDocumentFor(
  about: string,
  documents: readonly ListedDocument[],
): ListedDocument | null {
  const shared = readableListed(documents).filter(
    (document) => !DECK.test(document.title),
  );
  if (shared.length === 0) return null;
  if (FIGURES.test(about)) {
    const financial = [...shared]
      .filter((document) => weightOf(document) >= 0.3)
      .sort((left, right) => weightOf(right) - weightOf(left));
    if (financial[0] !== undefined) return financial[0];
  }
  const best = shared
    .map((document) => ({
      document,
      score: documentScore(about, {
        title: document.title,
        documentType: null,
        folder: document.folder,
        opening: null,
      }),
    }))
    .sort((left, right) => right.score - left.score)[0];
  return best !== undefined && best.score >= 0.55 ? best.document : null;
}

/** Code's line in place of an offer to request what is already shared. */
export function alreadySharedLine(
  company: string,
  document: ListedDocument,
): string {
  return `${company} has already shared "${document.title}" with you in their data room, so there is nothing to request for this: the answer above draws on it, and I can open it for you.`;
}
