import {
  CorrelationIdSchema,
  QActionProposalIdSchema,
  QApprovalIdSchema,
  QRunIdSchema,
  type QApprovalView,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  QActionPayloadMismatchError,
  QApprovalAlreadyDecidedError,
  QApprovalExpiredError,
  type QActionService,
} from "@capital-q/q-actions";
import type { QOrchestrator, QRuntimeService } from "@capital-q/q-runtime";
import type {
  ConversationProposal,
  PendingProposalContext,
  PendingProposalPort,
  ProposalPlainStatus,
} from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

import type { PendingDecisionPort } from "@capital-q/q-specialists";

import type { DecisionReader } from "../voice/decision.js";
import type { ApprovedContinuation } from "./approved-continuation.js";

/**
 * Approval by conversation (live test 2026-09-27 #1, #2).
 *
 * The status of a change Q prepared, in the only terms Q may use about it,
 * read from the Approval Engine as the person: pending, saving, saved, not
 * saved, declined or expired. Q said "ready for approval" and "done" about
 * the same change because it had the approval row's status (APPROVED) and
 * not whether the action ran; SAVED here means the action EXECUTED.
 */
export function plainProposalStatus(view: QApprovalView): ProposalPlainStatus {
  switch (view.status) {
    case "PENDING":
      return view.canDecide ? "PENDING" : "EXPIRED";
    case "REJECTED":
      return "DECLINED";
    case "EXPIRED":
    case "REVOKED":
      return "EXPIRED";
    case "APPROVED":
      switch (view.action.actionStatus) {
        case "EXECUTED":
          return "SAVED";
        case "APPROVED":
        case "EXECUTING":
          return "SAVING";
        // Approved, but the change did not (or can no longer) go through.
        case "FAILED":
        case "RECONCILIATION_REQUIRED":
        case "EXPIRED":
        case "WITHDRAWN":
        case "REJECTED":
        case "PROPOSED":
        case "AWAITING_APPROVAL":
          return "NOT_SAVED";
      }
  }
}

export type ConversationApprovalDependencies = {
  readonly runtime: Pick<QRuntimeService, "getRun" | "getConversation">;
  /**
   * Resolved at call time: the Approval Engine and the orchestrator are
   * composed after the tools that call this port. An absent orchestrator
   * means an approved action waits for a worker, as after the card's
   * Approve.
   */
  readonly late: () => {
    readonly actions: Pick<
      QActionService,
      | "findApprovalForAction"
      | "getApproval"
      | "approve"
      | "reject"
      | "listPendingApprovals"
    >;
    readonly orchestrator: QOrchestrator | undefined;
    /**
     * Resume, or execute through the gate when the run cannot resume
     * (approved-continuation.ts). Absent: resume only.
     */
    readonly continueApproved?: ApprovedContinuation | undefined;
  };
  /** How long an approval waits for the change to be applied before answering "saving". */
  readonly applyWithinMs?: number | undefined;
  readonly logger?: Logger | undefined;
};

const APPLY_WITHIN_MS = 12_000;
const PROPOSALS_MAX = 12;

/**
 * The port behind `approve_pending_proposal`. Everything is read as the
 * actor: the run and conversation through their owner checks, each
 * proposal through `getApproval`, which refuses anyone the approval was
 * not requested from. Approving is the Approval Engine's own `approve`,
 * the call the card's Approve button makes, then the paused run's
 * resumption, which executes through the execution gate.
 */
