# START HERE — Capital Q shared engineering handoff (Claude Code ⇄ Codex)

**Purpose:** any coding agent (Codex, Claude Code on any account) picks up the same work without this chat. These files are the single shared memory. There are no model-specific project memories: Codex reads `AGENTS.md`, Claude reads `CLAUDE.md`, and both point here.

**Latest handoff (2026-10-26): read [`HANDOFF-2026-10-26.md`](HANDOFF-2026-10-26.md) first.**

**Continuity (2026-10-11):** Codex Cloud is completing the current demo release; Claude Code may continue immediately from the prominent latest status in STATE.md. Shared handoff files and branch SHAs govern continuity; no model-specific memory or replacement application.

> **Latest handover (23 Oct 2026):** read [`HANDOFF-2026-10-23.md`](HANDOFF-2026-10-23.md) first: the deployed state, the workers in flight, the owner decisions and the open items.

## Q Pitch — canonical specification (all agents)

- **Read first:** before starting or modifying Q Pitch, demo identities, scripted tours, navigation, narration or showcase features, read `docs/specs/q-pitch/Q_PITCH_MASTER_BLUEPRINT.md`.
- **Shared baseline:** its approved experience design, 12-minute investor script, Feature Atlas, wow moments, interruption rules, performance targets and certification requirements are the baseline for Claude, Codex, subagents and every future agent.
- **No alternatives:** do not invent a different Q Pitch architecture, script, experience or demo account system.
- **Precedence:** the locked PADL and higher-priority Capital Q specifications still take precedence. Flag conflicts; never silently override.
- **Changes:** a material change is a proposed revision for product-owner approval. Approved revisions go in the blueprint's changelog.
- **Status and claims:**
  - Feature status: `docs/specs/q-pitch/IMPLEMENTATION_STATUS.md`. PLANNED is not certified.
  - Every demonstration claim must map to `docs/specs/q-pitch/CERTIFICATION_MANIFEST.md`.
- **Shared handoff:** progress, release evidence, risks and branch ownership stay in `docs/ai-handoff/`.
- **Parallel lanes:** GateQ and Q Pitch run in parallel lanes with one integration owner. No conflicting changes to shared contracts, authorization, Q orchestration or migrations.

## Read in this order (stop when you have enough)

1. [`STATE.md`](STATE.md) — branch roles, deployed revision per service, migrations, CI, environment facts.
2. [`ACTIVE-TASKS.md`](ACTIVE-TASKS.md) — every workstream with evidence, open defects and the exact next action.
3. The last entry of [`HANDOFF-LOG.md`](HANDOFF-LOG.md).
4. [`DECISIONS.md`](DECISIONS.md) — founder directions (below the PADL in authority).
5. [`AGENT-EXECUTION-MATRIX.md`](AGENT-EXECUTION-MATRIX.md) — the agent and workforce architecture as built, its defects and the first slices.
6. [`PROMISE-COVERAGE.md`](PROMISE-COVERAGE.md) with [`LANDING-PROMISES.md`](LANDING-PROMISES.md) — what the public page promises and its status.
7. [`SOURCES.md`](SOURCES.md) and [`PADL-DECISIONS.md`](PADL-DECISIONS.md) — product source register (PADL governs).
8. [`LEGACY-RECONCILIATION.md`](LEGACY-RECONCILIATION.md) — which older instructions are superseded, and the locked rules that still bind.
9. Root `CLAUDE.md` invariants (Product Invariants, Q Architecture, Data/Tenant, Contracts, UX, Forbidden Shortcuts, ADR-001 vocabulary): **binding for every model**. Its dated operational notes (budget, deadline, Vercel hosting, packets) are superseded; see `LEGACY-RECONCILIATION.md`.

## Product sources (authority order)

Locked PADL → Product Specification → Final System Review → MVP/V1 Release Definition → Technical Architecture docs 11–25 (`docs/architecture/`) → ADRs (`docs/adr/`) → specs (`docs/specs/`) → current task → code.

- Originals, unaltered: `docs/product-sources/*.docx`.
- Searchable text extracts: `docs/product-sources/text/*.txt`.
- GateQ Feature Specification is supplementary.

## Release lane (how code reaches production)

