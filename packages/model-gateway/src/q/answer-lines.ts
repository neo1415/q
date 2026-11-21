// Moved verbatim from ./index.ts (W3-A, audit finding 4: the god-file split).

import {
  QDocumentToolResultSchema,
  isCalendarBlock,
  type QResultBlock,
} from "@capital-q/contracts";
import { splitSentences } from "@capital-q/q-core";
import { chartNotDrawnLine, type ChartOutcome } from "./figure-chart.js";

/**
 * ADR 0040: the line an app action tool (generated from the registry)
 * returns when it ran or could not: `{ status: DONE | NOT_DONE, says }`.
 * Prepared actions are narrated by the Approval Engine, not here.
 */
/**
 * What Q says when it was asked to do something and did nothing: plainly
 * that it did not, and why, by the kind of miss -- never a status line in
 * place of an answer, and never a claim that anything changed.
 */
/** A reply written without Latin letters (Arabic, Amharic, Chinese...). */
export function repliedInOtherScript(text: string): boolean {
  return /\p{L}/u.test(text) && !/\p{Script=Latin}/u.test(text);
}

/** A sentence of the reply that says it will remember. */
const REMEMBER_SAID =
  /\b(?:i['’]ll|i\s+will|i['’]ve|i\s+have)\s+(?:remember|noted|note|keep\s+(?:that|it)\s+in\s+mind)/iu;
/** A sentence that only acknowledges ("Noted.", "Got it."). */
const ACK_ONLY =
  /^(?:noted|got it|understood|will do|of course|sure|okay|ok|done)$/u;
/**
 * The confirmation of a remember ask (QA 2026-10-24), said by code the same
 * way every time. Q intelligence step 4: whether they asked Q to remember
 * something, and the fact said back to them in the second person, are the
 * reader's (TURN_READER v78 `remember`), read by meaning in any language --
 * never a word pattern over what they said, nor a pronoun swap of it. A
 * fact that would not read back plainly (absent, several sentences, too
 * long) is confirmed without being repeated. Null when the reader read no
 * remember ask, or the turn was not read (the neutral default).
 */
export function rememberConfirmation(
  ask: { readonly fact: string | null } | null | undefined,
): { readonly line: string; readonly fact: string | null } | null {
  if (ask === null || ask === undefined) return null;
  let fact = (ask.fact ?? "").trim();
  while (fact.endsWith(".") || fact.endsWith("!")) {
    fact = fact.slice(0, -1).trimEnd();
  }
  const plain =
    fact.length > 0 &&
    fact.length <= 200 &&
    !fact.includes("\n") &&
    !fact.includes(";") &&
    !fact.includes(". ");
  if (!plain) return { line: "I'll remember that.", fact: null };
  return { line: `I'll remember that ${fact}.`, fact };
}

/**
 * The model's reply after code's confirmation: its own "I'll remember…"
 * and a sentence that only says the fact back are not said twice.
 */
