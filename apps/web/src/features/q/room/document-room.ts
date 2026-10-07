import {
  QDocumentActIntentSchema,
  type QDocumentActIntent,
} from "@capital-q/contracts";

import type { QTurn } from "../conversation";

/**
 * Q room W3 (R3, R6): the document open in the Q room, worked by asking.
 * Code only, never a model: what a page act does, which lines of an
 * answer cite which page, which sentence Q is reading, when the viewer
 * closes as the conversation moves on and reopens when the subject comes
 * back, and when a long web answer is offered as a PDF.
 */

export type DocumentPosition = {
  readonly page: number;
  /** Pages in the document; null until the viewer has read it. */
  readonly pageCount: number | null;
};

/** Where a page act moves the viewer; null when it does not page. */
export function pageAfter(
  position: DocumentPosition,
  act: QDocumentActIntent,
): number | null {
  const last = position.pageCount ?? Number.POSITIVE_INFINITY;
  const clamp = (page: number) => Math.max(1, Math.min(last, page));
  switch (act.act) {
    case "NEXT_PAGE":
      return clamp(position.page + 1);
    case "PREVIOUS_PAGE":
      return clamp(position.page - 1);
    case "GO_TO_PAGE":
      return act.page === undefined ? null : clamp(act.page);
    case "READ_ALOUD":
      return act.page === undefined ? null : clamp(act.page);
    case "STOP_READING":
    case "SUMMARISE":
    case "DOWNLOAD":
    case "CLOSE":
      return null;
  }
}

/** The document acts an answer carries, in order (validated again here). */
export function documentActsOf(turn: QTurn): readonly QDocumentActIntent[] {
  if (turn.kind !== "Q") return [];
  const out: QDocumentActIntent[] = [];
  for (const block of turn.blocks) {
    if (block.kind !== "UI_INTENT") continue;
    const parsed = QDocumentActIntentSchema.safeParse(block.intent);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export type CitedLine = {
  readonly text: string;
  /** The pages the line cites, in its own order. */
  readonly pages: readonly number[];
};

const CITATION = /\((?:p|pp|page|pages)\.?\s*(\d{1,5})(?:\s*[-–]\s*(\d{1,5}))?\)/giu;

/**
 * The page-cited lines of an answer ("Revenue grew 40% (p. 3)"): the
 * summary column shows these, each a link to its page. A line with no
 * page citation is not a summary line; nothing is inferred.
 */
export function citedLines(text: string): readonly CitedLine[] {
  const out: CitedLine[] = [];
  for (const raw of text.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9*•-])/u)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "").trim();
    if (line.length === 0) continue;
    const pages: number[] = [];
    for (const match of line.matchAll(CITATION)) {
      const from = Number(match[1]);
      const to = match[2] === undefined ? from : Number(match[2]);
      if (from >= 1 && !pages.includes(from)) pages.push(from);
      if (to > from && !pages.includes(to)) pages.push(to);
    }
    if (pages.length === 0) continue;
    out.push({
      text: line.replace(/\*\*/gu, "").replace(CITATION, "").trim(),
      pages,
    });
  }
  return out;
}

