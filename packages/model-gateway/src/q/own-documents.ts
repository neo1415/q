import type { AuthorisedFact } from "@capital-q/q-core";
import type { QToolCallOutcome, QToolProposal } from "@capital-q/q-runtime";

import {
  DATA_ROOM_FACTS_MAX_CHARS,
  dataRoomDocumentFacts,
} from "./data-room-document-fact.js";
import { documentDeckDifferenceFact } from "./shared-documents.js";

/**
 * Live 16 Nov 2026 (production b156a9cd1, Halyard's founder, conversation
 * d3d81729): ADR 0079 lets a founder's own Q read their own company's
 * highly confidential documents, but Q read them only when the founder
 * named them (run c5b0f789). For "what's most worth fixing before the
 * raise?" (278141d8), "which of our figures do our documents back up?"
 * (5f75f14f) and "does anything contradict our deck?" (d178c978) no
 * document was read: Q said nothing corroborated the deck's cash, burn and
 * runway (the management accounts do) and asked for a cap table, a cash
 * bridge, invoices and bank statements already uploaded.
 *
 * The founder mirror of shared-documents.ts. On a founder's own question
 * about their company -- the turn reader's question kind (THEIR_OWN_RECORDS
 * or ADVICE) and execution class, never a word list -- code lists what
 * their company uploaded through list_uploaded_documents (as them; their
 * own organisation's evidence only), and pre-reads, bounded, the most
 * useful pages through read_document_pages under ADR 0079's membership
 * check (re-checked at the read; provenance `ownCompanyRead`). RESTRICTED
 * material stays held back: it is named, never read. What the documents
 * state is the company's own material (USER_CLAIM, DOCUMENT_SUPPORTED);
 * the listing itself is the platform's record.
 */

/** One document their company uploaded, from list_uploaded_documents. */
export type UploadedDocument = {
  readonly documentId: string;
  readonly title: string;
  readonly documentType: string | null;
  /** Held back from Q by classification (RESTRICTED): never read. */
  readonly heldBack: boolean;
  readonly updatedAt: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** heldBackFromQ's own opening (q-tools own-records.ts). */
const HELD_BACK = /^Held back from Q\b/u;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/** list_uploaded_documents' items; null when malformed. */
export function uploadedDocumentsOf(
  data: unknown,
): readonly UploadedDocument[] | null {
  if (typeof data !== "object" || data === null) return null;
  const items: unknown = Reflect.get(data, "items");
  if (!Array.isArray(items)) return null;
  return items.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const documentId = text(Reflect.get(item, "documentId"));
    const title = text(Reflect.get(item, "title"));
    if (documentId === null || !UUID.test(documentId) || title === null) {
      return [];
    }
    const qUse = text(Reflect.get(item, "qUse"));
    return [
      {
        documentId: documentId.toLowerCase(),
        title: title.slice(0, 200),
        documentType: text(Reflect.get(item, "documentType")),
        heldBack: qUse !== null && HELD_BACK.test(qUse),
        updatedAt: text(Reflect.get(item, "updatedAt")),
      },
    ];
  });
}

/** Execution classes that never take this read (no evidence question). */
const NOT_AN_EVIDENCE_TURN: ReadonlySet<string> = new Set([
  "CONVERSATIONAL_ACK",
  "NAVIGATION",
  "STRUCTURED_QUERY",
  "PUBLIC_RESEARCH",
  "CONSEQUENTIAL_ACTION",
]);

/**
 * A founder's question about their own company's evidence, figures, gaps,
 * readiness or contradictions, as the turn reader read it: a question to Q
 * (not a document being written, not an action), of kind THEIR_OWN_RECORDS
 * or ADVICE, about their own company rather than someone else, in an
 * execution class that answers a question. An investor never takes it.
 */
export function ownEvidenceTurn(input: {
  readonly side: "FOUNDER" | "INVESTOR";
  readonly questionKind?: string | undefined;
  readonly executionClass?: string | undefined;
  readonly turnKind?: string | undefined;
  readonly writingDocument?: boolean | undefined;
  readonly aboutSomeoneElse: boolean;
}): boolean {
  return (
    input.side === "FOUNDER" &&
    !input.aboutSomeoneElse &&
    input.writingDocument !== true &&
    (input.turnKind === undefined || input.turnKind === "QUESTION_TO_Q") &&
    (input.questionKind === "THEIR_OWN_RECORDS" ||
      input.questionKind === "ADVICE") &&
    (input.executionClass === undefined ||
      !NOT_AN_EVIDENCE_TURN.has(input.executionClass))
  );
}

/** How many of their documents one turn pre-reads, beside the listing. */
export const OWN_READS_MAX = 2;
/** The pages read of each: the summary and the month-by-month lines. */
export const OWN_PAGES = { fromPage: 1, toPage: 3 } as const;

