import type {
  FastifyReply,
  FastifyRequest,
  onRequestHookHandler,
} from "fastify";
import type { OnboardingActor } from "@capital-q/onboarding";
import {
  ActorContextDeniedError,
  ActorContextRequiredError,
  ActorContextResolutionError,
  AuthenticationRequiredError,
  ORGANISATION_CONTEXT_HEADER,
  parseOrganisationSelector,
  resolveHumanActorContext,
  type ActorContextResolver,
} from "@capital-q/security";
import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";
import { withObservabilityContext } from "@capital-q/observability";

import type { RequestAuthenticator } from "./actor-context.js";

/**
 * The onboarding actor hook: the one route family that must work before a
 * person belongs to any organisation.
 *
 *   authenticate -> application identity (Person) -> try to resolve the
 *   organisation context -> attach { userId, context | null }
 *
 * CONTEXT_REQUIRED is not an error here: a brand-new founder answering the
 * first onboarding questions has no membership yet, and the session is
 * owned by their Person id. A refused or invalid selector is still refused,
 * so a caller cannot slip into another organisation's context by starting
 * an onboarding session. Nothing authoritative comes from the request body.
 */

export type OnboardingActorDependencies = {
  readonly authenticator: RequestAuthenticator;
  readonly resolver: ActorContextResolver;
  readonly identities: ApplicationIdentityLookup;
};

declare module "fastify" {
  interface FastifyRequest {
    /** Present only after successful server-side resolution. */
    onboardingActor?: OnboardingActor;
  }
}

export function getOnboardingActor(request: FastifyRequest): OnboardingActor {
  const actor = request.onboardingActor;
  if (actor === undefined) {
    throw new ActorContextRequiredError();
  }
  return actor;
}

export function requireOnboardingActorHook(
  dependencies: OnboardingActorDependencies,
): onRequestHookHandler {
  return function onboardingActorHook(
    request: FastifyRequest,
    _reply: FastifyReply,
    done: (error?: Error) => void,
  ): void {
    void (async () => {
      const principal = await dependencies.authenticator.authenticate(request);
      if (principal === null) {
        throw new AuthenticationRequiredError();
      }
      const identity = await dependencies.identities.lookup(principal);
      if (identity === null) {
        throw new ActorContextDeniedError();
      }
      const rawSelector = request.headers[ORGANISATION_CONTEXT_HEADER];
      const selector = parseOrganisationSelector(
        typeof rawSelector === "string" ? rawSelector : undefined,
      );
      if (!selector.ok) {
        throw new ActorContextRequiredError(
          "The requested organisation context identifier is not valid.",
        );
      }
      const resolution = await resolveHumanActorContext(dependencies.resolver, {
        principal,
        selection: selector.selection,
      });
      let actor: OnboardingActor;
      switch (resolution.status) {
        case "RESOLVED":
          actor = {
            userId: resolution.context.userId,
            context: resolution.context,
            principal,
          };
          break;
        case "CONTEXT_REQUIRED":
          actor = { userId: identity.userId, context: null, principal };
          break;
        case "NO_APPLICATION_IDENTITY":
        case "CONTEXT_NOT_ACCESSIBLE":
          throw new ActorContextDeniedError();
        case "INVALID_CONTEXT":
          throw new ActorContextResolutionError();
      }
      request.onboardingActor = actor;
      withObservabilityContext(
        {
          requestId: request.id,
          ...(actor.context === null
            ? {}
            : { tenantId: actor.context.tenantId }),
          ...(actor.context?.organisationId === undefined
            ? {}
            : { organisationId: actor.context.organisationId }),
        },
        () => {
          done();
        },
      );
    })().catch((error: unknown) => {
      done(
        error instanceof Error ? error : new Error("onboarding actor failed"),
      );
    });
  };
}
