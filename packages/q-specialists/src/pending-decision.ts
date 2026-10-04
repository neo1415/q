import { closestByName } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

/**
 * A typed yes or no to a change Q prepared (founder-fixture failure #1,
 * docs/handoff/fixtures/founder-live-test-2026-09-27.md; live again
 * 2026-10-01: "yes, go ahead" was answered "The reminder has been saved"
 * while the action still waited for approval).
 *
 * Approving by conversation used to depend on the answer's model choosing
 * approve_pending_proposal out of every tool it was offered; when it did
 * not, nothing was approved and the model's own words claimed it was.
 * Voice already worked another way: the decision is READ (DECISION_READER,
 * a model reading of meaning, ADR 0011) and CODE acts on it through the
 * Approval Engine, the call the card's buttons make. Typed turns now do
 * the same, and what Q says about the change is the engine's own status,
 * never the model's.
 *
 * - Nothing pending: nothing is read; the turn is answered as any other.
 * - One pending, read YES with nothing more: approved (payload-bound,
 *   idempotent, expiry checked by the engine); the line is its result.
 * - The question is whether to go ahead with exactly this, unchanged, so
 *   a yes that asks for something different ("yes, but at 3") reads as
 *   not this one: declined, and the change they want is answered as a
 *   new proposal with its own approval.
 * - Read NO: declined through the engine; anything more they said is
 *   answered after. A YES with more: approved, and the rest answered.
 * - Several pending and a decision read: Q asks which, by name.
 * - Nothing pending in this conversation, but changes asked for recently
 *   in another one (live 2026-10-01: after a reload the dock opened a new
 *   conversation, and "yes, go ahead" met "I need the specific action"
 *   while an errand waited): exactly one is decided as above, its status
 *   line naming it; several are asked about by name.
 * - Read as something else, or not read at all: answered as any other.
 *
 * Live 2026-10-02 (Zino):
 * - With exactly one change waiting, a plain approval ("Okay. I give the
 *   approval. Go ahead.") approves it by code, with no name to match.
 * - With several, a name they say picks one, heard slightly wrong
 *   included ("Nixon" for Nixo), by the same matcher as everywhere.
 * - With none waiting, a yes to a change already approved is answered
 *   with where it really stands (an errand's progress from its record),
 *   never an argument about approval.
 */

/** The plain statuses the Approval Engine's state maps to (q-tools). */
export type PendingDecisionStatus =
  | "PENDING"
  | "SAVING"
  | "SAVED"
  | "NOT_SAVED"
  | "DECLINED"
  | "EXPIRED"
  | "CHANGED";

export type PendingDecisionContext = {
  readonly actor: ActorContext;
  readonly runId: string;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly userId: string;
};

