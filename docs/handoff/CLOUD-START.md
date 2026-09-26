---
title: Capital Q cloud start (single entry point for the cloud lead)
project: capital-q
date: 2026-09-26
tags: [handoff, cloud, lead, runbook]
---

# Capital Q: cloud start

You are the **cloud lead** for Capital Q. The founder moved the work from a Windows laptop to this Claude Code cloud session and expects you to continue **unsupervised**: build, test, deploy, and come back to a far-along product. This file is your entry point. Everything it points at is in the repo.

## 0. Budget and deadline first (founder rule, read before anything else)

- **$250 of Claude credit in total is the only hard ceiling. There is no daily cap: never stop or pause work because of a daily figure.** Pacing exists to remove waste, not to idle.
- **Hard deadline: Monday 2026-09-28 morning.** The whole product done, polished and deployed, with seeded videos. The priority-ordered **Monday definition of done is playbook section 0**, and the queue in section 8 below follows it exactly.
- **The founder is unavailable all of Sunday.** Run continuously and decide on your own inside the rules of `CLAUDE.md` and section 9. Actions that need the founder (hosted migration pushes, Railway variable changes, new accounts) must be settled before the founder leaves, or worked around (section 1).
- The verified cost model and settings are in **[`cloud-cost-playbook.md`](cloud-cost-playbook.md)**. Read it before spawning any agent. Its facts override anything generic here: the two 1-hour cache TTL variables, the **4 vCPU / 16 GB VM (so at most 2 workers building, testing or running a browser at once; up to 2 more doing read/write-only work)**, the setup-script cache (snapshotted only if it finishes in under ~5 minutes; kept about 7 days), and Opus 5.5 cache reads at $0.20/M.
- Short version of the habits:
  - Log `/usage` in `docs/handoff/research/ledger.md` morning, midday and evening. If the total trends toward $250 before the must-haves are done, cut waste and the bottom of the queue first; never the top.
  - Navigate with graphify first (section 4), then read only the file ranges you need.
  - `docs/handoff/transcripts/` is **grep only**. Never read a part end to end.
  - Targeted tests while working; full gates only before merging to the deploy branch.
  - Resume an agent (SendMessage) rather than re-spawn; never two agents on one topic; tight worker prompts naming exact files.
  - No sleep-polling. Use background commands and wait for the notification.
- **The founder's provider credits are off-limits** (OpenAI: a $5 top-up only; Gemini; ElevenLabs Creator plan, about 131k characters a month; Deepgram; Cloudflare Stream; Bright Data; Tavily; SerpAPI). Every provider key in every local process is a **non-empty disabled value** (`disabled-locally-000000000000`); an empty value lets a `.env.local` fill in a real key. Any live call needs a stated reason, the smallest possible size, your approval, and is reported with its cost. R19 narration is the one planned spend: generate each script once, cache the audio, and log the character count.

## 1. Founder one-time setup (checklist)

The founder does these in claude.ai/code environment settings before or at the switch. Check each one at session start and tell the founder in one line what is missing.

- [ ] **Environment variables** (from playbook §2), exactly:
      `CLAUDE_CODE_PROMPT_CACHE_TTL=1h`, `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL=1h`, `BASH_DEFAULT_TIMEOUT_MS=600000`, `BASH_MAX_TIMEOUT_MS=1200000`.
