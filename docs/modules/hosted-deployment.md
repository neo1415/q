# Hosted deployment: Supabase, Render, Vercel

What it takes to run what exists today outside this machine, in the order it
has to happen. Nothing here changes the architecture: hosting is ADR 0001's
(Render for the Node services, Vercel for the web app) and the data store is
Supabase, as everywhere else in the documents.

## 1. The hosted Supabase project

The project already exists (`SUPABASE_URL` in `.env.local` names it) and has
Google enabled in its dashboard. Three things remain.

**Connection strings.** From the dashboard's Connect panel, put in
`.env.local`:

| Variable                 | Which string                                  |
| ------------------------ | --------------------------------------------- |
| `DATABASE_URL`           | Session pooler (port 5432 on the pooler host) |
| `DATABASE_MIGRATION_URL` | Direct connection, with the database password |

Both carry the password. Neither is ever printed, committed or handed to a
browser.

**Migrations.** Then:

```bash
pnpm db:push --dry-run
```

lists what would be applied, and

```bash
pnpm db:push
```

applies every file under `supabase/migrations` that the project has not seen.
The extensions those migrations create (`vector`, `pg_trgm`, `btree_gist`,
`pgmq`) are all available on hosted Supabase. `supabase/seed.sql` is not
applied: what a deployment needs (capabilities, taxonomy, model policy) is in
the migrations themselves.

**Google sign-in.** The provider is configured in the hosted dashboard, not
in `supabase/config.toml`. The Google Cloud OAuth client must list the
project's callback, `https://<ref>.supabase.co/auth/v1/callback`, as an
authorised redirect URI. For the local stack the same client must also list
`http://127.0.0.1:54321/auth/v1/callback`; `pnpm demo` exports the client id
and secret to the local Auth server when it starts the database.

**One Supabase per run.** `SUPABASE_URL` (api, q-api, workers),
`NEXT_PUBLIC_SUPABASE_URL` (apps/web) and `DATABASE_URL` must all name the
same project or all name the local stack. `pnpm demo` checks and refuses a
mix; `pnpm demo --local` runs everything against the local stack whatever
the files say, without editing them.

## 2. The embedding runtime

Chunks are embedded under one open-weight model on a runtime Capital Q
operates, and a query must be embedded under the same one. The runtime holds
confidential document text while it embeds it, so configuration refuses any
`Q_EMBEDDING_BASE_URL` that is not loopback, a private address or a
single-label internal host. `render.yaml` therefore runs Text Embeddings
Inference as a Render **private service** (`capital-q-embeddings`, no public
URL) and points q-api and workers at `http://capital-q-embeddings:8080`. The
model weights live on a persistent disk so a deploy does not download them
again. A hosted embedding API is not a drop-in alternative: it would move
document text off Capital Q's infrastructure and change the vector space
every chunk was indexed in.

## 3. Render

`render.yaml` at the repository root is a Render Blueprint: `capital-q-api`
and `capital-q-q-api` as web services with `/health/ready` checks,
`capital-q-workers` as a background worker, and the embedding runtime above,
all in Frankfurt. Every secret is `sync: false` and is entered once in the
dashboard under the exact name `packages/config` reads. Build commands use
turbo's `...` filter so each service builds only what it depends on.

`Q_API_PUBLIC_URL` is q-api's own public origin; enter it after the first
deploy. `CQ_API_URL` on q-api is the application API's private address.

`CQ_MALWARE_POLICY` must be `REQUIRE_CLEAN` in every hosted environment, and
no scanner is composed yet, so document processing waits on one; uploads are
accepted and held, not parsed.

## 4. Vercel

Import the repository with the root directory set to `apps/web`. Environment:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`CQ_WEB_ORIGIN` (the deployment's own origin), `CQ_API_URL` and
`CQ_Q_API_URL` (the two Render public URLs), `CAPITAL_Q_ENV=production`.

## 5. Voice

The Deepgram think route needs q-api reachable at `Q_API_PUBLIC_URL`; on
Render that is the service's own URL and no tunnel is involved. The
ElevenLabs Speech Engines, if used, are re-pointed once with
`pnpm voice:setup -- --ws-url wss://<q-api host>/v1/q/voice/ws`.

## Not yet done

- The connection strings in §1 are the one input only the project owner has.
- A malware scanner for document processing.
- A CI job that runs `pnpm db:push --dry-run` against the hosted project and
  fails when a migration is missing.
