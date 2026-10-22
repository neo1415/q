# Fly.io + Vercel fallback deployment (Railway outage, 2026-10-22)

Railway (ADR 0014) paused all builds. This is the prepared move: **api, q-api and workers to Fly.io**, **apps/web to Vercel**. Nothing here has been deployed. No Fly or Vercel account call has been made. Names only in this file — never values.

Branch `deploy/fly`. It changes no Railway behaviour: Railway builds with Railpack and never reads the Dockerfile, `deploy/fly/*` or `apps/web/vercel.json`. The one source change, in `apps/web/next.config.ts`, only takes effect when `NEXT_OUTPUT_STANDALONE=1` is set, which only the Docker web target does.

## One command each

```bash
# 0. flyctl (once): curl -L https://fly.io/install.sh | sh   (or pass --install-flyctl)
# Env files: /root/.cq-secrets/fly/{api,q-api,workers,web}.env, exported from Railway (KEY="value").
export NODE_USE_ENV_PROXY=1            # cloud sandbox only: Node fetch through the proxy

node scripts/deploy/fly-deploy.mjs --dry-run      # plan, names only
FLY_API_TOKEN=... node scripts/deploy/fly-deploy.mjs [--web-origin https://<vercel-prod-domain>]

node scripts/deploy/vercel-deploy.mjs --dry-run
VERCEL_TOKEN=... node scripts/deploy/vercel-deploy.mjs [--team <id>] [--web-origin https://<vercel-prod-domain>]
```

- **Order:** Fly first, then Vercel. Either order works, because every address is computed up front.
- **Web origin:** both scripts default to `https://capital-q-web.vercel.app`. Vercel gives a project that domain only if the name is free. If `vercel-deploy.mjs` reports a different production domain, rerun **both** scripts with `--web-origin <that domain>`.
- **Flags:**
  - `fly-deploy.mjs`: `--only api,q-api,workers`, `--prefix`, `--org`, `--env-dir`, `--skip-secrets`.
  - `vercel-deploy.mjs`: `--project`, `--fly-prefix`, `--env-dir`.
  - Both: `--help`.
- **Web on Fly instead of Vercel:** `fly-deploy.mjs --only web` uses the `web` Docker target, and `CQ_WEB_ORIGIN` becomes `https://capital-q-web.fly.dev`. If you take this path, deploy api, q-api and workers again with `--web-origin https://capital-q-web.fly.dev`.

## What the scripts do to each env file

The rules live in one shared module, `scripts/deploy/env-plan.mjs`.

- **Dropped:**
  - every `RAILWAY_*` key;
  - `PORT`: each app takes the port its fly.toml sets (3001 api, 3002 q-api) or the one Vercel sets;
  - on Vercel only, `NODE_ENV`: Vercel sets it, and `production` during install would skip the devDependencies the build needs.
- **Rewritten to the new hosts:**

  | Key                                     | New value                         |
  | --------------------------------------- | --------------------------------- |
  | `CQ_WEB_ORIGIN`                         | the Vercel production origin      |
  | `CQ_API_URL`, `CQ_API_INTERNAL_URL`     | `https://capital-q-api.fly.dev`   |
  | `CQ_Q_API_URL`, `CQ_Q_API_INTERNAL_URL` | `https://capital-q-q-api.fly.dev` |
  | `API_PUBLIC_URL`                        | `https://capital-q-api.fly.dev`   |
  | `Q_API_PUBLIC_URL`                      | `https://capital-q-q-api.fly.dev` |

  Internal URLs become public https URLs. Three reasons:
  - Fly `.internal` addresses do not wake a stopped machine.
  - Vercel has no private network to Fly.
  - `packages/config` accepts a plain-http internal URL only on `*.railway.internal`.

- **Added when missing:** the addresses each app needs, per the table below. Added always, on q-api only: `RAILWAY_SERVICE__CAPITAL_Q_WEB_URL` = the web host with no scheme.
  - `apps/q-api/src/main.ts` reads this key for the web link in invite and meeting-recap emails. It is still read but no longer injected by any host.
  - **Flag for the lead:** this is the one exception to the "drop every `RAILWAY_*` key" rule. Without it, those emails carry no app link. The better fix is renaming the variable in the code, which is out of scope here.
- **Left exactly as exported:** `GOOGLE_WORKSPACE_REDIRECT_URI`, `GOOGLE_PUBSUB_PUSH_AUDIENCE` and every provider webhook setting. Update them by hand; see the table at the end.
- **How values travel:**
  - Fly: `flyctl secrets import --stage` reads them on stdin.
  - Vercel: they go in the HTTPS request body as encrypted variables.
  - Values never appear in argv or output. Each `--env-dir` must be outside the repository, and the scripts refuse a directory inside it.

