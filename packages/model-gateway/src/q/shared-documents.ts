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

/** Companies whose rooms are counted for one list of cards, at most. */
export const READABLE_COUNT_MAX = 10;
/** Each room read is waited for at most this long. */
export const READABLE_COUNT_TIMEOUT_MS = 1_500;

/**
 * Owner live 17 Nov 2026 (conversation 9995dcca): a ranked list said "no
 * source documents yet" for Halyard, Tensorgate and Shiftwell, each with
 * documents open to the investor, because a ranking run never counted
 * them. What each listed company's data room holds open to this reader
 * (shared with them, or open in the room), through the room's own
 * projection as them -- read_company_data_room, authorised per company,
 * so no other investor's grant and nothing founder-private is counted.
 * Bounded to the listed companies, read side by side. A room that could
 * not be read, or is not open to them, is absent: unknown, never zero.
 */
export async function readableDocumentCounts(input: {
  readonly companyIds: readonly string[];
  readonly read: (
    companyId: string,
    index: number,
  ) => Promise<{
    readonly result: { readonly ok: boolean; readonly data?: unknown };
  } | null>;
  readonly timeoutMs?: number | undefined;
}): Promise<ReadonlyMap<string, number>> {
  const ids = [
    ...new Set(input.companyIds.map((id) => id.toLowerCase())),
  ].slice(0, READABLE_COUNT_MAX);
  const counts = new Map<string, number>();
  // A slow room never holds the answer: past the bound it is uncounted.
  const bound = input.timeoutMs ?? READABLE_COUNT_TIMEOUT_MS;
  const outcomes = await Promise.all(
    ids.map((id, index) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), bound);
      });
      return Promise.race([
        input.read(id, index).catch(() => null),
        late,
      ]).finally(() => clearTimeout(timer));
    }),
  );
  outcomes.forEach((outcome, at) => {
    const id = ids[at];
    if (id === undefined || outcome === null || !outcome.result.ok) return;
    const documents = listedDocumentsOf(outcome.result.data);
    if (documents === null) return;
    counts.set(id, readableListed(documents).length);
  });
  return counts;
}

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
      : `For any question about ${company}'s figures, performance or evidence, answer from these documents before saying a figure is not recorded: what was read of them is given as DATA ROOM DOCUMENT facts, and any other can be read now (read_document_pages or read_company_document). Name each document you rely on by its title and period, and offer to open it (open_company_document). Where a document and the deck differ, give both with their periods and explain the difference from the document's own notes and line items for those periods, or say the documents do not explain it; never call either wrong, and never give a reason the documents do not state. They are already shared: never offer to request any of them, and never say ${company} has not provided them. A document not named here is not open to them: never name or guess one.`,
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

/** A word's stem: "hires", "hiring", "hire" → "hir"; "planned" → "plan". */
function stem(word: string): string {
  const cut = word.replace(/(?:ing|ed|es|s|e)$/u, "");
  return /([b-df-hj-np-tv-z])\1$/u.test(cut) ? cut.slice(0, -1) : cut;
}

const STEM_FILLER = new Set([
  "the",
  "and",
  "for",
  "with",
  "what",
  "how",
  "many",
  "much",
  "their",
  "they",
  "this",
  "that",
  "from",
  "about",
  "break",
  "down",
  "tell",
  "show",
  "give",
  "does",
  "have",
  "has",
  "of",
]);

const stemsOf = (text: string): ReadonlySet<string> =>
  new Set(
    (text.toLowerCase().match(/\p{L}{3,}/gu) ?? [])
      .filter((word) => !STEM_FILLER.has(word))
      .map(stem)
      .filter((word) => word.length >= 3),
  );

/**
 * How many content words of the question the document's title shares, by
 * stem. Live run 434ead80 (Thames Arc, 17 Nov 2026): "Break down Halyard
 * Security's planned 2027 hires" read the management accounts and the KPI
 * pack (KINDS weights) and never "Team and hiring plan", the one document
 * that answers it ("hires"/"hiring", "planned"/"plan" share no word), so
 * the answer was built from Q's own recalled earlier words.
 */
function titleStems(question: string, document: ListedDocument): number {
  const asked = stemsOf(question);
  let shared = 0;
  for (const word of stemsOf(document.title)) if (asked.has(word)) shared += 1;
  return shared;
}

/** A title naming what was asked outranks any KINDS weight. */
const TITLE_MATCH = 1;

