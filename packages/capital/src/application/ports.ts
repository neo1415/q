import type { CompanyId } from "@capital-q/companies";
import type {
  CapitalObjectiveClosureReason,
  CapitalObjectiveStatus,
  CapitalObjectiveType,
  CapitalTarget,
  LocalDate,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { TenantId, UserId } from "@capital-q/security";

import type {
  CapitalObjective,
  CapitalObjectiveId,
  CapitalObjectiveSnapshot,
} from "../contracts/index.js";
import type {
  CapitalHistoryEventType,
  CapitalHistoryPayload,
} from "../domain/history.js";

/**
 * Application-owned persistence ports. Specific to the use cases; no
 * generic repository. Writes take the caller's transaction so the objective,
 * its history row, its audit record and its event commit together. Money is
 * carried as exact strings end to end.
 */

export type NewCapitalObjective = {
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly objectiveType: CapitalObjectiveType;
  readonly target: CapitalTarget;
  readonly targetStage: string | null;
  readonly instrumentCode: string | null;
  readonly targetCloseDate: LocalDate | null;
  readonly useOfFundsSummary: string | null;
  readonly createdByUserId: UserId;
};

export type CapitalObjectiveChanges = {
  readonly target?: CapitalTarget | undefined;
  readonly targetStage?: string | null | undefined;
  readonly instrumentCode?: string | null | undefined;
  readonly targetCloseDate?: LocalDate | null | undefined;
  readonly useOfFundsSummary?: string | null | undefined;
};

export type CapitalObjectiveRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewCapitalObjective,
  ) => Promise<CapitalObjective>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    companyId: CompanyId,
    capitalObjectiveId: CapitalObjectiveId,
  ) => Promise<CapitalObjective | null>;
  readonly findActive: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    companyId: CompanyId,
  ) => Promise<CapitalObjective | null>;
  /** Locks the row for the rest of the transaction. */
  readonly lockById: (
    tx: TransactionContext,
    tenantId: TenantId,
    companyId: CompanyId,
    capitalObjectiveId: CapitalObjectiveId,
  ) => Promise<CapitalObjective | null>;
  /** Serialises objective creation for one company until commit. */
  readonly lockCompany: (
    tx: TransactionContext,
    companyId: CompanyId,
  ) => Promise<void>;
  readonly list: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    companyId: CompanyId,
    page: {
      readonly after?:
        { readonly createdAt: string; readonly id: string } | undefined;
      readonly limit: number;
    },
  ) => Promise<readonly CapitalObjective[]>;
  /**
   * Recalibration: applies `changes` only when the row is ACTIVE and its
   * version equals `expectedVersion`, incrementing it. Null when no row
   * matched.
   */
  readonly recalibrate: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly companyId: CompanyId;
      readonly capitalObjectiveId: CapitalObjectiveId;
      readonly expectedVersion: number;
      readonly changes: CapitalObjectiveChanges;
    },
  ) => Promise<CapitalObjective | null>;
  /** ACTIVE -> terminal status with server-time closed_at. Null when no row matched. */
  readonly close: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly companyId: CompanyId;
      readonly capitalObjectiveId: CapitalObjectiveId;
      readonly expectedVersion: number;
      readonly status: CapitalObjectiveClosureReason | "REPLACED";
    },
  ) => Promise<CapitalObjective | null>;
};

export type CapitalObjectiveHistoryWriter = {
  readonly append: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly capitalObjectiveId: CapitalObjectiveId;
      readonly eventType: CapitalHistoryEventType;
      readonly actorType: string;
      readonly actorId: UserId;
      readonly payload: CapitalHistoryPayload;
    },
  ) => Promise<void>;
};

export type CapitalObjectiveCreationRecord = {
  readonly requestHash: string;
  readonly capitalObjectiveId: CapitalObjectiveId;
  readonly tenantId: TenantId;
};

export type CapitalObjectiveCreationRequestStore = {
  readonly lock: (
    tx: TransactionContext,
    userId: UserId,
    companyId: CompanyId,
    idempotencyKeyHash: string,
  ) => Promise<void>;
  readonly find: (
    tx: TransactionContext,
    userId: UserId,
    companyId: CompanyId,
    idempotencyKeyHash: string,
  ) => Promise<CapitalObjectiveCreationRecord | null>;
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly userId: UserId;
      readonly companyId: CompanyId;
      readonly idempotencyKeyHash: string;
      readonly requestHash: string;
      readonly capitalObjectiveId: CapitalObjectiveId;
      readonly tenantId: TenantId;
    },
  ) => Promise<void>;
};

/**
 * The read port future Q tools, InvestIQ, Blueprint, onboarding and
 * recommendation consumers depend on. Structured-first: "how much are we
 * raising" resolves here before any document retrieval. Permission-neutral;
 * callers authorize first.
 */
/** Trusted ownership facts of a capital objective for disclosure resolution. No amounts. */
export type CapitalObjectiveOwnershipFacts = {
  readonly id: CapitalObjectiveId;
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly status: CapitalObjectiveStatus;
};

export type CapitalObjectiveQueryPort = {
  /**
   * Tenant-agnostic ownership lookup for the Permissions bounded context
   * (CQ-PERM-001): identifiers and status only, never the target or the
   * use-of-funds narrative. Permission-neutral.
   */
  readonly findCanonicalCapitalObjective: (
    capitalObjectiveId: CapitalObjectiveId,
  ) => Promise<CapitalObjectiveOwnershipFacts | null>;
  readonly getCurrentForCompany: (
    tenantId: TenantId,
    companyId: CompanyId,
  ) => Promise<CapitalObjectiveSnapshot | null>;
  readonly getById: (
    tenantId: TenantId,
    companyId: CompanyId,
    capitalObjectiveId: CapitalObjectiveId,
  ) => Promise<CapitalObjectiveSnapshot | null>;
};