## Hosts and cross-service URLs

| Service | Host                          | Address                                                     | Reads (cross-service)                                                                          |
| ------- | ----------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| web     | Vercel (fra1)                 | `https://capital-q-web.vercel.app` (or the assigned domain) | `CQ_WEB_ORIGIN`, `CQ_API_URL`, `CQ_Q_API_URL` (+ `*_INTERNAL_URL`)                             |
| api     | Fly `capital-q-api` (ams)     | `https://capital-q-api.fly.dev`                             | `CQ_WEB_ORIGIN`, `CQ_Q_API_URL`, `API_PUBLIC_URL`                                              |
| q-api   | Fly `capital-q-q-api` (ams)   | `https://capital-q-q-api.fly.dev`                           | `CQ_WEB_ORIGIN`, `CQ_API_URL`, `Q_API_PUBLIC_URL`, `RAILWAY_SERVICE__CAPITAL_Q_WEB_URL` (host) |
| workers | Fly `capital-q-workers` (ams) | none (no http service)                                      | `CQ_WEB_ORIGIN`                                                                                |

**Fly sizing** (cheapest; `deploy/fly/<service>.fly.toml`):

- All three services: `shared-cpu-1x`, no dedicated IPv4, no volumes, one machine (`--ha=false`).
- Memory: api 512 MB, q-api 1024 MB, workers 512 MB.
- **api and q-api:** `auto_stop_machines="stop"`, `min_machines_running=0`, with a check on `/health/ready`.
  - For a pitch day, set `min_machines_running = 1` and redeploy, so nothing cold-starts. Do it on q-api at least, because voice calls back into it.
- **workers:** no `http_service`, so Fly never auto-stops it.
  - Restart policy: `always`.
  - No process check exists: Fly machine checks are HTTP/TCP only, and workers listen on nothing. Watch it with `fly status` and `fly logs`.

**Vercel** (`apps/web/vercel.json` plus project settings sent by the script):

| Setting        | Value                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Root directory | `apps/web`                                                                                            |
| Node           | `24.x`                                                                                                |
| Install        | `cd ../.. && pnpm install --frozen-lockfile`                                                          |
| pnpm version   | 11.25.0 through `packageManager`, with `ENABLE_EXPERIMENTAL_COREPACK=1`                               |
| Build          | `cd ../.. && node node_modules/turbo/bin/turbo run build --filter=@capital-q/web... --env-mode=loose` |
| Region         | `fra1`                                                                                                |

## Env var checklist (names only)

`R` = the service refuses to start, or loses its core function, without it. Everything else is optional: the app logs what it disabled. Public = safe in a browser.

### web (Vercel)

- **R, public:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
  - `packages/config/src/web.ts` reads both server-side at runtime, so they must be runtime variables.
  - The Docker target also takes them as build args.
- **R:** `CQ_WEB_ORIGIN`. This is the auth callback origin, and it is required outside `local`.
- **R for real onboarding:** `CQ_API_URL`, `CQ_Q_API_URL`.
- **Optional:** `CQ_API_INTERNAL_URL`, `CQ_Q_API_INTERNAL_URL`, `CAPITAL_Q_ENV` (`staging`), `REGION`, `LOG_LEVEL`, `CQ_FOUNDER_ONBOARDING_ADAPTER`, `CQ_Q_PITCH_TOUR`, `CQ_Q_PITCH_SUBJECT_COMPANY_ID`, `CQ_VOICE_REALTIME`, `CQ_VOICE_PREVIEW`, `CQ_VOICE_PREVIEW_DEPLOYED`, `CQ_DEV_PREVIEW`, `CQ_REVIEW_PAGES`, `CQ_DESIGN_REVIEW`.

### api (Fly)

