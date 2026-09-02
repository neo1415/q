import {
  AUTHORIZATION_REQUIREMENTS,
  type AuthorizationDecision,
  type AuthorizationRequirement,
} from "./decision.js";
import type {
  AuthorizationPolicyFacts,
  AuthorizationRequest,
} from "./policy.js";
import { AuthorizationRequestSchema } from "./policy.js";
import { scopeCovers } from "./resource-scope.js";

/**
 * Deterministic, deny-by-default evaluation. Pure: no I/O, no clock, no
 * randomness, so the same request and facts always yield the same decision.
 *
 * Order matters and is fixed:
 *
 *   1. structural validity            -> DENY
 *   2. actor tenant = resource tenant -> DENY   (hard, before any policy)
 *   3. actor organisation coherence   -> DENY
 *   4. explicit matching denial       -> DENY   (always beats a grant)
 *   5. no matching grant              -> DENY
 *   6. unmet VERIFICATION             -> REQUIRES_VERIFICATION
 *   7. unmet STEP_UP                  -> REQUIRES_STEP_UP
 *   8. unmet APPROVAL                 -> REQUIRES_APPROVAL
 *   9. ALLOW
 *
 * Nothing here consults an actor type. Q, SYSTEM and CONNECTED_SYSTEM receive
 * exactly the authority their policy facts grant and no more; there is no
 * branch that treats any actor as inherently trusted.
 */
export function evaluateAuthorization(
  request: AuthorizationRequest,
  facts: AuthorizationPolicyFacts,
): AuthorizationDecision {
  const { capability, resource } = request;

  if (!AuthorizationRequestSchema.safeParse(request).success) {
    return {
      outcome: "DENY",
      capability,
      resource,
      reasonCode: "INVALID_REQUEST",
      authority: undefined,
    };
  }

  // The isolation boundary. Checked before policy so that no grant, however
  // broad or however mistaken, can reach across tenants.
  if (request.actor.tenantId !== resource.tenantId) {
    return {
      outcome: "DENY",
      capability,
      resource,
      reasonCode: "TENANT_MISMATCH",
      authority: undefined,
    };
  }

  // An actor operating for organisation A does not act on organisation B's
  // objects by virtue of sharing a tenant. Cross-organisation access, if it
  // ever exists, will be an explicit policy architecture -- not an inference.
  const targetOrganisation =
    resource.kind === "TENANT" ? undefined : resource.organisationId;

  if (
    request.actor.organisationId !== undefined &&
    targetOrganisation !== undefined &&
    request.actor.organisationId !== targetOrganisation
  ) {
    return {
      outcome: "DENY",
      capability,
      resource,
      reasonCode: "ORGANISATION_MISMATCH",
      authority: undefined,
    };
  }

  const denial = facts.denials.find(
    (candidate) =>
      candidate.capability === capability &&
      scopeCovers(candidate.scope, resource),
  );

  if (denial !== undefined) {
    return {
      outcome: "DENY",
      capability,
      resource,
      reasonCode: "EXPLICIT_DENIAL",
      authority: "EXPLICIT_DENIAL",
    };
  }

  const grant = facts.grants.find(
    (candidate) =>
      candidate.capability === capability &&
      scopeCovers(candidate.scope, resource),
  );

  if (grant === undefined) {
    return {
      outcome: "DENY",
      capability,
      resource,
      reasonCode: "NO_MATCHING_GRANT",
      authority: undefined,
    };
  }

  const unmet = orderRequirements(facts.unmetRequirements);
  const first = unmet[0];

  if (first !== undefined) {
    switch (first) {
      case "VERIFICATION":
        return {
          outcome: "REQUIRES_VERIFICATION",
          capability,
          resource,
          reasonCode: "VERIFICATION_REQUIRED",
          requirements: unmet,
        };
      case "STEP_UP":
        return {
          outcome: "REQUIRES_STEP_UP",
          capability,
          resource,
          reasonCode: "STEP_UP_REQUIRED",
          requirements: unmet,
        };
      case "APPROVAL":
        return {
          outcome: "REQUIRES_APPROVAL",
          capability,
          resource,
          reasonCode: "APPROVAL_REQUIRED",
          requirements: unmet,
        };
    }
  }

  return {
    outcome: "ALLOW",
    capability,
    resource,
    reasonCode: "CAPABILITY_GRANTED",
    authority: grant.source,
  };
}

/** Deterministic VERIFICATION → STEP_UP → APPROVAL ordering, deduplicated. */
function orderRequirements(
  requirements: readonly AuthorizationRequirement[],
): readonly AuthorizationRequirement[] {
  const present = new Set(requirements);
  return AUTHORIZATION_REQUIREMENTS.filter((requirement) =>
    present.has(requirement),
  );
}
