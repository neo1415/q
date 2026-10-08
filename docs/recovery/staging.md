# Private staging for real voice tests (RECOVERY-2026-10)

Founder rule: real microphone and OpenAI Realtime tests run **locally or on private staging, before production**. They run on a small approved budget and **never with production credentials**. This page gives the cheapest path, in two tiers. Each step is marked:

- **[script]**: Claude or the lead can run it, given the named token.
- **[founder]**: needs the founder's account, a click in a dashboard, or a payment decision.

No secret value goes in this file, in the repository, or in a chat.

## What is shared and what must not be

| Thing                                 | Production today                                                    | Staging must have                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Railway                               | project `Q`, environment `production`, branch `recovery/2026-09-12` | its own **environment** in the same project, branch `recovery/2026-09-12-8y2j4w`, its own variables         |
| Database                              | hosted Supabase `vcohxiqsmnkzxnvawgri`                              | a **separate Supabase project**, or the local stack. Never the production `DATABASE_URL`.                   |
| Supabase Auth                         | production project's users                                          | the staging project's own users (seeded test accounts)                                                      |
| OpenAI                                | the production key                                                  | a **separate OpenAI project** with its own key and a hard monthly cap                                       |
| Gemini / Groq / ElevenLabs / Deepgram | production keys                                                     | unset, or `disabled-locally-000000000000`, unless a test needs them and the founder approves a separate key |

## Tier 0: local (cheapest; no new hosting)

The browser treats `http://localhost` as a secure context, so the microphone and WebRTC work locally without HTTPS. This tier costs only Realtime minutes.

1. **[founder]** Create the low-cap OpenAI project key (see "The OpenAI key" below).
2. **[script]** Start the local stack and apply migrations: `pnpm db:start`, then `npx supabase migration up --local`, then `pnpm seed:fictional`.
3. **[founder]** Put the staging key in your own shell or an untracked `.env.local`, never in the repo: `OPENAI_API_KEY=<staging project key>`. Set every other provider key to `disabled-locally-000000000000`.
4. **[script]** Enable the line with its caps: `CQ_VOICE_REALTIME=on`, `CQ_VOICE_REALTIME_DAILY_CAP_USD=1`, `CQ_VOICE_REALTIME_MAX_SESSION_SECONDS=300`, and the aggregate text cap `CQ_MODEL_DAILY_SPEND_CAP_USD=2` (workstream F, F5).
5. **[script]** Start the services with `pnpm dev`, sign in as a seeded founder, and run the voice scenarios (SPEC §5 E, G, H). G's harness records the evidence under `docs/recovery/evidence/`.

**Limits.** This tier tests only one machine and one browser. It cannot show a Railway deploy or restart dropping an in-memory voice line (DEF-A5), and it does not use the hosted network path.

## Tier 1: private staging on Railway

### 1. The database (choose one)

- **A. A second Supabase project (recommended).** The free plan allows two active projects per organisation; a free project pauses after a week of inactivity and is restored from the dashboard.
  1. **[founder]** supabase.com → New project → name `capital-q-staging`, region `eu-central-1` (same as production), a generated database password. Note the project ref.
  2. **[founder]** Create a personal access token (Account → Access Tokens), or reuse the one the lead has. Give the lead the project ref, not the password.
  3. **[script]** `npx supabase link --project-ref <staging-ref>`, then `node scripts/db-push.mjs` (or `npx supabase db push --include-all`). This applies all 178+ migrations to the empty project. Then `pnpm seed:fictional` against the staging `DATABASE_URL`.
  4. **[founder]** Auth → URL configuration: set the site URL and redirect URLs to the staging web domain from step 2.4.
- **B. No hosted database.** Run voice tests in Tier 0 only. Tier 1 needs a database the Railway services can reach.

Supabase branching (a preview branch of the production project) needs a paid plan and shares the production organisation's billing. It is not needed here.

### 2. The Railway environment

