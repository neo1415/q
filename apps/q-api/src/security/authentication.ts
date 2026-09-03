import type {
  FastifyReply,
  FastifyRequest,
  onRequestHookHandler,
} from "fastify";
import {
  AuthenticationRequiredError,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import { withObservabilityContext } from "@capital-q/observability";

import type { RequestAuthenticator } from "./actor-context.js";

/**
 * Authentication without organisation context.
 *
 * Most protected routes want `requireActorContextHook`: authenticate, then
 * resolve the organisation the caller acts for, failing closed if none. A
 * small set of routes are about the person rather than an organisation --
 * "who am I", the onboarding entry, choosing a context -- and for those a
 * user with no membership yet is a valid caller, not a 401.
 *
 * This hook establishes only the first fact: the session belongs to this
 * identity. It grants no tenant, organisation, membership or role.
 */

declare module "fastify" {
  interface FastifyRequest {
    /** Present only after the trusted authenticator verified the session. */
    principal?: AuthenticatedPrincipal;
  }
}

export function getPrincipal(request: FastifyRequest): AuthenticatedPrincipal {
  const principal = request.principal;

  if (principal === undefined) {
    throw new AuthenticationRequiredError();
  }

  return principal;
}

export function requireAuthenticationHook(dependencies: {
  readonly authenticator: RequestAuthenticator;
}): onRequestHookHandler {
  return function authenticationHook(
    request: FastifyRequest,
    _reply: FastifyReply,
    done: (error?: Error) => void,
  ): void {
    void (async () => {
      const principal = await dependencies.authenticator.authenticate(request);

      if (principal === null) {
        throw new AuthenticationRequiredError();
      }

      request.principal = principal;

      // The request id only: an auth subject is not a tenant and is not
      // written into log context.
      withObservabilityContext({ requestId: request.id }, () => {
        done();
      });
    })().catch((error: unknown) => {
      done(error instanceof Error ? error : new Error("authentication failed"));
    });
  };
}