const DECK = /\b(?:deck|pitch|slides?)\b/iu;
/** What a document is, by its type and title; one read per kind. */
type Kind = "ACCOUNTS" | "REVENUE" | "OWNERSHIP" | "BANK" | "FINANCIAL";
function kindOf(document: UploadedDocument): Kind | null {
  const words = document.title;
  if (
    document.documentType === "MANAGEMENT_ACCOUNTS" ||
    /\bmanagement\s+accounts?\b/iu.test(words)
  ) {
    return "ACCOUNTS";
  }
  if (/\b(?:invoices?|revenue|receivables?|sales\s+ledger)\b/iu.test(words)) {
    return "REVENUE";
  }
  if (
    /\b(?:cap(?:itali[sz]ation)?\s+table|shareholders?|ownership)\b/iu.test(
      words,
    )
  ) {
    return "OWNERSHIP";
  }
  if (/\bbank\b/iu.test(words)) return "BANK";
  if (
    document.documentType === "FINANCIAL" ||
    document.documentType === "FINANCIAL_MODEL"
  ) {
    return "FINANCIAL";
  }
  return null;
}

/**
 * Their question is about who owns the company. It only orders which
 * document fills the second read (the cap table before the revenue
 * evidence); every document stays one read_document_pages call away.
 */
const OWNERSHIP_ASKED =
  /\b(?:cap\s+table|ownership|owns|owned|dilut\w*|shareholders?|equity|stakes?|option\s+pool|esop)\b/iu;

const WEIGHT: Readonly<Record<Kind, number>> = {
  ACCOUNTS: 1,
  REVENUE: 0.7,
  BANK: 0.5,
  FINANCIAL: 0.4,
  OWNERSHIP: 0.3,
};

/**
 * Which of their documents to pre-read: never a deck (its figures come
 * from read_company_deck), never one held back, at most one of each kind
 * (the latest), management accounts first, then the revenue evidence
 * (invoice register, revenue breakdown) -- or the cap table when they ask
 * about ownership -- at most OWN_READS_MAX.
 */
export function ownDocumentReads(input: {
  readonly documents: readonly UploadedDocument[];
  readonly question: string;
  readonly max?: number | undefined;
}): readonly UploadedDocument[] {
  const ownership = OWNERSHIP_ASKED.test(input.question);
  const byKind = new Map<Kind, UploadedDocument>();
  for (const document of input.documents) {
    if (
      document.heldBack ||
      document.documentType === "PITCH_DECK" ||
      DECK.test(document.title)
    ) {
      continue;
    }
    const kind = kindOf(document);
    if (kind === null) continue;
    const kept = byKind.get(kind);
    if (
      kept === undefined ||
      (document.updatedAt ?? "") > (kept.updatedAt ?? "")
    )
      byKind.set(kind, document);
  }
  const weight = (kind: Kind): number =>
    kind === "OWNERSHIP" && ownership ? 0.9 : WEIGHT[kind];
  return [...byKind.entries()]
    .sort(([left], [right]) => weight(right) - weight(left))
    .slice(0, input.max ?? OWN_READS_MAX)
    .map(([, document]) => document);
}

const STATEMENT_MAX = 7_800;
const typeWords = (type: string | null): string =>
  type === null || type === "UNCLASSIFIED" || type === "OTHER"
    ? ""
    : ` (${type.toLowerCase().replace(/_/gu, " ")})`;

/**
 * The fact: what their company has uploaded, by title (each names its
 * period) and type, which are held back, and that none of them is ever
 * asked for again. Null when nothing is uploaded.
 */
export function ownDocumentsFact(
  documents: readonly UploadedDocument[],
): AuthorisedFact | null {
  if (documents.length === 0) return null;
  const readable = documents.filter((document) => !document.heldBack);
  const held = documents.filter((document) => document.heldBack);
  const quoted = (document: UploadedDocument) =>
    `"${document.title}"${typeWords(document.documentType)}`;
  const parts = [
    readable.length === 0
      ? ""
      : `DOCUMENTS THEY HAVE UPLOADED (their own company's, on Capital Q; each title names its period): ${readable.map(quoted).join("; ")}.`,
    held.length === 0
      ? ""
      : `Also uploaded but held back from Q by classification (restricted; never read, no model receives them): ${held.map(quoted).join("; ")}.`,
    readable.length === 0
      ? ""
      : `For any question about their figures, evidence, gaps, readiness or contradictions, answer from these documents before saying a figure is not backed up or a document is missing: what was read of them is given as DATA ROOM DOCUMENT facts, and any other can be read now (read_document_pages, by its title). Name each document you rely on by its title and period and cite its pages. Their highly confidential documents are their company's own management material: say "your management accounts show...", document-supported, not independently verified. Where a document and the deck differ, give both with their periods and explain the difference only from the document's own notes and line items, or say the documents do not explain it; never call either wrong.`,
    `Never ask them to upload, provide or send a document listed here (management accounts, invoices, bank statements, a cap table or anything else): name it and use it, or say which part of it needs bringing up to date. Only a kind of document not listed here may be suggested as missing.`,
  ];
  return {
    scope: "DATA_ROOM",
    statement: parts
      .filter((part) => part.length > 0)
      .join(" ")
      .slice(0, STATEMENT_MAX),
    truthClass: "VERIFIED",
    evidenceStatus: "PLATFORM_VERIFIED",
    source: "Their company's uploaded documents on Capital Q",
  };
}