1. **[founder]** Railway → project `Q` → Environments → **New Environment** → name `staging` → **Duplicate** `production`. (CLI equivalent, **[script]** with the founder's token: `railway environment new staging --duplicate production`.) Duplicating copies services and variable _names_; replace every secret below.
2. **[founder]** For each of the four services in `staging`: Settings → Source → branch `recovery/2026-09-12-8y2j4w`, and turn **Wait for CI** on.
3. **[script]** Set the variables per service (`railway variable set NAME --stdin --service <svc> --environment staging`, value from stdin):
   - `DATABASE_URL` = the staging project's session pooler URL (the founder pastes it; it never passes through chat);
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (api, q-api, workers) and `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (web; these are build-time, so redeploy web after setting them) = the staging project's;
   - `OPENAI_API_KEY` = the staging project key, on q-api, api and workers only;
   - `CAPITAL_Q_ENV=staging`, `CQ_VOICE_REALTIME=on`, `CQ_VOICE_REALTIME_DAILY_CAP_USD=1`, `CQ_VOICE_REALTIME_MAX_SESSION_SECONDS=300`, `CQ_MODEL_DAILY_SPEND_CAP_USD=2`;
   - **delete** `GEMINI_API_KEY*`, `GROQ_API_KEY*`, and every Stripe, Recall, Google Workspace, SMTP/Brevo, Postmark, Web Push and Cloudflare secret the duplicate copied, unless a staged test needs one and the founder approves a separate credential. A duplicated production secret in staging is exactly what this page exists to prevent.
4. **[founder]** Settings → Networking: generate Railway domains for web, api and q-api in `staging`. Leave workers private. Put the web domain into the staging Supabase Auth redirect URLs (step 1.A.4).
5. **[founder]** Keep it private. The staging web domain is unguessable but public. Either add the founder's and testers' emails as the only seeded accounts (no open sign-up in the staging Supabase project: Auth → Providers → Email → disable sign-ups after seeding), or put Railway's private networking plus a password gate in front of web. The first option is enough for test data that is entirely fictional.
6. **[script]** Smoke: `curl https://<staging-q-api>/health/ready` must return 200 with `checks.database = "OK"` (F4, once the lead wires the probe). Then run G's scenarios against the staging web domain.

**Cost.** Railway charges usage for each running service. Four small services idle cost a few dollars a month. **[founder]** Stop the environment's services between test sessions (each service's ⋮ menu → Stop, or remove the deploy) to keep it near zero. Supabase free costs nothing.

## The OpenAI key (both tiers)

1. **[founder]** platform.openai.com → Settings → **Projects** → Create project `capital-q-staging`.
2. **[founder]** That project → **Limits**: set the monthly budget (for example $10). Allow only the models the tests use: the realtime model (`gpt-realtime-mini`), its transcription model, and `gpt-5.6-luna` for text.
3. **[founder]** For a cap that cannot be exceeded, use prepaid credits with **auto-recharge off**: requests stop when the balance is spent. A budget alone may only alert, depending on the account's billing mode; check the Limits page's wording.
4. **[founder]** API keys → create a **restricted** key in that project, with permissions only for Model capabilities / Realtime. Hand it over only by pasting it into Railway or a local untracked env file.
5. **[script]** Every live run is logged in `docs/handoff/research/ledger.md` with its purpose, duration and the `ai_ops.model_usage` sum for the run (duplex rows are `purpose = 'VOICE_REALTIME'`). Duplex usage is reported by the browser (audit F-R3), so compare it with the OpenAI project's usage page after each session.

## Guard rails already in code

- Duplex: off unless `CQ_VOICE_REALTIME=on`; daily cap with default $1 and hard bound $20 (`apps/q-api/src/voice/duplex/config.ts:45-92`).
- Text and images: the aggregate daily cap `CQ_MODEL_DAILY_SPEND_CAP_USD` (F5). A request past it fails with `BUDGET_EXCEEDED` (Q failure class `BUDGET`).
- `CQ_SYNTHETIC_DEMO_ROUTING` stays unset on Railway (`.railway/railway.ts`), so a staging deploy never claims to be a demo.
