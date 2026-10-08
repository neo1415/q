# q-api authentication and actor context

Why included: Supabase getUser per request; org selector is a request resolved against active memberships.

## `apps/q-api/src/security/authentication.ts` lines 44-70

```ts
   44  export function requireAuthenticationHook(dependencies: {
   45    readonly authenticator: RequestAuthenticator;
   46  }): onRequestHookHandler {
   47    return function authenticationHook(
   48      request: FastifyRequest,
   49      _reply: FastifyReply,
   50      done: (error?: Error) => void,
   51    ): void {
   52      void (async () => {
   53        const principal = await dependencies.authenticator.authenticate(request);
   54  
   55        if (principal === null) {
   56          throw new AuthenticationRequiredError();
   57        }
   58  
   59        request.principal = principal;
   60  
   61        // The request id only: an auth subject is not a tenant and is not
   62        // written into log context.
   63        withObservabilityContext({ requestId: request.id }, () => {
   64          done();
   65        });
   66      })().catch((error: unknown) => {
   67        done(error instanceof Error ? error : new Error("authentication failed"));
   68      });
   69    };
   70  }
```

## `apps/q-api/src/security/actor-context.ts` lines 81-140

```ts
   81  export function requireActorContextHook(
   82    dependencies: ActorContextDependencies,
   83  ): onRequestHookHandler {
   84    return function actorContextHook(
   85      request: FastifyRequest,
   86      _reply: FastifyReply,
   87      done: (error?: Error) => void,
   88    ): void {
   89      void (async () => {
   90        const principal = await dependencies.authenticator.authenticate(request);
   91  
   92        if (principal === null) {
   93          throw new AuthenticationRequiredError();
   94        }
   95  
   96        // The only thing a client may influence. A malformed identifier is
   97        // rejected here so obviously bad input never reaches identity lookup.
   98        const rawSelector = request.headers[ORGANISATION_CONTEXT_HEADER];
   99        const selector = parseOrganisationSelector(
  100          typeof rawSelector === "string" ? rawSelector : undefined,
  101        );
  102  
  103        if (!selector.ok) {
  104          throw new ActorContextRequiredError(
  105            "The requested organisation context identifier is not valid.",
  106          );
  107        }
  108  
  109        // Everything authoritative comes from here. X-Tenant-Id, X-Membership-Id,
  110        // X-Actor-Role and X-Actor-Type are never read: a caller cannot name its
  111        // own tenant, membership, role or actor type.
  112        const context = await requireHumanActorContext(dependencies.resolver, {
  113          principal,
  114          selection: selector.selection,
  115        });
  116  
  117        request.actorContext = context;
  118  
  119        // Safe identifiers only, so a log line can be tied to a tenant without
  120        // copying business data into it. The direction is one-way: observability
  121        // is enriched from security context and is never read back as authority.
  122        withObservabilityContext(
  123          {
  124            requestId: request.id,
  125            ...(context.tenantId === undefined
  126              ? {}
  127              : { tenantId: context.tenantId }),
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
```

## `packages/security/src/postgres/actor-context-resolver.ts` lines 55-131

```ts
   55  
   56    return {
   57      resolveHumanContext: async ({
   58        principal,
   59        selection,
   60      }): Promise<ActorContextResolution> => {
   61        // AuthUserId -> UserId. A suspended or closed profile has no
   62        // application identity for the purposes of acting.
   63        const profileRows = await sql`
   64          select p.id
   65            from identity.user_profiles p
   66           where p.auth_user_id = ${principal.authUserId}
   67             and p.status = 'active'
   68           limit 1`;
   69  
   70        if (profileRows.length === 0) {
   71          return { status: "NO_APPLICATION_IDENTITY" };
   72        }
   73        const profile = ProfileRowSchema.safeParse(profileRows[0]);
   74        if (!profile.success) {
   75          return { status: "INVALID_CONTEXT" };
   76        }
   77        const userId = profile.data.id;
   78  
   79        const requested = selection?.organisationId;
   80  
   81        const membershipRows =
   82          requested === undefined
   83            ? await sql`
   84                select m.id, m.tenant_id, m.organisation_id
   85                  from identity.user_active_contexts c
   86                  join identity.organisation_memberships m
   87                    on m.id = c.membership_id
   88                   and m.user_id = c.user_id
   89                 where c.user_id = ${userId}
   90                   and m.membership_status = 'active'
   91                 limit 1`
   92            : await sql`
   93                select m.id, m.tenant_id, m.organisation_id
   94                  from identity.organisation_memberships m
   95                 where m.user_id = ${userId}
   96                   and m.organisation_id = ${requested}
   97                   and m.membership_status = 'active'
   98                 limit 1`;
   99  
  100        if (membershipRows.length === 0) {
  101          // Whether the organisation exists, belongs to another tenant, or held
  102          // a membership that has since been revoked is not distinguished.
  103          return {
  104            status:
  105              requested === undefined
  106                ? "CONTEXT_REQUIRED"
  107                : "CONTEXT_NOT_ACCESSIBLE",
  108          };
  109        }
  110  
  111        const membership = MembershipRowSchema.safeParse(membershipRows[0]);
  112        if (!membership.success) {
  113          return { status: "INVALID_CONTEXT" };
  114        }
  115  
  116        const context = ActorContextSchema.safeParse({
  117          userId,
  118          tenantId: membership.data.tenant_id,
  119          organisationId: membership.data.organisation_id,
  120          membershipId: membership.data.id,
  121          // Only human requests travel this path (CQ-SEC-001 s101).
  122          actorType: "HUMAN",
  123        });
  124        if (!context.success) {
  125          return { status: "INVALID_CONTEXT" };
  126        }
  127  
  128        return { status: "RESOLVED", context: context.data };
  129      },
  130    };
  131  }
```

## `packages/security/src/supabase/access-token-authenticator.ts` lines 53-96

```ts
   53  export function createSupabaseAccessTokenAuthenticator(
   54    options: SupabaseAccessTokenAuthenticatorOptions,
   55  ): AccessTokenAuthenticator {
   56    const client = createClient(options.url, options.publishableKey, {
   57      auth: {
   58        // This process never owns a session: it only verifies tokens handed to
   59        // it. Nothing is persisted and nothing refreshes in the background.
   60        persistSession: false,
   61        autoRefreshToken: false,
   62        detectSessionInUrl: false,
   63      },
   64      ...(options.fetch === undefined
   65        ? {}
   66        : { global: { fetch: options.fetch } }),
   67    });
   68  
   69    return {
   70      authenticate: async (accessToken) => {
   71        if (!looksLikeAccessToken(accessToken)) {
   72          return null;
   73        }
   74  
   75        const { data, error } = await client.auth.getUser(accessToken);
   76  
   77        if (error !== null || data.user === null) {
   78          return null;
   79        }
   80  
   81        const authUserId = AuthUserIdSchema.safeParse(data.user.id);
   82  
   83        if (!authUserId.success) {
   84          return null;
   85        }
   86  
   87        return { authUserId: authUserId.data };
   88      },
   89    };
   90  }
   91  
   92  /**
   93   * Extract a bearer token from an Authorization header value, or `null`.
   94   *
   95   * Only the `Bearer` scheme is recognised (case-insensitive scheme, per RFC
   96   * 9110). Basic, cookies, custom schemes and bare tokens are not authentication.
```

