// W3-B (audit finding 4): moved unchanged out of answer.ts, which
// re-exports what it exported. Here: what a turn asks for after a move: screen acts, questions, work products and a city.
import { type QResultBlock, type QUiIntent } from "@capital-q/contracts";
import { askerSideOf } from "@capital-q/model-gateway/q";
import {
  type QAnswerRequest,
  type QConversationMessage,
} from "@capital-q/q-runtime";
import { zoneFromWords } from "@capital-q/q-tools";

import { type InstantPageAct, instantRequestOf } from "./instant-request.js";
import { pageRequestOf } from "./page-request.js";
import { tabAskOf } from "./tab-request.js";
import { type TeamJobAudience } from "./team-job.js";

/**
 * The few bare screen commands done in code (scroll, top, bottom, back).
 * Deliberately narrow: the whole message must be the command, optionally
 * with "Q", "please" or "the page", so a question never matches.
 */
export function screenActOf(text: string): {
  readonly act:
    "PAGE_DOWN" | "PAGE_UP" | "SCROLL_TOP" | "SCROLL_BOTTOM" | "GO_BACK";
  readonly said: string;
} | null {
  const t = text
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\b(hey|ok|okay|hi|hello)\s+q\b/g, " ")
    .replace(
      /\b(please|q|can you|could you|now|for me|a bit|a little|the page|this page|on this page|on the page)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(scroll|go|move) down( more)?$|^(scroll|page) down$|^keep scrolling$|^scroll$/.test(
      t,
    )
  ) {
    return { act: "PAGE_DOWN", said: "Scrolling down." };
  }
  if (/^(scroll|go|move|page) up$/.test(t))
    return { act: "PAGE_UP", said: "Scrolling up." };
  if (
    /^(scroll |go |take me )?(to )?(the )?top$|^back to (the )?top$/.test(t)
  ) {
    return { act: "SCROLL_TOP", said: "Back to the top." };
  }
  if (/^(scroll |go |take me )?(to )?(the )?bottom$/.test(t)) {
    return { act: "SCROLL_BOTTOM", said: "To the bottom." };
  }
  if (/^go back$|^back$|^go to the previous page$/.test(t)) {
    return { act: "GO_BACK", said: "Going back." };
  }
  return null;
}

/**
 * Lane 7 (instant nav): the page acts the browser now does by code are
 * done here too when a turn still reaches Q (the duplex line routes the
 * words as well), with the same screen act and words: 0 model calls, and
 * the browser drops a repeat of an act it just did. Only acts with a
 * screen-act equivalent: close, a press by name and the theme need a
 * control resolved or a tool's authorize step, so they keep the normal
 * path (and its early reading).
 */
const INSTANT_SCREEN_ACTS: Readonly<
  Partial<Record<InstantPageAct, NonNullable<ReturnType<typeof screenActOf>>>>
> = {
  BACK: { act: "GO_BACK", said: "Going back." },
  SCROLL_DOWN: { act: "PAGE_DOWN", said: "Scrolling down." },
  SCROLL_UP: { act: "PAGE_UP", said: "Scrolling up." },
  SCROLL_TOP: { act: "SCROLL_TOP", said: "Back to the top." },
  SCROLL_BOTTOM: { act: "SCROLL_BOTTOM", said: "To the bottom." },
};

export function screenActOfTurn(text: string): ReturnType<typeof screenActOf> {
  const direct = screenActOf(text);
  if (direct !== null) return direct;
  const instant = instantRequestOf(text);
  return instant?.kind === "PAGE_ACT"
    ? (INSTANT_SCREEN_ACTS[instant.act] ?? null)
    : null;
}

/** Whether Q's last answer put cards on screen ("the first one" means a card then). */
export function lastAnswerShowedCards(
  history: readonly QConversationMessage[],
): boolean {
  const lastQ = [...history].reverse().find((m) => m.role === "Q");
  return (lastQ?.blocks ?? []).some(
    (block) =>
      block.kind === "ANSWER_CARDS" ||
      block.kind === "COMPANY_REFERENCE" ||
      block.kind === "INVESTOR_REFERENCE" ||
      block.kind === "COMPARISON_CARDS",
  );
}

/** The record page this intent opens is the one the person is looking at. */
export function alreadyOnScreen(
  request: QAnswerRequest,
  intent: Extract<QUiIntent, { kind: "OPEN_RECORD_PAGE" }>,
): boolean {
  const screen = request.plan.screen;
  if (screen === undefined || intent.tab !== undefined) return false;
  return (
    intent.page === "COMPANY" &&
    (screen.route === "COMPANY" || screen.route === "PITCH") &&
    screen.companyId === intent.id
  );
}

/**
 * U4/F8: the words ask for a move and then a question about it ("open the
 * data room and tell me what's missing", "go to my pipeline, who's
 * waiting?"): a later clause is a question.
 */