export function withoutRememberTalk(
  text: string,
  remember: { readonly fact: string | null } | null,
): string {
  if (remember === null) return text;
  const bare = (sentence: string): string =>
    sentence
      .toLowerCase()
      .replace(/’/gu, "'")
      .replace(/[^\p{L}\p{N}' ]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
  const fact = remember.fact === null ? null : bare(remember.fact);
  const kept = (sentence: string): boolean =>
    !REMEMBER_SAID.test(sentence) &&
    !ACK_ONLY.test(bare(sentence)) &&
    (fact === null || bare(sentence) !== fact);
  // Line by line, so the reply's paragraphs and lists keep their shape.
  return text
    .split("\n")
    .map((line) =>
      line.trim().length === 0
        ? line
        : line
            .split(/(?<=[.!?])[ \t]+/u)
            .filter(kept)
            .join(" "),
    )
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** A message they asked for, written in the answer but not put on its card. */
export const DRAFT_NOT_ON_CARD_LINE =
  "That draft isn't on a card yet, so nothing has been sent. Say \"prepare it\" and I'll put it on a card for your approval.";

/**
 * Acceptance 2026-11-04 J6: "Show me a chart of Ledgerline's revenue" was
 * answered with the figures, then "I tried, but it didn't go through". No
 * chart was ever going to be drawn: a CHART block has no producer yet
 * (result-blocks visualBlock draws one only from a typed read of evidenced
 * figures, and none exists), and numbers are never lifted from prose to
 * fill one. So the ask is answered plainly as not available yet, never as
 * a failure to retry. Q intelligence step 4: that they asked for a chart is
 * the reader's (TURN_READER v78 `asksForChart`), never a word pattern.
 */
const SAID_NO_CHART =
  /\b(?:couldn['’]?t|could not|can['’]?t|cannot|unable to)\b[^.!?\n]{0,40}\b(?:chart|graph|plot|display|draw)/iu;
// A8 (13 Nov 2026): charts are now drawn by code from the figures a run
// read (figure-chart.ts). This line is for an ask with nothing honest to
// draw: fewer than two comparable, dated, published figures.
export const CHART_NOT_YET_LINE =
  "I can't chart that: I don't have two or more comparable published figures for it. I can give you the figures that are known, with where each one comes from.";

/**
 * The could-not line for a turn with nothing done: a chart they asked for
 * is said plainly as not available yet (null when the answer already says
 * so); anything else is the gap's own line.
 */
export function couldNotLineFor(
  gap: string,
  asksForChart: boolean,
  answerText: string,
  /** A8: what the asked chart came to, for its own honest line. */
  chart: ChartOutcome | null = null,
): string | null {
  if (asksForChart) {
    if (SAID_NO_CHART.test(answerText)) return null;
    return chart === null ? CHART_NOT_YET_LINE : chartNotDrawnLine(chart);
  }
  return couldNotDoLine(gap);
}

export function couldNotDoLine(gap: string): string {
  switch (gap) {
    case "DECLARED_NOT_OFFERED":
      return "I couldn't do that from this conversation: that action isn't available to me here, so nothing was prepared or changed. You can do it from its page, or ask me again from there.";
    case "CALLED_DID_NOTHING":
      return "I tried, but it didn't go through, so nothing was prepared or changed. Ask me again in a moment, or do it from its page.";
    case "NOT_CALLED":
      return "I didn't prepare that, so nothing was changed. Tell me again what you'd like done, and to whom, and I'll prepare it for your approval.";
    default:
      // Not "I couldn't tell which action" (QA 2026-10-03, run 18eb8420):
      // nothing was done, and the one question that moves it is asked --
      // including handing the work over for Q to keep doing.
      // Never a canned "what should I take on?" (QA 2026-10-23): what
      // happened, plainly, and what Q will do next.
      return "I didn't get that done, so nothing was prepared or changed. Tell me again what you'd like and I'll prepare it for your approval.";
  }
}

/**
 * An answer that itself says nothing was (or needs to be) done, and why:
 * the thing is already so, or Q says it can't do it. Read narrowly -- a
 * claim that something WAS done never matches, so a false "done" still
 * gets the could-not line.
 */
const NOTHING_DONE_EXPLAINED =
  /\b(?:already\b|(?:can(?:no|['’])t|couldn['’]t|could not|unable to|not able to|won['’]t be able to)\s+(?:\w+\s+){0,3}?(?:do|express|send|prepar|mak|chang|record|book|shar|request|ask|add|creat|sav|pass|mov|accept|declin|invit)\w*|nothing (?:was|has been|is) (?:done|prepared|changed|needed)|(?:isn['’]t|is not) (?:needed|necessary|possible|available)|no need to|(?:isn['’]t|is not|aren['’]t|are not|you['’]re not|you are not) (?:yet )?connected|(?:the )?(?:next|first) step (?:is|would be)|you['’]d (?:first )?need to)/iu;
export function explainsNothingDone(text: string): boolean {
  return NOTHING_DONE_EXPLAINED.test(text);
}

/**
 * An answer that says a change WAS made: "are now recorded", "I've saved
 * it", "has been updated". Only consulted when code knows nothing was
 * done, so a match is a false claim and is not said.
 */
const DONE_CLAIMED =
  /\b(?:(?:is|are) now (?:recorded|saved|set|updated|changed|live|in place)|(?:i|i['’]ve|i have|we['’]ve|we have) (?:just )?(?:saved|updated|changed|recorded|sent|booked|set|added|removed|made|drafted|prepared|written|wrote)|(?:has|have) (?:now )?been (?:saved|updated|changed|recorded|sent|booked|set|added|removed)|(?:it['’]s|that['’]s) (?:done|saved|updated))\b/iu;
/**
 * Guard run (2026-10-25, run a3f0e2b0): "Understood." was the whole reply
 * while the answer's findings were on screen. With no words left, the
 * reply says what the answer shows: its first findings, as recorded.
 */
export function shownFindingsLine(
  blocks: readonly QResultBlock[] | undefined,
): string | null {
  const said = (blocks ?? [])
    .flatMap((block) =>
      block.kind === "FINDING" ? [block.finding.statement.trim()] : [],
    )
    .filter((statement) => statement.length > 0)
    .slice(0, 2)
    .map((statement) =>
      /[.!?]$/u.test(statement) ? statement : `${statement}.`,
    );
  return said.length === 0 ? null : said.join(" ");
}

export function claimsDone(text: string): boolean {
  return DONE_CLAIMED.test(text) && !NOTHING_DONE_EXPLAINED.test(text);
}

/** A reply that puts a question to the person: any sentence ending "?". */
export function asksThePerson(text: string): boolean {
  return /\?["'’”)]*(?:\s|$)/u.test(text);
}

/**
 * The names the turn's reader heard: whom the turn is about (v58
 * namedOther) and the names of a comparison (v62). Empty before the
 * reading is in, so a warmed read never binds a sentence's first word.
 */
export function heardNames(request: {
  readonly namedOther?: { readonly name: string } | null | undefined;
  readonly compare?: { readonly names: readonly string[] } | null | undefined;
}): readonly string[] {
  return [
    ...(request.namedOther?.name === undefined
      ? []
      : [request.namedOther.name]),
    ...(request.compare?.names ?? []),
  ];
}

/**
 * XLSX-002 (live 2026-10-28, the pipeline spreadsheet answered with only
 * "Want me to add a separate tab…?"): a document tool's own receipt, read
 * from its authorised result by its closed schema -- a document filed with
 * `says`, or make_spreadsheet's nothing-to-put-in-it / failed line. Null
 * when the result carries none.
 */
export function documentReceiptOf(
  toolName: string,
  data: unknown,
): string | null {
  const filed = QDocumentToolResultSchema.safeParse(data);
  if (filed.success) return filed.data.says ?? null;
  if (toolName !== "make_spreadsheet") return null;
  const record = (typeof data === "object" && data !== null ? data : {}) as {
    readonly status?: unknown;
    readonly says?: unknown;
  };
  return (record.status === "NOTHING_TO_PUT_IN_IT" ||
    record.status === "FAILED") &&
    typeof record.says === "string" &&
    record.says.trim().length > 0
    ? record.says.trim()
    : null;
}

/** A sentence that asks the person something: it ends in a question mark. */
export function isAsk(sentence: string): boolean {
  return /[?？؟]["'”’)]*\s*$/u.test(sentence.trim());
}

/**
 * Live 2026-10-30 (founder.ledgerbridge, "What should I do today?"): the
 * answer ended with the model's "Want me to take you to the verification
 * area?" and then code's plan offer -- two asks, so a "yes" could bind to
 * either. The note telling the model not to offer did not hold, so this is
 * structural, not a matter of its words: when code closes an answer with
 * its own recorded offer, the model's trailing questions -- every sentence
 * at the end of its text that ends in a question mark, whatever it asks --
 * are dropped. A question mark is how a sentence asks for a reply, and
 * code's offer is the one reply this answer may take. A question in the
 * middle, with the model's prose after it, is kept as written.
 */
export function withoutTrailingAsks(text: string): string {
  const sentences = splitSentences(text);
  let end = sentences.length;
  while (end > 0 && isAsk(sentences[end - 1] ?? "")) end -= 1;
  if (end === sentences.length) return text;
  return sentences.slice(0, end).join("").trim();
}

/**
 * After a receipt, the model's words carry at most one offer: of its
 * questions, only the last stays (each sentence that ends in a question
 * mark is one; the rest of what it said is kept as written).
 */
export function atMostOneOffer(text: string): string {
  const sentences = splitSentences(text);
  const asks = sentences
    .map((sentence, at) => ({ at, ask: /[?？؟]\s*$/u.test(sentence) }))
    .filter((one) => one.ask);
  if (asks.length <= 1) return text;
  const last = asks.at(-1)?.at;
  return sentences
    .filter((sentence, at) => !/[?？؟]\s*$/u.test(sentence) || at === last)
    .join("")
    .trim();
}

/** Batch 19: a prepared app action's own line (what it will change). */
export function preparedLineOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as { readonly status?: unknown; readonly says?: unknown };
  return record.status === "PREPARED" &&
    typeof record.says === "string" &&
    record.says.trim().length > 0
    ? record.says.trim()
    : null;
}

/**
 * Batch 19: whether an app action acted on the person's own records (true),
 * on anything else (false), or is no app action at all (null).
 */
export function ownRecordOf(data: unknown): boolean | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as {
    readonly status?: unknown;
    readonly ownRecord?: unknown;
  };
  if (record.status !== "PREPARED" && record.status !== "DONE") return null;
  return record.ownRecord === true;
}

export function appActionLineOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as { readonly status?: unknown; readonly says?: unknown };
  // meetfix-57: a call blocked on the organiser's calendar is said in
  // Capital Q's words too -- the typed reason and its fix, never the
  // generic could-not line.
  return (record.status === "DONE" ||
    record.status === "NOT_DONE" ||
    isCalendarBlock(record.status)) &&
    typeof record.says === "string" &&
    record.says.trim().length > 0
    ? record.says.trim()
    : null;
}