/**
 * Which documents open to them to read for this turn: never a deck, never
 * one already read this turn; a document whose title names what was asked
 * first (titleStems), then the most evidential (KINDS), the question
 * breaking ties, at most SHARED_READS_MAX.
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
        (titleStems(input.question, document) >= 2
          ? TITLE_MATCH + 0.1 * titleStems(input.question, document)
          : 0) +
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

/**
 * Live scenario D rerun on d252444b1 (16 Nov 2026, run b0a877f8): Q read
 * Halyard's "Team and hiring plan" for the answer, then closed with "Want
 * me to ask Halyard Security for a document that would settle this?". The
 * already-shared check matched the uncertainty against the listing by
 * coverage of the uncertainty's own words, which a long statement never
 * reaches; and a document the run actually read was never consulted.
 *
 * The documents this run read: code's page reads (their DATA ROOM DOCUMENT
 * facts, `Data room: "<title>"`) and the model's own reads in the tool
 * round (read_company_document / read_document_pages results that came
 * back READ). Titles only; a title is the company's own label.
 */
const READ_TOOLS = new Set(["read_company_document", "read_document_pages"]);
const READ_TITLE =
  /"status":"READ","documentId":"[0-9a-f-]{36}","title":"((?:[^"\\]|\\.)*)"/u;

export function documentsReadIn(input: {
  readonly facts: readonly {
    readonly statement: string;
    readonly source?: string | undefined;
  }[];
  readonly toolResults: readonly {
    readonly role: string;
    readonly name?: string | undefined;
    readonly content: string;
  }[];
}): readonly string[] {
  const titles: string[] = [];
  const add = (title: string | null): void => {
    const clean = title?.trim() ?? "";
    if (clean.length > 0 && !titles.includes(clean)) titles.push(clean);
  };
  for (const fact of input.facts) {
    if (!fact.statement.startsWith("DATA ROOM DOCUMENT:")) continue;
    add(/^Data room: "(.+)"$/u.exec(fact.source ?? "")?.[1] ?? null);
  }
  for (const message of input.toolResults) {
    if (message.role !== "TOOL" || !READ_TOOLS.has(message.name ?? "")) {
      continue;
    }
    const quoted = READ_TITLE.exec(message.content)?.[1];
    if (quoted === undefined) continue;
    try {
      const title: unknown = JSON.parse(`"${quoted}"`);
      add(typeof title === "string" ? title : null);
    } catch {
      // A malformed result names no document.
    }
  }
  return titles;
}

