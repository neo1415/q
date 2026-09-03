import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { OrganisationId, TenantId, UserId } from "@capital-q/security";

import type {
  DisclosureAccessLevel,
  DisclosurePolicy,
  DisclosurePolicyId,
  DisclosureRecipient,
  DisclosureResourceDescriptor,
  DisclosureResourceRef,
  DisclosureResourceType,
  DisclosureScope,
  RelationshipParties,
  UtcTimestamp,
} from "../contracts/index.js";

/**
 * Application-owned ports of the Permissions bounded context. Specific to
 * disclosure; no generic repository, no `updatePolicy`. Writes take the
 * caller's transaction so the policy row, its audit record and its domain
 * event commit together.
 */

/** The injected clock. Tests pin it; production uses the server's UTC time. */
export type DisclosureClock = {
  readonly now: () => UtcTimestamp;
};

/**
 * Resolves one resource kind to trusted disclosure metadata through the
 * owning domain's public query port. There is exactly one resolver per
 * kind and no fallback: an unregistered kind cannot be resolved, so no
 * caller can turn an arbitrary table into a disclosure question.
 */
export type DisclosureResourceResolver = {
  readonly resourceType: DisclosureResourceType;
  readonly resolve: (
    resourceId: string,
  ) => Promise<DisclosureResourceDescriptor | null>;
};

export type DisclosureResourceResolverRegistry = {
  readonly resolve: (
    resource: DisclosureResourceRef,
  ) => Promise<DisclosureResourceDescriptor | null>;
  readonly has: (resourceType: string) => boolean;
  readonly types: () => readonly DisclosureResourceType[];
};

/**
 * The exact canonical parties of a relationship, through Network's public
 * query port and the Company/Investor query ports. Never Network's tables.
 */
export type RelationshipPartyResolver = {
  readonly resolve: (
    relationshipId: string,
  ) => Promise<RelationshipParties | null>;
};

export type NewDisclosurePolicy = {
  readonly id: DisclosurePolicyId;
  readonly tenantId: TenantId;
  readonly ownerUserId: UserId | null;
  readonly ownerOrganisationId: OrganisationId | null;
  readonly resource: DisclosureResourceRef;
  readonly scopeType: DisclosureScope;
  readonly recipient: DisclosureRecipient | null;
  readonly accessLevel: DisclosureAccessLevel;
  readonly expiresAt: UtcTimestamp | null;
  readonly createdByUserId: UserId;
};

/**
 * Production operations only: insert, revoke, read. Scope, recipient,
 * access level and expiry are never edited in place; a change is a
 * revocation plus a new policy, so historical disclosure state survives.
 */
export type DisclosurePolicyRepository = {
  readonly insert: (
    tx: TransactionContext,
    policy: NewDisclosurePolicy,
  ) => Promise<DisclosurePolicy>;
  readonly findById: (
    executor: DatabaseExecutor,
    disclosurePolicyId: DisclosurePolicyId,
  ) => Promise<DisclosurePolicy | null>;
  /** Locks the row for the rest of the transaction. */
  readonly lockById: (
    tx: TransactionContext,
    disclosurePolicyId: DisclosurePolicyId,
  ) => Promise<DisclosurePolicy | null>;
  /** Serialises grants for one resource until commit. */
  readonly lockResource: (
    tx: TransactionContext,
    resource: DisclosureResourceRef,
  ) => Promise<void>;
  /**
   * Unrevoked policies of one resource. Expiry is decided by the evaluator's
   * clock, not here, so a pinned test clock and the database agree.
   */
  readonly findUnrevokedForResource: (
    executor: DatabaseExecutor,
    resource: DisclosureResourceRef,
  ) => Promise<readonly DisclosurePolicy[]>;
  /** Bounded batch form of the above for retrieval/feed filters. */
  readonly findUnrevokedForResources: (
    executor: DatabaseExecutor,
    resources: readonly DisclosureResourceRef[],
  ) => Promise<readonly DisclosurePolicy[]>;
  /** Every policy of one resource, including revoked history, for inspection. */
  readonly findAllForResource: (
    executor: DatabaseExecutor,
    resource: DisclosureResourceRef,
  ) => Promise<readonly DisclosurePolicy[]>;
  /**
   * Sets revoked_at on an unrevoked row. Returns the revoked policy, or null
   * when the row was already revoked or does not exist.
   */
  readonly revoke: (
    tx: TransactionContext,
    disclosurePolicyId: DisclosurePolicyId,
    revokedAt: UtcTimestamp,
  ) => Promise<DisclosurePolicy | null>;
};