/** A page's text as sentences, for the read-aloud highlight. */
export function sentencesOf(text: string): readonly string[] {
  return (text.replace(/\s+/gu, " ").trim().match(/[^.!?]+[.!?]*/gu) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

const wordsOf = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((word) => word.length >= 3);

/**
 * The sentence of the page Q is saying now, by the words they share; null
 * when nothing said matches well enough (Q giving the gist in its own
 * words highlights nothing rather than the wrong line).
 */
export function sentenceSaid(
  sentences: readonly string[],
  said: string,
  from = 0,
): number | null {
  const heard = new Set(wordsOf(said));
  if (heard.size === 0) return null;
  let best: { readonly at: number; readonly score: number } | null = null;
  for (let at = 0; at < sentences.length; at += 1) {
    const words = wordsOf(sentences[at] ?? "");
    if (words.length === 0) continue;
    const shared = words.filter((word) => heard.has(word)).length;
    // Reading moves forward: a later sentence wins a tie.
    const score = shared / Math.max(words.length, 3) + (at >= from ? 0.01 : 0);
    if (best === null || score > best.score) best = { at, score };
  }
  return best !== null && best.score >= 0.5 ? best.at : null;
}

/** How long a sentence takes to say, for the highlight without a voice. */
export function speakingMs(sentence: string): number {
  const words = sentence.split(/\s+/u).filter((word) => word.length > 0);
  return Math.max(1_200, Math.round((words.length / 2.6) * 1_000));
}

const CLOSE_WORDS =
  /^\s*(please\s+)?(close|shut|hide|dismiss|put away)\b.*$/iu;

/** Words that keep talk on the open document. */
const ON_DOCUMENT = [
  "it",
  "this",
  "that",
  "page",
  "pages",
  "next",
  "previous",
  "back",
  "read",
  "reading",
  "summarise",
  "summarize",
  "summary",
  "download",
  "document",
  "doc",
  "file",
  "pdf",
  "section",
  "paragraph",
  "line",
  "says",
  "stop",
  "continue",
  "yes",
  "no",
];

function folded(text: string): string {
  return ` ${text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

const GENERIC_TITLE = new Set([
  "the",
  "and",
  "for",
  "with",
  "document",
  "final",
  "draft",
  "copy",
  "version",
  "signed",
]);

/** The words of a document's title that name it ("incorporation"). */
export function titleWords(title: string | null): readonly string[] {
  if (title === null) return [];
  return folded(title)
    .trim()
    .split(" ")
    .filter((word) => word.length >= 4 && !GENERIC_TITLE.has(word));
}

/** Whether these words are about the document: its name, or pointing at it. */
export function aboutDocument(text: string, title: string | null): boolean {
  const said = folded(text);
  return (
    titleWords(title).some((word) => said.includes(` ${word} `)) ||
    ON_DOCUMENT.some((word) => said.includes(` ${word} `))
  );
}

/**
 * When the document open in the room closes (founder clarification, 6
 * October): they ask to close it; Q's answer puts something else on
 * screen (another document, other cards, a page); or they ask about
 * something else and Q's answer does not come back to it. A document
 * being read stays while the talk is on it.
 */
export function documentShouldClose(
  turnsSinceOpen: readonly QTurn[],
  documentId: string,
  title: string | null,
): boolean {
  let asked: string | null = null;
  for (const turn of turnsSinceOpen) {
    if (turn.kind === "PERSON") {
      if (CLOSE_WORDS.test(turn.text)) return true;
      asked = turn.text;
      continue;
    }
    if (turn.kind !== "Q" || turn.streaming) continue;
    let acted = false;
    for (const block of turn.blocks) {
      if (block.kind === "ANSWER_CARDS" || block.kind === "COMPARISON_CARDS") {
        return true;
      }
      if (block.kind !== "UI_INTENT") continue;
      const intent = block.intent;
      if (intent.kind === "DOCUMENT_ACT") {
        if (intent.act === "CLOSE") return true;
        acted = true;
        continue;
      }
      const same =
        intent.kind === "OPEN_RECORD_PAGE" &&
        intent.page === "DATA_ROOM_DOCUMENT" &&
        intent.id.toLowerCase() === documentId.toLowerCase();
      if (!same) return true;
      acted = true;
    }
    if (
      !acted &&
      asked !== null &&
      !aboutDocument(asked, title) &&
      !titleWords(title).some((word) => folded(turn.text).includes(` ${word} `))
    ) {
      return true;
    }
    asked = null;
  }
  return false;
}

/**
 * A document that closed as the conversation moved on, to reopen when its
 * subject comes back: the newest whose name the person says again.
 */
export function documentToReopen<T extends { readonly title: string | null }>(
  said: string,
  closed: readonly T[],
): T | null {
  const text = folded(said);
  if (CLOSE_WORDS.test(said)) return null;
  for (const document of [...closed].reverse()) {
    const words = titleWords(document.title);
    if (words.length > 0 && words.some((word) => text.includes(` ${word} `))) {
      return document;
    }
  }
  return null;
}

/** A long web or news answer gets "Want it as a PDF?" (R6). */
export const PDF_OFFER_MIN_WORDS = 400;

export type PdfOffer = {
  readonly answerId: string;
  readonly runId: string;
  readonly words: number;
};

/** The offer for the latest answer, if it read the web and runs long. */
export function pdfOfferOf(turns: readonly QTurn[]): PdfOffer | null {
  const latest = turns.findLast(
    (turn): turn is Extract<QTurn, { kind: "Q" }> => turn.kind === "Q",
  );
  if (
    latest === undefined ||
    latest.streaming ||
    latest.runId === undefined ||
    latest.publicSources.length === 0
  ) {
    return null;
  }
  const words = latest.text.split(/\s+/u).filter((w) => w.length > 0).length;
  return words >= PDF_OFFER_MIN_WORDS
    ? { answerId: latest.id, runId: latest.runId, words }
    : null;
}

/** "That's about 1,100 words." */
export function offerLine(words: number): string {
  const rounded = words >= 1_000 ? Math.round(words / 100) * 100 : Math.round(words / 50) * 50;
  return `That's about ${rounded.toLocaleString("en-GB")} words. Want it as a PDF?`;
}

/** The person's yes or no to the offer, said or typed; null otherwise. */
export function answerToOffer(text: string): "YES" | "NO" | null {
  const said = text.trim().toLowerCase().replace(/[.!]+$/u, "");
  if (
    /^(yes|yeah|yep|sure|ok|okay|please|go on|go ahead|do it|yes please|sure thing|make it a pdf|make the pdf|as a pdf|pdf please)( please)?$/u.test(
      said,
    )
  ) {
    return "YES";
  }
  if (/^(no|nope|no thanks|no thank you|not now|nah|skip it|it's fine)$/u.test(said)) {
    return "NO";
  }
  return null;
}
