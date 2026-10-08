# Pre-production voice testing at $0 (RECOVERY-2026-10)

Founder rules:

- Real microphone and OpenAI Realtime tests run **before production**, never with production data or a production deploy.
- The additional budget is **$0**: no new OpenAI project or key, no new Supabase project, no paid service.
- Agents make **no billable live calls**. Only the founder runs microphone tests, on his own machine, with the configuration he already has.

No secret value appears in this file. The steps below never print, copy or paste one.

## (a) Local full stack on the founder's machine

The browser treats `http://localhost` as a secure context, so the microphone and WebRTC work locally without HTTPS. The database is the local Supabase stack, so nothing touches hosted data.

**Billing note.** Realtime minutes are billed to the founder's existing OpenAI account by the key already in his `.env.local`. That is the founder's own spend, bounded by the caps in step 3. An agent never runs this.

### Steps

1. **Prerequisites.** Node 24, pnpm (via `corepack enable`), and Docker Desktop running.
2. **Local database** (no hosted access):
   ```bash
   pnpm install --frozen-lockfile
   pnpm db:start                         # local Supabase in Docker
   npx supabase migration up --local     # all repo migrations, local only
   pnpm seed:fictional                   # fictional founders and investors
   ```
3. **Configuration: reuse, don't copy.** The services read the repository-root `.env.local` (`scripts/dev-env.mjs` loads it and logs only that it exists), and the web app reads `apps/web/.env.local`. Both are gitignored and already on the founder's machine. Check that they point at the **local** stack, not hosted, without printing values:
   ```bash
   grep -c '127.0.0.1:54322' .env.local     # expect 1 or more: DATABASE_URL is local
   grep -c 'supabase.co' .env.local         # expect 0: no hosted Supabase URL or key
   grep -c '^OPENAI_API_KEY=' .env.local    # expect 1: the existing key is present
   ```
   If the second count is not 0, the file points at hosted data. Stop and fix the file (local values come from `npx supabase status`) before going further.
4. **Turn the voice line on with tight caps.** Shell variables override the file, so the caps apply to this session only and nothing is edited:
   ```bash
   export CQ_VOICE_REALTIME=on
   export CQ_VOICE_REALTIME_DAILY_CAP_USD=0.50       # duplex hard stop per day (bound 0-20)
   export CQ_VOICE_REALTIME_MAX_SESSION_SECONDS=300  # one line lasts at most 5 minutes
   export CQ_MODEL_DAILY_SPEND_CAP_USD=1             # aggregate text cap (F5)
   export GEMINI_API_KEY=disabled-locally-000000000000
   export GROQ_API_KEY=disabled-locally-000000000000
   export ELEVENLABS_API_KEY=disabled-locally-000000000000
   export DEEPGRAM_API_KEY=disabled-locally-000000000000
   ```
   The `disabled-…` values are non-empty on purpose: an empty value would let `.env.local` supply the real key.
5. **Run:** `pnpm dev`. Open `http://localhost:3000`, sign in as a seeded fictional founder, and allow the microphone.
6. **Scenarios:** SPEC §5 E (continuous voice across pages, interrupt, correct, continue), G (voice → text → voice), and the voice parts of H (deny the microphone, go offline mid-turn, reload during playback). Keep each line under 5 minutes.
7. **Evidence and spend.** After the session, read the session's realtime cost from the local ledger (the local database only; this costs nothing):
   ```bash
   docker exec supabase_db_capital-q psql -U postgres -Atc \
     "select count(*), coalesce(sum(cost_usd),0) from ai_ops.model_usage where purpose = 'VOICE_REALTIME' and occurred_at > now() - interval '1 day'"
   ```
   Compare it with the OpenAI usage page: duplex usage is reported by the browser (audit F-R3). Record both in `docs/handoff/research/ledger.md`.
8. **Stop:** Ctrl-C, then `pnpm db:stop`.

### What this cannot show

It runs on one machine and one browser. It cannot reproduce a Railway deploy or restart dropping an in-memory voice line (DEF-A5), nor the hosted network path. Those are checked after a founder-approved deploy, briefly.

## (b) A Railway staging environment at $0: not possible under these rules

Railway itself could host a second environment in project `Q` at no extra charge only while the project's total usage stays inside what the current plan already includes. Railway has no free tier beyond the plan. Four more services, even idle, add usage that is not guaranteed to stay inside it.

The blocker is the database, not Railway:

- Staging must not use the production `DATABASE_URL`. That is the whole point of staging, and the services run as a role that bypasses RLS (ADR 0065).
- A second Supabase project is ruled out by the $0 / no-new-project decision. Supabase's free plan would cost $0, but it is a new project.
- The founder's local database is not reachable from Railway.

So a private Railway staging environment is **not available at $0** today. If the founder later allows one free Supabase project, the path is:

1. **[founder]** create the project;
2. **[script]** `npx supabase link` and `db push`;
3. **[founder]** in Railway, New Environment `staging` (duplicate `production`), branch `recovery/2026-09-12-8y2j4w`, "Wait for CI" on;
4. **[script]** replace every copied secret, set `CAPITAL_Q_ENV=staging`, and delete every provider secret staging does not need;
5. **[founder]** stop the staging services between sessions, so usage stays near zero.

## Guard rails already in code

- **Duplex voice.** Off unless `CQ_VOICE_REALTIME=on`. The daily cap defaults to $1 with a hard bound of $20, and a typo falls back to the default (`apps/q-api/src/voice/duplex/config.ts:45-92`).
- **Text and images.** The aggregate daily cap `CQ_MODEL_DAILY_SPEND_CAP_USD` (F5). Past it, a request fails with `BUDGET_EXCEEDED` (Q failure class `BUDGET`).
- **Tests.** No test makes a live provider call; keys are `disabled-locally-000000000000`.