- **R:** `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (must be an `sb_secret_` key), `CQ_WEB_ORIGIN`.
- **Set in fly.toml:** `NODE_ENV`, `CAPITAL_Q_ENV`, `REGION`, `LOG_LEVEL`, `HOST`, `PORT`, `DATABASE_CONNECTION_MODE`.
- **Cross-service:** `CQ_Q_API_URL`, which the onboarding interviewer needs, and `API_PUBLIC_URL`, the GateQ video (Tavus) callback base.
- **Optional, by area:**
  - Database: `DATABASE_POOL_MAX`, `DATABASE_*_TIMEOUT*`.
  - Models: `GEMINI_API_KEY`, `GEMINI_API_KEY2`, `GROQ_API_KEY`, `GROQ_API_KEY_2..4`, `OPENAI_API_KEY`.
  - Google Workspace: `GOOGLE_WORKSPACE_CLIENT_ID`, `GOOGLE_WORKSPACE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_WORKSPACE_REDIRECT_URI`, `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_PUSH_AUDIENCE`, `GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT`.
  - Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SENDER`, `SMTP_API_KEY`, `BREVO_API_KEY`.
  - Inbound email: `POSTMARK_INBOUND_ADDRESS`, `INBOUND_EMAIL_WEBHOOK_SECRET`.
  - Video: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_STREAM_API_TOKEN`, `CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN`, `CLOUDFLARE_STREAM_SIGNING_KEY_ID`, `CLOUDFLARE_STREAM_SIGNING_KEY_PEM`, `CLOUDFLARE_STREAM_WEBHOOK_SECRET`.
  - Billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
  - GateQ video: `TAVUS_API_KEY`, `CQ_TAVUS_API_KEYS`, `CQ_GATEQ_VIDEO_*` (including `CQ_GATEQ_VIDEO_SEAL_KEY`).
  - GateQ contact and synthesis: `GATEQ_CONTACT_CODE_SECRET`, `GATEQ_CONTACT_REQUIRED_FROM`, `CQ_GATEQ_SYNTHESIS*`, `CQ_GATEQ_COVERAGE_SOURCES`.
  - Web push: `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`.
  - Documents and spend: `CQ_MALWARE_POLICY`, `CQ_DOCUMENT_UPLOAD_MAX_BYTES`, `CQ_MODEL_DAILY_SPEND_CAP_USD`.
  - Telemetry: `OTEL_EXPORTER_OTLP_ENDPOINT`, `CQ_TELEMETRY_EXPORT`.

### q-api (Fly)

- **R:** `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CQ_WEB_ORIGIN`, `CQ_API_URL`, `Q_API_PUBLIC_URL`. q-api reads `Q_API_PUBLIC_URL` as its own origin: voice think/ws, Recall and Tavus event URLs.
- **Recommended:** `SUPABASE_SECRET_KEY`, at least one model key.
- **Set in fly.toml:** as for api, plus `Q_VOICE_EXPRESSIVE`.
- **Optional, by area:**
  - Research: `TAVILY_API_KEY`, `SERP_API_KEY`, `SERPER_API_KEY`, `BRIGHT_DATA_API_KEY`, `BRIGHT_DATA_SERP_ZONE`, `BRIGHT_DATA_UNLOCKER_ZONE`, `SCRAPING_BEE_API`, `COMPANIES_HOUSE_API_KEY`, `SEC_EDGAR_USER_AGENT`.
  - Voice: `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_SPEECH_ENGINE_ID`, `ELEVENLABS_SPEECH_ENGINE_ID_MALE`, `Q_VOICE_PROVIDER`, `Q_PERSONALITY`, `CQ_VOICE_LIVE*`, `CQ_VOICE_REALTIME*`, `CQ_SPEECH_LINES_PER_10MIN`.
  - Meetings: `RECALL_API_KEY`/`RECALL_API`, `RECALL_REGION`, `RECALL_WEBHOOK_SECRET`, `RECALL_TRANSCRIBER`, `RECALL_SCREEN_VISION`, `RECALL_CAMERA_VISION`, `CQ_MEETING_*`, `MEETING_WAIT_MAX_MINUTES`.
  - Rehearsal video (Tavus): `TAVUS_API_KEY`, `CQ_TAVUS_*`, `CQ_REHEARSAL_VIDEO_INTERVIEWERS`.
  - Google Workspace and email: the same names as api.
  - Embeddings: `Q_EMBEDDING_*`.
  - Instructions and spend: `CQ_INSTRUCTIONS_AUTO`, `Q_WORKFORCE_MONTHLY_LIMIT_USD`, `CQ_UI_TRANSLATION_DAILY_CAP_USD`.
  - Documents: `CQ_DOCUMENT_IMAGES*`, `CQ_DOCUMENT_PIPELINE`.
  - Media: `PEXELS_API_KEY`/`PEXELS_API`.
  - Synthetic demo: `CQ_SYNTHETIC_DEMO_ROUTING`, `CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED`, `CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF`.

### workers (Fly)

- **R:** `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `CQ_WEB_ORIGIN` (links in the daily briefing and reminder emails).
- **Set in fly.toml:** `NODE_ENV`, `CAPITAL_Q_ENV`, `REGION`, `LOG_LEVEL`, `DATABASE_CONNECTION_MODE`, `CQ_MALWARE_POLICY=REQUIRE_CLEAN`.
- **Optional, by area:**
  - Models and research: the same keys as api and q-api.
  - Email and push: SMTP and web-push names.
  - Google Workspace: the same names as api.
  - Polling and batches: `OUTBOX_*`, `CQ_DOCUMENTS_*`.
  - Document parser: `CQ_PARSER_*`, `CQ_DOCUMENT_MAX_BYTES`, `CQ_PIPELINE_VERSION`.
  - Document images and critic: `CQ_DOCUMENT_IMAGES*`, `CQ_DOCUMENT_CRITIC`.
  - Daily briefing: `Q_DAILY_DISABLED`, `Q_DAILY_MAX_EDITIONS_PER_DAY`.
  - Embeddings and media: `Q_EMBEDDING_PROVIDER`, `PEXELS_API_KEY`/`PEXELS_API`.

