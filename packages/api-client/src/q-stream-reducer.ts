import type {
  QActionProposal,
  QCapability,
  QMessage,
  QPublicFailure,
  QPublicFinding,
  QRunStatus,
  QStreamEvent,
  QVisibleStage,
} from "@capital-q/contracts";

/**
 * A deterministic reducer from Q stream events to presentation state
 * (CQ-Q-009 §78-§86). It is not a second source of truth: refreshing the
 * page rebuilds it from the server's replay. Every collection is keyed by
 * a stable identity (message id, finding id, proposal id, approval id) so
 * a replayed durable event upserts and never duplicates, and the partial
 * text buffer is replaced by the persisted message when
 * `q.message.completed` arrives — the final message wins (§79).
 */

export type QStreamPartialMessage = {
  readonly messageId: string;
  readonly text: string;
};

export type QStreamApprovalState = {
  readonly approvalId: string;
  readonly proposalId: string;
  readonly expiresAt: string | undefined;
};

export type QStreamState = {
  readonly runId: string | null;
  readonly capability: QCapability | null;
  /** The last durable status the stream reported; null until run.started. */
  readonly runStatus: QRunStatus | null;
  readonly stage: QVisibleStage | null;
  /** Durable messages by id, in arrival order. */
  readonly messages: readonly QMessage[];
  /** Live text for a message that has not completed yet. */
  readonly partial: QStreamPartialMessage | null;
  readonly findings: readonly QPublicFinding[];
  readonly proposals: readonly QActionProposal[];
  readonly approval: QStreamApprovalState | null;
  readonly clarification: {
    readonly question: string;
    readonly options: readonly string[] | undefined;
  } | null;
  readonly failure: QPublicFailure | null;
  readonly completedAt: string | null;
  /** The highest durable sequence applied; the resume cursor. */
  readonly lastSequence: number;
  readonly terminal: boolean;
};

export function createQStreamState(): QStreamState {
  return {
    runId: null,
    capability: null,
    runStatus: null,
    stage: null,
    messages: [],
    partial: null,
    findings: [],
    proposals: [],
    approval: null,
    clarification: null,
    failure: null,
    completedAt: null,
    lastSequence: 0,
    terminal: false,
  };
}

function upsert<T>(
  items: readonly T[],
  item: T,
  key: (value: T) => string,
): readonly T[] {
  const id = key(item);
  const index = items.findIndex((existing) => key(existing) === id);
  if (index === -1) {
    return [...items, item];
  }
  const next = [...items];
  next[index] = item;
  return next;
}

export function reduceQStream(
  state: QStreamState,
  event: QStreamEvent,
): QStreamState {
  const runId = state.runId ?? event.runId;
  switch (event.type) {
    case "q.message.delta": {
      // Ephemeral: appended to the live buffer, never to durable state, and
      // ignored once the message it belongs to has been persisted.
      if (state.terminal) {
        return state;
      }
      if (state.messages.some((m) => m.messageId === event.data.messageId)) {
        return state;
      }
      const partial =
        state.partial !== null &&
        state.partial.messageId === event.data.messageId
          ? {
              messageId: state.partial.messageId,
              text: state.partial.text + event.data.text,
            }
          : { messageId: event.data.messageId, text: event.data.text };
      return { ...state, runId, partial };
    }
    case "q.run.started":
      return {
        ...applySequence(state, event),
        runId,
        capability: event.data.capability,
        runStatus: event.data.status,
      };
    case "q.stage.changed":
      return { ...applySequence(state, event), runId, stage: event.data.stage };
    case "q.message.completed": {
      const message = event.data.message;
      return {
        ...applySequence(state, event),
        runId,
        messages: upsert(state.messages, message, (m) => m.messageId),
        partial:
          state.partial?.messageId === message.messageId ? null : state.partial,
      };
    }
    case "q.finding.available":
      return {
        ...applySequence(state, event),
        runId,
        findings: upsert(
          state.findings,
          event.data.finding,
          (f) => f.findingId,
        ),
      };
    case "q.action.proposed":
      return {
        ...applySequence(state, event),
        runId,
        proposals: upsert(
          state.proposals,
          event.data.proposal,
          (p) => p.proposalId,
        ),
      };
    case "q.approval.required":
      return {
        ...applySequence(state, event),
        runId,
        runStatus: "AWAITING_APPROVAL",
        stage: "WAITING_FOR_APPROVAL",
        approval: {
          approvalId: event.data.approvalId,
          proposalId: event.data.proposalId,
          expiresAt: event.data.expiresAt,
        },
      };
    case "q.input.required":
      return {
        ...applySequence(state, event),
        runId,
        runStatus: "AWAITING_INPUT",
        clarification: {
          question: event.data.clarification.question,
          options: event.data.clarification.options,
        },
      };
    case "q.run.completed":
      return {
        ...applySequence(state, event),
        runId,
        runStatus: "COMPLETED",
        stage: null,
        partial: null,
        approval: null,
        clarification: null,
        completedAt: event.data.completedAt,
        terminal: true,
      };
    case "q.run.failed":
      return {
        ...applySequence(state, event),
        runId,
        runStatus: event.data.status,
        stage: null,
        // A cancelled or failed run has no half-written answer to keep.
        partial: null,
        approval: null,
        clarification: null,
        failure: event.data.failure,
        terminal: true,
      };
  }
}

function applySequence(state: QStreamState, event: QStreamEvent): QStreamState {
  return {
    ...state,
    lastSequence: Math.max(state.lastSequence, event.sequence),
  };
}

/**
 * The plain-English status a UI may show for the stage (§72, §121). The
 * enum itself is never user-facing prose.
 */
export function describeQStage(stage: QVisibleStage | null): string | null {
  switch (stage) {
    case null:
      return null;
    case "UNDERSTANDING_REQUEST":
      return "Understanding your request";
    case "REVIEWING_COMPANY":
      return "Reviewing the company";
    case "CHECKING_EVIDENCE":
      return "Checking the evidence";
    case "REVIEWING_INVESTOR_CRITERIA":
      return "Reviewing investor criteria";
    case "COMPARING_OPPORTUNITIES":
      return "Comparing opportunities";
    case "REVIEWING_RELATIONSHIP":
      return "Reviewing the relationship";
    case "PREPARING_ANALYSIS":
      return "Preparing the analysis";
    case "WAITING_FOR_REPLY":
      return "Q needs a little more information before continuing.";
    case "WAITING_FOR_APPROVAL":
      return "Q is waiting for your approval.";
    case "COMPLETING_APPROVED_ACTION":
      return "Completing the approved action";
  }
}