export function createConversationApprovalPort(
  dependencies: ConversationApprovalDependencies,
): PendingProposalPort {
  const { runtime, late, logger } = dependencies;
  const applyWithinMs = dependencies.applyWithinMs ?? APPLY_WITHIN_MS;

  const viewOf = async (
    actor: ActorContext,
    proposalId: string,
    correlationId: string,
  ): Promise<QApprovalView | null> => {
    const id = QActionProposalIdSchema.safeParse(proposalId);
    if (!id.success) return null;
    const { actions } = late();
    const approval = await actions.findApprovalForAction(
      actor.tenantId,
      id.data,
    );
    if (approval === null) return null;
    // findApprovalForAction is tenant-scoped only; getApproval is the
    // read as this person, and refuses anyone else.
    return actions
      .getApproval({
        actor,
        approvalId: QApprovalIdSchema.parse(approval.id),
        correlationId: CorrelationIdSchema.parse(correlationId),
      })
      .catch(() => null);
  };

  const inConversation = async (
    context: PendingProposalContext,
  ): Promise<readonly ConversationProposal[]> => {
    const { actor } = context;
    const correlationId = CorrelationIdSchema.parse(context.correlationId);
    const { run } = await runtime.getRun({
      actor,
      runId: QRunIdSchema.parse(context.runId),
      correlationId,
    });
    if (run.conversationId === null) return [];
    const { messages } = await runtime.getConversation({
      actor,
      conversationId: run.conversationId,
      correlationId,
    });
    const seen = new Map<string, string>();
    for (const message of messages) {
      for (const block of message.blocks ?? []) {
        if (block.kind === "ACTION_PROPOSAL") {
          seen.set(block.proposal.proposalId, block.proposal.summary);
        }
      }
    }
    const proposals: ConversationProposal[] = [];
    for (const [proposalId, summary] of [...seen].slice(-PROPOSALS_MAX)) {
      const view = await viewOf(actor, proposalId, context.correlationId);
      if (view === null) continue;
      proposals.push({
        proposalId,
        summary,
        status: plainProposalStatus(view),
      });
    }
    return proposals;
  };

  const approve = async (
    context: PendingProposalContext,
    proposalId: string,
  ): Promise<{ readonly status: ProposalPlainStatus | "CHANGED" }> => {
    const { actor } = context;
    const correlationId = CorrelationIdSchema.parse(context.correlationId);
    const before = await viewOf(actor, proposalId, context.correlationId);
    if (before === null) {
      throw new Error("the proposal is not readable as this person");
    }
    const { actions, orchestrator, continueApproved } = late();
    // Whether the continuation finished within the wait: "applying" is
    // said only while it may still be running (live 2026-10-01: Q said
    // "It's being applied now" about an action whose continuation had
    // already failed, and it stayed APPROVED).
    let continued: "WAITING" | "DONE" | "FAILED" = "WAITING";
    try {
      const result = await actions.approve({
        actor,
        approvalId: before.approvalId,
        correlationId,
      });
      // A repeated approve of an action still waiting to run (its first
      // continuation was lost) continues it again; the gate's claim makes
      // that safe.
      const waiting =
        result.decided ||
        (continueApproved !== undefined && result.action.status === "APPROVED");
      const continuation =
        continueApproved !== undefined
          ? () =>
              continueApproved({
                actor,
                runId: result.action.runId,
                actionId: result.action.id,
                correlationId,
              })
          : orchestrator !== undefined
            ? () =>
                orchestrator
                  .resume({ actor, runId: result.action.runId, correlationId })
                  .then(() => undefined)
            : undefined;
      if (waiting && continuation !== undefined) {
        // The same continuation the card's Approve starts. It runs on its
        // own; this answer waits a bounded time to report what happened.
        const resumed = continuation()
          .then(() => {
            continued = "DONE";
            return true;
          })
          .catch((error: unknown) => {
            logger?.error(
              { err: error, qRunId: result.action.runId, correlationId },
              "q run did not resume after an approval by conversation",
            );
            continued = "FAILED";
            return true;
          });
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          resumed,
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => {
              resolve(false);
            }, applyWithinMs);
            timer.unref();
          }),
        ]);
        if (timer !== undefined) clearTimeout(timer);
      }
    } catch (error: unknown) {
      if (error instanceof QActionPayloadMismatchError) {
        return { status: "CHANGED" };
      }
      if (error instanceof QApprovalExpiredError) {
        return { status: "EXPIRED" };
      }
      if (!(error instanceof QApprovalAlreadyDecidedError)) throw error;
      // Decided meanwhile (on the card, or by a retried call): reported
      // as it now stands, below.
    }
    const after = await viewOf(actor, proposalId, context.correlationId);
    if (after === null) return { status: "NOT_SAVED" };
    const status = plainProposalStatus(after);
    // Approved and nothing left running it: not "being applied".
    if (
      status === "SAVING" &&
      continued !== "WAITING" &&
      after.action.actionStatus === "APPROVED"
    ) {
      return { status: "NOT_SAVED" };
    }
    return { status };
  };

  /**
   * R33: "no, don't". The Approval Engine's own reject, the call the
   * card's Decline makes, as this person; nothing executes.
   */
  const decline = async (
    context: PendingProposalContext,
    proposalId: string,
  ): Promise<{ readonly status: ProposalPlainStatus }> => {
    const { actor } = context;
    const before = await viewOf(actor, proposalId, context.correlationId);
    if (before === null) {
      throw new Error("the proposal is not readable as this person");
    }
    try {
      await late().actions.reject({
        actor,
        approvalId: before.approvalId,
        correlationId: CorrelationIdSchema.parse(context.correlationId),
      });
    } catch (error: unknown) {
      if (
        !(error instanceof QApprovalAlreadyDecidedError) &&
        !(error instanceof QApprovalExpiredError)
      ) {
        throw error;
      }
    }
    const after = await viewOf(actor, proposalId, context.correlationId);
    return { status: after === null ? "EXPIRED" : plainProposalStatus(after) };
  };

  /**
   * An approval from the person's inbox (another conversation), by id,
   * read as them: getApproval refuses anyone it was not requested from.
   */
  const inboxItem = async (
    context: PendingProposalContext,
    approvalId: string,
  ): Promise<ConversationProposal | null> => {
    const id = QApprovalIdSchema.safeParse(approvalId);
    if (!id.success) return null;
    const view = await late()
      .actions.getApproval({
        actor: context.actor,
        approvalId: id.data,
        correlationId: CorrelationIdSchema.parse(context.correlationId),
      })
      .catch(() => null);
    if (view === null) return null;
    return {
      proposalId: view.action.actionId,
      summary: view.action.summary,
      status: plainProposalStatus(view),
    };
  };

  return { inConversation, approve, decline, inboxItem };
}

