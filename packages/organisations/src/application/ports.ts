import type { OrganisationType } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type {
  MembershipId,
  OrganisationId,
  TenantId,
  UserId,
} from "@capital-q/security";

import type {
  Membership,
  MembershipView,
  Organisation,
  OrganisationIdentity,
} from "../domain/organisation.js";

/**
 * Application-owned persistence ports. Each is specific to what the use
 * cases need; there is no generic Repository<T>. Writes take the caller's
 * transaction so creation, audit and events commit together; reads take
 * an executor so they run inside or outside a transaction unchanged.
 *
 * Every tenant-owned mutation and lookup carries the trusted TenantId.
 */

export type NewOrganisation = {
  readonly tenantId: TenantId;
  readonly organisationType: OrganisationType;
  readonly displayName: string;
  readonly slug: string;
  readonly legalName: string | null;
  readonly websiteUrl: string | null;
  readonly countryCode: string | null;
  readonly jurisdictionCode: string | null;
};

export type OrganisationProfileChanges = {
  readonly displayName?: string | undefined;
  readonly legalName?: string | null | undefined;
  readonly websiteUrl?: string | null | undefined;
  readonly countryCode?: string | null | undefined;
  readonly jurisdictionCode?: string | null | undefined;
};

export type TenantRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: { readonly name: string },
  ) => Promise<TenantId>;
  readonly linkPrimaryOrganisation: (
    tx: TransactionContext,
    tenantId: TenantId,
    organisationId: OrganisationId,
  ) => Promise<void>;
};

export type OrganisationRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewOrganisation,
  ) => Promise<Organisation>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    organisationId: OrganisationId,
  ) => Promise<Organisation | null>;
  /** Locks the row for the rest of the transaction. */
  readonly lockById: (
    tx: TransactionContext,
    tenantId: TenantId,
    organisationId: OrganisationId,
  ) => Promise<Organisation | null>;
  /**
   * Applies `changes` only when the stored version equals `expectedVersion`,
   * incrementing it. Returns null when no row matched.
   */
  readonly updateProfile: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly organisationId: OrganisationId;
      readonly expectedVersion: number;
      readonly changes: OrganisationProfileChanges;
    },
  ) => Promise<Organisation | null>;
};

export type MembershipRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly organisationId: OrganisationId;
      readonly userId: UserId;
    },
  ) => Promise<Membership>;
  readonly assignRole: (
    tx: TransactionContext,
    membershipId: MembershipId,
    roleId: string,
  ) => Promise<void>;
  readonly setActiveContext: (
    tx: TransactionContext,
    userId: UserId,
    membershipId: MembershipId,
  ) => Promise<void>;
  readonly listActiveForUser: (
    executor: DatabaseExecutor,
    userId: UserId,
    page: {
      readonly after?:
        { readonly joinedAt: string; readonly id: string } | undefined;
      readonly limit: number;
    },
  ) => Promise<readonly MembershipView[]>;
  readonly findActiveForUser: (
    executor: DatabaseExecutor,
    userId: UserId,
    organisationId: OrganisationId,
  ) => Promise<MembershipView | null>;
};

export type RoleTemplateRepository = {
  readonly findActiveRoleIdByCode: (
    tx: TransactionContext,
    code: string,
  ) => Promise<string | null>;
};

export type CreationRequestRecord = {
  readonly requestHash: string;
  readonly organisationId: OrganisationId;
  readonly tenantId: TenantId;
};

export type OrganisationCreationRequestStore = {
  /** Serialises concurrent requests for the same (person, key) until commit. */
  readonly lock: (
    tx: TransactionContext,
    userId: UserId,
    idempotencyKeyHash: string,
  ) => Promise<void>;
  readonly find: (
    tx: TransactionContext,
    userId: UserId,
    idempotencyKeyHash: string,
  ) => Promise<CreationRequestRecord | null>;
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly userId: UserId;
      readonly idempotencyKeyHash: string;
      readonly requestHash: string;
      readonly organisationId: OrganisationId;
      readonly tenantId: TenantId;
    },
  ) => Promise<void>;
};

/**
 * The read port later canonical domains depend on. Company and Investor
 * Organisation anchor themselves to an organisation identity through this,
 * never through the repositories above.
 */
export type OrganisationQueryPort = {
  readonly getActiveOrganisationIdentity: (
    tenantId: TenantId,
    organisationId: OrganisationId,
  ) => Promise<OrganisationIdentity | null>;
};
