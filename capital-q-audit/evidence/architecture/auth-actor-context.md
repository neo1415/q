# Excerpt: apps/api/src/security/actor-context.ts lines 1-137

- Original path: `apps/api/src/security/actor-context.ts`
- Line range: 1-137
- Why included: The single per-route hook that authenticates (bearer) and resolves the organisation actor context. An identical copy lives in apps/q-api/src/security/actor-context.ts lines 1-127 plus a personal-context variant.

```
    1  import type {
    2    FastifyReply,
    3    FastifyRequest,
    4    onRequestHookHandler,
    5  } from "fastify";
    6  import {
    7    ActorContextRequiredError,
    8    AuthenticationRequiredError,
    9    ORGANISATION_CONTEXT_HEADER,
   10    parseOrganisationSelector,
   11    requireHumanActorContext,
   12    type ActorContext,
   13    type ActorContextResolver,
   14    type AuthenticatedPrincipal,
   15  } from "@capital-q/security";
   16  import { withObservabilityContext } from "@capital-q/observability";
   17
   18  /**
   19   * The single mechanism protected routes use to obtain actor context.
   20   *
   21   * No route parses authentication, reads a context header, or looks up a
   22   * membership itself. If that logic is duplicated per route it will eventually
   23   * be duplicated slightly wrong, and the wrong copy is a cross-tenant bug.
   24   */
   25
   26  /**
   27   * The trusted authentication boundary.
   28   *
   29   * Returns a principal for an authenticated request, or null. Supabase Auth is
   30   * wired in behind this interface by the identity packet; nothing here fakes it.
   31   */
   32  export type RequestAuthenticator = {
   33    readonly authenticate: (
   34      request: FastifyRequest,
   35    ) => Promise<AuthenticatedPrincipal | null>;
   36  };
   37
   38  export type ActorContextDependencies = {
   39    readonly authenticator: RequestAuthenticator;
   40    readonly resolver: ActorContextResolver;
   41  };
   42
   43  declare module "fastify" {
   44    interface FastifyRequest {
   45      /**
   46       * Present only after successful server-side resolution. Never populated
   47       * from a body, query or header.
   48       */
   49      actorContext?: ActorContext;
   50    }
   51  }
   52
   53  /**
   54   * Read the resolved context, or fail closed.
   55   *
   56   * Handlers use this rather than `request.actorContext!`, so a route that is
   57   * accidentally left unprotected raises a security error instead of proceeding
   58   * with an undefined context.
   59   */
   60  export function getActorContext(request: FastifyRequest): ActorContext {
   61    const context = request.actorContext;
   62
   63    if (context === undefined) {
   64      throw new ActorContextRequiredError();
   65    }
   66
   67    return context;
   68  }
   69
   70  /**
   71   * Build the onRequest hook that protects a route.
   72   *
   73   *   authenticate -> parse selector -> resolve -> attach -> continue
   74   *
   75   * Applied per route rather than globally: health checks and future public
   76   * pages must not require authentication merely because this exists.
   77   */
   78  export function requireActorContextHook(
   79    dependencies: ActorContextDependencies,
   80  ): onRequestHookHandler {
   81    return function actorContextHook(
   82      request: FastifyRequest,
   83      _reply: FastifyReply,
   84      done: (error?: Error) => void,
   85    ): void {
   86      void (async () => {
   87        const principal = await dependencies.authenticator.authenticate(request);
   88
   89        if (principal === null) {
   90          throw new AuthenticationRequiredError();
   91        }
   92
   93        // The only thing a client may influence. A malformed identifier is
   94        // rejected here so obviously bad input never reaches identity lookup.
   95        const rawSelector = request.headers[ORGANISATION_CONTEXT_HEADER];
   96        const selector = parseOrganisationSelector(
   97          typeof rawSelector === "string" ? rawSelector : undefined,
   98        );
   99
  100        if (!selector.ok) {
  101          throw new ActorContextRequiredError(
  102            "The requested organisation context identifier is not valid.",
  103          );
  104        }
  105
  106        // Everything authoritative comes from here. X-Tenant-Id, X-Membership-Id,
  107        // X-Actor-Role and X-Actor-Type are never read: a caller cannot name its
  108        // own tenant, membership, role or actor type.
  109        const context = await requireHumanActorContext(dependencies.resolver, {
  110          principal,
  111          selection: selector.selection,
  112        });
  113
  114        request.actorContext = context;
  115
  116        // Safe identifiers only, so a log line can be tied to a tenant without
  117        // copying business data into it. The direction is one-way: observability
  118        // is enriched from security context and is never read back as authority.
  119        withObservabilityContext(
  120          {
  121            requestId: request.id,
  122            ...(context.tenantId === undefined
  123              ? {}
  124              : { tenantId: context.tenantId }),
  125            ...(context.organisationId === undefined
  126              ? {}
  127              : { organisationId: context.organisationId }),
  128          },
  129          () => {
  130            done();
  131          },
  132        );
  133      })().catch((error: unknown) => {
  134        done(error instanceof Error ? error : new Error("actor context failed"));
  135      });
  136    };
  137  }
```