## External places that hold the app's address — update after the move

The scripts do not touch any of these. Each one keeps pointing at Railway until someone changes it.

| Where                                                           | Key / setting                                                               | New value                                                                           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Supabase → Auth → URL Configuration                             | Site URL                                                                    | `https://capital-q-web.vercel.app` (the Vercel production origin)                   |
| Supabase → Auth → Redirect URLs                                 | allow-list                                                                  | add `https://capital-q-web.vercel.app/auth/callback` (keep Railway's until cutover) |
| Google Cloud → OAuth client (Workspace connector)               | Authorised redirect URI                                                     | `https://capital-q-api.fly.dev/v1/integrations/google/callback`                     |
| Fly secrets api, q-api, workers                                 | `GOOGLE_WORKSPACE_REDIRECT_URI`                                             | `https://capital-q-api.fly.dev/v1/integrations/google/callback`                     |
| Google Cloud → Pub/Sub push subscription (Gmail)                | Push endpoint                                                               | `https://capital-q-api.fly.dev/v1/integrations/google/gmail-push`                   |
| Fly secrets api, q-api, workers                                 | `GOOGLE_PUBSUB_PUSH_AUDIENCE`                                               | host becomes `capital-q-api.fly.dev`, matching the subscription's audience          |
| Supabase Auth → Google provider (if "Sign in with Google" used) | Google console redirect URI                                                 | unchanged (it is Supabase's own callback); only the Supabase allow-list above       |
| Postmark inbound stream                                         | Webhook URL                                                                 | `https://capital-q-api.fly.dev/v1/inbound/email/postmark`                           |
| Cloudflare Stream                                               | Webhook URL (`CLOUDFLARE_STREAM_WEBHOOK_SECRET` stays the same)             | `https://capital-q-api.fly.dev/v1/webhooks/cloudflare-stream`                       |
| Stripe dashboard (when billing is on)                           | Webhook endpoint                                                            | `https://capital-q-api.fly.dev/v1/webhooks/stripe`                                  |
| ElevenLabs Speech Engine                                        | ws URL; re-run `pnpm voice:setup -- --ws-url <url>`                         | `wss://capital-q-q-api.fly.dev/v1/q/voice/ws`                                       |
| Deepgram Voice Agent                                            | think URL (per session from `Q_API_PUBLIC_URL`)                             | automatic: `https://capital-q-q-api.fly.dev/v1/q/voice/think`                       |
| Recall.ai bots                                                  | meeting-host / meeting-screen URLs (per bot from `Q_API_PUBLIC_URL`)        | automatic; `RECALL_WEBHOOK_SECRET` unchanged                                        |
| Tavus                                                           | callback URLs (per conversation from `API_PUBLIC_URL` / `Q_API_PUBLIC_URL`) | automatic                                                                           |
| Email templates / links                                         | built from `CQ_WEB_ORIGIN`                                                  | automatic                                                                           |

## Container images (Fly)

- **Layout:** one root `Dockerfile` with targets `api`, `q-api`, `workers` and `web`.
  - Base image: `node:24.22.0-bookworm-slim`.
  - Runs as the non-root `node` user. Code is root-owned and read-only.
- **How the Node targets are built:**
  1. A full `pnpm install` and `turbo build --filter=@capital-q/<svc>...`.
  2. `scripts/deploy/docker-build-service.sh`, which:
     - reinstalls only that service's workspace closure with `--prod --offline`;
     - deletes other apps and every `src/`.
- **Two pnpm quirks the build works around:**
  - **Runtime imports of devDependencies.** Some packages import a workspace package at runtime but declare it only as a devDependency: model-gateway→q-tools, q-api→api-client, q-orchestrator→q-core. `scripts/deploy/workspace-closure.mjs link-dev` relinks those, and fails the build if an npm devDependency is imported at runtime. Railway never sees this because it installs the whole workspace. Declaring these properly is a follow-up.
  - **Default store location.** pnpm 11 re-verifies dependencies before each `pnpm run`. A store directory that differs between install and run makes every build task reinstall, so the default store is used throughout.
- **web target:** the Next.js standalone output (`NEXT_OUTPUT_STANDALONE=1`), running `node apps/web/server.js`.