export function questionAfterMove(text: string): boolean {
  const clauses = text
    .split(/\s*(?:,|;|\band\b|\bthen\b)\s*/iu)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
  return clauses
    .slice(1)
    .some((clause) => asksAQuestion(clause) || asksToBeShownContent(clause));
}

/**
 * U4/F8, A3: a move the words asked for beside more (a question, or
 * something to be shown), carried by the answer to the rest. The
 * conversation and the record's name let Q say plainly what was done
 * when the rest could not be answered.
 */
export type MoveWithQuestion = {
  readonly blocks: readonly QResultBlock[];
  readonly conversationId?: QConversationMessage["conversationId"] | undefined;
  /** The record opened, as Q says it ("Ledgerline"); absent for a page. */
  readonly opened?: string | undefined;
};

/**
 * A3: the move was made and the rest of the ask was not answered. Says
 * what was done, what was not, and why, in the person's terms -- never a
 * provider or a code.
 */
export function movedButNotAnsweredLine(
  opened: string | undefined,
  code: string,
): string {
  const done =
    opened === undefined
      ? "I've opened the page you asked for"
      : `I've opened ${opened}`;
  const why =
    code === "POLICY_DENIED"
      ? "that isn't something I can access for you"
      : code === "MODEL_PROVIDER_TIMEOUT" ||
          code === "MODEL_PROVIDER_UNAVAILABLE"
        ? "my reasoning service didn't answer in time"
        : code === "TOOL_FAILED" || code === "RETRIEVAL_FAILED"
          ? "I couldn't read it just now"
          : "something went wrong on my side";
  return `${done}, but I couldn't do the rest of what you asked because ${why}. Ask me again and I'll try once more.`;
}

/**
 * A3 (rehearsal 2026-11-04: "Open Ledgerline's company profile and show
 * the financials" opened the profile and said only "Opening Ledgerline."):
 * a later clause that asks to be shown something which is no page and no
 * tab of a page ("show the financials", "show me their numbers") is a
 * request for content, answered after the move. "show me the deck" or
 * "show me Discover" stay moves: the same tab and page readers decide.
 */
function asksToBeShownContent(clause: string): boolean {
  const said = clause.trim();
  return (
    /^(?:show|list|pull up|bring up|read out)(?:\s+(?:me|us))?\s+\S/iu.test(
      said,
    ) &&
    tabAskOf(said) === null &&
    pageRequestOf(said) === null
  );
}

/** A question, not a command to go somewhere. */
export function asksAQuestion(text: string): boolean {
  const said = text.trim().toLowerCase();
  return (
    said.includes("?") ||
    /^(what|why|how|who|which|when|where|does|do|is|are|can|could|should|would|tell me|explain|describe|walk me|give me|summari[sz]e)\b/u.test(
      said,
    )
  );
}

/** Work-product kinds of a part (TURN_READER v78): judgement, weighing, a document. */
const WORK_PRODUCT_KINDS: ReadonlySet<string> = new Set([
  "ANALYSIS",
  "COMPARISON",
  "DOCUMENT",
]);

/** Answer kinds that ask Q for an answer of its own, not only an action. */
const ANSWER_ASKING_KINDS: ReadonlySet<string> = new Set([
  "LOOKUP",
  "FOLLOW_UP",
  "ANALYSIS",
  "COMPARISON",
]);

/**
 * D7 (live 14 Nov 2026, run dea2efd9): the turn asks Q for an answer as
 * well as (or instead of) an action -- read from the reader's answerKind
 * and parts (v78), never from the words. No reading, or an older one: no.
 */
export function asksForAnAnswer(
  read: {
    readonly answerKind?: string | null | undefined;
    readonly parts?: readonly { readonly kind: string }[] | undefined;
  } | null,
): boolean {
  if (read === null) return false;
  return (
    (read.answerKind !== undefined &&
      read.answerKind !== null &&
      ANSWER_ASKING_KINDS.has(read.answerKind)) ||
    (read.parts ?? []).some((part) => ANSWER_ASKING_KINDS.has(part.kind))
  );
}

/**
 * The reading splits the turn into two or more parts that each ask Q for
 * work (an assessment, a comparison, a memo, diligence questions): a
 * request for work products. Handing a relationship over ("handle Kestrel
 * for me") is one ask and names none of them. Q intelligence step 4: read
 * from the reader's parts (v78), never from the words; no reading, or an
 * older one, is no work request (the neutral default).
 */
export function asksForWorkProducts(
  parts: readonly { readonly kind: string }[] | undefined,
): boolean {
  return (
    (parts ?? []).filter((part) => WORK_PRODUCT_KINDS.has(part.kind)).length >=
    2
  );
}

/** Q's own question for their city or time zone. */
const ASKS_CITY =
  /\b(?:which|what)\s+(?:city|time\s?zone|timezone)\b|\bwhere are you (?:based|located)\b/iu;

