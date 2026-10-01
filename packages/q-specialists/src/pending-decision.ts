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
 * - Read as something else, or not read at all: answered as any other.
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
  const pending = all.filter((proposal) => proposal.status === "PENDING");
  if (pending.length === 0) return { kind: "NONE" };
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
