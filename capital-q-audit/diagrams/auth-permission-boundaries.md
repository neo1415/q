# Auth and permission boundaries (investigator A)

Sources: `apps/web/proxy.ts`, `apps/web/src/auth/session.ts`, `apps/api/src/security/*`, `apps/q-api/src/security/*`, `packages/security/src/supabase/access-token-authenticator.ts`, `apps/api/src/http/app-actions.ts`, `apps/q-api/src/voice/session-token.ts`, migrations RLS. Details in `02 §4` and `12 §2`.

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant W as web (Next server)
  participant SA as Supabase Auth
  participant A as api / q-api (Fastify)
  participant R as ActorContextResolver (Postgres)
  participant Z as authorize() (app-action / Q tool)
  participant DB as Postgres (as postgres, BYPASSRLS)

  B->>W: request + httpOnly SameSite=Lax cookie
  W->>W: proxy.ts session refresh, route policy (UI gate only)
  W->>W: getClaims() local verify; getSession().access_token
  W->>A: Authorization: Bearer <access token> [+ organisation selector header]
  A->>SA: auth.getUser(token)  (every request, no cache)
  SA-->>A: authUserId or null -> 401 problem
  A->>R: requireHumanActorContext(principal, selection)
  R->>DB: memberships, roles, active context
  R-->>A: ActorContext {tenantId, organisationId, membership, roles} or personal context (q-api only)
  A->>Z: action.authorize(ports, ctx, input)
  Z-->>A: deny -> 404 (callNotFound) / allow
  A->>DB: repository SQL with explicit "where tenant_id = ctx.tenantId"
  Note over DB: RLS policies exist for role "authenticated" only.<br/>Service role "postgres" bypasses RLS and FORCE RLS.<br/>Isolation = application predicates.
```

```mermaid
flowchart LR
  subgraph TB1["Trust boundary 1 - browser"]
    COOKIE["Supabase session cookie\n(httpOnly)"]
    VTOK["x-q-voice-session sealed token\nAES-256-GCM, 4h TTL,\ncontains user's access token"]
    EPH["OpenAI Realtime ephemeral key\n(minted by q-api)"]
  end
  subgraph TB2["Trust boundary 2 - services"]
    BEARER["Bearer verified per request\n(Supabase getUser)"]
    ACTOR["ActorContext from DB\n(headers X-Tenant/Role never read)"]
    AUTHZ["authorize(): app-actions,\nQ tool registry, Context Firewall"]
    APPROVAL["Q approvals bound to\nproposed_payload_hash"]
  end
  subgraph TB3["Trust boundary 3 - database"]
    PGROLE["postgres role (BYPASSRLS)"]
    RLS["RLS + policies (authenticated)\nunused by services"]
    GRANTS["no anon grants; authenticated SELECT-only\non 80 tables; no writes"]
  end
  subgraph PCB["Provider callbacks"]
    SPEECH["Deepgram / ElevenLabs think callback\npresents sealed voice token"]
    HOOKS["Webhooks: Cloudflare, Stripe, Postmark,\nGmail Pub/Sub, Recall (shared secrets)"]
  end
  COOKIE --> BEARER --> ACTOR --> AUTHZ --> PGROLE
  VTOK --> SPEECH --> ACTOR
  APPROVAL --> AUTHZ
  HOOKS --> PGROLE
  RLS -.not on service path.- PGROLE
```

Key keys and secrets (names only): `SUPABASE_PUBLISHABLE_KEY` (token verification), `SUPABASE_SECRET_KEY` (storage, api/workers; also the HKDF input for voice tokens when present), `DATABASE_URL` (HKDF fallback input for voice tokens, `apps/q-api/src/main.ts:5111-5112`), `GOOGLE_TOKEN_ENCRYPTION_KEY` (OAuth tokens at rest), and webhook secrets.