- [ ] **Secrets go in the environment's API credentials** (Pro/Max: proxy-injected, the session never sees the value), **never in environment variables** (anyone using the environment can read those). What the cloud lead needs there (section 5): `RAILWAY_TOKEN`, the hosted `DATABASE_URL` (session pooler) for read-only status checks, and `DATABASE_MIGRATION_URL` (direct connection) for founder-approved migration pushes. Provider keys are **not** needed in the cloud: Railway already holds them, and local work runs with disabled keys.
- [ ] **Railway token**: a Railway **project token** for project `Q` (so the lead can watch deploys and read logs). Railway variables are never changed without the founder.
- [ ] **GitHub access**: the cloud environment connected to the repo with push rights (the lead pushes `recovery/2026-09-12` and backup branches).
- [ ] **Network access**: github.com, the npm registry, PyPI (graphify), `*.supabase.co` and `*.pooler.supabase.com`, `*.railway.app` and `backboard.railway.app`, Docker Hub / `public.ecr.aws` (Supabase images). Full network access is simplest.
- [ ] **Monthly spend limit** at claude.ai → Settings → Usage (the hard cap behind the $250).
- [ ] **Sunday authority** (the founder is away all day): give the lead a standing yes, or a no, for hosted migration pushes on Sunday (always dry-run first, applied before the code that needs them, logged in the ledger). Without a standing yes, the lead merges only code that needs no new hosted migration and queues the rest for Monday morning. Railway variable changes stay founder-only.
- [ ] Before the switch, the **local lead pushes every in-flight branch** (section 7) to GitHub.

## 2. Read order (do not read more than this up front)

