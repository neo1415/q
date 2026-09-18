import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { OrganisationId, TenantId, UserId } from "@capital-q/security";

import type {
  CompanyStatus,
  MarketplaceReadinessState,
  MarketplaceVisibility,
} from "@capital-q/contracts";

import type { MarketplaceVerificationFacts } from "../domain/marketplace-readiness.js";

import type {
  Company,
  CompanyId,
  CompanyIdentity,
  FounderProfileId,
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
  /**
   * Sets who may see the declared profile, only when the stored version
   * equals `expectedVersion`, incrementing it. Returns null when no row
   * matched. The only column this touches is marketplace_visibility.
   */
  readonly updateVisibility: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly organisationId: OrganisationId;
      readonly companyId: CompanyId;
      readonly expectedVersion: number;
      readonly visibility: MarketplaceVisibility;
    },
  ) => Promise<Company | null>;
  /**
   * Written only by the marketplace-readiness reconciliation, under the
   * row lock, with the state the policy decided. No profile PATCH, no
   * visibility change and no client field reaches this method.
   */
  readonly updateReadiness: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly organisationId: OrganisationId;
      readonly companyId: CompanyId;
      readonly expectedVersion: number;
      readonly readinessState: MarketplaceReadinessState;
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
  /**
   * Tenant-agnostic canonical lookup for cross-organisation domains (the
   * relationship graph): returns the company's trusted ownership metadata,
   * including its tenant. Permission-neutral; callers authorise separately.
   */
  readonly findCanonicalCompany: (
    companyId: CompanyId,
  ) => Promise<CompanyIdentity | null>;
  /**
   * The company's ownership and intrinsic disclosure classification for the
   * Permissions bounded context (CQ-PERM-001). marketplace_visibility stays
   * owned here; disclosure reads it through this port and never copies it.
   */
  readonly findCanonicalCompanyVisibility: (
    companyId: CompanyId,
  ) => Promise<CompanyVisibilityFacts | null>;
  /**
   * A founder profile's ownership (the Person) and its intrinsic
   * visibility_scope, tenant-agnostic, for disclosure resolution. No
   * summaries or narrative are returned through this port.
   */
  readonly findCanonicalFounderProfile: (
    founderProfileId: FounderProfileId,
  ) => Promise<FounderProfileOwnershipFacts | null>;
  /**
   * The profile core of one company with its trusted ownership and
   * classification, tenant-agnostic, for consumers that authorise the read
   * themselves first (the Q Tool Registry, CQ-Q-007). Permission-neutral:
   * returning a row is not permission to show it. No founder, financial,
   * evidence or score content lives here.
   */
  readonly findCanonicalCompanyProfile: (
    companyId: CompanyId,
  ) => Promise<CompanyProfileFacts | null>;
  /**
   * Bounded discovery over companies a viewer could be allowed to see: the
   * viewer's own organisation's companies plus companies classified
   * network_visible or public_external. Classification is a candidate
   * filter, not the disclosure decision — callers re-check each candidate
   * through the Permissions bounded context before showing it. Keyset
   * pagination on (canonical_name, id); never offset.
   */
  readonly searchCompanies: (
    query: CompanySearchQuery,
  ) => Promise<CompanySearchPage>;
};

/** Profile core + trusted ownership/classification. Permission-neutral. */
export type CompanyProfileFacts = {
  readonly id: CompanyId;
  readonly tenantId: TenantId;
  readonly organisationId: OrganisationId;
  readonly canonicalName: string;
  readonly legalName: string | null;
  readonly websiteUrl: string | null;
  readonly foundedDate: string | null;
  readonly headquartersCountry: string | null;
  readonly headquartersCity: string | null;
  readonly currentStageCode: string | null;
  readonly primaryDescription: string | null;
  readonly shortDescription: string | null;
  readonly companyStatus: CompanyStatus;
  readonly marketplaceVisibility: MarketplaceVisibility;
};

export const COMPANY_SEARCH_LIMIT_MAX = 50;
export const COMPANY_SEARCH_TEXT_MAX_LENGTH = 120;

export type CompanySearchQuery = {
  /** Whose own-organisation companies are candidates. Server-resolved. */
  readonly viewer: {
    readonly tenantId: TenantId;
    readonly organisationId: OrganisationId | undefined;
  };
  /** Case-insensitive substring of the canonical name. */
  readonly text?: string | undefined;
  readonly stageCode?: string | undefined;
  readonly headquartersCountry?: string | undefined;
  readonly limit: number;
  /** Opaque cursor from a previous page. */
  readonly cursor?: string | undefined;
};