export type PendingDecisionPort = {
  /** Every proposal of this run's conversation, with its CURRENT status. */
  readonly proposals: (context: PendingDecisionContext) => Promise<
    readonly {
      readonly proposalId: string;
      readonly summary: string;
      readonly status: PendingDecisionStatus;
    }[]
  >;
  /** Whether the words decide the question asked (DECISION_READER). */
  readonly read: (input: {
    readonly question: string;
    readonly utterance: string;
    readonly recentTurns: readonly {
      readonly role: "USER" | "Q";
      readonly text: string;
    }[];
    readonly context: PendingDecisionContext;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<{
    readonly decision: "YES" | "NO" | "UNRELATED";
    readonly remainder: string | null;
  } | null>;
  readonly approve: (
    context: PendingDecisionContext,
    proposalId: string,
  ) => Promise<{ readonly status: PendingDecisionStatus }>;
  readonly decline: (
    context: PendingDecisionContext,
    proposalId: string,
  ) => Promise<{ readonly status: PendingDecisionStatus }>;
  /**
   * Changes still waiting for this person's approval that were asked for
   * recently in their other conversations. Absent: only this one counts.
   */
  readonly recentElsewhere?: (context: PendingDecisionContext) => Promise<
    readonly {
      readonly proposalId: string;
      readonly summary: string;
      readonly status: PendingDecisionStatus;
    }[]
  >;
  /**
   * Where work an approved change started stands now, in plain words, from
   * its own records (the receipts port: "Q is looking after Nixo for you:
   * waiting for them to accept…"); null when it is simply saved. Absent:
   * the engine status line is said instead.
   */
  readonly progress?: (
    context: PendingDecisionContext,
    proposalId: string,
  ) => Promise<string | null>;
};

/**
 * How the turn reader read this turn (lead 2026-10-03, run ad0b0067): only
 * a reply to Q -- an answer, a clarification, a control word -- can decide
 * a waiting card. A turn that asks for an action in its own right (a
 * TOOL_REQUEST, a named action, a hand) or a question never does, whatever
 * words it holds: "We've decided not to proceed with Ledgefold" is a
 * request, and "proceed" in it approves nothing.
 */
export type PendingTurnReading = {
  readonly kind: string;
  readonly addressedToQ: boolean;
  readonly namesAction: boolean;
};

/** The turn kinds that answer what Q asked; anything else is its own turn. */
const REPLY_KINDS: ReadonlySet<string> = new Set([
  "ANSWER",
  "CLARIFICATION",
  "CONTROL",
  "SMALL_TALK",
]);

/**
 * A reply to the card: words that are nothing but a yes or a no ("yes,
 * go ahead", "approve it", "no thanks"), which hold no request of their
 * own, or a turn the reader read as a reply. An unread turn is not one.
 */
export function isReplyToCard(
  utterance: string,
  turn: PendingTurnReading | null,
  cards: readonly { readonly summary: string }[] = [],
): boolean {
  if (plainApproval(utterance) || plainRefusal(utterance)) return true;
  if (pointedRefusal(utterance) || restatesCard(utterance, cards)) return true;
  // "Approved. And what's the weather like?": a reply first, then more.
  // Only a first sentence that is nothing but a yes or a no counts; "We've
  // decided not to proceed…" is no such sentence.
  const first = /^[^.!?]+[.!?]/u.exec(utterance.trim())?.[0];
  if (
    first !== undefined &&
    first.trim().length < utterance.trim().length &&
    (plainApproval(first) || plainRefusal(first))
  ) {
    return true;
  }
  return (
    turn !== null &&
    turn.addressedToQ &&
    !turn.namesAction &&
    REPLY_KINDS.has(turn.kind)
  );
}

export type PendingDecisionOutcome =
  /** Nothing to decide here: answer the turn as any other. */
  | { readonly kind: "NONE" }
  /** Decided, or a question back: this line is the whole reply. */
  | { readonly kind: "REPLY"; readonly line: string }
  /**
   * Answer the turn as any other, then say this: the real status of a
   * change the person spoke to without it being decided (or a decline
   * reported before the rest of what they said is answered).
   */
  | {
      readonly kind: "ANSWER_THEN";
      readonly before: string | null;
      readonly after: string | null;
      /** The card `after` is about, so it is not said twice for one card. */
      readonly about?: string | undefined;
      /** That card's action id, matched against the engine's result. */
      readonly aboutId?: string | undefined;
    };

function named(summary: string): string {
  return summary.trim().replace(/[.\s]+$/u, "");
}

/** What Q says about a change: its engine status, in plain words. */
export function statusLine(
  status: PendingDecisionStatus,
  summary: string,
): string {
  const what = named(summary);
  switch (status) {
    case "SAVED":
      return `Done: ${what}.`;
    case "SAVING":
      return `Approved: ${what}. It's being applied now.`;
    case "NOT_SAVED":
      return `Approved, but it didn't go through: ${what}. Nothing changed.`;
    case "DECLINED":
      return `Declined: ${what}. Nothing was changed.`;
    case "EXPIRED":
      return `That change had expired, so nothing was approved: ${what}. I can prepare it again.`;
    case "CHANGED":
      return `That change was altered after it was prepared, so I didn't approve it: ${what}. I can prepare it again for your approval.`;
    case "PENDING":
      return `Not saved yet: ${what} is waiting for your approval. Tap Approve on the card, or tell me to go ahead.`;
  }
}

function whichLine(summaries: readonly string[]): string {
  const shown = summaries.slice(0, 4).map((summary) => `"${named(summary)}"`);
  const list =
    shown.length <= 1
      ? (shown[0] ?? "")
      : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1) ?? ""}`;
  return `${String(summaries.length)} changes are waiting for your approval: ${list}. Which one do you mean?`;
}

export async function decidePending(
  port: PendingDecisionPort,
  input: {
    readonly context: PendingDecisionContext;
    readonly utterance: string;
    readonly recentTurns: readonly {
      readonly role: "USER" | "Q";
      readonly text: string;
    }[];
    readonly signal?: AbortSignal | undefined;
    /**
     * The turn reader's reading of this turn; null when it was not read.
     * Absent (callers without a reader): read as a reply, as before.
     */
    readonly turn?: PendingTurnReading | null | undefined;
  },
): Promise<PendingDecisionOutcome> {
  const all = await port.proposals(input.context);
  let pending = all.filter((proposal) => proposal.status === "PENDING");
  // Waiting in another of their conversations: not on the screen in front
  // of them (QA 2026-10-03: a restated "share my raise with Savanna Seed"
  // in a new conversation approved the card another one had prepared).
  let elsewhere = false;
  if (pending.length === 0 && port.recentElsewhere !== undefined) {
    const others = await port.recentElsewhere(input.context).catch(() => []);
    pending = others.filter((proposal) => proposal.status === "PENDING");
    elsewhere = pending.length > 0;
  }
  if (pending.length === 0) {
    return answeredAlready(port, input, all);
  }
  // Only a reply decides; the words are a second must-have, never what
  // grants it. A request or a statement in its own right, even one that
  // restates the card, approves and declines nothing.
  const reply =
    input.turn === undefined
      ? true
      : isReplyToCard(input.utterance, input.turn, pending);
  // A decision that restates the card carries nothing more to answer: the
  // restatement is the card itself, never a second request.
  const restated = restatesCard(input.utterance, pending);
  // A new request is never a reply to a card from another conversation
  // (QA 2026-10-03, run 528f4c4e: "just handle it" in a fresh
  // conversation was read as a yes to Express interest in Clinicrest,
  // waiting in another, so it was answered "That's ready…" and the
  // standing instruction it asked for was never set up). By the reader's
  // reading, never by words: a request to act, a declared action, a
  // hand-over, or a question is answered as itself; only the same request
  // again, naming the card's counterpart, is told the card is ready. In
  // this conversation a request already decides nothing (only a reply
  // does) and the card's status follows the answer.
  const reading = input.turn ?? null;
  const newRequest =
    elsewhere &&
    reading !== null &&
    !reply &&
    (reading.namesAction ||
      reading.kind === "TOOL_REQUEST" ||
      reading.kind === "QUESTION_TO_Q" ||
      reading.kind === "RESEARCH_REQUEST");
  if (newRequest && namedIn(input.utterance, pending) === null) {
    return { kind: "NONE" };
  }
  // Approval binds to words that approve. Asking for the same thing again
  // is not a yes: with no approval word, a reading that it is about this
  // change says it is ready and waiting, and nothing is approved.
  const approves = reply && approvalCue(input.utterance);
  // Elsewhere, the words must also point to this card: its counterpart
  // named, or the first words of a conversation opened to answer it
  // (live 2026-10-01: "yes, go ahead" after a reload).
  let points = !elsewhere;
  let namedElsewhere = false;
  if (elsewhere) {
    const chosen = namedIn(input.utterance, pending);
    if (chosen !== null) pending = [chosen];
    namedElsewhere = chosen !== null;
    points = chosen !== null || input.recentTurns.length === 0;
  }
  // What may approve by words: an approval word, and elsewhere an explicit
  // one ("approve", "go ahead") that points to this card.
  const mayApprove =
    approves && (!elsewhere || (points && explicitApproval(input.utterance)));
  // A plain approval of the one change waiting needs no reading and no
  // name (live 2026-10-02: "Okay. I give the approval. Go ahead.").
  if (pending.length === 1 && pending[0] !== undefined) {
    if (reply && plainApproval(input.utterance) && mayApprove) {
      const { status } = await port.approve(
        input.context,
        pending[0].proposalId,
      );
      return { kind: "REPLY", line: statusLine(status, pending[0].summary) };
    }
  } else {
    // Several: a name they said picks one ("Nixon" for Nixo).
    const chosen = namedIn(input.utterance, pending);
    if (chosen !== null) pending = [chosen];
  }
  const only = pending.length === 1 ? pending[0] : undefined;
  const question =
    only === undefined
      ? `${whichLine(pending.map((proposal) => proposal.summary))}`
      : // "Exactly this, unchanged": a yes that asks for something
        // different ("yes, but at 3") is not a yes to this payload, and
        // the reader says so from meaning (live 2026-10-01: with a plain
        // "Shall I go ahead?", "yes, go ahead" came back with a remainder
        // and could not be told apart from a change).
        `${named(only.summary)}. Shall I go ahead with exactly this, unchanged?`;
  const heard = await port.read({
    question,
    utterance: input.utterance,
    recentTurns: input.recentTurns,
    context: input.context,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const read =
    heard !== null && restated ? { ...heard, remainder: null } : heard;
  if (read === null || read.decision === "UNRELATED") {
    return { kind: "NONE" };
  }
  if (only === undefined) {
    // A request of its own is answered as one, not asked "which one?".
    if (!reply) return { kind: "NONE" };
    return {
      kind: "REPLY",
      line: whichLine(pending.map((proposal) => proposal.summary)),
    };
  }
  // Elsewhere, "it's ready" is said only to the same request again, which
  // names the card; words that neither approve it nor name it are
  // answered as themselves (run 528f4c4e).
  if (read.decision === "YES" && !mayApprove && elsewhere && !namedElsewhere) {
    return { kind: "NONE" };
  }
  if (read.decision === "YES" && !mayApprove) {
    // The same request again, or a yes elsewhere that does not approve
    // this card by name: it is ready and waits for theirs. Nothing is
    // approved and nothing new is prepared.
    return { kind: "REPLY", line: readyLine(only.summary) };
  }
  // A no declines only when the words refuse and point to this card: a
  // plain "no", "cancel that", or a refusal naming its counterpart (QA
  // 2026-10-03, runs 9355dc4f, 5010f6bf, 3af14042: a new, different
  // request was read NO and declined the card). Otherwise the card stays
  // pending and is mentioned after the answer.
  if (read.decision === "NO" && !points) return { kind: "NONE" };
  if (read.decision === "NO" && (!reply || !declines(input.utterance, only))) {
    return {
      kind: "ANSWER_THEN",
      before: null,
      after: `Still waiting for your approval: ${named(only.summary)}.`,
      about: only.summary,
      aboutId: only.proposalId,
    };
  }
  if (read.decision === "YES") {
    const { status } = await port.approve(input.context, only.proposalId);
    const line = statusLine(status, only.summary);
    // Anything more they said is answered after the decision.
    return read.remainder === null
      ? { kind: "REPLY", line }
      : { kind: "ANSWER_THEN", before: line, after: null };
  }
  const { status } = await port.decline(input.context, only.proposalId);
  const line = statusLine(status, only.summary);
  return read.remainder === null
    ? { kind: "REPLY", line }
    : { kind: "ANSWER_THEN", before: line, after: null };
}

/** Words that open by deciding: an approval or a refusal, before anything else. */
const OPENS_DECIDING =
  /^\s*(?:(?:yes|yeah|yep|ok(?:ay)?|sure|no|nope|please)[\s,.!]+)*(?:approve|confirm|go ahead(?: with)?|proceed with|cancel|decline|reject|scrap|drop)\b/iu;
/** Words that ask for something new or different, not this card again. */
const ASKS_ANEW =
  /\b(?:another|new|second|again|one more|instead|but|change|move|different|also|and then|as well)\b/iu;

/**
 * An explicit decision that restates the card it decides (voiceq-63, live
 * 2026-10-04): "Yes, approve the meeting with Nixo for the next five
 * minutes" opened with "approve", named the card's counterpart and asked
 * for nothing new, yet the reader read it as a request; it was answered as
 * one and prepared a second card, then a third for "Yes, confirm…". Words
 * that open by deciding and point to one waiting card by its counterpart
 * are a reply to it, unless they ask for something new or different.
 */
export function restatesCard(
  utterance: string,
  cards: readonly { readonly summary: string }[],
): boolean {
  if (cards.length === 0) return false;
  if (!OPENS_DECIDING.test(utterance) || ASKS_ANEW.test(utterance)) {
    return false;
  }
  return namedIn(utterance, cards) !== null;
}

/**
 * A refusal that is all pointing at the card ("cancel that", "scrap it",
 * "cancel the meeting"): a reply however the reader read it (voiceq-63:
 * "cancel that" must decline the waiting card by voice).
 */
export function pointedRefusal(utterance: string): boolean {
  if (!POINTED.test(utterance)) return false;
  const words = utterance
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  return words.every(
    (word) =>
      REFUSAL_WORDS.includes(word) || FILLER.has(word) || CARD_WORDS.has(word),
  );
}
const CARD_WORDS: ReadonlySet<string> = new Set([
  "meeting",
  "call",
  "booking",
  "request",
  "email",
  "message",
  "reminder",
  "please",
]);

/** Said when the same change is asked for again: ready, waiting for a yes. */
export function readyLine(summary: string): string {
  return `That's ready: ${named(summary)}. It's waiting for your yes. Tap Approve on the card, or tell me to go ahead.`;
}

/** Refusal words: without one, nothing is declined. */
const REFUSAL =
  /\b(?:no|nope|nah|don'?t|do not|cancel\w*|declin\w*|reject\w*|scrap|stop|never ?mind|forget (?:it|that)|not (?:that|this|it|now))\b/iu;
/** Words that point to the card in front of them. */
const POINTED =
  /\b(?:cancel|decline|scrap|drop|forget|reject|stop|don'?t do|do not do|not)\s+(?:that|this|it|the (?:card|change|proposal|one|meeting|call|booking|request|email|message|reminder)|that one)\b/iu;
/** "No," or "Nope." opening what they say: an explicit no. */
const OPENING_NO = /^\s*(?:no|nope|nah)\b[\s,.!;:-]/iu;
const REFUSAL_WORDS = [
  "no",
  "nope",
  "nah",
  "don't",
  "dont",
  "do",
  "not",
  "cancel",
  "decline",
  "reject",
  "scrap",
  "stop",
  "never",
  "mind",
  "nevermind",
  "forget",
  "thanks",
  "one",
  "card",
  "change",
  "proposal",
  "actually",
  "wait",
];

/**
 * A no that declines this card: a refusal that is all refusal ("no",
 * "no thanks"), one that opens with "no,", one that points at it ("cancel
 * that", "don't do it"), or one that names its counterpart. A new request, even read NO, is none.
 */
export function declines(
  utterance: string,
  card: { readonly summary: string },
): boolean {
  if (!REFUSAL.test(utterance)) return false;
  const words = utterance
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  if (words.every((word) => REFUSAL_WORDS.includes(word) || FILLER.has(word)))
    return true;
  if (POINTED.test(utterance) || OPENING_NO.test(`${utterance} `)) return true;
  return namedIn(utterance, [card]) !== null;
}

/** Words that are nothing but a no ("no", "no thanks", "nope"). */
export function plainRefusal(utterance: string): boolean {
  const words = utterance
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  return (
    words.length > 0 &&
    words.some((word) => word === "no" || word === "nope" || word === "nah") &&
    words.every((word) => REFUSAL_WORDS.includes(word) || FILLER.has(word))
  );
}

/** Any word that can approve; without one, nothing is approved. */
export function approvalCue(utterance: string): boolean {
  return /\b(?:yes|yeah|yep|yup|ok|okay|sure|alright|all right|sounds good|please do|absolutely|definitely|approv\w*|go ahead|proceed|confirm\w*|do it|send it|agreed?)\b/iu.test(
    utterance,
  );
}

/** An approval that says so: not a bare "yes" or "ok", which answer anything. */
function explicitApproval(utterance: string): boolean {
  return /\b(?:approv\w*|go ahead|proceed|confirm\w*|do it|send it)\b/iu.test(
    utterance,
  );
}

/**
 * Approval words only, and nothing that names or changes anything: "yes",
 * "go ahead", "Okay. I give the approval. Go ahead.", "approve it". A
 * sentence with anything more is left to the decision reader.
 */
const APPROVAL_PHRASES: readonly RegExp[] = [
  /\bgo ahead\b/g,
  /\bdo it\b/g,
  /\bsend it\b/g,
  /\b(?:yes|yeah|yep|yup|ok|okay|sure|approved?|approval|approving|proceed|confirm(?:ed)?)\b/g,
];
const FILLER_LIST = [
  "i",
  "give",
  "gave",
  "you",
  "the",
  "my",
  "it",
  "that",
  "this",
  "please",
  "now",
  "then",
  "so",
  "and",
  "just",
  "q",
  "thanks",
  "thank",
  "have",
  "has",
  "is",
  "here",
  "your",
  "fine",
  "good",
  "great",
  "you're",
  "youre",
  "of",
  "with",
  "a",
];
const FILLER: ReadonlySet<string> = new Set(FILLER_LIST);

export function plainApproval(utterance: string): boolean {
  let text = utterance.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ");
  let approved = false;
  for (const phrase of APPROVAL_PHRASES) {
    text = text.replace(phrase, () => {
      approved = true;
      return " ";
    });
  }
  if (!approved) return false;
  return text
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .every((word) => FILLER.has(word));
}

/** Words in a change's summary that are not names (titles, days, months). */
const NOT_NAMES = new Set(
  (
    "q call message reminder meeting email send reply accept decline introductory " +
    "looks after for you your with to move cancel change the a an and of on at in " +
    "mon tue wed thu fri sat sun jan feb mar apr may jun jul aug sep oct nov dec " +
    "monday tuesday wednesday thursday friday saturday sunday"
  ).split(" "),
);

function namesIn(summary: string): string[] {
  return summary
    .split(/[^\p{L}\p{N}'-]+/u)
    .filter(
      (word) =>
        word.length >= 3 &&
        /^\p{Lu}/u.test(word) &&
        !NOT_NAMES.has(word.toLowerCase()),
    );
}

/** The one waiting change whose counterpart they named, or null. */
function namedIn<T extends { readonly summary: string }>(
  utterance: string,
  pending: readonly T[],
): T | null {
  const said = utterance
    .split(/[^\p{L}\p{N}'-]+/u)
    .filter((word) => word.length >= 4);
  const hits = pending.filter((proposal) =>
    namesIn(proposal.summary).some(
      (name) => closestByName(said, name, (word) => word).length > 0,
    ),
  );
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/**
 * Nothing waits, and they say yes to a change already decided: where it
 * really stands, never an argument. Only for words that read as a yes.
 */
async function answeredAlready(
  port: PendingDecisionPort,
  input: {
    readonly context: PendingDecisionContext;
    readonly utterance: string;
    readonly recentTurns: readonly {
      readonly role: "USER" | "Q";
      readonly text: string;
    }[];
    readonly signal?: AbortSignal | undefined;
    readonly turn?: PendingTurnReading | null | undefined;
  },
  all: readonly {
    readonly proposalId: string;
    readonly summary: string;
    readonly status: PendingDecisionStatus;
  }[],
): Promise<PendingDecisionOutcome> {
  const latest = all.at(-1);
  if (latest === undefined) return { kind: "NONE" };
  // A request of its own is answered as one, never as "already done".
  if (input.turn !== undefined && !isReplyToCard(input.utterance, input.turn)) {
    return { kind: "NONE" };
  }
  // An explicit approval needs no reading; a bare "ok" or "yes" might
  // answer anything, so the reader decides whether it is about this one.
  let yes =
    plainApproval(input.utterance) &&
    /\b(?:approv|go ahead|proceed|confirm|do it|send it)/i.test(
      input.utterance,
    );
  if (!yes) {
    // A cheap gate before the reader: no approval word, no reading.
    if (
      !/\b(?:yes|go ahead|approv|ok|okay|proceed|confirm|do it)/i.test(
        input.utterance,
      )
    ) {
      return { kind: "NONE" };
    }
    const read = await port.read({
      question: `${named(latest.summary)}. Shall I go ahead?`,
      utterance: input.utterance,
      recentTurns: input.recentTurns,
      context: input.context,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    yes = read?.decision === "YES" && read.remainder === null;
  }
  if (!yes) return { kind: "NONE" };
  const progress =
    port.progress === undefined
      ? null
      : await port.progress(input.context, latest.proposalId).catch(() => null);
  return {
    kind: "REPLY",
    line:
      progress ??
      (latest.status === "SAVED"
        ? `Already approved and done: ${named(latest.summary)}.`
        : statusLine(latest.status, latest.summary)),
  };
}
