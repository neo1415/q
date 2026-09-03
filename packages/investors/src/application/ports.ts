import type {
  InvestorDeploymentState,
  InvestorType,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type {
  MembershipId,
  OrganisationId,
  TenantId,
  UserId,
} from "@capital-q/security";

import type {
  InvestorOrganisation,
  InvestorOrganisationId,
  InvestorOrganisationIdentity,
  InvestorRepresentative,
  InvestorRepresentativeId,
} from "../contracts/index.js";

/**
 * Application-owned persistence ports. Specific to the use cases; no
 * generic Repository<T>. Writes take the caller's transaction so the row,
 * its audit record and its event commit together; reads take an executor.
 * Every statement carries the trusted TenantId and, for organisation-owned
 * lookups, the OrganisationId from the actor context.
 */

export type NewInvestorOrganisation = {
  readonly tenantId: TenantId;
  readonly organisationId: OrganisationId;
  readonly investorType: InvestorType;
  readonly displayName: string;
  readonly websiteUrl: string | null;
  readonly hqCountry: string | null;
  readonly publicDescription: string | null;
  readonly deploymentState: InvestorDeploymentState | null;
};

export type InvestorProfileChanges = {
  readonly investorType?: InvestorType | undefined;
  readonly displayName?: string | undefined;
  readonly websiteUrl?: string | null | undefined;
  readonly hqCountry?: string | null | undefined;
  readonly publicDescription?: string | null | undefined;
  readonly deploymentState?: InvestorDeploymentState | null | undefined;
};

export type InvestorOrganisationRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewInvestorOrganisation,
  ) => Promise<InvestorOrganisation>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    organisationId: OrganisationId,
    investorOrganisationId: InvestorOrganisationId,
  ) => Promise<InvestorOrganisation | null>;
  /** The canonical investor organisation of one organisation, if established. */
  readonly findByOrganisation: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    organisationId: OrganisationId,
  ) => Promise<InvestorOrganisation | null>;
  /** Locks the row for the rest of the transaction. */
  readonly lockById: (
    tx: TransactionContext,
    tenantId: TenantId,
    organisationId: OrganisationId,
    investorOrganisationId: InvestorOrganisationId,
  ) => Promise<InvestorOrganisation | null>;
  /** Serialises investor establishment for one organisation until commit. */
  readonly lockOrganisation: (
    tx: TransactionContext,
    organisationId: OrganisationId,
  ) => Promise<void>;
  /**
   * Applies `changes` only when the stored version equals `expectedVersion`,
   * incrementing it. Returns null when no row matched.
   */
  readonly updateProfile: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly organisationId: OrganisationId;
      readonly investorOrganisationId: InvestorOrganisationId;
      readonly expectedVersion: number;
      readonly changes: InvestorProfileChanges;
    },
  ) => Promise<InvestorOrganisation | null>;
};

export type InvestorRepresentativeChanges = {
  readonly businessTitle?: string | null | undefined;
};

export type InvestorRepresentativeRepository = {
  readonly findCurrentForUser: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    investorOrganisationId: InvestorOrganisationId,
    userId: UserId,
  ) => Promise<InvestorRepresentative | null>;
  /** Locks the current row for the rest of the transaction. */
  readonly lockCurrentForUser: (
    tx: TransactionContext,
    tenantId: TenantId,
    investorOrganisationId: InvestorOrganisationId,
    userId: UserId,
  ) => Promise<InvestorRepresentative | null>;
  /**
   * A new current period. The membership must belong to the same person
   * and to the investor's organisation; the database refuses anything else.
   */
  readonly create: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly investorOrganisationId: InvestorOrganisationId;
      readonly organisationId: OrganisationId;
      readonly userId: UserId;
      readonly membershipId: MembershipId;
      readonly businessTitle: string | null;
    },
  ) => Promise<InvestorRepresentative>;
  readonly updateCurrent: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly investorRepresentativeId: InvestorRepresentativeId;
      readonly expectedVersion: number;
      readonly changes: InvestorRepresentativeChanges;
    },
  ) => Promise<InvestorRepresentative | null>;
};

export type InvestorCreationRecord = {
  readonly requestHash: string;
  readonly investorOrganisationId: InvestorOrganisationId;
  readonly tenantId: TenantId;
};

export type InvestorCreationRequestStore = {
  readonly lock: (
    tx: TransactionContext,
    userId: UserId,
    organisationId: OrganisationId,
    idempotencyKeyHash: string,
  ) => Promise<void>;
  readonly find: (
    tx: TransactionContext,
    userId: UserId,
    organisationId: OrganisationId,
    idempotencyKeyHash: string,
  ) => Promise<InvestorCreationRecord | null>;
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly userId: UserId;
      readonly organisationId: OrganisationId;
      readonly idempotencyKeyHash: string;
      readonly requestHash: string;
      readonly investorOrganisationId: InvestorOrganisationId;
      readonly tenantId: TenantId;
    },
  ) => Promise<void>;
};

/**
 * The read port later domains depend on. Mandate, discovery,
 * relationships and Q tools anchor to an investor organisation through
 * this, never through the repositories above. Permission-neutral: callers
 * authorize before they ask.
 */
export type InvestorOrganisationQueryPort = {
  readonly getCanonicalInvestorOrganisation: (
    tenantId: TenantId,
    investorOrganisationId: InvestorOrganisationId,
  ) => Promise<InvestorOrganisationIdentity | null>;
};