export type CompanySearchCandidate = {
  readonly id: CompanyId;
  readonly tenantId: TenantId;
  readonly organisationId: OrganisationId;
  readonly canonicalName: string;
  readonly currentStageCode: string | null;
  readonly headquartersCountry: string | null;
  readonly shortDescription: string | null;
  readonly marketplaceVisibility: MarketplaceVisibility;
  /** True when the viewer's own organisation owns the company. */
  readonly ownedByViewer: boolean;
};

export type CompanySearchPage = {
  readonly items: readonly CompanySearchCandidate[];
  readonly nextCursor: string | null;
};

/** Thrown for a cursor that is not one this port issued. */
export class CompanySearchCursorError extends Error {
  constructor() {
    super("company search cursor is invalid");
    this.name = "CompanySearchCursorError";
  }
}

/** Trusted ownership + classification of a company. Permission-neutral. */
export type CompanyVisibilityFacts = {
  readonly id: CompanyId;
  readonly tenantId: TenantId;
  readonly organisationId: OrganisationId;
  readonly marketplaceVisibility: MarketplaceVisibility;
};

/**
 * What investor discovery is allowed to know about a company before any
 * comparison happens: ownership, lifecycle, the two marketplace switches and
 * the two canonical hard-criterion fields (stage, headquarters country).
 * Permission-neutral and tenant-agnostic by design — a discovery candidate
 * lives in another tenant — so the caller must still put every id through
 * disclosure. No name, description, founder, financial, evidence, score, Q
 * or memory content: a port that cannot express it cannot leak it.
 */
export type CompanyMarketplaceFacts = {
  readonly id: CompanyId;
  readonly tenantId: TenantId;
  readonly organisationId: OrganisationId;
  readonly companyStatus: CompanyStatus;
  readonly marketplaceVisibility: MarketplaceVisibility;
  /** Raw readiness state; read it through `marketplaceParticipationOf`. */
  readonly marketplaceReadinessState: string;
  readonly currentStageCode: string | null;
  readonly headquartersCountry: string | null;
};

/**
 * The read port the Recommendation context consumes for hard eligibility
 * (CQ-REC-001). Batch by construction so a candidate set is one query, not
 * one per company; unknown ids are simply absent.
 */
export type CompanyMarketplaceQueryPort = {
  readonly findCanonicalMarketplaceFacts: (
    companyIds: readonly CompanyId[],
  ) => Promise<readonly CompanyMarketplaceFacts[]>;
  /**
   * Structured candidate retrieval (CQ-REC-002): active companies whose
   * declared classification is network_visible or public_external and
   * whose canonical stage or headquarters country is one of the codes.
   * Either filter may be null (not applied); both null is refused, so no
   * caller can list the platform. Bounded, ordered by id, cross-tenant by
   * design: classification chooses candidates, disclosure and readiness
   * decide each one downstream.
   */
  readonly listDiscoverableCompanies: (input: {
    readonly stageCodes: readonly string[] | null;
    readonly headquartersCountries: readonly string[] | null;
    readonly limit: number;
  }) => Promise<readonly CompanyMarketplaceFacts[]>;
};

/**
 * The Verification seam readiness reads (doc 13 §24; PADL #147). Claims
 * are specific — a founder's identity, the organisation's identity — and
 * are answered by the Verification context's own query port when it
 * exists. Until then the production adapter says "unavailable" and the
 * only other implementation is a synthetic fixture that refuses to run
 * anywhere but a local database. Nothing in this port can be satisfied by
 * a document, a public page, Q, or the person themselves.
 */
export type VerificationClaimsPort = {
  /** Recorded on every audited readiness transition so a synthetic answer can never pass as a real one. */
  readonly sourceLabel:
    | "VERIFICATION_UNAVAILABLE"
    | "SYNTHETIC_LOCAL_FIXTURE"
    | `VERIFICATION_${string}`;
  readonly currentStandings: (subject: {
    readonly tenantId: TenantId;
    readonly organisationId: OrganisationId;
    readonly companyId: CompanyId;
  }) => Promise<MarketplaceVerificationFacts>;
};

/** Trusted ownership + classification of a founder profile. No content. */
export type FounderProfileOwnershipFacts = {
  readonly id: FounderProfileId;
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly primaryCompanyId: CompanyId | null;
  readonly visibilityScope: MarketplaceVisibility;
};