1. Work in your own worktree and branch from `origin/build/int-rc`. One owner per branch.
2. Gates before merging:
   - `pnpm exec turbo run build --filter=./packages/*`, so package `dist` folders are current. Stale `dist` causes false type errors.
   - Targeted `vitest` runs.
   - `node --max-old-space-size=7168 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (the root typecheck CI runs; it includes tests).
   - `tsc` for each app touched.
   - eslint and prettier on changed files.
   - `pnpm check` runs everything; it's slow.
3. Merge to `build/int-rc`. Push the same commit to `recovery/2026-09-12-8y2j4w` to run CI; CI does **not** trigger on `build/*`. That gives the quality job plus pgTAP.
4. For a migration:
   1. Wait for the pgTAP job to pass.
   2. Apply with `node scripts/handoff/hosted-migrate-https.mjs --apply <version>`. It refuses DROP and RLS-loosening; `--founder-approved <version>` exists only for a reviewed exception.
   3. Apply **before** deploying code that reads the new columns.
5. Deploy by pushing to `recovery/2026-09-12`. Railway rebuilds web, api, q-api and workers; unchanged services may show SKIPPED.
6. Verify on production straight away:
   - the Railway deployment status per service;
   - `scripts/handoff/live/*` checks;
   - authenticated Playwright, which can be launched with `executablePath: "/opt/pw-browsers/chromium"`.
7. Update `STATE.md`, `ACTIVE-TASKS.md` and `HANDOFF-LOG.md`, then commit and push.

Useful live scripts:

- `scripts/handoff/live/hosted-read.mjs "<select>"` — read-only SQL.
- `scripts/handoff/live/rehearsal-matrix.mjs` — founder × entity rehearsal pages.
- `scripts/handoff/live/investor-demo-rehearsal.mjs` — actual Discover/cards/profile/Q/follow-up/comparison browser journey using an existing authorized session; set `CQ_DEMO_SESSION_FILE`, `CQ_DEMO_PUBLIC_KEY_FILE`, optionally `CQ_DEMO_CHROMIUM_PATH` and `CQ_DEMO_FOUNDER_RECORD_FILE` (a known, previously authorized founder company record for separate evidence/profile/follow-up checks), and `NODE_USE_ENV_PROXY=1` in this cloud environment. It creates internal Q turns; no new accounts or outward messages. Protected temporary receipts contain private data and must not be committed.
- `node scripts/handoff/live/investiq-proposed-evaluation.mjs` — synthetic offline PROPOSED arithmetic experiment, no network or production scoring. Methodology design/limits: [INVESTIQ-METHODOLOGY-PROPOSED.md](INVESTIQ-METHODOLOGY-PROPOSED.md).

## Credentials — NAMES and access methods only (never commit or echo values)

| Name                                                                                                           | Used for                                                 | Where it lives                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`                                                                                        | Supabase management API (hosted reads, migrations)       | Environment secret store. The value in the 2026-10-11 Claude environment was invalid; a replacement was supplied out of band and **must be rotated** |
| `CQ_SEED_ACCOUNT_PASSWORD`                                                                                     | Signing in as `*@fictional.capitalq.local` demo accounts | Environment secret                                                                                                                                   |
| Kathryn (Spheros) demo password                                                                                | Fallback sign-in for her real demo account               | Founder-held; supply through a secret file and `CQ_FALLBACK_PASSWORD_FILE`. It was exposed in chat and **must be rotated**                           |
| `RAILWAY_TOKEN` / `RAILWAY_API_TOKEN`                                                                          | Railway GraphQL/CLI (deploy status, logs, variables)     | Environment secret. The token used on 2026-10-11 was exposed in chat and **must be rotated**                                                         |
| `SB_PUBLISHABLE`                                                                                               | Public Supabase key for test sign-in                     | Public; read from the web service's `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                                                                           |
| `SERP_API_KEY`, `TAVILY_API_KEY`, `OPENAI_API_KEY`, `GEMINI_*`, `ELEVENLABS_*`, `DEEPGRAM_API_KEY`, Recall key | Provider calls                                           | Railway service variables only. Tests use `disabled-locally-000000000000`                                                                            |
| `DATABASE_URL`, `SUPABASE_SECRET_KEY`                                                                          | Services' database and admin access                      | Railway service variables. Never in a browser, prompt or repo                                                                                        |

The cloud sandbox reaches the outside only over HTTPS through a proxy: set `NODE_USE_ENV_PROXY=1` for Node `fetch`. Direct Postgres from the sandbox is blocked.

## Session contract (every model, every substantial session)

- **Start:** record the actual branch, HEAD, dirty files and the deployed revision (do not assume). Pick ONE bounded slice from `ACTIVE-TASKS.md`.
- **During:** small commits, evidence for every claim, separate worktrees for parallel workers. Never symlink or build into another worker's checkout.
- **End:**
  - Update `STATE.md` and `ACTIVE-TASKS.md`, and append to `HANDOFF-LOG.md`.
  - Commit and push.
  - If anything can't be pushed, label it **LOCAL ONLY** and list the files.
- **Never:**
  - Call something done without its evidence stage (code, merged, CI, deployed, live verified).
  - Record secrets.
  - Weaken RLS, authorization or the Context Firewall to get green.

## Startup prompt (paste into a new session)

> We are continuing Capital Q (`neo1415/q`). Read `AGENTS.md` (Codex) or `CLAUDE.md` (Claude), then `docs/ai-handoff/START-HERE.md`, `STATE.md`, `ACTIVE-TASKS.md` and the latest `HANDOFF-LOG.md` entry. Verify `git status`, HEAD, the remote branches and the Railway-deployed revision before assuming anything is live. Continue the next unfinished slice. Reuse existing code and tests. Don't repeat completed work or confuse local tests with production verification. Update the handoff files and commit/push before stopping.
