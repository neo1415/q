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
  // Approval binds to words that approve. Asking for the same thing again
  // is not a yes: with no approval word, a reading that it is about this
  // change says it is ready and waiting, and nothing is approved.
  const approves = approvalCue(input.utterance);
  // Elsewhere, the words must also point to this card: its counterpart
  // named, or the first words of a conversation opened to answer it
  // (live 2026-10-01: "yes, go ahead" after a reload).
  let points = !elsewhere;
  if (elsewhere) {
    const chosen = namedIn(input.utterance, pending);
    if (chosen !== null) pending = [chosen];
    points = chosen !== null || input.recentTurns.length === 0;
  }
  // What may approve by words: an approval word, and elsewhere an explicit
  // one ("approve", "go ahead") that points to this card.
  const mayApprove =
    approves && (!elsewhere || (points && explicitApproval(input.utterance)));
  // A plain approval of the one change waiting needs no reading and no
  // name (live 2026-10-02: "Okay. I give the approval. Go ahead.").
  if (pending.length === 1 && pending[0] !== undefined) {
    if (plainApproval(input.utterance) && mayApprove) {
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
  const read = await port.read({
    question,
    utterance: input.utterance,
    recentTurns: input.recentTurns,
    context: input.context,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (read === null || read.decision === "UNRELATED") {
    return { kind: "NONE" };
  }
  if (only === undefined) {
    return {
      kind: "REPLY",
      line: whichLine(pending.map((proposal) => proposal.summary)),
    };
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
  if (read.decision === "NO" && !declines(input.utterance, only)) {
    return {
      kind: "ANSWER_THEN",
      before: null,
      after: `Still waiting for your approval: ${named(only.summary)}.`,
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

/** Said when the same change is asked for again: ready, waiting for a yes. */
export function readyLine(summary: string): string {
  return `That's ready: ${named(summary)}. It's waiting for your yes. Tap Approve on the card, or tell me to go ahead.`;
}

/** Refusal words: without one, nothing is declined. */
const REFUSAL =
  /\b(?:no|nope|nah|don'?t|do not|cancel\w*|declin\w*|reject\w*|scrap|stop|never ?mind|forget (?:it|that)|not (?:that|this|it|now))\b/iu;
/** Words that point to the card in front of them. */
const DEICTIC =
  /\b(?:that|this|it|the (?:card|change|proposal|one)|that one)\b/iu;
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
 * "no thanks", "don't do it"), one that points at it ("cancel that"), or
 * one that names its counterpart. A new request, even read NO, is none.
 */
function declines(
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
  if (words.length <= 6 && DEICTIC.test(utterance)) return true;
  return namedIn(utterance, [card]) !== null;
}

/** Any word that can approve; without one, nothing is approved. */
function approvalCue(utterance: string): boolean {
  return /\b(?:yes|yeah|yep|yup|ok|okay|sure|approv\w*|go ahead|proceed|confirm\w*|do it|send it|agreed?)\b/iu.test(
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
  },
  all: readonly {
    readonly proposalId: string;
    readonly summary: string;
    readonly status: PendingDecisionStatus;
  }[],
): Promise<PendingDecisionOutcome> {
  const latest = all.at(-1);
  if (latest === undefined) return { kind: "NONE" };
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
