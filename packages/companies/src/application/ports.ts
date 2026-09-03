import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { OrganisationId, TenantId, UserId } from "@capital-q/security";

import type {
  Company,
  CompanyId,
  CompanyIdentity,
} from "../contracts/index.js";

/**
 * Application-owned persistence ports. Specific to the use cases; no
 * generic Repository<T>. Writes take the caller's transaction so the
 * company row, its audit record and its event commit together; reads take
 * an executor. Every statement carries the trusted TenantId and, for
 * organisation-owned lookups, the OrganisationId.
 */

export type NewCompany = {
  readonly tenantId: TenantId;
  readonly organisationId: OrganisationId;
  readonly canonicalName: string;
  readonly slug: string;
  readonly legalName: string | null;
  readonly websiteUrl: string | null;
  readonly foundedDate: string | null;
  readonly headquartersCountry: string | null;
  readonly headquartersCity: string | null;
  readonly currentStageCode: string | null;
  readonly primaryDescription: string | null;
  readonly shortDescription: string | null;
};

export type CompanyProfileChanges = {
  readonly canonicalName?: string | undefined;
  readonly legalName?: string | null | undefined;
  readonly websiteUrl?: string | null | undefined;
  readonly foundedDate?: string | null | undefined;
  readonly headquartersCountry?: string | null | undefined;
  readonly headquartersCity?: string | null | undefined;
  readonly currentStageCode?: string | null | undefined;
  readonly primaryDescription?: string | null | undefined;
  readonly shortDescription?: string | null | undefined;
};

export type CompanyRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewCompany,
  ) => Promise<Company>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    organisationId: OrganisationId,
    companyId: CompanyId,
  ) => Promise<Company | null>;
  /** Locks the row for the rest of the transaction. */
  readonly lockById: (
    tx: TransactionContext,
    tenantId: TenantId,
    organisationId: OrganisationId,
    companyId: CompanyId,
  ) => Promise<Company | null>;
  /**
   * Applies `changes` only when the stored version equals `expectedVersion`,
   * incrementing it. Returns null when no row matched.
   */
  readonly updateProfile: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly organisationId: OrganisationId;
      readonly companyId: CompanyId;
      readonly expectedVersion: number;
      readonly changes: CompanyProfileChanges;
    },
  ) => Promise<Company | null>;
  /** Serialises slug allocation for one (tenant, base slug) until commit. */
  readonly lockSlug: (
    tx: TransactionContext,
    tenantId: TenantId,
    baseSlug: string,
  ) => Promise<void>;
  /** Which of `candidates` are already taken within the tenant. */
  readonly takenSlugs: (
    tx: TransactionContext,
    tenantId: TenantId,
    candidates: readonly string[],
  ) => Promise<ReadonlySet<string>>;
};

export type CompanyCreationRecord = {
  readonly requestHash: string;
  readonly companyId: CompanyId;
  readonly tenantId: TenantId;
};

export type CompanyCreationRequestStore = {
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
  ) => Promise<CompanyCreationRecord | null>;
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly userId: UserId;
      readonly organisationId: OrganisationId;
      readonly idempotencyKeyHash: string;
      readonly requestHash: string;
      readonly companyId: CompanyId;
      readonly tenantId: TenantId;
    },
  ) => Promise<void>;
};

/**
 * The read port later domains depend on. Capital objective, evidence and
 * founder/team anchor to a company through this, never through the
 * repository above.
 */
export type CompanyQueryPort = {
  readonly getCanonicalCompany: (
    tenantId: TenantId,
    companyId: CompanyId,
  ) => Promise<CompanyIdentity | null>;
};