/** Words of a title that do not say what the document is. */
const TITLE_FILLER = new Set([
  "a",
  "an",
  "and",
  "the",
  "of",
  "to",
  "for",
  "with",
  "by",
  "from",
  "on",
  "in",
  "at",
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

const titleWord = (word: string): string =>
  word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
    ? word.slice(0, -1)
    : word;

const wordsOf = (text: string): string[] =>
  (text.toLowerCase().match(/\p{L}[\p{L}'-]*/gu) ?? []).flatMap((word) =>
    word.split("-").map(titleWord),
  );

/**
 * The read document an uncertainty or a request is about: most of its
 * title's own words (at least two) are said in it ("the hiring plan gives
 * quarters" for "Team and hiring plan"). Null when none is.
 */
export function readDocumentFor(
  about: string,
  titles: readonly string[],
): string | null {
  const said = new Set(wordsOf(about));
  let best: { title: string; score: number } | null = null;
  for (const title of titles) {
    const own = [
      ...new Set(wordsOf(title).filter((word) => !TITLE_FILLER.has(word))),
    ];
    if (own.length === 0) continue;
    const found = own.filter((word) => said.has(word)).length;
    const score = found / own.length;
    if (found >= 2 && score >= 0.6 && (best === null || score > best.score)) {
      best = { title, score };
    }
  }
  return best?.title ?? null;
}

/** Code's line in place of an offer to request a document just read. */
export function alreadyReadLine(company: string, title: string): string {
  return `I read ${company}'s "${title}" for this answer, so there is no document to request for this; I can open it for you.`;
}

/**
 * Live rerun on bab915357 (16 Nov 2026, Savanna on Tensorgate, turn 1:
 * 23.1 s, 21 tools): a figures question about one company. The figures a
 * question asks for, as code reads the words: cash, burn, runway, revenue
 * and the like. Only ever narrows what is read or waited on for the turn
 * (a figures read bounded to the summary pages, no wait on the public web
 * or the day): anything not read here stays one tool call away.
 */
const ASKED_FIGURES =
  /\b(?:burn(?:s|ing|ed|\s+rate)?|runway|cash(?:\s+balance)?|revenue|mrr|arr|margins?|profit|loss(?:es)?|expenses?|costs?|spend(?:ing)?|financials?|p&l|ebitda|balance|payroll)\b/iu;

/** The turn asks for a company's figures (cash, burn, runway, revenue...). */
export function asksForFigures(question: string): boolean {
  return ASKED_FIGURES.test(question);
}

/**
 * The turn asks whether two sources agree or why they differ ("is that
 * consistent with their deck?", "why don't they match?"). The reader's
 * comparison reading decides first where there is one (the caller ORs it).
 */
const RECONCILES =
  /\b(?:deck|pitch|consistent|consistency|inconsisten\w*|match(?:es|ing)?|differ\w*|discrepan\w*|reconcil\w*|why|explain\w*|conflict\w*|line\s+up|square|agree\w*|compare\w*)\b/iu;
export function asksToReconcile(question: string): boolean {
  return RECONCILES.test(question);
}

/**
 * Which pages a shared document is read for this turn. A figures question
 * reads the summary page (a management pack states the period's cash,
 * burn and runway first); a question about whether the document agrees
 * with the deck reads the pages that also carry the month-by-month lines
 * and their notes. Anything else reads the document as before (bounded by
 * the tool). Pages beyond these stay one read_document_pages call away.
 */
export const FIGURES_SUMMARY_PAGES = 1;
export const RECONCILE_PAGES = 3;
export function sharedPageRange(input: {
  readonly question: string;
  readonly reconcile: boolean;
}): { readonly fromPage: number; readonly toPage: number } | null {
  if (input.reconcile) return { fromPage: 1, toPage: RECONCILE_PAGES };
  if (asksForFigures(input.question)) {
    return { fromPage: 1, toPage: FIGURES_SUMMARY_PAGES };
  }
  return null;
}

/**
 * Live 17 Nov 2026 (production 4f542f5f6, Savanna on Nixo): "What's Nixo's
 * monthly burn and runway?" read page 1 of Nixo's management accounts and
 * of its revenue breakdown, then answered "not established". Which pages
 * carry an asked figure is a property of the document, not of page 1: a
 * pack may open with its summary (Tensorgate's, Halyard's, Nixo's do) or
 * with a basis-of-preparation note, and a balance sheet sits on its last
 * page. So after the bounded first read, code looks for each asked measure
 * in the text it read; a measure found on none of those pages sends the
 * read on, a bounded few pages further in the same document, and only the
 * pages that carry a missing measure are added. A measure still on no page
 * read is then genuinely not in what was read (said so, never guessed).
 *
 * Each measure is a question word and the words a page states it with.
 * Code's own reading of the text, any layout; never a value.
 */
const MEASURES: readonly {
  readonly asked: RegExp;
  readonly stated: RegExp;
}[] = [
  { asked: /\bburn(?:s|ing|ed|\s+rate)?\b/iu, stated: /\bburn\b/iu },
  { asked: /\brunway\b/iu, stated: /\brunway\b/iu },
  { asked: /\bcash\b/iu, stated: /\bcash\b/iu },
  {
    asked: /\b(?:revenue|mrr|arr|sales|turnover)\b/iu,
    stated: /\b(?:revenue|mrr|arr|sales|turnover)\b/iu,
  },
  { asked: /\bmargins?\b/iu, stated: /\bmargins?\b/iu },
  {
    asked: /\b(?:profit|loss(?:es)?|p&l|net\s+result)\b/iu,
    stated: /\b(?:profit|loss|net\s+result)\b/iu,
  },
  {
    asked: /\b(?:expenses?|costs?|spend(?:ing)?|opex)\b/iu,
    stated: /\b(?:expenses?|costs?|payments)\b/iu,
  },
  { asked: /\bpayroll\b/iu, stated: /\bpayroll\b/iu },
  { asked: /\bebitda\b/iu, stated: /\bebitda\b/iu },
  { asked: /\bheadcount\b/iu, stated: /\bheadcount\b/iu },
  {
    asked:
      /\b(?:balance\s+sheet|assets|liabilit(?:y|ies)|equity|receivables|payables)\b/iu,
    stated:
      /\b(?:balance\s+sheet|assets|liabilit(?:y|ies)|equity|receivables|payables)\b/iu,
  },
];

/** The measures a question asks for, by index into MEASURES. */
export function askedMeasures(question: string): readonly number[] {
  return MEASURES.flatMap((measure, index) =>
    measure.asked.test(question) ? [index] : [],
  );
}

/** The asked measures no page read states (by index into MEASURES). */
export function measuresMissing(
  question: string,
  pages: readonly { readonly text: string }[],
): readonly number[] {
  return askedMeasures(question).filter(
    (index) =>
      !pages.some((page) => MEASURES[index]?.stated.test(page.text) === true),
  );
}

/** The pages that state at least one of these measures. */
export function pagesCarrying<P extends { readonly text: string }>(
  pages: readonly P[],
  measures: readonly number[],
): readonly P[] {
  return pages.filter((page) =>
    measures.some((index) => MEASURES[index]?.stated.test(page.text) === true),
  );
}

/** At most this many further pages of one document, once per turn. */
export const FIGURES_FURTHER_PAGES = 3;

/**
 * The further pages to read of a document whose first read carried none
 * of the missing measures; null when the document has no further page.
 */
export function furtherPageRange(input: {
  readonly readTo: number;
  readonly pageCount: number | null;
}): { readonly fromPage: number; readonly toPage: number } | null {
  if (input.pageCount === null || input.pageCount <= input.readTo) return null;
  return {
    fromPage: input.readTo + 1,
    toPage: Math.min(input.pageCount, input.readTo + FIGURES_FURTHER_PAGES),
  };
}

/** A read_document_pages result's pages and page count, as data. */
export function pagesOfRead(data: unknown): {
  readonly pages: readonly { readonly page: number; readonly text: string }[];
  readonly pageCount: number | null;
} {
  if (typeof data !== "object" || data === null) {
    return { pages: [], pageCount: null };
  }
  const raw: unknown = Reflect.get(data, "pages");
  const count: unknown = Reflect.get(data, "pageCount");
  const pages = Array.isArray(raw)
    ? (raw as readonly unknown[]).flatMap((page) => {
        if (typeof page !== "object" || page === null) return [];
        const number: unknown = Reflect.get(page, "page");
        const words: unknown = Reflect.get(page, "text");
        return typeof number === "number" && typeof words === "string"
          ? [{ page: number, text: words }]
          : [];
      })
    : [];
  return {
    pages,
    pageCount: typeof count === "number" ? count : null,
  };
}

/** A sentence that explains a movement, in the document's own words. */
const EXPLAINS =
  /\b(?:adds?|added|includ(?:es?|ed|ing)|due\s+to|because|reflects?|reflecting|one[-\s]off|reserved|offset|driven|higher|lower|increase[sd]?|decrease[sd]?|rose|fell|timing|deferred|non[-\s]recurring|note)\b/iu;
const NOTE_MAX_CHARS = 320;
const NOTES_MAX = 4;

/**
 * The document's own explanatory notes on the pages read: prose lines (not
 * table rows, not its header or watermark) that explain a figure or a
 * movement, verbatim, with their page. Never composed: code quotes, it does
 * not reason about why.
 */
export function documentNotes(
  pages: readonly { readonly page: number; readonly text: string }[],
): readonly { readonly page: number; readonly note: string }[] {
  const notes: { page: number; note: string }[] = [];
  for (const page of pages) {
    for (const raw of page.text.split(/\n+/u)) {
      const line = raw.replace(/\s+/gu, " ").trim();
      if (line.length < 30 || line.includes("|")) continue;
      if (/SYNTHETIC DEMO|NOT A REAL/iu.test(line)) continue;
      const words = line.split(" ").length;
      if (words < 6 || !/[a-z]{3}/u.test(line)) continue;
      if (!EXPLAINS.test(line)) continue;
      if (notes.some((one) => one.note === line)) continue;
      notes.push({ page: page.page, note: line.slice(0, NOTE_MAX_CHARS) });
      if (notes.length >= NOTES_MAX) return notes;
    }
  }
  return notes;
}

/** The period headings on the pages read ("Summary for October 2026"). */
const PERIOD_HEADING =
  /^(?:summary\s+for|balance\s+sheet\s+summary\s+at|cash\s+flow|profit\s+and\s+loss|for\s+the\s+month\s+(?:ended|of)|as\s+at|position\s+at)\b[^|]{0,60}\b(?:19|20)\d{2}\b/iu;
export function documentPeriods(
  pages: readonly { readonly page: number; readonly text: string }[],
): readonly { readonly page: number; readonly period: string }[] {
  const found: { page: number; period: string }[] = [];
  for (const page of pages) {
    for (const raw of page.text.split(/\n+/u)) {
      const line = raw.replace(/\s+/gu, " ").trim();
      const match = PERIOD_HEADING.exec(line);
      if (match === null) continue;
      if (found.some((one) => one.period === match[0])) continue;
      found.push({ page: page.page, period: match[0].slice(0, 80) });
      if (found.length >= 4) return found;
    }
  }
  return found;
}

/** The deck's FINANCIALS figures, as read_company_deck gives them. */
function deckFinancials(deck: unknown): readonly {
  label: string;
  value: string;
  asOf: string | null;
  slide: number | null;
}[] {
  if (typeof deck !== "object" || deck === null) return [];
  const sections: unknown = Reflect.get(deck, "sections");
  if (!Array.isArray(sections)) return [];
  const financials: unknown = sections.find(
    (section: unknown) =>
      typeof section === "object" &&
      section !== null &&
      Reflect.get(section, "section") === "FINANCIALS" &&
      Reflect.get(section, "status") === "PRESENT",
  );
  if (typeof financials !== "object" || financials === null) return [];
  const facts: unknown = Reflect.get(financials, "facts");
  if (!Array.isArray(facts)) return [];
  return facts
    .flatMap((fact: unknown) => {
      if (typeof fact !== "object" || fact === null) return [];
      const label = text(Reflect.get(fact, "label"));
      const value = text(Reflect.get(fact, "value"));
      if (label === null || value === null) return [];
      const pages: unknown = Reflect.get(fact, "pages");
      const slide = Array.isArray(pages)
        ? pages.find(
            (page: unknown): page is number => typeof page === "number",
          )
        : undefined;
      return [
        {
          label: label.slice(0, 80),
          value: value.slice(0, 60),
          asOf: text(Reflect.get(fact, "asOf"))?.slice(0, 40) ?? null,
          slide: slide ?? null,
        },
      ];
    })
    .slice(0, 6);
}

/**
 * Live rerun on bab915357 (turn 2, "Is that consistent with their pitch
 * deck?"): Q gave both figure sets and said they conflict, but not why,
 * though the management accounts carry the period and its line items, and
 * the deck's cash is at 30 Sep while the accounts' is at October's month
 * end. Where a company's deck states figures and a document it shared with
 * them was read, the evidence puts both side by side with their periods,
 * quotes the document's own notes for the figure, and asks the answer to
 * explain the difference from those notes (or to say the documents do not
 * explain it), never calling either figure wrong and never giving a reason
 * the documents do not state. Null when the deck states no figures or no
 * page of the document was read.
 */
export function documentDeckDifferenceFact(input: {
  readonly company: string;
  readonly deck: unknown;
  readonly document: {
    readonly title: string;
    readonly pages: readonly { readonly page: number; readonly text: string }[];
  };
}): AuthorisedFact | null {
  const deck = deckFinancials(input.deck);
  if (deck.length === 0 || input.document.pages.length === 0) return null;
  const periods = documentPeriods(input.document.pages);
  const notes = documentNotes(input.document.pages);
  const deckSaid = deck
    .map(
      (fact) =>
        `${fact.label}: ${fact.value}${fact.asOf === null ? "" : ` (as of ${fact.asOf})`}${fact.slide === null ? "" : `, slide ${String(fact.slide)}`}`,
    )
    .join("; ");
  const periodSaid =
    periods.length === 0
      ? `its own period (named in its title)`
      : periods
          .map((one) => `"${one.period}" (p. ${String(one.page)})`)
          .join(", ");
  const notesSaid =
    notes.length === 0
      ? `The pages read carry no note explaining a movement in these figures; its line items by month (DATA ROOM DOCUMENT facts) may show which costs or receipts changed between the two periods.`
      : `Its own notes on the pages read: ${notes
          .map((one) => `"${one.note}" (p. ${String(one.page)})`)
          .join(" ")}`;
  return {
    scope: "DATA_ROOM",
    statement:
      `${input.company.toUpperCase()}'S DECK AND "${input.document.title}" SIDE BY SIDE (code placed them; neither is wrong). The deck states: ${deckSaid}. The document states its figures for ${periodSaid}. ${notesSaid} When they differ, or they ask whether they match: give both with their periods (the deck's date and the document's month), then explain the difference only from the document's own notes and its line items for those periods; if those do not explain it, say the documents do not explain the difference. Never call either figure wrong, and never give a reason the documents do not state.`.slice(
        0,
        STATEMENT_MAX,
      ),
    // It quotes the company's own claims (deck and document): never more.
    truthClass: "USER_CLAIM",
    evidenceStatus: "DOCUMENT_SUPPORTED",
    source: `Their Data room tab and the deck for ${input.company}`.slice(
      0,
      200,
    ),
  };
}
