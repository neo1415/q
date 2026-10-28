import type {
  QActionProposal,
  QArtifactPreview,
  QCapability,
  QMessage,
  QPublicFailure,
  QPublicFinding,
  QRunStatus,
  QStageAbout,
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
  /** A holding line: replaced by any delta, cleared by any message. */
  readonly holding?: true | undefined;
};

export type QStreamApprovalState = {
  readonly approvalId: string;
  readonly proposalId: string;
  readonly expiresAt: string | undefined;
};

export type QStageStep = {
  readonly sequence: number;
  readonly stage: QVisibleStage;
  /** Round 4: what the run said the stage is about, when it said. */
  readonly about?: QStageAbout | undefined;
};

export type QStreamState = {
  readonly runId: string | null;
  readonly capability: QCapability | null;
  /** The last durable status the stream reported; null until run.started. */
  readonly runStatus: QRunStatus | null;
  readonly stage: QVisibleStage | null;
  /**
   * Every stage this run has reported, by its sequence, oldest first: the
   * run's real path, for a step list of where Q has been (owner 2026-10-21:
   * stages shown as they happen, never a timer). Keyed by sequence, so a
   * replay after a reconnect upserts and never adds a step twice.
   */
  readonly stageHistory: readonly QStageStep[];
  /** Durable messages by id, in arrival order. */
  readonly messages: readonly QMessage[];
  /** Live text for a message that has not completed yet. */
  readonly partial: QStreamPartialMessage | null;
  /**
   * Artifacts live: the subjects the live message has named so far, for
   * a card skeleton while Q talks. Ephemeral like `partial`, and dropped
   * the moment that message is persisted (its blocks win).
   */
  readonly preview: QArtifactPreview | null;
  /**
   * Owner 2026-10-23: what each persisted message had put up while it
   * streamed, by message id. A card shown for a turn stays through the
   * answer: an answer with no cards of its own keeps these on screen
   * rather than clearing them as it lands.
   */
  readonly landedPreviews?: Readonly<Record<string, QArtifactPreview>>;
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
    stageHistory: [],
    messages: [],
    partial: null,
    preview: null,
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
        state.partial.messageId === event.data.messageId &&
        state.partial.holding !== true
          ? {
              messageId: state.partial.messageId,
              text: state.partial.text + event.data.text,
            }
          : {
              messageId: event.data.messageId,
              text: event.data.text,
              ...(event.data.holding === true
                ? { holding: true as const }
                : {}),
            };
      return { ...state, runId, partial };
    }
    case "q.artifact.preview": {
      // Ephemeral, like a delta: never once the run is over or its
      // message is persisted. Each preview carries every subject named so
      // far, so the newest replaces the last.
      if (state.terminal) return state;
      if (state.messages.some((m) => m.messageId === event.data.messageId)) {
        return state;
      }
      return { ...state, runId, preview: event.data };
    }
    case "q.run.started":
      return {
        ...applySequence(state, event),
        runId,
        capability: event.data.capability,
        runStatus: event.data.status,
      };
    case "q.stage.changed": {
      const step: QStageStep = {
        sequence: event.sequence,
        stage: event.data.stage,
        ...(event.data.about === undefined ? {} : { about: event.data.about }),
      };
      const stageHistory = [
        ...state.stageHistory.filter((one) => one.sequence !== step.sequence),
        step,
      ]
        .sort((a, b) => a.sequence - b.sequence)
        .slice(-Q_STAGE_HISTORY_MAX);
      // The current stage is the newest by sequence, not the last to
      // arrive: a replayed older stage never moves Q backwards.
      const newest = stageHistory.at(-1)?.stage ?? event.data.stage;
      return {
        ...applySequence(state, event),
        runId,
        stage: newest,
        stageHistory,
      };
    }
    case "q.message.completed": {
      const message = event.data.message;
      return {
        ...applySequence(state, event),
        runId,
        messages: upsert(state.messages, message, (m) => m.messageId),
        // A holding line gives way to whatever message the run settles on.
        partial:
          state.partial?.messageId === message.messageId ||
          state.partial?.holding === true
            ? null
            : state.partial,
        preview:
          state.preview?.messageId === message.messageId ? null : state.preview,
        ...(state.preview?.messageId === message.messageId
          ? {
              landedPreviews: {
                ...state.landedPreviews,
                [message.messageId]: state.preview,
              },
            }
          : {}),
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
        preview: null,
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
        preview: null,
        approval: null,
        clarification: null,
        failure: event.data.failure,
        terminal: true,
      };
  }
}

/** A run reports a handful of stages; this bounds a pathological one. */
export const Q_STAGE_HISTORY_MAX = 24;

/**
 * The steps Q has actually taken this run, in order, for a step list: the
 * run's stage history with a stage repeated back to back said once. The
 * last one is where Q is now. Nothing here is inferred or timed.
 */
export function qStageSteps(
  history: readonly QStageStep[],
): readonly QVisibleStage[] {
  const steps: QVisibleStage[] = [];
  for (const { stage } of history) {
    if (steps.at(-1) !== stage) steps.push(stage);
  }
  return steps;
}

/** Where Q is now: the newest step and what it is about; null before any. */
export function qCurrentStage(
  history: readonly QStageStep[],
): QStageStep | null {
  return history.at(-1) ?? null;
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
      return "Looking at the company";
    case "CHECKING_EVIDENCE":
      return "Reading their deck and documents";
    case "SEARCHING_PUBLIC_SOURCES":
      return "Looking into it";
    case "REVIEWING_INVESTOR_CRITERIA":
      return "Reading the investor's mandate";
    case "COMPARING_OPPORTUNITIES":
      return "Comparing them side by side";
    case "REVIEWING_RELATIONSHIP":
      return "Checking where things stand";
    case "PREPARING_ANALYSIS":
      return "Pulling it together";
    case "PREPARING_DOCUMENT":
      return "Writing your document. This takes a moment.";
    case "REVISING_DOCUMENT":
      return "Making your changes to the document. One moment.";
    case "DESIGNING_DOCUMENT":
      return "Laying out each page";
    case "FINDING_DOCUMENT_IMAGES":
      return "Finding pictures and drawing your charts";
    case "CHECKING_DOCUMENT":
      return "Checking every page";
    case "WAITING_FOR_REPLY":
      return "Q needs a little more information before continuing.";
    case "WAITING_FOR_APPROVAL":
      return "Q is waiting for your approval.";
    case "COMPLETING_APPROVED_ACTION":
      return "Completing the approved action";
    case "GATHERING_SITUATION":
      return "Gathering your situation";
    case "READING_DOCUMENTS":
      return "Reading your documents";
    case "DRAFTING_PLAN":
      return "Drafting the plan";
    case "REVIEWING_PLAN":
      return "Reviewing the plan";
  }
}
