import { z } from "zod";
import { createUuidIdSchema } from "@capital-q/contracts";

/**
 * The identity provider's subject. What authentication proves.
 *
 * Deliberately separate from UserId. Collapsing the two would make the auth
 * subject permanently authoritative, and the mapping between them is exactly
 * where profile lifecycle and revocation live: `identity.user_profiles`
 * translates an AuthUserId into a UserId, and that translation can be removed.
 */
export const AuthUserIdSchema = createUuidIdSchema("AuthUserId");
export type AuthUserId = z.infer<typeof AuthUserIdSchema>;

/**
 * The Capital Q person. Persistent application-level identity, and what
 * ActorContext.userId refers to.
 *
 * A person is not an organisation and not a membership (PADL #145). Identity
 * continuity is not information continuity: the same person acting for two
 * organisations is two different operating contexts.
 */
export const UserIdSchema = createUuidIdSchema("UserId");
export type UserId = z.infer<typeof UserIdSchema>;

/**
 * The isolation boundary all tenant-owned data belongs to.
 *
 * Distinct from OrganisationId even though V1 has one organisation per tenant.
 * Writing `tenantId = organisationId` as an invariant would make a future
 * enterprise tenant containing several organisations a migration of every
 * query rather than a change of one mapping.
 */
export const TenantIdSchema = createUuidIdSchema("TenantId");
export type TenantId = z.infer<typeof TenantIdSchema>;

/** The organisation a person is currently acting for. */
export const OrganisationIdSchema = createUuidIdSchema("OrganisationId");
export type OrganisationId = z.infer<typeof OrganisationIdSchema>;

/**
 * The person-to-organisation link that grants organisational context.
 *
 * A membership is not a role, a business title, or a permission. Its existence
 * establishes which organisation someone may act for, never what they may do
 * there -- capabilities are resolved separately.
 */
export const MembershipIdSchema = createUuidIdSchema("MembershipId");
export type MembershipId = z.infer<typeof MembershipIdSchema>;
