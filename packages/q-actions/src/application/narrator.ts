import {
  QActionProposalSchema,
  Q_CONTRACT_VERSION,
  type NamedPicture,
  type QResponseMessage,
  type QResultBlock,
  type QRunId,
  type QSubjectRef,
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
          | "reason"
          | "createdAt"
          | "payload"
        >
      >,
    approval?: { readonly id: string; readonly expiresAt: string },
    /** The same change was already waiting: shown again, nothing new made. */
    options?: {
      readonly alreadyWaiting?: boolean | undefined;
      /** Older cards for the same thing this one replaced (no longer waiting). */
      readonly replaces?: readonly string[] | undefined;
    },
  ) => Promise<void>;
  /** The person asked for something that could not be prepared; `reason` is theirs to read. */
  readonly refused: (run: QRunRef, reason: string) => Promise<void>;
  /** A line of code's own about a waiting card, said in the run (no blocks). */
  readonly note?: ((run: QRunRef, line: string) => Promise<void>) | undefined;
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
  /** Whom it is aimed at, with their picture; undefined: not looked up. */
  named?: NamedPicture | null,
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
    ...(action.reason === undefined || action.reason === null
      ? {}
      : { reason: action.reason }),
    ...(named === undefined ? {} : { named }),
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

/** The older cards a new one replaced, named, and that they no longer wait. */
export function replacesLine(replaced: readonly string[]): string {
  const names = replaced.map((summary) =>
    sentence(summary).replace(/\.$/u, ""),
  );
  return names.length === 1
    ? `This replaces the earlier card: ${names[0] ?? ""} (no longer waiting).`
    : `This replaces the earlier cards: ${names.join("; ")} (no longer waiting).`;
}

export function proposedLine(summary: string, cardOnly = false): string {
  // Plain status (R23/R37, live 2026-09-27 #2): what it is, and that it
  // is not saved until approved, on the card or by saying so. A kind
  // that keeps its card (money, terms, a private document shared) is
  // never invited to be approved by words (owner 2026-10-16).
  return cardOnly
    ? `${sentence(summary)} Not saved yet: it needs your tap on Approve on the card.`
    : `${sentence(summary)} Not saved yet: tap Approve on the card, or tell me to go ahead.`;
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
  /**
   * A decision made in the person's own words is answered in the turn
   * they spoke (owner 2026-10-16: two "Done" lines for one action). While
   * that turn waits for the action, its outcome line is handed to it here
   * instead of being written a second time on the paused run.
   */
  readonly relay?:
    | {
        readonly heldFor: (actionId: string) => boolean;
        readonly hold: (actionId: string, line: string) => void;
      }
    | undefined;
  /**
   * Approval card upgrade (QA lead 2026-10-24): whom a new card is aimed
   * at (its first such target), with their picture under the viewer's
   * scope, as QPendingApproval.named. Absent: not shown.
   */
  readonly named?:
    | ((
        targets: readonly QSubjectRef[],
        run: QRunRef,
      ) => Promise<NamedPicture | null>)
    | undefined;
  /** Whether a kind keeps its card's Approve (never approved by words). */
  readonly cardOnly?:
    | ((action: {
        readonly actionType: string;
        readonly actionClass: string;
      }) => boolean)
    | undefined;
}): QActionNarrator {
  const { sql, transactions, runtime, actions, registry, logger } =
    dependencies;
  const keepsCard = (action: {
    readonly actionType?: string | undefined;
    readonly riskClass?: string | undefined;
  }): boolean =>
    dependencies.cardOnly !== undefined &&
    action.actionType !== undefined &&
    dependencies.cardOnly({
      actionType: action.actionType,
      actionClass: action.riskClass ?? "",
    });

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

  /** Said here, or handed to the turn that decided it by words. */
  const sayOnce = async (
    actionId: string,
    run: QRunRef,
    line: string,
  ): Promise<void> => {
    const relay = dependencies.relay;
    if (relay !== undefined && relay.heldFor(actionId)) {
      relay.hold(actionId, line);
      return;
    }
    await say(run, line);
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

  /** The definition's own line for a new card, from the exact payload. */
  const definedProposedLine = (
    action: Parameters<QActionNarrator["proposed"]>[1],
  ): string | null => {
    if (action.actionType === undefined || action.payload === undefined) {
      return null;
    }
    const definition = registry.get(action.actionType);
    if (definition?.proposed === undefined) return null;
    const payload = definition.payload.safeParse(action.payload);
    return payload.success
      ? definition.proposed(payload.data, action.summary)
      : null;
  };

  return {
    proposed: async (run, action, approval, options) => {
      const named =
        dependencies.named === undefined || action.targets === undefined
          ? undefined
          : await dependencies
              .named(action.targets, run)
              .catch(() => undefined);
      const line =
        definedProposedLine(action) ??
        proposedLine(action.summary, keepsCard(action));
      return say(
        run,
        options?.alreadyWaiting === true
          ? alreadyWaitingLine(action.summary)
          : options?.replaces !== undefined && options.replaces.length > 0
            ? `${line} ${replacesLine(options.replaces)}`
            : line,
        proposalBlocks(action, approval, named),
      );
    },
    refused: (run, reason) => say(run, refusedLine(reason)),
    note: (run, line) => say(run, line),
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
          if (line !== null) await sayOnce(context.actionId, run, line);
          return;
        }
        case "FAILED":
        case "RECONCILIATION_REQUIRED":
        case "BLOCKED":
          await sayOnce(context.actionId, run, failedLine());
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