/**
 * Their reply names a place, Q's last line asked for their city, and the
 * turn before asked for a reminder or a call: that request, its declared
 * tool and the zone. Null otherwise. Code only: the request is read again
 * against the tool's own schema by the caller.
 */
export function cityForAskedAction(
  history: readonly {
    readonly id: string;
    readonly role: string;
    readonly content: string;
  }[],
  latest: { readonly id: string; readonly content: string },
): {
  readonly tool: string;
  readonly utterance: string;
  readonly zone: string;
} | null {
  const zone = zoneFromWords(latest.content);
  if (zone === null) return null;
  const before = history.filter((message) => message.id !== latest.id);
  const askedAt = before.findLastIndex((message) => message.role !== "USER");
  const asked = before[askedAt];
  if (asked === undefined || !ASKS_CITY.test(asked.content)) return null;
  const request = before
    .slice(0, askedAt)
    .findLast((message) => message.role === "USER");
  if (request === undefined) return null;
  const tool = /\bremind/iu.test(request.content)
    ? "propose_reminder"
    : /\b(?:call|meeting)\b/iu.test(request.content) &&
        /\b(?:book|schedule|set up|arrange)\b/iu.test(request.content)
      ? "propose_meeting"
      : null;
  return tool === null ? null : { tool, utterance: request.content, zone };
}

/**
 * The reply is a place and little else ("Lagos.", "I'm in Abuja"), and
 * Q's last line asked for their city: the place as said and its zone.
 */
export function bareCityReply(
  history: readonly {
    readonly id: string;
    readonly role: string;
    readonly content: string;
  }[],
  latest: { readonly id: string; readonly content: string },
): { readonly said: string; readonly zone: string } | null {
  const zone = zoneFromWords(latest.content);
  if (zone === null) return null;
  const words = latest.content
    .replace(/[^\p{L}\s'-]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0 || words.length > 5) return null;
  const asked = history
    .filter((message) => message.id !== latest.id)
    .findLast((message) => message.role !== "USER");
  if (asked === undefined || !ASKS_CITY.test(asked.content)) return null;
  const said = words
    .filter(
      (word) =>
        !/^(?:i'?m|i|am|in|based|from|it's|its|the|city|of|yes|ok|okay)$/iu.test(
          word,
        ),
    )
    .join(" ");
  return { said: said.length > 0 ? said : zone, zone };
}

/**
 * Whose side of the table a team-job line speaks to (live 2026-10-28: a
 * founder was offered "questions for the founder"): an investor when the
 * run is bound to their own investor organisation's mandate -- the
 * firewall's proof, as the record resolver above reads it -- a founder
 * otherwise.
 */
/**
 * The reader read an investment (IC, deal) memo on a company (v75
 * investmentMemo), on a confident reading meant for Q. A document the
 * reader bound to their own company (PREPARE_DOCUMENT with no subject
 * named) is never one: their own memo keeps the quick path.
 */
export function researchedMemoAsked(read: {
  readonly confidence: string;
  readonly addressedToQ?: boolean | undefined;
  readonly investmentMemo?: boolean | undefined;
  readonly tool?: {
    readonly kind: string;
    readonly subjectName?: string | null | undefined;
  } | null;
}): boolean {
  if (read.investmentMemo !== true) return false;
  if (read.confidence === "LOW" || read.addressedToQ === false) return false;
  const ownDocument =
    read.tool?.kind === "PREPARE_DOCUMENT" &&
    (read.tool.subjectName ?? null) === null;
  return !ownDocument;
}

export function teamJobAudienceOf(request: QAnswerRequest): TeamJobAudience {
  return askerSideOf(request);
}

/** The turns before this one, theirs and Q's, as pairs (newest last). */
export function recentTurnPairs(
  history: readonly QConversationMessage[],
  latest: QConversationMessage,
): { readonly user: string; readonly q: string }[] {
  const pairs: { user: string; q: string }[] = [];
  for (const message of history) {
    if (message === latest) break;
    if (message.role === "USER") pairs.push({ user: message.content, q: "" });
    else if (message.role === "Q") {
      const last = pairs.at(-1);
      if (last !== undefined && last.q === "") last.q = message.content;
    }
  }
  return pairs.slice(-4);
}

/** Owner replay batch 7 (#3): what is said when the pane's move was made. */
export const MOVE_MADE_LINE = "I've opened it for you.";

/** Whether the settled blocks carry a move the answer's own blocks did not. */
export function addsMove(
  before: readonly QResultBlock[] | undefined,
  after: readonly QResultBlock[] | undefined,
): boolean {
  const moves = (blocks: readonly QResultBlock[] | undefined) =>
    (blocks ?? []).filter(
      (block) =>
        block.kind === "UI_INTENT" &&
        (block.intent.kind === "NAVIGATE" ||
          block.intent.kind === "OPEN_RECORD_PAGE" ||
          block.intent.kind === "OPEN_SETTINGS"),
    ).length;
  return moves(after) > moves(before);
}
