import {
  QActionProposalSchema,
  Q_CONTRACT_VERSION,
  type QResponseMessage,
  type QResultBlock,
  type QRunId,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import {
  appendRunEvent,
  toQMessage,
  type QActionExecuteContext,
  type QActionExecuteOutcome,
  type QRuntimeRepositories,
} from "@capital-q/q-runtime";
import type { TenantId, UserId } from "@capital-q/security";

import type { QActionRecord, QActionRepository } from "../ports.js";
import type { QActionRegistry } from "../registry.js";

/**
 * What Q says about an action, and only after the record says it
 * (CQ-QACT-001, acceptance F7).
 *
 * Live, a founder asked Q to change their website and read "I've prepared
 * that change to your profile. Approve it and it goes in" — while the
 * proposer had refused the value and no proposal existed, so there was
 * nothing to approve. The sentence had been appended the moment a model
 * noted the request, before anything was proposed.
 *
 * Every sentence here is composed from a persisted record instead: the
 * proposal the Approval Engine wrote, the refusal the proposer returned,
 * the execution the gate recorded. A model's intent never reaches this
 * file, so it cannot make Q claim an action that does not exist, and
 * "done" is said only after the executor reported EXECUTED and the gate
 * persisted it.
 */
export type QActionNarrator = {
  /** A proposal and its approval request now exist. */
  readonly proposed: (
    run: QRunRef,
    action: Pick<QActionRecord, "summary"> &
      Partial<
        Pick<
          QActionRecord,
          | "id"
          | "runId"
          | "actionType"
          | "riskClass"
          | "targets"
          | "preview"
          | "createdAt"
        >
      >,
    approval?: { readonly id: string; readonly expiresAt: string },
    /** The same change was already waiting: shown again, nothing new made. */
    options?: { readonly alreadyWaiting?: boolean | undefined },
  ) => Promise<void>;
  /** The person asked for something that could not be prepared; `reason` is theirs to read. */
  readonly refused: (run: QRunRef, reason: string) => Promise<void>;
  /** What the execution gate recorded, after an approval. */
  readonly settled: (
    context: QActionExecuteContext,
    outcome: QActionExecuteOutcome,
  ) => Promise<void>;
};

export type QRunRef = {
  readonly runId: QRunId;
  readonly tenantId: TenantId;
  readonly actorUserId: UserId;
};

export const noQActionNarrator: QActionNarrator = {
  proposed: () => Promise.resolve(),
  refused: () => Promise.resolve(),
  settled: () => Promise.resolve(),
};

/** Ends a summary with exactly one full stop, whatever it ended with. */
function sentence(text: string): string {
  const trimmed = text.trim().replace(/[.\s]+$/u, "");
  return trimmed.length === 0 ? "" : `${trimmed}.`;
}

/**
 * The proposal itself, on the line that says it is waiting (QA 2026-10-01).
 * The conversation is where a waiting change is found again -- by the
 * typed "go ahead" (pending-decision), approve_pending_proposal and the
 * card after a reload -- and it used to be there only when the answer's
 * own structure carried it: an answer whose structure was refused left a
 * pending change no turn could find, and its card vanished.
 */
export function proposalBlocks(
  action: Parameters<QActionNarrator["proposed"]>[1],
  approval: Parameters<QActionNarrator["proposed"]>[2],
): readonly QResultBlock[] | undefined {
  if (
    approval === undefined ||
    action.id === undefined ||
    action.runId === undefined ||
    action.actionType === undefined ||
    action.riskClass === undefined ||
    action.targets === undefined ||
    action.createdAt === undefined
  ) {
    return undefined;
  }
  const proposal = QActionProposalSchema.safeParse({
    contractVersion: Q_CONTRACT_VERSION,
    proposalId: action.id,
    runId: action.runId,
    actionType: action.actionType,
    actionClass: action.riskClass,
    targets: [...action.targets],
    summary: action.summary,
    ...(action.preview === undefined || action.preview === null
      ? {}
      : { preview: action.preview }),
    approval: {
      required: true,
      approval: { approvalId: approval.id, status: "PENDING" },
    },
    status: "PROPOSED",
    createdAt: action.createdAt,
    expiresAt: approval.expiresAt,
  });
  return proposal.success
    ? [{ kind: "ACTION_PROPOSAL", proposal: proposal.data }]
    : undefined;
}

/** The same change asked for again: the card it already has, not a new one. */
export function alreadyWaitingLine(summary: string): string {
  return `That's ready: ${sentence(summary).replace(/\.$/u, "")}. It's waiting for your yes.`;
}

export function proposedLine(summary: string): string {
  // Plain status (R23/R37, live 2026-09-27 #2): what it is, and that it
  // is not saved until approved, on the card or by saying so.
  return `${sentence(summary)} Not saved yet: tap Approve on the card, or tell me to go ahead.`;
}

export function refusedLine(reason: string): string {
  return `I couldn't prepare that change: ${sentence(reason)} Nothing has been changed.`;
}

export function failedLine(): string {
  return "That change didn't go through, so nothing was changed. You can try again, or make it from the page itself.";
}

export function createQActionNarrator(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly runtime: Pick<
    QRuntimeRepositories,
    "runs" | "runEvents" | "messages"
  >;
  readonly actions: Pick<QActionRepository, "findById">;
  readonly registry: QActionRegistry;
  readonly logger?: Logger | undefined;
}): QActionNarrator {
  const { sql, transactions, runtime, actions, registry, logger } =
    dependencies;

  /**
   * One Q message in the run's own conversation, with its durable
   * completion event, committed together. A sentence that cannot be
   * written is a log line: the record it describes already stands, and
   * the approval control is drawn from that record, not from this text.
   */
  const say = async (
    run: QRunRef,
    content: string,
    blocks?: readonly QResultBlock[],
  ): Promise<void> => {
    try {
      const found = await runtime.runs.findForActor(
        sql,
        run.tenantId,
        run.actorUserId,
        run.runId,
      );
      if (found === null || found.conversationId === null) return;
      const conversationId = found.conversationId;
      await transactions.run(async (tx) => {
        const stored = await runtime.messages.insert(tx, {
          tenantId: run.tenantId,
          conversationId,
          runId: run.runId,
          role: "Q",
          content,
          ...(blocks === undefined ? {} : { blocks }),
        });
        await appendRunEvent(
          runtime,
          tx,
          { id: run.runId, tenantId: run.tenantId },
          {
            type: "q.message.completed",
            data: { message: toQMessage(stored) as QResponseMessage },
          },
        );
      });
    } catch (error: unknown) {
      logger?.warn(
        { err: error, qRunId: run.runId },
        "q action narration was not recorded",
      );
    }
  };

  /** "Done", from the persisted execution, in the definition's own words. */
  const executedLine = async (
    context: QActionExecuteContext,
  ): Promise<string | null> => {
    const action = await actions.findById(
      sql,
      context.tenantId,
      context.actionId,
    );
    if (action?.status !== "EXECUTED") return null;
    const definition = registry.get(action.actionType);
    if (definition?.confirm !== undefined) {
      const payload = definition.payload.safeParse(action.payload);
      const result = definition.result.safeParse(action.executionResult);
      if (payload.success && result.success) {
        return definition.confirm(payload.data, result.data);
      }
    }
    return `Done: ${sentence(action.summary)}`;
  };

  return {
    proposed: (run, action, approval, options) =>
      say(
        run,
        options?.alreadyWaiting === true
          ? alreadyWaitingLine(action.summary)
          : proposedLine(action.summary),
        proposalBlocks(action, approval),
      ),
    refused: (run, reason) => say(run, refusedLine(reason)),
    settled: async (context, outcome) => {
      const run: QRunRef = {
        runId: context.runId,
        tenantId: context.tenantId,
        actorUserId: context.actor.userId,
      };
      switch (outcome.kind) {
        case "EXECUTED": {
          const line = await executedLine(context).catch((error: unknown) => {
            logger?.warn(
              { err: error, qRunId: context.runId },
              "executed q action could not be read back for its confirmation",
            );
            return null;
          });
          // No record saying EXECUTED, no "done".
          if (line !== null) await say(run, line);
          return;
        }
        case "FAILED":
        case "RECONCILIATION_REQUIRED":
        case "BLOCKED":
          await say(run, failedLine());
          return;
        // Said once, by the invocation that executed; a replayed gate that
        // finds the work already done has nothing new to tell.
        case "ALREADY_EXECUTED":
        case "NOT_APPROVED":
        case "IN_PROGRESS":
          return;
      }
    },
  };
}
