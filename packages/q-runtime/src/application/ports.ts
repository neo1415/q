import type {
  QConversationId,
  QMessageId,
  QRunId,
  QRunStatus,
  QVisibleStage,
  UtcTimestamp,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { TenantId, UserId } from "@capital-q/security";
import type { QFailureDiagnosticCode } from "@capital-q/contracts";

import type {
  NewQConversation,
  NewQConversationMessage,
  NewQRun,
  NewQRunEvent,
  QConversation,
  QConversationMessage,
  QRunEventRecord,
  QRunRecord,
} from "../contracts/index.js";

/**
 * Persistence ports for the Q runtime.
 *
 * Every method is a named operation with its own rules and its own
 * predicate. Reads for a person carry tenant AND owner; there is no
 * `findById(id)` that returns whatever row matches, because that is the
 * method a route would eventually call without the ownership check. The one
 * ownership-only lookup exists so a refused access can be recorded as a
 * security event — it returns identifiers, never content.
 *
 * There is deliberately no `update(id, patch)` and no `setStatus`. A run's
 * status moves only through `transition`, which applies one lifecycle move
 * under the version the caller read.
 */

export type QConversationRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewQConversation,
  ) => Promise<QConversation>;
  readonly findForOwner: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    userId: UserId,
    conversationId: QConversationId,
  ) => Promise<QConversation | null>;
  /** Identifiers only, for recording a refused access. Never content. */
  readonly findOwnership: (
    executor: DatabaseExecutor,
    conversationId: QConversationId,
  ) => Promise<{ readonly tenantId: TenantId; readonly userId: UserId } | null>;
};

export type QRunTransition = {
  readonly tenantId: TenantId;
  readonly runId: QRunId;
  readonly expectedVersion: number;
  readonly status: QRunStatus;
  readonly startedAt?: UtcTimestamp | undefined;
  readonly completedAt?: UtcTimestamp | undefined;
  readonly failureCode?: QFailureDiagnosticCode | undefined;
  /** Assigned once, when orchestration first picks the run up. */
  readonly orchestrationVersion?: string | undefined;
  /** The routing policy the answer was produced under (CQ-Q-005). */
  readonly modelPolicyVersion?: string | undefined;
  /** The prompt bundle the answer was produced under (CQ-Q-006). */
  readonly promptBundleVersion?: string | undefined;
};

export type QRunRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewQRun,
  ) => Promise<QRunRecord>;
  readonly findForActor: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    userId: UserId,
    runId: QRunId,
  ) => Promise<QRunRecord | null>;
  readonly findOwnership: (
    executor: DatabaseExecutor,
    runId: QRunId,
  ) => Promise<{
    readonly tenantId: TenantId;
    readonly actorUserId: UserId;
  } | null>;
  /** Row lock for a lifecycle decision made from the current state. */
  readonly lockForActor: (
    tx: TransactionContext,
    tenantId: TenantId,
    userId: UserId,
    runId: QRunId,
  ) => Promise<QRunRecord | null>;
  /**
   * Applies one lifecycle move. The expected version is part of the
   * predicate, so a stale writer updates nothing and receives null.
   */
  readonly transition: (
    tx: TransactionContext,
    input: QRunTransition,
  ) => Promise<QRunRecord | null>;
  /**
   * Claims the next per-run event sequence under the run's row lock. Two
   * concurrent writers receive distinct consecutive numbers; neither is
   * dropped. Null when the run does not exist in this tenant.
   */
  readonly allocateEventSequence: (
    tx: TransactionContext,
    tenantId: TenantId,
    runId: QRunId,
  ) => Promise<number | null>;
};

export type QConversationMessageRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewQConversationMessage,
  ) => Promise<QConversationMessage>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    messageId: QMessageId,
  ) => Promise<QConversationMessage | null>;
  /** Oldest first, bounded. */
  readonly listForRun: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    runId: QRunId,
    limit: number,
  ) => Promise<readonly QConversationMessage[]>;
};

export type QRunEventRepository = {
  /** Append only. The sequence must already have been allocated. */
  readonly append: (
    tx: TransactionContext,
    input: NewQRunEvent,
  ) => Promise<QRunEventRecord>;
  /** Ordered by sequence; `afterSequence` is the replay cursor. */
  readonly listForRun: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    runId: QRunId,
    page?: {
      readonly afterSequence?: number | undefined;
      readonly limit?: number | undefined;
    },
  ) => Promise<readonly QRunEventRecord[]>;
  /** The stage on the latest event that carries one, or null. */
  readonly latestVisibleStage: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    runId: QRunId,
  ) => Promise<QVisibleStage | null>;
};

export type QRunCreationRecord = {
  readonly requestHash: string;
  readonly runId: QRunId;
  readonly tenantId: TenantId;
};

export type QRunCreationRequestStore = {
  readonly lock: (
    tx: TransactionContext,
    userId: UserId,
    idempotencyKeyHash: string,
  ) => Promise<void>;
  readonly find: (
    tx: TransactionContext,
    userId: UserId,
    idempotencyKeyHash: string,
  ) => Promise<QRunCreationRecord | null>;
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly userId: UserId;
      readonly idempotencyKeyHash: string;
      readonly requestHash: string;
      readonly runId: QRunId;
      readonly tenantId: TenantId;
    },
  ) => Promise<void>;
};

export type QMessageCreationRecord = {
  readonly requestHash: string;
  readonly messageId: QMessageId;
  readonly tenantId: TenantId;
};

export type QMessageCreationRequestStore = {
  readonly lock: (
    tx: TransactionContext,
    userId: UserId,
    runId: QRunId,
    idempotencyKeyHash: string,
  ) => Promise<void>;
  readonly find: (
    tx: TransactionContext,
    userId: UserId,
    runId: QRunId,
    idempotencyKeyHash: string,
  ) => Promise<QMessageCreationRecord | null>;
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly userId: UserId;
      readonly runId: QRunId;
      readonly idempotencyKeyHash: string;
      readonly requestHash: string;
      readonly messageId: QMessageId;
      readonly tenantId: TenantId;
    },
  ) => Promise<void>;
};

export type QRuntimeRepositories = {
  readonly conversations: QConversationRepository;
  readonly runs: QRunRepository;
  readonly messages: QConversationMessageRepository;
  readonly runEvents: QRunEventRepository;
  readonly runCreationRequests: QRunCreationRequestStore;
  readonly messageCreationRequests: QMessageCreationRequestStore;
};
