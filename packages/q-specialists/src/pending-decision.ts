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

/**
 * One reading of their reply (DECISION_READER v2, founder brief J7): the
 * decision and what kind of reply it is, read by meaning. Code decides
 * from these fields what a reply may do; no list of approval or refusal
 * words decides it. A field the reader did not give is false: the reading
 * that does nothing.
 */
export type DecisionReading = {
  readonly decision: "YES" | "NO" | "UNRELATED";
  readonly remainder: string | null;
  /** Nothing but the decision ("yes, go ahead", "no thanks"). */
  readonly onlyDecision?: boolean | undefined;
  /** Decides in clear words ("approve it", "cancel that"). */
  readonly explicit?: boolean | undefined;
  /** Points at the waiting change (its name, "that", "it"). */
  readonly pointsAtIt?: boolean | undefined;
  /** Asks for something new or different from what was asked. */
  readonly asksSomethingElse?: boolean | undefined;
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
  }) => Promise<DecisionReading | null>;
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
 * The reply restates the card it decides (voiceq-63: "Yes, approve the
 * meeting with Nixo for the next five minutes"): it points at the waiting
 * change and asks for nothing new, so there is no rest to answer.
 */
export function restatesCard(read: DecisionReading | null): boolean {
  return (
    read !== null &&
    read.decision !== "UNRELATED" &&
    read.pointsAtIt === true &&
    read.asksSomethingElse !== true
  );
}

/**
 * A reply to the card: words that are nothing but a decision, a decision
 * that restates the card, or a turn the turn reader read as a reply. An
 * unread turn, or an unread decision, is not one.
 */
export function isReplyToCard(
  read: DecisionReading | null,
  turn: PendingTurnReading | null,
  options: {
    /**
     * Whether a turn the turn reader could not read may still be a reply
     * when the words are nothing but the decision. Typed: yes. On a live
     * line an unread turn may be the room, not the person: no.
     */
    readonly unreadMayReply?: boolean | undefined;
  } = {},
): boolean {
  if (read === null) return false;
  // Overheard: said to someone in the room, never to Q.
  if (turn !== null && !turn.addressedToQ) return false;
  if (read.onlyDecision === true || restatesCard(read)) {
    return turn !== null || options.unreadMayReply !== false;
  }
  return turn !== null && !turn.namesAction && REPLY_KINDS.has(turn.kind);
}

/**
 * A yes that approves this card as it is: nothing but the decision, a
 * decision in clear words, or a yes followed by something else to answer
 * ("yes, and what's next?") -- never one asking for something different.
 */
export function approvesByWords(read: DecisionReading | null): boolean {
  return (
    read?.decision === "YES" &&
    read.asksSomethingElse !== true &&
    (read.onlyDecision === true ||
      read.explicit === true ||
      read.remainder !== null)
  );
}

/**
 * A no that declines this card: nothing but a no, a no in clear words, a
 * no pointing at it, or one naming its counterpart. A new request, even
 * read NO, is none.
 */
export function declinesByWords(
  read: DecisionReading | null,
  utterance: string,
  card: { readonly summary: string },
): boolean {
  if (read?.decision !== "NO") return false;
  return (
    read.onlyDecision === true ||
    read.explicit === true ||
    read.pointsAtIt === true ||
    namedIn(utterance, [card]) !== null
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

type PendingDecisionInput = {
  readonly context: PendingDecisionContext;
  readonly utterance: string;
  readonly recentTurns: readonly {
    readonly role: "USER" | "Q";
    readonly text: string;
  }[];
  readonly signal?: AbortSignal | undefined;
};

type DecisionProposal = {
  readonly proposalId: string;
  readonly summary: string;
  readonly status: PendingDecisionStatus;
};

/**
 * What can be known before the turn reader has spoken: which cards wait,
 * which one the words name, and the question the decision reader is asked.
 */
type PendingStage =
  | { readonly kind: "NOTHING" }
  | {
      readonly kind: "ALREADY";
      readonly latest: DecisionProposal;
      readonly question: string;
    }
  | {
      readonly kind: "WAITING";
      readonly pending: readonly DecisionProposal[];
      readonly only: DecisionProposal | undefined;
      readonly elsewhere: boolean;
      readonly namedElsewhere: boolean;
      readonly question: string;
    };

async function stagePending(
  port: PendingDecisionPort,
  input: PendingDecisionInput,
): Promise<PendingStage> {
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
    const latest = all.at(-1);
    return latest === undefined
      ? { kind: "NOTHING" }
      : {
          kind: "ALREADY",
          latest,
          question: `${named(latest.summary)}. Shall I go ahead?`,
        };
  }
  // Several: a name they said picks one ("Nixon" for Nixo). Elsewhere, the
  // words must point to the card: its counterpart named, or the first
  // words of a conversation opened to answer it.
  const chosen = namedIn(input.utterance, pending);
  const namedElsewhere = elsewhere && chosen !== null;
  if (chosen !== null && (elsewhere || pending.length > 1)) pending = [chosen];
  const only = pending.length === 1 ? pending[0] : undefined;
  const question =
    only === undefined
      ? whichLine(pending.map((proposal) => proposal.summary))
      : // "Exactly this, unchanged": a yes that asks for something
        // different ("yes, but at 3") is not a yes to this payload.
        `${named(only.summary)}. Shall I go ahead with exactly this, unchanged?`;
  return {
    kind: "WAITING",
    pending,
    only,
    elsewhere,
    namedElsewhere,
    question,
  };
}

/**
 * A decision on a waiting change, begun before the turn reader has spoken.
 *
 * Voice latency sweep (L1, 2026-10-06): the decision reader used to be
 * asked only after the turn reader had answered, so a turn with any card
 * on record paid two FAST_CLASSIFICATION calls one after the other (about
 * 1.2 s each in the hosted ledger) before Q's answer could start. Neither
 * reading needs the other's result to be MADE, only to be JUDGED: with
 * `speculative`, the decision reading starts at once beside the turn
 * reading, and `conclude` judges both exactly as before. A reading the
 * turn makes moot (a request of its own) is aborted, never acted on.
 * Nothing is approved or declined until `conclude`.
 */
export type PendingDecisionStart = {
  readonly conclude: (
    turn?: PendingTurnReading | null,
  ) => Promise<PendingDecisionOutcome>;
  /** The turn went elsewhere: stop the reading in flight, if any. */
  readonly cancel: () => void;
};

export function startPendingDecision(
  port: PendingDecisionPort,
  input: PendingDecisionInput,
  options: { readonly speculative?: boolean } = {},
): PendingDecisionStart {
  const controller = new AbortController();
  const signal =
    input.signal === undefined
      ? controller.signal
      : AbortSignal.any([input.signal, controller.signal]);
  const staged = stagePending(port, input);
  let reading: Promise<DecisionReading | null> | undefined;
  const readFor = (question: string): Promise<DecisionReading | null> => {
    reading ??= port.read({
      question,
      utterance: input.utterance,
      recentTurns: input.recentTurns,
      context: input.context,
      signal,
    });
    return reading;
  };
  if (options.speculative === true) {
    // Never an unhandled rejection: conclude re-awaits the same promises.
    staged
      .then((stage) => {
        if (stage.kind !== "NOTHING") readFor(stage.question).catch(() => null);
      })
      .catch(() => undefined);
  }
  return {
    cancel: () => {
      controller.abort();
    },
    conclude: async (turn) => {
      const stage = await staged;
      if (stage.kind === "NOTHING") return { kind: "NONE" };
      if (stage.kind === "ALREADY") {
        const outcome = await answeredAlready(
          port,
          input,
          stage,
          turn,
          readFor,
        );
        if (outcome.kind === "NONE") controller.abort();
        return outcome;
      }
      return concludeWaiting(port, input, stage, turn, readFor);
    },
  };
}

export async function decidePending(
  port: PendingDecisionPort,
  input: PendingDecisionInput & {
    /**
     * The turn reader's reading of this turn; null when it was not read.
     * Absent (callers without a reader): the decision reading alone.
     */
    readonly turn?: PendingTurnReading | null | undefined;
  },
): Promise<PendingDecisionOutcome> {
  return startPendingDecision(port, input).conclude(input.turn);
}

async function concludeWaiting(
  port: PendingDecisionPort,
  input: PendingDecisionInput,
  stage: Extract<PendingStage, { kind: "WAITING" }>,
  turn: PendingTurnReading | null | undefined,
  readFor: (question: string) => Promise<DecisionReading | null>,
): Promise<PendingDecisionOutcome> {
  const { pending, only, elsewhere, namedElsewhere } = stage;
  // One reading of meaning decides it (J7): never a list of words.
  const heard = await readFor(stage.question);
  // A decision that restates the card carries nothing more to answer.
  const read =
    heard !== null && restatesCard(heard)
      ? { ...heard, remainder: null }
      : heard;
  if (read === null || read.decision === "UNRELATED") {
    return { kind: "NONE" };
  }
  // Only a reply decides; a request or a statement in its own right, even
  // one that restates the card, approves and declines nothing.
  const reply =
    turn === undefined
      ? read.onlyDecision === true ||
        restatesCard(read) ||
        read.asksSomethingElse !== true
      : isReplyToCard(read, turn);
  // A new request is never a reply to a card from another conversation
  // (QA 2026-10-03, run 528f4c4e): by the turn reader's reading.
  const reading = turn ?? null;
  const newRequest =
    elsewhere &&
    reading !== null &&
    !reply &&
    (reading.namesAction ||
      reading.kind === "TOOL_REQUEST" ||
      reading.kind === "QUESTION_TO_Q" ||
      reading.kind === "RESEARCH_REQUEST");
  if (newRequest && !namedElsewhere) return { kind: "NONE" };
  const points = !elsewhere || namedElsewhere || input.recentTurns.length === 0;
  // What may approve: a reply that approves by its words, and elsewhere an
  // explicit one that points to this card.
  const mayApprove =
    reply &&
    approvesByWords(read) &&
    (!elsewhere || (points && read.explicit === true));
  if (only === undefined) {
    // A request of its own is answered as one, not asked "which one?".
    if (!reply) return { kind: "NONE" };
    return {
      kind: "REPLY",
      line: whichLine(pending.map((proposal) => proposal.summary)),
    };
  }
  if (read.decision === "YES" && !mayApprove && elsewhere && !namedElsewhere) {
    return { kind: "NONE" };
  }
  if (read.decision === "YES" && !mayApprove) {
    // A yes in meaning that does not approve this card by its words: it
    // is ready and waits for theirs. Nothing is approved or prepared.
    return { kind: "REPLY", line: readyLine(only.summary) };
  }
  if (read.decision === "NO" && !points) return { kind: "NONE" };
  if (
    read.decision === "NO" &&
    (!reply || !declinesByWords(read, input.utterance, only))
  ) {
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

/** Said when the same change is asked for again: ready, waiting for a yes. */
export function readyLine(summary: string): string {
  return `That's ready: ${named(summary)}. It's waiting for your yes. Tap Approve on the card, or tell me to go ahead.`;
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
 * really stands, never an argument. Only for a reply read as a yes.
 */
async function answeredAlready(
  port: PendingDecisionPort,
  input: PendingDecisionInput,
  stage: Extract<PendingStage, { kind: "ALREADY" }>,
  turn: PendingTurnReading | null | undefined,
  readFor: (question: string) => Promise<DecisionReading | null>,
): Promise<PendingDecisionOutcome> {
  const latest = stage.latest;
  // A request of its own is answered as one, never as "already done".
  if (
    turn !== undefined &&
    turn !== null &&
    (!turn.addressedToQ || turn.namesAction || !REPLY_KINDS.has(turn.kind))
  ) {
    return { kind: "NONE" };
  }
  const read = await readFor(stage.question);
  if (!approvesByWords(read) || read?.remainder != null) {
    return { kind: "NONE" };
  }
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