/** The pages a read_document_pages result carries. */
function pagesOf(data: unknown): readonly { page: number; text: string }[] {
  if (typeof data !== "object" || data === null) return [];
  const pages: unknown = Reflect.get(data, "pages");
  if (!Array.isArray(pages)) return [];
  return pages.flatMap((page: unknown) => {
    if (typeof page !== "object" || page === null) return [];
    const number: unknown = Reflect.get(page, "page");
    const words: unknown = Reflect.get(page, "text");
    return typeof number === "number" && typeof words === "string"
      ? [{ page: number, text: words }]
      : [];
  });
}

type Execute = (proposal: QToolProposal) => Promise<QToolCallOutcome>;

/**
 * The reads, side by side: the listing and (their company known) their
 * deck at once, then the chosen documents' pages in parallel. Every call
 * goes through the run's tools under its plan, as them; a read the tools
 * refuse (no current membership, another company, RESTRICTED) adds
 * nothing. Never throws: a failed read costs the answer its facts.
 */
export async function readOwnDocuments(input: {
  readonly execute: Execute;
  readonly available: ReadonlySet<string>;
  readonly ownCompanyId: string | null;
  readonly question: string;
}): Promise<readonly AuthorisedFact[]> {
  if (!input.available.has("list_uploaded_documents")) return [];
  const attempt = (proposal: QToolProposal) =>
    input.execute(proposal).catch(() => null);
  const deckRead =
    input.ownCompanyId !== null && input.available.has("read_company_deck")
      ? attempt({
          callId: "q-own-deck",
          name: "read_company_deck",
          arguments: { companyId: input.ownCompanyId },
        })
      : Promise.resolve(null);
  const listing = await attempt({
    callId: "q-own-documents",
    name: "list_uploaded_documents",
    arguments: {},
  });
  const documents =
    listing?.result.ok === true
      ? uploadedDocumentsOf(listing.result.data)
      : null;
  if (documents === null || documents.length === 0) {
    deckRead.catch(() => undefined);
    return [];
  }
  const facts: AuthorisedFact[] = [];
  const listed = ownDocumentsFact(documents);
  if (listed !== null) facts.push(listed);
  const chosen = input.available.has("read_document_pages")
    ? ownDocumentReads({ documents, question: input.question })
    : [];
  const reads = await Promise.all(
    chosen.map(async (document, at) => ({
      document,
      outcome: await attempt({
        callId: `q-own-document-${String(at)}`,
        name: "read_document_pages",
        arguments: {
          ...(input.ownCompanyId === null
            ? {}
            : { companyId: input.ownCompanyId }),
          documentId: document.documentId,
          ...OWN_PAGES,
        },
      }),
    })),
  );
  const deck = await deckRead;
  const share = Math.floor(
    DATA_ROOM_FACTS_MAX_CHARS / Math.max(reads.length, 1),
  );
  let differenceGiven = false;
  for (const { document, outcome } of reads) {
    if (outcome?.result.ok !== true) continue;
    const data: unknown = outcome.result.data;
    const read = dataRoomDocumentFacts(
      data,
      {
        companyId: input.ownCompanyId ?? "",
        documentId: document.documentId,
        open: false,
        own: true,
      },
      share,
    );
    if (read.length === 0) continue;
    facts.push(...read);
    // Their deck's figures beside the document's, with both periods and the
    // document's own notes (the investor side's difference fact).
    if (differenceGiven || deck?.result.ok !== true) continue;
    const difference = documentDeckDifferenceFact({
      company: "their company",
      deck: deck.result.data,
      document: {
        title:
          typeof data === "object" && data !== null
            ? (text(Reflect.get(data, "title")) ?? document.title)
            : document.title,
        pages: pagesOf(data),
      },
    });
    if (difference !== null) {
      facts.push({
        ...difference,
        source: "Their own uploaded documents and their deck",
      });
      differenceGiven = true;
    }
  }
  return facts;
}
