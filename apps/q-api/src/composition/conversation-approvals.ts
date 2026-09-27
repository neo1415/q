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
      "findApprovalForAction" | "getApproval" | "approve"
    >;
    readonly orchestrator: QOrchestrator | undefined;
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
    const { actions, orchestrator } = late();
    try {
      const result = await actions.approve({
        actor,
        approvalId: before.approvalId,
        correlationId,
      });
      if (result.decided && orchestrator !== undefined) {
        // The same continuation the card's Approve starts. It runs on its
        // own; this answer waits a bounded time to report what happened.
        const resumed = orchestrator
          .resume({ actor, runId: result.action.runId, correlationId })
          .then(() => true)
          .catch((error: unknown) => {
            logger?.error(
              { err: error, qRunId: result.action.runId, correlationId },
              "q run did not resume after an approval by conversation",
            );
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
    return {
      status: after === null ? "NOT_SAVED" : plainProposalStatus(after),
    };
  };

  return { inConversation, approve };
}
