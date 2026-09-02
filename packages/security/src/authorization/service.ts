import type { AuthorizationDecision } from "./decision.js";
import {
  AuthorizationDeniedError,
  AuthorizationRequirementError,
} from "./errors.js";
import { evaluateAuthorization } from "./evaluator.js";
import type {
  AuthorizationPolicyFacts,
  AuthorizationPolicySource,
  AuthorizationRequest,
} from "./policy.js";

/**
 * The single server-side answer to "may this actor do this to this object?"
 *
 * Everything protected -- HTTP routes, worker commands, Q tool arguments --
 * consults this, so authorization semantics exist in one place rather than in
 * whatever each route happened to write.
 */
export type AuthorizationService = {
  readonly authorize: (
    request: AuthorizationRequest,
  ) => Promise<AuthorizationDecision>;
  /**
   * Authorize or throw. ALLOW returns; DENY throws AuthorizationDeniedError; a
   * conditional outcome throws AuthorizationRequirementError. Neither error
   * knows about HTTP.
   */
  readonly requireCapability: (request: AuthorizationRequest) => Promise<void>;
};

const NO_FACTS: AuthorizationPolicyFacts = {
  grants: [],
  denials: [],
  unmetRequirements: [],
};

export function createAuthorizationService(
  policySource: AuthorizationPolicySource,
): AuthorizationService {
  const authorize = async (
    request: AuthorizationRequest,
  ): Promise<AuthorizationDecision> => {
    let facts: AuthorizationPolicyFacts;

    try {
      facts = await policySource.getPolicyFacts(request);
    } catch {
      // Unknown policy state is not "probably fine". A source that cannot be
      // consulted yields no grants, and no grants is a denial.
      return {
        outcome: "DENY",
        capability: request.capability,
        resource: request.resource,
        reasonCode: "POLICY_UNAVAILABLE",
        authority: undefined,
      };
    }

    return evaluateAuthorization(request, facts ?? NO_FACTS);
  };

  return {
    authorize,

    requireCapability: async (request) => {
      const decision = await authorize(request);

      switch (decision.outcome) {
        case "ALLOW":
          return;
        case "DENY":
          throw new AuthorizationDeniedError(decision.reasonCode);
        case "REQUIRES_VERIFICATION":
        case "REQUIRES_STEP_UP":
        case "REQUIRES_APPROVAL":
          throw new AuthorizationRequirementError(
            decision.outcome,
            decision.requirements,
          );
      }
    },
  };
}
