import {
  AuthorizationDeniedError,
  AuthorizationRequirementError,
  type ActorContext,
  type AuthorizationContext,
  type AuthorizationDecision,
  type AuthorizationOutcome,
  type AuthorizationService,
  type Capability,
  type ResourceScope,
} from "@capital-q/security";

import {
  actorPrincipal,
  type DisclosureAccessLevel,
  type DisclosureResourceRef,
} from "../contracts/index.js";
import type { DisclosureDecision } from "../domain/decision.js";
import { DisclosureDeniedError } from "../domain/errors.js";
import type { DisclosureAccessService } from "./access-service.js";

/**
 * Capability authorization + disclosure, composed for protected reads.
 *
 *   Authorization DENY        -> DENY            (disclosure not consulted)
 *   Disclosure DENY           -> DENY            (whatever authorization said)
 *   Authorization REQUIRES_*  -> preserved       (disclosure ALLOW never flattens it)
 *   both ALLOW                -> ALLOW
 *
 * Both layers must permit. Neither is ever converted into the other, and a
 * view/view_download share grants no capability.
 */

export type ProtectedDisclosureRequest = {
  readonly actor: ActorContext;
  readonly capability: Capability;
  readonly resourceScope: ResourceScope;
  readonly disclosure: {
    readonly resource: DisclosureResourceRef;
    readonly requestedAccess: DisclosureAccessLevel;
  };
  readonly context?: AuthorizationContext | undefined;
};

export type ProtectedDisclosureDecision = {
  readonly outcome: AuthorizationOutcome;
  readonly authorization: AuthorizationDecision;
  /** Null when authorization already denied and disclosure was not consulted. */
  readonly disclosure: DisclosureDecision | null;
};

export type ProtectedDisclosureGuard = {
  readonly check: (
    request: ProtectedDisclosureRequest,
  ) => Promise<ProtectedDisclosureDecision>;
  /** ALLOW returns; anything else throws the matching transport-neutral error. */
  readonly require: (request: ProtectedDisclosureRequest) => Promise<void>;
};

export function createProtectedDisclosureGuard(dependencies: {
  readonly authorization: AuthorizationService;
  readonly disclosure: DisclosureAccessService;
}): ProtectedDisclosureGuard {
  const { authorization, disclosure } = dependencies;

  const check = async (
    request: ProtectedDisclosureRequest,
  ): Promise<ProtectedDisclosureDecision> => {
    const authorized = await authorization.authorize({
      actor: request.actor,
      capability: request.capability,
      resource: request.resourceScope,
      ...(request.context === undefined ? {} : { context: request.context }),
    });
    if (authorized.outcome === "DENY") {
      return { outcome: "DENY", authorization: authorized, disclosure: null };
    }
    const disclosed = await disclosure.canDisclose({
      principal: actorPrincipal(request.actor),
      resource: request.disclosure.resource,
      requestedAccess: request.disclosure.requestedAccess,
    });
    if (disclosed.outcome === "DENY") {
      return {
        outcome: "DENY",
        authorization: authorized,
        disclosure: disclosed,
      };
    }
    // ALLOW or a preserved REQUIRES_* from the capability layer.
    return {
      outcome: authorized.outcome,
      authorization: authorized,
      disclosure: disclosed,
    };
  };

  return {
    check,
    require: async (request) => {
      const decision = await check(request);
      switch (decision.outcome) {
        case "ALLOW":
          return;
        case "DENY":
          if (decision.disclosure?.outcome === "DENY") {
            throw new DisclosureDeniedError(decision.disclosure.reasonCode);
          }
          throw new AuthorizationDeniedError(
            decision.authorization.outcome === "DENY"
              ? decision.authorization.reasonCode
              : "NO_MATCHING_GRANT",
          );
        case "REQUIRES_VERIFICATION":
        case "REQUIRES_STEP_UP":
        case "REQUIRES_APPROVAL":
          throw new AuthorizationRequirementError(
            decision.outcome,
            decision.authorization.outcome === "ALLOW" ||
              decision.authorization.outcome === "DENY"
              ? []
              : decision.authorization.requirements,
          );
      }
    },
  };
}