/** How recently a change in another conversation was asked for to count. */
export const RECENT_ELSEWHERE_MS = 30 * 60_000;

/**
 * Changes still waiting for this person's approval, asked for in the last
 * half hour in a conversation other than this run's (live 2026-10-01). The
 * person's own pending list, each read back as them through getApproval.
 */
export function createRecentPendingElsewhere(
  dependencies: Pick<ConversationApprovalDependencies, "runtime" | "late"> & {
    readonly withinMs?: number | undefined;
    readonly now?: (() => number) | undefined;
  },
): (
  context: PendingProposalContext,
) => Promise<readonly ConversationProposal[]> {
  const { runtime, late } = dependencies;
  const withinMs = dependencies.withinMs ?? RECENT_ELSEWHERE_MS;
  const now = dependencies.now ?? Date.now;
  return async (context) => {
    const { actor } = context;
    const correlationId = CorrelationIdSchema.parse(context.correlationId);
    const { run } = await runtime.getRun({
      actor,
      runId: QRunIdSchema.parse(context.runId),
      correlationId,
    });
    const { actions } = late();
    const rows = await actions.listPendingApprovals({ actor });
    const found: ConversationProposal[] = [];
    for (const row of rows) {
      if (
        row.conversationId !== null &&
        row.conversationId === run.conversationId
      ) {
        continue;
      }
      if (now() - Date.parse(row.requestedAt) > withinMs) continue;
      const view = await actions
        .getApproval({ actor, approvalId: row.approvalId, correlationId })
        .catch(() => null);
      if (view === null) continue;
      found.push({
        proposalId: view.action.actionId,
        summary: view.action.summary,
        status: plainProposalStatus(view),
      });
    }
    return found;
  };
}

/**
 * The typed-turn decision port (founder fixture #1): the conversation's
 * proposals and their engine status, the person's words read by
 * DECISION_READER, and the engine's own approve and reject.
 */
export function createPendingDecisionPort(dependencies: {
  readonly proposals: PendingProposalPort;
  readonly decisions: DecisionReader;
  /** Changes waiting in their other conversations, asked for recently. */
  readonly recentElsewhere?:
    | ((
        context: PendingProposalContext,
      ) => Promise<readonly ConversationProposal[]>)
    | undefined;
  /** Where an approved change's work stands now (the receipts port). */
  readonly progress?: PendingDecisionPort["progress"];
}): PendingDecisionPort {
  const { proposals, decisions, recentElsewhere, progress } = dependencies;
  return {
    ...(recentElsewhere === undefined ? {} : { recentElsewhere }),
    ...(progress === undefined ? {} : { progress }),
    proposals: (context) => proposals.inConversation(context),
    read: (input) =>
      decisions.read({
        question: input.question,
        utterance: input.utterance,
        recentTurns: input.recentTurns,
        attribution: {
          tenantId: input.context.tenantId,
          userId: input.context.userId,
          correlationId: input.context.correlationId,
        },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }),
    approve: (context, proposalId) => proposals.approve(context, proposalId),
    decline: async (context, proposalId) => {
      if (proposals.decline === undefined) {
        return { status: "PENDING" as const };
      }
      return proposals.decline(context, proposalId);
    },
  };
}
