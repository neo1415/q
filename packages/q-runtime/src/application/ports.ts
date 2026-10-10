import type {
  QConversationId,
  QMessageId,
  QRunId,
  QRunStatus,
  QSubjectRef,
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
  QConversationDigest,
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
  /**
   * What the conversation is about, replaced.
   *
   * Set when a turn names a subject, so the next turn inherits it. Each
   * subject is re-resolved for the actor on every run, so recording one
   * here grants nothing: it is a memory of what was being discussed, not
   * a standing permission.
   */
  readonly setSubjects: (
    tx: TransactionContext,
    tenantId: TenantId,
    conversationId: QConversationId,
    subjects: readonly QSubjectRef[],
  ) => Promise<void>;
  /**
   * The owner's open conversations, newest activity first, bounded.
   * `before` pages by last activity. Owner and tenant, always.
   */
  readonly listForOwner: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    userId: UserId,
    page: {
      readonly limit: number;
      readonly before?: UtcTimestamp | undefined;
    },
  ) => Promise<readonly QConversation[]>;
  /** Other recent conversations of the owner, for cross-conversation memory: identifiers, titles and summaries only. */
  readonly setDigest: (
    tx: TransactionContext,
    tenantId: TenantId,
    conversationId: QConversationId,
    digest: QConversationDigest,
  ) => Promise<void>;
  /** Archives the owner's conversation; idempotent; null when it is not theirs. */
  readonly archiveForOwner: (
    tx: TransactionContext,
    tenantId: TenantId,
    userId: UserId,
    conversationId: QConversationId,
  ) => Promise<QConversation | null>;
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

/**
 * S2: a chain of lifecycle moves and its event as ONE statement. The
 * caller has already checked, from the lifecycle map, that every move in
 * the chain is legal from each status in `allowedFrom`; the statement
 * applies the whole chain only to a run that is the actor's, in the
 * tenant, and in one of those statuses at the instant it holds the row
 * lock. A run anywhere else (already moved by a replay, terminal,
 * cancel-requested, someone else's) updates nothing and returns null, and
 * the caller falls back to the locked, step-by-step path.
 */
export type QRunMoveChain = {
  readonly tenantId: TenantId;
  readonly actorUserId: UserId;
  readonly runId: QRunId;
  /** The statuses the chain may start from. */
  readonly allowedFrom: readonly QRunStatus[];
  /** How many lifecycle moves the chain is (the version rises by this). */
  readonly steps: number;
  readonly status: QRunStatus;
  readonly startedAt?: UtcTimestamp | undefined;
  readonly completedAt?: UtcTimestamp | undefined;
  readonly failureCode?: QFailureDiagnosticCode | undefined;
  readonly orchestrationVersion?: string | undefined;
  readonly modelPolicyVersion?: string | undefined;
  readonly promptBundleVersion?: string | undefined;
  /**
   * The one event the chain appends, if any. With `onlyIfStageDiffers`
   * it is appended only when the run's latest visible stage is not
   * already that stage (a replay never duplicates a stage event).
   */
  readonly event?:
    | {
        readonly eventType: string;
        readonly visibleStage: QVisibleStage | null;
        readonly payload: unknown;
        readonly onlyIfStageDiffers: boolean;
      }
    | undefined;
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
  /**
   * Non-terminal runs that have shown no sign of life (no durable event,
   * no start, no creation) since the given instants, oldest first,
   * bounded. In-flight and paused runs have separate windows: a run paused
   * for a person is not orphaned by being quiet. For the orphan sweep,
   * which must never touch a run another process is still working on.
   */
  readonly listStale: (
    executor: DatabaseExecutor,
    input: {
      readonly inFlightSilentSince: UtcTimestamp;
      readonly pausedSilentSince: UtcTimestamp;
      /**
       * G-D24: an in-flight run whose engine heartbeats is orphaned once
       * its heartbeat is older than this. Absent: the in-flight window.
       */
      readonly engineSilentSince?: UtcTimestamp | undefined;
      readonly limit: number;
    },
  ) => Promise<readonly QRunRecord[]>;
  /** The newest run of a conversation, for reopening it where it stopped. Owner-scoped. */
  readonly findLatestForConversation: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    userId: UserId,
    conversationId: QConversationId,
  ) => Promise<QRunRecord | null>;
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
  /** S2: see QRunMoveChain. Absent: the caller uses `transition`. */
  readonly moveChain?:
    | ((
        executor: DatabaseExecutor,
        input: QRunMoveChain,
      ) => Promise<QRunRecord | null>)
    | undefined;
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
  /**
   * The most recent messages of the CONVERSATION the run belongs to,
   * oldest first, bounded.
   *
   * A voice turn is its own run, so run-scoped history meant Q could not
   * see the sentence it had spoken a moment earlier: it named a company,
   * was asked "tell me more about it", and answered that no company had
   * been named. A conversation is the thing a person is having; a run is
   * one turn of it.
   */
  readonly listRecentForConversationOfRun: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    runId: QRunId,
    limit: number,
  ) => Promise<readonly QConversationMessage[]>;
  /** The most recent messages of a conversation, oldest first, bounded. Tenant-scoped; the caller has checked ownership. */
  readonly listRecentForConversation: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    conversationId: QConversationId,
    limit: number,
    /**
     * readBack: what Q may read back (memory learning): marked lines --
     * speech for someone else, lines the person hid -- are left out. The
     * person's own history view keeps them.
     */
    options?: { readonly readBack?: boolean | undefined },
  ) => Promise<readonly QConversationMessage[]>;
  /**
   * Keep lines out of what Q reads back, append-only (20261110030000):
   * the person's lines not meant for Q, and Q's replies to them. Only
   * lines of this conversation are marked; marking twice is a no-op.
   */
  readonly mark?: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly conversationId: string;
      readonly messageIds: readonly string[];
      readonly mark: "NOT_ADDRESSED_TO_Q" | "HIDDEN_BY_PERSON";
      readonly markedBy: "Q_READING" | "PERSON";
      readonly runId?: string | undefined;
    },
  ) => Promise<void>;
};

export type QRunEventRepository = {
  /** Append only. The sequence must already have been allocated. */
  readonly append: (
    tx: TransactionContext,
    input: NewQRunEvent,
  ) => Promise<QRunEventRecord>;
  /**
   * R5: allocate the run's next sequence and append the event in ONE
   * statement (the same row lock, the same consecutive numbering, the same
   * unique (run_id, sequence) arbiter). Null when the run does not exist.
   * Optional: a store without it is used through allocate + append.
   */
  readonly appendNext?: (
    tx: TransactionContext,
    input: Omit<NewQRunEvent, "sequence">,
  ) => Promise<QRunEventRecord | null>;
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
