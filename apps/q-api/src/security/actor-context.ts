import type {
  FastifyReply,
  FastifyRequest,
  onRequestHookHandler,
} from "fastify";
import {
  ActorContextRequiredError,
  AuthenticationRequiredError,
  ORGANISATION_CONTEXT_HEADER,
  parseOrganisationSelector,
  requireHumanActorContext,
  type ActorContext,
  type ActorContextResolver,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import { withObservabilityContext } from "@capital-q/observability";

/**
 * The single mechanism protected routes use to obtain actor context.
 *
 * No route parses authentication, reads a context header, or looks up a
 * membership itself. If that logic is duplicated per route it will eventually
 * be duplicated slightly wrong, and the wrong copy is a cross-tenant bug.
 */

/**
 * The trusted authentication boundary.
 *
 * Returns a principal for an authenticated request, or null. Supabase Auth is
 * wired in behind this interface by the identity packet; nothing here fakes it.
 */
export type RequestAuthenticator = {
  readonly authenticate: (
    request: FastifyRequest,
  ) => Promise<AuthenticatedPrincipal | null>;
};

export type ActorContextDependencies = {
  readonly authenticator: RequestAuthenticator;
  readonly resolver: ActorContextResolver;
};

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Present only after successful server-side resolution. Never populated
     * from a body, query or header.
     */
    actorContext?: ActorContext;
  }
}

/**
 * Read the resolved context, or fail closed.
 *
 * Handlers use this rather than `request.actorContext!`, so a route that is
 * accidentally left unprotected raises a security error instead of proceeding
 * with an undefined context.
 */
export function getActorContext(request: FastifyRequest): ActorContext {
  const context = request.actorContext;

  if (context === undefined) {
    throw new ActorContextRequiredError();
  }

  return context;
}

/**
 * Build the onRequest hook that protects a route.
 *
 *   authenticate -> parse selector -> resolve -> attach -> continue
 *
 * Applied per route rather than globally: health checks and future public
 * pages must not require authentication merely because this exists.
 */
export function requireActorContextHook(
  dependencies: ActorContextDependencies,
): onRequestHookHandler {
  return function actorContextHook(
    request: FastifyRequest,
    _reply: FastifyReply,
    done: (error?: Error) => void,
  ): void {
    void (async () => {
      const principal = await dependencies.authenticator.authenticate(request);

      if (principal === null) {
        throw new AuthenticationRequiredError();
      }

      // The only thing a client may influence. A malformed identifier is
      // rejected here so obviously bad input never reaches identity lookup.
      const rawSelector = request.headers[ORGANISATION_CONTEXT_HEADER];
      const selector = parseOrganisationSelector(
        typeof rawSelector === "string" ? rawSelector : undefined,
      );

      if (!selector.ok) {
        throw new ActorContextRequiredError(
          "The requested organisation context identifier is not valid.",
        );
      }

      // Everything authoritative comes from here. X-Tenant-Id, X-Membership-Id,
      // X-Actor-Role and X-Actor-Type are never read: a caller cannot name its
      // own tenant, membership, role or actor type.
      const context = await requireHumanActorContext(dependencies.resolver, {
        principal,
        selection: selector.selection,
      });

      request.actorContext = context;

      // Safe identifiers only, so a log line can be tied to a tenant without
      // copying business data into it. The direction is one-way: observability
      // is enriched from security context and is never read back as authority.
      withObservabilityContext(
        {
          requestId: request.id,
          ...(context.tenantId === undefined
            ? {}
            : { tenantId: context.tenantId }),
          ...(context.organisationId === undefined
            ? {}
            : { organisationId: context.organisationId }),
        },
        () => {
          done();
        },
      );
    })().catch((error: unknown) => {
      done(error instanceof Error ? error : new Error("actor context failed"));
    });
  };
}