# Excerpt: apps/api/src/security/supabase-authenticator.ts lines 1-39

- Original path: `apps/api/src/security/supabase-authenticator.ts`
- Line range: 1-39
- Why included: Bearer-only request authenticator; byte-identical to apps/q-api/src/security/supabase-authenticator.ts.

```
    1  import type { FastifyRequest } from "fastify";
    2  import {
    3    extractBearerToken,
    4    type AccessTokenAuthenticator,
    5  } from "@capital-q/security/supabase";
    6
    7  import type { RequestAuthenticator } from "./actor-context.js";
    8
    9  /**
   10   * The production RequestAuthenticator: Supabase access token in the
   11   * Authorization header -> verified AuthenticatedPrincipal.
   12   *
   13   * This service is bearer-only. It reads no cookies, so a browser cannot be
   14   * made to authenticate here by a cross-site form post or image load, and the
   15   * cookie session stays where it is managed: at the web app's server
   16   * boundary. The token is verified with the Auth server on every request;
   17   * nothing here decodes a JWT and trusts what it says.
   18   *
   19   * Only the Authorization header is consulted. A user id in a body, a query
   20   * string or a custom header is input, never identity.
   21   */
   22  export function createSupabaseRequestAuthenticator(
   23    accessTokens: AccessTokenAuthenticator,
   24  ): RequestAuthenticator {
   25    return {
   26      authenticate: (request: FastifyRequest) => {
   27        const header = request.headers.authorization;
   28        const token = extractBearerToken(
   29          typeof header === "string" ? header : undefined,
   30        );
   31
   32        if (token === null) {
   33          return Promise.resolve(null);
   34        }
   35
   36        return accessTokens.authenticate(token);
   37      },
   38    };
   39  }
```

# Excerpt: apps/q-api/src/security/actor-context.ts lines 128-215

- Original path: `apps/q-api/src/security/actor-context.ts`
- Line range: 128-215
- Why included: q-api-only variant: requireActorContextOrPersonalHook (personal tenant context for people without an organisation).

```
  128            ...(context.organisationId === undefined
  129              ? {}
  130              : { organisationId: context.organisationId }),
  131          },
  132          () => {
  133            done();
  134          },
  135        );
  136      })().catch((error: unknown) => {
  137        done(error instanceof Error ? error : new Error("actor context failed"));
  138      });
  139    };
  140  }
  141
  142  /**
  143   * The same hook, for the few routes a person may use before they belong to
  144   * an organisation: the arrival conversation and Q's open thread. An
  145   * authenticated person with an active profile and no organisation context
  146   * gets a personal context (`personalActorContext`): no organisation, no
  147   * membership, no subject, attributed to the well-known personal tenant. A
  148   * person with an organisation resolves exactly as everywhere else, and a
  149   * request that names an organisation still gets that one or nothing.
  150   */
  151  export function requireActorContextOrPersonalHook(
  152    dependencies: ActorContextDependencies & {
  153      readonly identity: ApplicationIdentityLookup;
  154    },
  155  ): onRequestHookHandler {
  156    return function actorContextOrPersonalHook(
  157      request: FastifyRequest,
  158      _reply: FastifyReply,
  159      done: (error?: Error) => void,
  160    ): void {
  161      void (async () => {
  162        const principal = await dependencies.authenticator.authenticate(request);
  163        if (principal === null) {
  164          throw new AuthenticationRequiredError();
  165        }
  166        const rawSelector = request.headers[ORGANISATION_CONTEXT_HEADER];
  167        const selector = parseOrganisationSelector(
  168          typeof rawSelector === "string" ? rawSelector : undefined,
  169        );
  170        if (!selector.ok) {
  171          throw new ActorContextRequiredError(
  172            "The requested organisation context identifier is not valid.",
  173          );
  174        }
  175        const resolution = await resolveHumanActorContext(dependencies.resolver, {
  176          principal,
  177          selection: selector.selection,
  178        });
  179        let context: ActorContext;
  180        if (resolution.status === "RESOLVED") {
  181          context = resolution.context;
  182        } else if (
  183          resolution.status === "CONTEXT_REQUIRED" &&
  184          selector.selection?.organisationId === undefined
  185        ) {
  186          const identity = await dependencies.identity.lookup(principal);
  187          if (identity === null) {
  188            throw new ActorContextRequiredError();
  189          }
  190          context = personalActorContext(identity.userId);
  191        } else {
  192          // Everything else fails exactly as the strict hook does.
  193          context = await requireHumanActorContext(dependencies.resolver, {
  194            principal,
  195            selection: selector.selection,
  196          });
  197        }
  198        request.actorContext = context;
  199        withObservabilityContext(
  200          {
  201            requestId: request.id,
  202            tenantId: context.tenantId,
  203            ...(context.organisationId === undefined
  204              ? {}
  205              : { organisationId: context.organisationId }),
  206          },
  207          () => {
  208            done();
  209          },
  210        );
  211      })().catch((error: unknown) => {
  212        done(error instanceof Error ? error : new Error("actor context failed"));
  213      });
  214    };
  215  }
```
