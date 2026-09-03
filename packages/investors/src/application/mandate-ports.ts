import type {
  DiscoveryMode,
  InvestorMandateStatus,
  MandateConstraintDimension,
  MandateConstraintOperator,
  MandateConstraintValue,
  MandatePreferenceClass,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { TenantId, UserId } from "@capital-q/security";

import type { InvestorOrganisationId } from "../contracts/index.js";
import type {
  InvestorMandate,
  InvestorMandateConstraintId,
  InvestorMandateId,
  InvestorMandateSnapshot,
  InvestorMandateSummary,
} from "../contracts/mandate.js";

/**
 * Persistence ports for declared mandates. Specific to the use cases; no
 * generic repository and no constraint-to-SQL compiler. Constraint values
 * are stored and returned as typed data. Every statement names the tenant
 * and the investor organisation.
 */

export type NewMandateConstraint = {
  readonly dimension: MandateConstraintDimension;
  readonly operator: MandateConstraintOperator;
  readonly value: MandateConstraintValue;
  readonly importance: MandatePreferenceClass;
  readonly isHardExclusion: boolean;
};

export type NewInvestorMandate = {
  readonly tenantId: TenantId;
  readonly investorOrganisationId: InvestorOrganisationId;
  readonly name: string;
  readonly discoveryMode: DiscoveryMode | null;
  readonly minCheque: string | null;
  readonly maxCheque: string | null;
  readonly currencyCode: string | null;
  readonly minStageCode: string | null;
  readonly maxStageCode: string | null;
  readonly rawMandateText: string | null;
  readonly createdByUserId: UserId;
  readonly constraints: readonly NewMandateConstraint[];
};

export type InvestorMandateScalarChanges = {
  readonly name?: string | undefined;
  readonly discoveryMode?: DiscoveryMode | null | undefined;
  readonly minCheque?: string | null | undefined;
  readonly maxCheque?: string | null | undefined;
  readonly currencyCode?: string | null | undefined;
  readonly minStageCode?: string | null | undefined;
  readonly maxStageCode?: string | null | undefined;
  readonly rawMandateText?: string | null | undefined;
};

export type MandateListPage = {
  readonly status?: InvestorMandateStatus | undefined;
  readonly after?:
    { readonly createdAt: string; readonly id: string } | undefined;
  readonly limit: number;
};

export type InvestorMandateRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewInvestorMandate,
  ) => Promise<InvestorMandate>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    investorOrganisationId: InvestorOrganisationId,
    mandateId: InvestorMandateId,
  ) => Promise<InvestorMandate | null>;
  /** Locks the mandate row for the rest of the transaction. */
  readonly lockById: (
    tx: TransactionContext,
    tenantId: TenantId,
    investorOrganisationId: InvestorOrganisationId,
    mandateId: InvestorMandateId,
  ) => Promise<InvestorMandate | null>;
  readonly list: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    investorOrganisationId: InvestorOrganisationId,
    page: MandateListPage,
  ) => Promise<readonly InvestorMandateSummary[]>;
  /**
   * Applies scalar changes (possibly none) only when the stored version
   * equals `expectedVersion`, always incrementing it. Returns false when no
   * row matched.
   */
  readonly updateScalars: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly investorOrganisationId: InvestorOrganisationId;
      readonly mandateId: InvestorMandateId;
      readonly expectedVersion: number;
      readonly changes: InvestorMandateScalarChanges;
    },
  ) => Promise<boolean>;
  /** Removes and adds constraints of one mandate inside the caller's transaction. */
  readonly replaceConstraints: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly mandateId: InvestorMandateId;
      readonly removeIds: readonly InvestorMandateConstraintId[];
      readonly add: readonly NewMandateConstraint[];
    },
  ) => Promise<void>;
  /**
   * Lifecycle transition with server time. Returns the effective timestamp
   * written, or null when no row matched the expected version.
   */
  readonly transition: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly investorOrganisationId: InvestorOrganisationId;
      readonly mandateId: InvestorMandateId;
      readonly expectedVersion: number;
      readonly to: "ACTIVE" | "CLOSED";
    },
  ) => Promise<string | null>;
};

export type InvestorMandateCreationRecord = {
  readonly requestHash: string;
  readonly mandateId: InvestorMandateId;
  readonly tenantId: TenantId;
};

export type InvestorMandateCreationRequestStore = {
  readonly lock: (
    tx: TransactionContext,
    userId: UserId,
    investorOrganisationId: InvestorOrganisationId,
    idempotencyKeyHash: string,
  ) => Promise<void>;
  readonly find: (
    tx: TransactionContext,
    userId: UserId,
    investorOrganisationId: InvestorOrganisationId,
    idempotencyKeyHash: string,
  ) => Promise<InvestorMandateCreationRecord | null>;
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly userId: UserId;
      readonly investorOrganisationId: InvestorOrganisationId;
      readonly idempotencyKeyHash: string;
      readonly requestHash: string;
      readonly mandateId: InvestorMandateId;
      readonly tenantId: TenantId;
    },
  ) => Promise<void>;
};

/**
 * The read port future recommendation, onboarding and Q consumers depend
 * on. Permission-neutral (callers authorize first); returns typed policy
 * without the raw narrative; deterministic for (mandateId, version).
 */
export type InvestorMandateQueryPort = {
  readonly getMandate: (
    tenantId: TenantId,
    investorOrganisationId: InvestorOrganisationId,
    mandateId: InvestorMandateId,
  ) => Promise<InvestorMandateSnapshot | null>;
  readonly listActiveMandates: (
    tenantId: TenantId,
    investorOrganisationId: InvestorOrganisationId,
  ) => Promise<readonly InvestorMandateSummary[]>;
};
