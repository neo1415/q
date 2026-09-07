import type {
  QActionClass,
  QActionPayloadHash,
  QActionProposalId,
  QActionStatus,
  QActionType,
  QApprovalId,
  QApprovalStatus,
  QRunId,
  QSubjectRef,
  UtcTimestamp,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { OrganisationId, TenantId, UserId } from "@capital-q/security";

/**
 * Persistence ports of the Approval Engine (doc 13 §48). Named operations
 * with their own predicates: every read carries the tenant, every
 * lifecycle move carries the expected version, and there is no
 * `update(id, patch)` — a status moves only through `transition` and
 * `decide`, which apply one lifecycle move each.
 */

export type QActionRecord = {
  readonly id: QActionProposalId;
  readonly tenantId: TenantId;
  readonly runId: QRunId;
  readonly organisationId: OrganisationId | null;
  readonly proposedByUserId: UserId;
  readonly actionType: QActionType;
  readonly actionVersion: number;
  readonly riskClass: QActionClass;
  readonly targets: readonly QSubjectRef[];
  /** The exact material payload. Sensitive; never logged. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadHash: QActionPayloadHash;
  readonly summary: string;
  readonly preview: string | null;
  readonly status: QActionStatus;
  readonly idempotencyKey: string;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
  readonly executedAt: UtcTimestamp | null;
  readonly executionResult: Readonly<Record<string, unknown>> | null;
  readonly failureCode: string | null;
  readonly retryPermitted: boolean;
  readonly executionAttempts: number;
  readonly version: number;
};

export type NewQAction = {
  readonly id: QActionProposalId;
  readonly tenantId: TenantId;
  readonly runId: QRunId;
  readonly organisationId: OrganisationId | null;
  readonly proposedByUserId: UserId;
  readonly actionType: QActionType;
  readonly actionVersion: number;
  readonly riskClass: QActionClass;
  readonly targets: readonly QSubjectRef[];
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadHash: QActionPayloadHash;
  readonly summary: string;
  readonly preview: string | null;
  readonly idempotencyKey: string;
};

export type QActionTransition = {
  readonly tenantId: TenantId;
  readonly actionId: QActionProposalId;
  readonly expectedVersion: number;
  readonly status: QActionStatus;
  readonly executedAt?: UtcTimestamp | undefined;
  readonly executionResult?: Readonly<Record<string, unknown>> | undefined;
  readonly failureCode?: string | null | undefined;
  readonly retryPermitted?: boolean | undefined;
  /** Claiming an execution counts an attempt under the same row lock. */
  readonly incrementAttempts?: boolean | undefined;
};

export type QActionRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewQAction,
  ) => Promise<QActionRecord>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    actionId: QActionProposalId,
  ) => Promise<QActionRecord | null>;
  /** Row lock for a lifecycle decision made from the current state. */
  readonly lockById: (
    tx: TransactionContext,
    tenantId: TenantId,
    actionId: QActionProposalId,
  ) => Promise<QActionRecord | null>;
  /** Newest first, bounded. */
  readonly listForRun: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    runId: QRunId,
  ) => Promise<readonly QActionRecord[]>;
  /** One lifecycle move under the expected version; null when a stale writer. */
  readonly transition: (
    tx: TransactionContext,
    input: QActionTransition,
  ) => Promise<QActionRecord | null>;
};

export type QApprovalRecord = {
  readonly id: QApprovalId;
  readonly tenantId: TenantId;
  readonly actionId: QActionProposalId;
  readonly requestedFromUserId: UserId;
  readonly status: QApprovalStatus;
  readonly requestedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
  readonly approvedAt: UtcTimestamp | null;
  readonly approvedByUserId: UserId | null;
  readonly rejectedAt: UtcTimestamp | null;
  readonly rejectedByUserId: UserId | null;
  readonly rejectionReason: string | null;
  readonly revokedAt: UtcTimestamp | null;
  readonly revokedByUserId: UserId | null;
  readonly approvalPayloadHash: QActionPayloadHash | null;
  readonly version: number;
};

export type NewQApproval = {
  readonly id: QApprovalId;
  readonly tenantId: TenantId;
  readonly actionId: QActionProposalId;
  readonly requestedFromUserId: UserId;
  readonly requestedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
};

export type QApprovalDecision = {
  readonly tenantId: TenantId;
  readonly approvalId: QApprovalId;
  readonly expectedVersion: number;
} & (
  | {
      readonly status: "APPROVED";
      readonly approvedAt: UtcTimestamp;
      readonly approvedByUserId: UserId;
      readonly approvalPayloadHash: QActionPayloadHash;
    }
  | {
      readonly status: "REJECTED";
      readonly rejectedAt: UtcTimestamp;
      readonly rejectedByUserId: UserId;
      readonly rejectionReason: string | null;
    }
  | { readonly status: "EXPIRED" }
  | {
      readonly status: "REVOKED";
      readonly revokedAt: UtcTimestamp;
      readonly revokedByUserId: UserId | null;
    }
);

export type QApprovalRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewQApproval,
  ) => Promise<QApprovalRecord>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    approvalId: QApprovalId,
  ) => Promise<QApprovalRecord | null>;
  readonly lockById: (
    tx: TransactionContext,
    tenantId: TenantId,
    approvalId: QApprovalId,
  ) => Promise<QApprovalRecord | null>;
  /** Identifiers only, for recording a refused access. Never content. */
  readonly findOwnership: (
    executor: DatabaseExecutor,
    approvalId: QApprovalId,
  ) => Promise<{
    readonly tenantId: TenantId;
    readonly requestedFromUserId: UserId;
  } | null>;
  /** Newest first. */
  readonly listForAction: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    actionId: QActionProposalId,
  ) => Promise<readonly QApprovalRecord[]>;
  readonly decide: (
    tx: TransactionContext,
    input: QApprovalDecision,
  ) => Promise<QApprovalRecord | null>;
};

export type QActionRepositories = {
  readonly actions: QActionRepository;
  readonly approvals: QApprovalRepository;
};

/** Injectable time, so expiry is tested without sleeping (CQ-Q-008 §38). */
export type QActionClock = { readonly now: () => Date };
export const systemQActionClock: QActionClock = { now: () => new Date() };

/**
 * Configured approval policy (CQ-Q-008 §37). No source names a V1 TTL, so
 * the default is conservative and explicit; a composition may narrow it.
 */
export type QApprovalPolicy = {
  /** How long a requested approval stays open, and how long an APPROVED decision stays usable. */
  readonly approvalTtlMs: number;
  /** Execution claims permitted per action, counting retries of retryable failures. */
  readonly maxExecutionAttempts: number;
};

export const DEFAULT_Q_APPROVAL_POLICY: QApprovalPolicy = Object.freeze({
  approvalTtlMs: 24 * 60 * 60 * 1000,
  maxExecutionAttempts: 3,
});