1. `CLAUDE.md` (repo root). Binding. The budget section is at its top.
2. This file.
3. `docs/handoff/cloud-cost-playbook.md`.
4. `docs/handoff/research/founder-requirements-2026-09-25.md` (R1–R31 plus the founder decisions). This is the product queue's source.
5. `docs/handoff/memory/MEMORY.md` (index of the local lead's persistent memory; open individual memory files only when a topic comes up).
6. The **last ~60 lines** of `docs/handoff/research/ledger.md` (chronological packet ledger; the older part is history).
7. `docs/handoff/CLAUDE-GLOBAL-NOTES.md` (the founder's global workflow rules adapted to the cloud: graphify, session logs).
8. On demand only: `docs/handoff/HANDOFF-2026-09-25.md` (the earlier handoff; its branch list and migration count are stale, this file supersedes them), `docs/handoff/research/business-research.md` (BIZ packet specs), `docs/handoff/research/acceptance-directive-2026-09-24.md` (A–K acceptance rules), `docs/handoff/setup-email-and-meetings.md`, `docs/handoff/fixtures/founder-hosted-transcripts-2026-09-24.md` (adversarial fixture), `docs/handoff/research/{q-intelligence-research,identity-media-investor-report,integrations-meetings-report,code-capability-map}.md`, `docs/handoff/transcripts/INDEX.md` (founder messages by time; grep only).

## 3. Your role

- You **coordinate workers** in isolated git worktrees. You do not do packet implementation yourself unless it is a small lead-owned fix.
- You **own the coordination-critical files**: `packages/contracts`, `supabase/migrations`, event names, permission constants, Q tool definitions, root package files. Workers may write them only when the packet needs it, and must label those commits `(lead-owned …, for review)`. You review each one.
- You **review and cherry-pick** worker commits onto **`recovery/2026-09-12`**, the deploy branch. Railway auto-deploys all four services (web, api, q-api, workers) from it on push.
- **Never merge `recovery/2026-09-12` into old agent branches, and never merge agent branches into recovery.** The local git pack corrupted on 2026-09-25 and old agent branches have broken merge bases (memory `git-pack-corruption-2026-09-25.md`). Cherry-pick only. **Workers branch from a recent recovery head.** A fresh cloud clone is clean.
- You **deploy** (push recovery), **apply hosted migrations first** when a packet needs them (founder-approved flow, section 10), **verify health** on Railway, and **keep GitHub backups**: push recovery after every merge, and keep `backup/…` branches current. Idle cloud VMs are reclaimed, so unpushed work is lost work.
- You write the ledger entry for each merge and each spend check, and a short session log at the end of each substantial session (section 11).
- You never force-push, reset or rebase shared history without the founder's explicit approval, and never commit secrets, `.env*` files, `graphify-out/` or vault content.

## 4. Environment bootstrap (fresh Linux cloud box)

**Setup script** (keep it under ~5 minutes so it is cached):

```bash
corepack enable
corepack prepare pnpm@11.25.0 --activate   # package.json "packageManager"
pnpm install --frozen-lockfile
pip install graphifyy                       # the PyPI name has two y's
npm i -g @railway/cli
```

- **Node 24** (`.nvmrc` is `24`; `engines` is `>=24 <25`). If the image has another major, install 24 with nvm first.
- **Supabase CLI** is a devDependency: use `pnpm exec supabase …` (or `npx supabase …`). Local stack: `pnpm db:start`, then `pnpm db:reset` to apply every migration and the seed. Pre-pulling the images inside the setup script may push it over 5 minutes; if so, start Supabase in the first task of the session instead.
- **gh**: use it for GitHub reads if installed; git push goes through the environment's GitHub connection.
- **Railway CLI** reads `RAILWAY_TOKEN` from the environment (project token). Service names: `@capital-q/web`, `@capital-q/api`, `@capital-q/q-api`, `@capital-q/workers`.

**Local configuration files** (gitignored, never commit):

- `.env.local` at the root: copy `.env.example`, point it at the **local** stack (values from `pnpm exec supabase status`: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `DATABASE_CONNECTION_MODE=direct`, `CAPITAL_Q_ENV=local`, `SUPABASE_URL=http://127.0.0.1:54321`, the local publishable and secret keys), and set **every provider key to `disabled-locally-000000000000`**: `OPENAI_API_KEY`, `OPEN_AI_API_KEY`, `GEMINI_API_KEY`, `GEMINI_API_KEY2`, `GROQ_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `TAVILY_API_KEY`, `BRIGHT_DATA_API_KEY`, `SERP_API_KEY`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_STREAM_API_TOKEN`. Deterministic tests use the fake model provider (`CQ_TEST_MODEL_PROVIDER`).
- `apps/web/.env.local`: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (local values), `CQ_API_URL=http://127.0.0.1:3001`, `CQ_Q_API_URL=http://127.0.0.1:3002`. Never a secret here.
- The Windows-only launch scripts (`pnpm demo:detached`, `demo:status`, `demo:stop` are PowerShell) do not apply. On Linux run services directly (`pnpm --filter @capital-q/api dev`, etc.) **without `--watch`** when testing (package builds otherwise cause restart storms that look like model failures), record each PID, and kill every one when done.

**If Docker is unavailable** (the playbook says the cloud VM has Docker; this is the fallback):

- These need a database and cannot run: `pnpm test:integration`, `pnpm test:db` / `pnpm test:rls` (pgTAP), `pnpm eval:taxonomy`, `pnpm db:types:check`, any local stack, e2e.
- These still run: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit, fake provider), `pnpm build`.
- **Never point tests or local stacks at the hosted database.** Hosted Supabase (`vcohxiqsmnkzxnvawgri`) is staging with synthetic data; it receives only migrations, through the founder-approved push in section 10. Verify DB-dependent behaviour by deploying to Railway and checking there, and say in the postflight which DB checks could not run.

**graphify** (the founder's global rule, details in `CLAUDE-GLOBAL-NOTES.md`):

- After install: `graphify update .` (AST only, no API cost) builds `graphify-out/graph.json`. Then `graphify query "<question>" --budget 1500`, `graphify explain "<node>"`, `graphify path "<A>" "<B>"`, `graphify affected "<node>"`.
- Re-run `graphify update .` after merges. Never run semantic (LLM) extraction over the whole repo.
- `graphify-out/` is not in the repo's `.gitignore` (the laptop used a global gitignore). **Add it to `.git/info/exclude`** in the clone and in every worktree's main repo; never edit the repo `.gitignore` for it and never commit it. `pnpm format:check` flags files under `graphify-out/`: that is not a failure (memory `format-check-graphify-out.md`).

## 5. Secrets and configuration: names only

Never copy values from any `.env.local` into the repo, a prompt or a log. The validated schemas are in `packages/config/src/*.ts`; the per-service deployment table is `docs/deployment/staging.md`.

| Variable                                                                                                                                                                                                                          | Read by                                  | Where it is set                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `CAPITAL_Q_ENV` (`staging` on Railway)                                                                                                                                                                                            | all                                      | Railway (set); local `.env.local` = `local`                                                      |
| `DATABASE_URL`, `DATABASE_CONNECTION_MODE`, `DATABASE_POOL_MAX`, `DATABASE_*_TIMEOUT_*`                                                                                                                                           | api, q-api, workers                      | Railway (set). Cloud: hosted pooler URL in API credentials, **only** for `scripts/handoff/*.mjs` |
| `DATABASE_PRIVILEGED_URL`, `DATABASE_MIGRATION_URL`                                                                                                                                                                               | privileged clients / `pnpm db:push`      | Migration URL (direct connection) in cloud API credentials for founder-approved pushes           |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`                                                                                                                                                                                        | api, q-api (workers: URL)                | Railway (set); local values from `supabase status`                                               |
| `SUPABASE_SECRET_KEY`                                                                                                                                                                                                             | api, workers                             | Railway (set); local value locally                                                               |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `CQ_WEB_ORIGIN`, `CQ_API_URL`, `CQ_Q_API_URL`, `CQ_FOUNDER_ONBOARDING_ADAPTER`                                                                                | web                                      | Railway web service (set); `apps/web/.env.local` locally                                         |
| `OPENAI_API_KEY`, `OPEN_AI_API_KEY`, `GEMINI_API_KEY`, `GEMINI_API_KEY2` / `GEMINI_API_KEY_2`, `GROQ_API_KEY*` (dropped from routing)                                                                                             | q-api (api/workers for some)             | Railway (set). Local: **disabled value**                                                         |
| `TAVILY_API_KEY`, `BRIGHT_DATA_API_KEY`, `BRIGHT_DATA_SERP_ZONE`, `BRIGHT_DATA_UNLOCKER_ZONE`, `SERP_API_KEY`                                                                                                                     | q-api                                    | Railway (set). Local: disabled                                                                   |
| `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_SPEECH_ENGINE_ID`, `ELEVENLABS_SPEECH_ENGINE_ID_MALE`, `Q_VOICE_PROVIDER`, `Q_VOICE_TTS_MODEL`, `Q_VOICE_EXPRESSIVE`, `Q_PERSONALITY`, `Q_API_PUBLIC_URL`                   | q-api                                    | Railway (set). Local: disabled keys                                                              |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_STREAM_API_TOKEN`, `CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN`, `CLOUDFLARE_STREAM_SIGNING_KEY_ID`, `CLOUDFLARE_STREAM_SIGNING_KEY_PEM`, `CLOUDFLARE_STREAM_WEBHOOK_SECRET` | api (media)                              | Railway (set). Local: disabled                                                                   |
| `CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED`, `CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF`                                                                                                                                                   | q-api only (ADR 0014 hosted attestation) | Railway q-api (set). **Never on workers**: it crashes them at startup                            |
| `CQ_SYNTHETIC_DEMO_ROUTING`                                                                                                                                                                                                       | q-api                                    | Local/test only; **never on Railway** (throws there by design)                                   |
| `CQ_MALWARE_POLICY`, `CQ_DOCUMENT*`, `CQ_PARSER_*`, `CQ_PIPELINE_VERSION`, `OUTBOX_*`                                                                                                                                             | workers / api                            | Defaults suit local; Railway set where needed                                                    |
| `Q_EMBEDDING_*`, `CQ_EMBEDDING_HOST_PORT`                                                                                                                                                                                         | q-api, workers                           | Local Docker only (founder decision: Railway is keyword retrieval only)                          |
| `Q_MCP_SERVER`                                                                                                                                                                                                                    | q-api                                    | Off by default                                                                                   |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`                                                                                                                                                       | local Supabase Auth only                 | Hosted Google sign-in is configured in the Supabase dashboard                                    |
| `RAILWAY_TOKEN`                                                                                                                                                                                                                   | Railway CLI                              | Cloud API credentials                                                                            |

Model policy for the demo (memory `demo-model-policy-openai-primary.md`): **OpenAI primary** (gpt-5.6-luna) for every task class, **Gemini fallback**, **no Groq**. Do not re-raise provider data-policy gating for the synthetic demo; launch needs reviewed providers.

## 6. Worker policy

- **Concurrency:** default 3, max 4 workers; **at most 2 heavy** (build, test, browser) at once on the 4 vCPU VM. eslint always runs alone: `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (add `--ignore-pattern ".claude/**"` if a worktree lives under `.claude/`).
- **Model:** every Agent call passes `model: "opus"` (Opus 5.5) at **medium effort**. Set model and effort once; never switch mid-session (cache).
- **Isolation:** each worker in its own worktree and branch, created from the **current recovery head**. Branch names: `<lane>/<packet>` (e.g. `ux/r24-q-page`).
- **Every worker prompt names:** `CLAUDE.md`; the requirement ids (R-numbers, BIZ-numbers); the ADRs (at least 0011 and 0016 for anything touching Q conversation, 0017 plus `docs/design/ux-direction-2026-09.md` for UI, ADR-001 vocabulary); the architecture docs by number and section; the exact files or directories to start from (use graphify to find them first); the tests to run; the done-criteria; and the report limit (≤ 60 lines: SHAs, exact check results, open questions).
- **Worker rules to paste into every prompt:** small commits, each ending with the attribution line; never push, merge or rebase; never touch hosted DB or Railway; contracts/migrations commits labelled `(lead-owned …, for review)`; every provider key set to the non-empty disabled value; kill every process it started (by recorded PID) before starting another and before finishing; no sleep-polling; tail/grep all command output; targeted tests only; no phrase lists or regex over user words (ADR 0011/0016).
- **One packet per worker.** When it finishes, it ends. Continue the same packet by resuming it (SendMessage); start a fresh small worker for a new packet.
- **Worker prompt skeleton:**

```text
You are <LANE>, a Capital Q worker. Worktree <path>, branch <lane>/<packet> from recovery <sha>.
Read first: CLAUDE.md; docs/handoff/research/founder-requirements-2026-09-25.md <R-ids>;
docs/adr/<ids>; docs/architecture/<doc> §<sections>; <exact files>. Use graphify before opening other files.
Goal: <one paragraph>. Done when: <observable criteria + tests>.
Rules: <the worker rules above>. Report (≤60 lines): commits (SHA + subject), checks run with exact results,
lead-owned files touched, open questions.
```

## 7. Current state (2026-09-26 evening)

- **Deploy branch:** `recovery/2026-09-12`. **Deployed on Railway: `e90d02a`.** Later commits on recovery are docs only (the R20–R31 requirements, the budget rule, the cost playbook, this handoff).
- **Live URLs** (Railway project `Q`, environment `production` running `CAPITAL_Q_ENV=staging`, region europe-west4, every service capped at 1 GB RAM / 2 vCPU):
  - web https://capital-qweb-production.up.railway.app
  - api https://capital-qapi-production.up.railway.app
  - q-api https://capital-qq-api-production.up.railway.app
  - workers: private, no public domain
- **Hosted DB:** Supabase `vcohxiqsmnkzxnvawgri` (eu-central-1), staging, synthetic data. **72/72 migrations applied** (matches `supabase/migrations` at `d6085ed`).
- **Backups on GitHub:** `backup/2026-09-25-integration`, `backup/2026-09-26-lead`. Older merged worker branches are on GitHub for reference only; do not merge them.
- **Branches in flight** (not yet merged; the local lead pushes them before the switch; fetch each and review with `git log recovery/2026-09-12..origin/<branch>`):

| Branch                 | Owner (lane) | What                                                                                                                                        | State at handoff                                                               |
| ---------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `seed/fictional-world` | SEED         | R29 seeded world: twelve invented companies, investors, onboarding, profiles, mandates, interests, claims, decks, manifest                  | 2 commits (runner + content), in progress; R19 videos not started              |
| `vid/founder-media`    | VID          | Founder Pitch & media page: every version, status, poster, captions, signed preview, withdraw; idempotent create/replace; one active player | 7 commits, near done; needs review of the schema-guard and idempotency changes |
| `e3/p0-1-cleanup`      | E3           | R20 capability registry + R21 screen context, then P0-1 deletion of the legacy interviewer                                                  | 1 commit (a run's own action is never filed as a document)                     |
| `vn3/voice-stutter`    | VN3          | R22 voice stutter                                                                                                                           | branch created at `d6085ed`, no commits yet                                    |
| `docs/cloud-handoff`   | DOCS         | this handoff                                                                                                                                | merge onto recovery (docs only)                                                |

## 8. The queue: the Monday definition of done, in order

This is playbook section 0, in the same order, with the state at handoff. Finish higher items first and **deploy each item as it lands**, so Monday shows the best achievable product even if the bottom is unfinished. Labels: **NOT STARTED**, **PARTLY BUILT**, **DONE-NOT-DEPLOYED**, **LIVE**.

1. **Voice speaks smoothly (R22)**, lane VN3. No stutter ("like a game at 2 fps" today), answers aloud every time. Gapless audio scheduling, buffering, chunk sizes, sentence streaming. Start in the web voice playback and the q-api speak relay (`apps/q-api/src/voice/`); measure with `scripts/voice-timings.mjs` over `railway logs --service @capital-q/q-api --json`. **NOT STARTED** (branch `vn3/voice-stutter` exists with no commits).
2. **Q can do anything the app can (R20) and Q knows the screen (R21)**, lane E3. One code-built registry of every app action (navigation to every screen, profile edits, visibility, handles and Q Card, PDF/PPTX documents, media, research, relationships), each with its typed tool, authorize step and approval class; Q consults it on every typed or voice turn and calls the tool straight away. BIZ-010 capability parity is folded in here. R21: structured app state (route, entities on screen, selection, open document or pitch plus position) sent with each turn through the Context Firewall, not screenshots. Live bugs to close: "edit my profile" told to Q does nothing; "make a Q card" produced a brief. **PARTLY BUILT**: the capability manifest with claims only from receipts (`932e8a0`) and the pitch viewing moment (R18) are LIVE; the registry, the parity test and general screen context are not built; `e3/p0-1-cleanup` holds one fix commit.
3. **Investor research-first onboarding (BIZ-009, R13)**, founder moved this up on 2026-09-26. BIZ-009 / R13 investor research-first onboarding (public sources at I0: website, SEC, Companies House, declared links; findings as `recommend` items with provenance; confirm; finish faster). **NOT STARTED.** Companies House key and SEC User-Agent contact come from the founder; without them, use the website and declared links only.
4. **Minimal Home Q page and product UI (R23, R24)**, UI lane. Side bars collapsed by default; Q presence visible without scrolling; the Board opens only on its icon or when a file is made, files open in a big closable modal; no evidence, fact, gap or truth-label clutter in chats (answer first, Sources on tap; record an ADR that progressive disclosure keeps the evidence invariants); theme as one dropdown icon (light/dark/system); voice options behind an icon; Mute and End inside the input; scope chip out of the input; remove the left bar's separate chat icon (Conversations stays); Q motion setting to profile, then Settings. **NOT STARTED.** (The Stage + Board page it reshapes is LIVE.)
5. **Seeded world (R29, R19)**, lane SEED. About 12 fictional companies with stories, decks AND narrated deck videos published as pitches; about 8 investors. Discover shows them full height, centred, with icon action buttons. R19 narrated deck video: slides + Q-written script + ElevenLabs narration → MP4 → published pitch, labelled "AI-narrated"; voice cloning only with explicit consent. **R29 PARTLY BUILT** (`seed/fictional-world`: content types, twelve companies and the runner, 2 commits, not merged). **R19 NOT STARTED.** Discover layout tweaks **NOT STARTED** (the TikTok-style Discover itself, UX-05, is LIVE).
6. **Profile shows everything from onboarding (R25); Settings page (R28); Relationships page (R27).** R25: every onboarding answer (investor mandate, sectors, stages, geographies, cheque sizes, thesis; founder company data) on the profile, editable, minimal; BIZ-002's editable profile is LIVE and is the base. **R25 PARTLY BUILT, R28 NOT STARTED, R27 NOT STARTED** (relationship screens exist but not as a top-level page).
7. **Q Card and public `/@handle` page redesign (R26); founder Pitch & media page (VID).** BIZ-004 handles, Q Card, `/@handle`, QR, vCard are LIVE; the redesign is **NOT STARTED**. VID (`vid/founder-media`, 7 commits: every pitch version with status, poster, captions, signed preview, withdraw; idempotent create/replace; one active player) is **PARTLY BUILT**, near done; review, merge and it becomes DONE-NOT-DEPLOYED, then LIVE on push.
8. **Journey audit fixes (R30)** for founder and investor, end to end on the deployed site. **NOT STARTED.**
9. **Then, in order:**
   - BIZ-005 / R7 brand kit (versioned brand kits, extraction from website and deck as recommendations, confirm UI, `BRAND` deck theme with a contrast guard). **NOT STARTED.**
   - BIZ-006 / R12 `/ops` operator console (`platform_operator` principal with step-up, verification queue, company acceptance). **NOT STARTED.**
   - UX-01 instant shell. Needs a static-shell security ADR first (what may render before auth). **NOT STARTED.**

**Out of scope unless the founder provides accounts:** BIZ-007 Gmail and BIZ-008 meetings/reminders (R9, R11). See `setup-email-and-meetings.md`. **NOT STARTED.**
**Dropped (do not build):** filtering out speech from a nearby video (speaker filtering), founder decision 2026-09-26.
**Later, only if everything above is LIVE:** UX-08 onboarding inside the Q page; R16/BIZ-011 continuous Q-intelligence loop (scripted checks, no live-model sweeps); R2 media creation (BIZ-102); R3 report and edit-history exports (BIZ-103); R10 in-app messaging (COMM-001); GateQ guest upload (blocked on an Evidence authority decision, memory `gateq-intake-state.md`); final reduced Wave-10 gate items beyond the walkthrough.

**Already LIVE (deployed at `e90d02a`, for reference):** BIZ-001 PDF/PPTX export for every artifact type (R1); BIZ-002 editable enriched profile (R4); BIZ-003 visibility control centre (R8); BIZ-004 handles + Q Card + `/@handle` (R5, R6); UX-04 Stage + Board Q page; UX-05 TikTok-style Discover with tiered preload; R18 Q watches the pitch (transcripts, captions, `get_pitch_moment`); relationship as a Q subject for either party; Wave 8 Express Interest, acceptance and relationship projection; onboarding as one tool-calling Q run (ADR 0016, M1–M5) plus the QX-008 gap fixes.

## 9. Standing directives and decisions (binding)

- **No patching, no word lists** (ADR 0011, ADR 0016; memories `adr-0011-no-word-lists.md`, `no-patching-architecture-first.md`). Every conversational failure maps to a missing general capability in planning, state, tool semantics, validation or persistence. Never phrase lists, regex over user words, or step-specific branches. Prompts state concepts, never quoted user wordings. Test **properties** with unseen paraphrases; transcripts are fixtures, passing them is not enough. Stop any worker that drifts into phrase lists.
- **Q-intelligence freeze:** no new Q-intelligence rework except bugs and capability work (R20/R21 are capability work).
- **Design:** ADR 0017 and `docs/design/ux-direction-2026-09.md` override conflicting prohibitions in CLAUDE.md: futuristic glow on Q only (Q Aperture), floating draggable Q Dock plus the Q page, Stage + Board, no ChatGPT-style chat UI, TikTok-style Discover, a visible light/dark/system switch. Every other prohibition holds. R23/R24 raise the minimalism bar further.
- **Founder decisions:** **C1** amend PADL #64 to "Ask Q aloud" (silent by default in meetings, speaks briefly only when explicitly asked, announces itself as AI); **C5** keep the existing Bright Data LinkedIn lookup (risk noted); **C9** email replies via Gmail `users.watch` + Pub/Sub with the Google app in Testing mode for the demo (CASA before real users); **C11** the business card is called "Q Card".
- **Embeddings local-only:** semantic search runs on local Docker only; Railway is keyword retrieval (the 1 GB cap cannot run the embedding runtime).
- **Deploy often** so the founder can test: build all four deployables first (`pnpm deploy:build:web` etc. or `turbo run build --filter=@capital-q/{web,api,q-api,workers}...`), then push recovery.
- **Commit and push discipline:** small commits; after each merge push recovery, fetch, confirm local HEAD equals the remote head, and record both SHAs (CLAUDE.md Git Continuity). If a push fails, report `IMPLEMENTED BUT REMOTE BACKUP BLOCKED` and stop there.
- **Hosted DB:** the founder approves hosted migration pushes. Dry-run first, apply **before** pushing code that needs the migration. Never `supabase db reset` against hosted; never read hosted user rows; never use hosted for tests.
- **Railway variables:** never change them without the founder. Never set `CQ_SYNTHETIC_DEMO_ROUTING` on Railway; never give workers the synthetic attestation variables.
- **No ngrok** (Railway's q-api domain is `Q_API_PUBLIC_URL`). **No `db reset`** on any shared database. **No `git gc`** on the laptop repo (does not apply to a fresh cloud clone).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## 10. Verification recipe

**Gates** (sequential, nothing else heavy running):

```bash
pnpm format:check                                   # warnings only under graphify-out/ are not failures
NODE_OPTIONS=--max-old-space-size=8192 pnpm lint    # alone
pnpm typecheck
pnpm test                                           # unit, fake provider
pnpm build                                          # or the four deploy:build:* scripts
pnpm test:integration                               # needs local Supabase (pnpm db:reset first); on a reset DB any failure is a regression
```

- While working, run only the touched test files (`pnpm vitest run <files>`). Full gates only before merging to recovery.
- "Failed to start forks worker" means those files never ran (vitest's fixed 60 s start timeout under load), not that they failed: rerun them directly (memory `vitest-worker-start-timeout.md`).
- CI (`.github/workflows/ci.yml`) runs only on pull requests and `main`, not on recovery pushes: your gates are the gate.

**Hosted migrations** (read-only check, then the founder-approved push):

```bash
DATABASE_URL="$HOSTED_POOLER_URL" node scripts/handoff/hosted-migrations-status.mjs   # exit 0 = up to date
pnpm exec supabase db push --db-url "$DATABASE_MIGRATION_URL" --dry-run               # show the founder
pnpm exec supabase db push --db-url "$DATABASE_MIGRATION_URL"                         # only after the founder says yes
```

The URL needs `?sslmode=require` for the CLI (memory `hosted-supabase-state.md`). `scripts/db-push.mjs` (`pnpm db:push`) wraps the same and refuses a local URL. `scripts/handoff/recent-artifacts.mjs` lists the latest hosted artifacts (id, type, status, time) to prove a "make me a PDF" turn really produced one.

**Deploy and health:**

```bash
git push origin recovery/2026-09-12 && git fetch origin && git rev-parse HEAD origin/recovery/2026-09-12
railway status
railway logs --service @capital-q/q-api | tail -n 40      # repeat per service; grep, never dump
curl -s https://capital-qapi-production.up.railway.app/health/ready
curl -s https://capital-qq-api-production.up.railway.app/health/ready
curl -sI https://capital-qweb-production.up.railway.app | head -n 5   # expect 307 to sign-in
```

"Deployed" on Railway is not health: `/health/ready` must answer with the right `service` name. Workers have no listener; they are healthy when RUNNING and the log shows the outbox and document loops started. Silent Q on Railway with no think failure means the speak relay upstream (ElevenLabs quota or key): check `railway logs` for `speak relay` before touching code (memory `railway-elevenlabs-key-mismatch.md`).

## 11. Session hygiene

- Ledger (`docs/handoff/research/ledger.md`): one dated line per merge, deploy, founder decision and spend check.
- Session logs go in `docs/handoff/logs/YYYY-MM-DD-<topic>.md` (template in `CLAUDE-GLOBAL-NOTES.md`), under 40 lines. Durable decisions go in the ledger or an ADR, not only in a log.
- Memory: the cloud has no `~/.claude` memory from the laptop. `docs/handoff/memory/` is the copy; add new durable lessons there as files and to its `MEMORY.md` index.
- Run `/compact` after each merge-and-deploy cycle with the current queue, open branches and pending decisions as focus.
