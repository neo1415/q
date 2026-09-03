import type {
  DisclosureAccessLevel,
  DisclosurePolicy,
  DisclosureRecipient,
  DisclosureResourceRef,
  DisclosureScope,
} from "../contracts/index.js";
import { DisclosurePolicyInvalidError } from "./errors.js";

/**
 * Structural rules of a disclosure statement, independent of any actor or
 * database. A scope decides what a recipient means:
 *
 *   specifically_shared   exactly one explicit recipient (USER, MEMBERSHIP,
 *                         ORGANISATION or RELATIONSHIP)
 *   relationship_shared   the exact canonical relationship, always stated
 *                         as a RELATIONSHIP recipient (one representation)
 *   every other scope     no recipient; a recipient would be meaningless
 */

export type DisclosurePolicyShape = {
  readonly scopeType: DisclosureScope;
  readonly recipient: DisclosureRecipient | null;
  readonly accessLevel: DisclosureAccessLevel;
};

export function validatePolicyShape(shape: DisclosurePolicyShape): void {
  switch (shape.scopeType) {
    case "specifically_shared":
      if (shape.recipient === null) {
        throw new DisclosurePolicyInvalidError("RECIPIENT_REQUIRED");
      }
      return;
    case "relationship_shared":
      if (shape.recipient === null || shape.recipient.type !== "RELATIONSHIP") {
        throw new DisclosurePolicyInvalidError(
          "RELATIONSHIP_RECIPIENT_REQUIRED",
        );
      }
      return;
    case "personal_private":
    case "organisation_private":
    case "founder_private":
    case "investor_private":
    case "network_visible":
    case "public_external":
      if (shape.recipient !== null) {
        throw new DisclosurePolicyInvalidError("RECIPIENT_NOT_ALLOWED");
      }
      return;
  }
}

/** The relationship a policy names, if it names one. */
export function policyRelationshipId(
  policy: Pick<DisclosurePolicy, "recipient">,
): string | undefined {
  return policy.recipient?.type === "RELATIONSHIP"
    ? policy.recipient.id
    : undefined;
}

/**
 * Two grants are semantically identical when they disclose the same resource
 * under the same scope to the same recipient at the same access level.
 * Expiry is deliberately not part of identity: a second active identical
 * grant with a different expiry is still a duplicate, not a new share.
 */
export type DisclosureGrantIdentity = {
  readonly resource: DisclosureResourceRef;
  readonly scopeType: DisclosureScope;
  readonly recipient: DisclosureRecipient | null;
  readonly accessLevel: DisclosureAccessLevel;
};

export function sameGrantIdentity(
  a: DisclosureGrantIdentity,
  b: DisclosureGrantIdentity,
): boolean {
  return (
    a.resource.type === b.resource.type &&
    a.resource.id === b.resource.id &&
    a.scopeType === b.scopeType &&
    a.accessLevel === b.accessLevel &&
    (a.recipient === null
      ? b.recipient === null
      : b.recipient !== null &&
        a.recipient.type === b.recipient.type &&
        a.recipient.id === b.recipient.id)
  );
}

/**
 * Same DisclosurePolicyId written twice: identical only when every
 * canonical field agrees, including owner and expiry. Anything else is a
 * conflict, never an overwrite.
 */
export function sameCanonicalPolicy(
  existing: DisclosurePolicy,
  proposed: DisclosureGrantIdentity & {
    readonly ownerUserId: string | null;
    readonly ownerOrganisationId: string | null;
    readonly expiresAt: string | null;
  },
): boolean {
  return (
    sameGrantIdentity(existing, proposed) &&
    existing.ownerUserId === proposed.ownerUserId &&
    existing.ownerOrganisationId === proposed.ownerOrganisationId &&
    (existing.expiresAt === null
      ? proposed.expiresAt === null
      : proposed.expiresAt !== null &&
        Date.parse(existing.expiresAt) === Date.parse(proposed.expiresAt))
  );
}
