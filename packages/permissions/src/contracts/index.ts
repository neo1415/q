import { z } from "zod";

import {
  createUuidIdSchema,
  DisclosureScopeSchema,
  MARKETPLACE_VISIBILITIES,
  UtcTimestampSchema,
  UuidSchema,
  type DisclosureScope,
  type MessageSensitivity,
  type UtcTimestamp,
} from "@capital-q/contracts";
import {
  ActorContextSchema,
  type ActorContext,
  type OrganisationId,
  type TenantId,
  type UserId,
} from "@capital-q/security";

/**
 * @capital-q/permissions/contracts
 *
 * The safe public surface of the Permissions bounded context: the
 * disclosure vocabularies, the branded policy identifier, the resource
 * descriptor a resolver produces, the policy entity and the principal a
 * disclosure question is asked for. No persistence, no decisions.
 *
 *   Authentication ≠ Authorization ≠ Disclosure ≠ Sensitivity
 *   ≠ Verification ≠ Data-use policy
 *
 * DisclosureScope answers "who may see this"; MessageSensitivity answers
 * "how damaging is exposure". They are different types on purpose and one
 * is never inferred from the other.
 */

// ---------------------------------------------------------------------------
// Scopes (ADR-001). Reused from the shared contract; not redefined.
// ---------------------------------------------------------------------------

/** The eight canonical ADR-001 scopes. `public`, `owner_private`, `private`, `shared` do not exist. */
export const DISCLOSURE_SCOPES = MARKETPLACE_VISIBILITIES;
export { DisclosureScopeSchema, type DisclosureScope };

/** The sensitivity axis, kept as a distinct type. Not evaluated here (deferred). */
export type SensitivityClass = MessageSensitivity;

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** The disclosure policy identifier. Generated before the write; never sequential. */
export const DisclosurePolicyIdSchema =
  createUuidIdSchema("DisclosurePolicyId");
export type DisclosurePolicyId = z.infer<typeof DisclosurePolicyIdSchema>;

// ---------------------------------------------------------------------------
// Access levels
// ---------------------------------------------------------------------------

/**
 * V1 access levels. `edit`, `share`, `approve` and `admin` are
 * capabilities, never access levels. `view` means Capital Q may render the
 * resource through a controlled surface; it is a platform access policy,
 * not DRM, and never claims to prevent screenshots or transcription.
 */
export const DISCLOSURE_ACCESS_LEVELS = ["view", "view_download"] as const;
export const DisclosureAccessLevelSchema = z.enum(DISCLOSURE_ACCESS_LEVELS);
export type DisclosureAccessLevel = z.infer<typeof DisclosureAccessLevelSchema>;

/** Explicit ordering. Deliberately not a string comparison. */
const ACCESS_LEVEL_RANK: Readonly<Record<DisclosureAccessLevel, number>> = {
  view: 1,
  view_download: 2,
};

/** Does `granted` satisfy a request for `requested`? view_download ⊇ view; view ⊉ view_download. */
export function accessLevelSatisfies(
  granted: DisclosureAccessLevel,
  requested: DisclosureAccessLevel,
): boolean {
  return ACCESS_LEVEL_RANK[granted] >= ACCESS_LEVEL_RANK[requested];
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

/** Bounded V1 recipient identity. Never an email address, phone, name or free string. */
export const DISCLOSURE_RECIPIENT_TYPES = [
  "USER",
  "MEMBERSHIP",
  "ORGANISATION",
  "RELATIONSHIP",
] as const;
export const DisclosureRecipientTypeSchema = z.enum(DISCLOSURE_RECIPIENT_TYPES);
export type DisclosureRecipientType = z.infer<
  typeof DisclosureRecipientTypeSchema
>;

export const DisclosureRecipientSchema = z
  .object({
    type: DisclosureRecipientTypeSchema,
    id: UuidSchema,
  })
  .strict();
export type DisclosureRecipient = z.infer<typeof DisclosureRecipientSchema>;

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

/**
 * The resource kinds a legitimate resolver exists for. Closed on purpose:
 * an unknown kind is refused before any lookup, so no caller can turn a
 * table name into a disclosure question. Sub-resources (a single field)
 * arrive later as their own kinds with their own adapters, never as
 * "company123.amount" strings.
 */
export const DISCLOSURE_RESOURCE_TYPES = [
  "company",
  "founder_profile",
  "investor_organisation",
  "investor_mandate",
  "capital_objective",
  "relationship",
  "relationship_event",
] as const;
export const DisclosureResourceTypeSchema = z.enum(DISCLOSURE_RESOURCE_TYPES);
export type DisclosureResourceType = z.infer<
  typeof DisclosureResourceTypeSchema
>;

/** An opaque canonical reference. Holding it is never permission. */
export const DisclosureResourceRefSchema = z
  .object({
    type: DisclosureResourceTypeSchema,
    id: UuidSchema,
  })
  .strict();
export type DisclosureResourceRef = z.infer<typeof DisclosureResourceRefSchema>;

export function sameResource(
  a: DisclosureResourceRef,
  b: DisclosureResourceRef,
): boolean {
  return a.type === b.type && a.id === b.id;
}

/** One side of a canonical relationship, as an organisation in its own tenant. */
export type RelationshipParty = {
  readonly organisationId: OrganisationId;
  readonly tenantId: TenantId;
};

/**
 * The exact legitimate parties of one canonical relationship, resolved
 * through the Network, Company and Investor query ports. Nobody else is a
 * party, whatever other relationships they hold with the same company.
 */
export type RelationshipParties = {
  readonly relationshipId: string;
  readonly company: RelationshipParty;
  readonly investor: RelationshipParty;
};

/**
 * What a resource resolver returns: trusted metadata sufficient for a
 * disclosure decision. Ownership is resolved from the canonical resource
 * and the intrinsic scope is the owning domain's own classification -- a
 * baseline this context reads and never re-stores.
 *
 * `intrinsicScope` absent means "unknown": deny unless an explicit policy
 * grants access. `sensitivity` is carried for future Context Firewall work
 * and is not a scope.
 */
export type DisclosureResourceDescriptor = {
  readonly resource: DisclosureResourceRef;
  /** The storage/owner tenant of the resource. Never an access rule on its own. */
  readonly tenantId: TenantId;
  readonly ownerUserId?: UserId | undefined;
  readonly ownerOrganisationId?: OrganisationId | undefined;
  readonly intrinsicScope?: DisclosureScope | undefined;
  /** The exact relationship this resource belongs to, when it belongs to one. */
  readonly relationshipId?: string | undefined;
  readonly sensitivity?: SensitivityClass | undefined;
};

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export type DisclosurePolicy = {
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
  readonly createdAt: UtcTimestamp;
  readonly revokedAt: UtcTimestamp | null;
};

/** Lifecycle at an instant. Expired and revoked are distinguishable forever. */
export const DISCLOSURE_POLICY_STATUSES = [
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
] as const;
export type DisclosurePolicyStatus =
  (typeof DISCLOSURE_POLICY_STATUSES)[number];

function instant(timestamp: string): number {
  return Date.parse(timestamp);
}

/**
 * Revocation wins over expiry when both apply: a revoked grant stays
 * "revoked" in history even if it would also have lapsed.
 */
export function policyStatusAt(
  policy: Pick<DisclosurePolicy, "expiresAt" | "revokedAt">,
  now: UtcTimestamp,
): DisclosurePolicyStatus {
  if (policy.revokedAt !== null && instant(policy.revokedAt) <= instant(now)) {
    return "REVOKED";
  }
  if (policy.expiresAt !== null && instant(policy.expiresAt) <= instant(now)) {
    return "EXPIRED";
  }
  return "ACTIVE";
}

export function isPolicyActiveAt(
  policy: Pick<DisclosurePolicy, "expiresAt" | "revokedAt">,
  now: UtcTimestamp,
): boolean {
  return policyStatusAt(policy, now) === "ACTIVE";
}

// ---------------------------------------------------------------------------
// Principals
// ---------------------------------------------------------------------------

/**
 * Who a disclosure question is asked for. ANONYMOUS is a legitimate
 * principal (only public_external can answer it). An ACTOR carries the
 * server-resolved ActorContext; a client-supplied identity is never one.
 */
export const DisclosurePrincipalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ANONYMOUS") }).strict(),
  z.object({ kind: z.literal("ACTOR"), actor: ActorContextSchema }).strict(),
]);
export type DisclosurePrincipal =
  | { readonly kind: "ANONYMOUS" }
  | { readonly kind: "ACTOR"; readonly actor: ActorContext };

export const ANONYMOUS_PRINCIPAL: DisclosurePrincipal = { kind: "ANONYMOUS" };

export function actorPrincipal(actor: ActorContext): DisclosurePrincipal {
  return { kind: "ACTOR", actor };
}

export { UtcTimestampSchema, type UtcTimestamp };
