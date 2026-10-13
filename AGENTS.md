# Capital Q — Instructions for Codex and other coding agents

Capital Q is an AI-native Investment Intelligence Operating System for private capital. It is not a marketplace, CRM, chatbot, document store or engagement platform.

## 1. Read first (shared with Claude Code; one memory, no model-specific copies)

1. `docs/ai-handoff/START-HERE.md` — the index, release lane, credential names and session contract.
2. `docs/ai-handoff/STATE.md`, `ACTIVE-TASKS.md`, and the last entry of `HANDOFF-LOG.md`.
3. `docs/ai-handoff/DECISIONS.md` (founder directions) and `AGENT-EXECUTION-MATRIX.md` (agent architecture as built).
4. Root `CLAUDE.md` — its **product invariants and engineering rules bind every model**:
   - Product Identity, Non-Negotiable Product Invariants, Q Architecture (Context Firewall, Authority, Tools and models, Evidence), Data/Tenant/Permission, Contracts/Events/Side Effects, UX/Performance, Engineering Rules, Forbidden Shortcuts, Canonical Vocabulary (ADR-001).
   - Its dated operational notes (the $250 budget, the 2026-09-28 deadline, Vercel/Render hosting, "packets", Claude model and cache settings) are **superseded**. See `docs/ai-handoff/LEGACY-RECONCILIATION.md`.

Do not replace `CLAUDE.md`. Update the shared handoff files instead.

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

## 2. Source hierarchy

Locked PADL → Product Specification → Final System Review → MVP/V1 Release Definition → `docs/architecture/` 11–25 → `docs/adr/` → `docs/specs/` → current task → code.

- Originals: `docs/product-sources/*.docx`; text extracts in `docs/product-sources/text/`.
- Register: `docs/ai-handoff/SOURCES.md`.
- On a conflict, flag it, don't redesign, and propose an ADR or PADL amendment.

## 3. Verify before you trust

- Run `git status --short --branch`, `git log -1 --oneline` and `git fetch origin`, then compare with `STATE.md`.
- Branch roles:
  - integrate on `build/int-rc`;
  - CI runs when you push `recovery/2026-09-12-8y2j4w`;
  - deploy by pushing `recovery/2026-09-12` (Railway auto-deploys web, api, q-api, workers);
  - `main` is stale.
- Check the Railway-deployed revision per service before claiming anything is live.

## 4. Implementation standards

- TypeScript strict, ESM, pnpm, Turborepo, Node 24. Apps depend on packages, never the reverse. No deep imports and no dumping-ground modules.
- Runtime contracts are Zod. Consequential POSTs take idempotency keys. Every tenant-scoped call takes an explicit access context.
- Schema changes:
  - a new immutable migration in `supabase/migrations/` with RLS/grants;
  - pgTAP in `supabase/tests/database/rls/`;
  - update `130_schema_guard` for new tables.
  - Fix forward; never edit an applied migration.
  - Bind jsonb with `tx.sql.json(value)`, **never** `${JSON.stringify(v)}::jsonb`: postgres.js double-encodes it into a JSON string. That caused the 2026-10-11 proposal 500s.
- In the Next.js web app, a module reachable from a Server Component must not import React client hooks. Keep plain stores separate from `"use client"` hook files.
- Deterministic behaviour (navigation, cards, prepared facts, mandate recall, Daily follow-ups) is composed by code, with no model call. All model calls go through the model gateway by task class.
- Tests make no live provider calls; provider keys are set to `disabled-locally-000000000000`.

## 5. Gates

- Build package `dist` first (`pnpm exec turbo run build --filter=./packages/*`).
- Then targeted vitest, the root `tsc` (`node --max-old-space-size=7168 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`), app `tsc`, and eslint/prettier on changed files.
- Then CI (quality + pgTAP).
- Then apply migrations, deploy, and verify live with an authenticated browser or API.

Never weaken lint, typecheck, tests, RLS or authorization to get green. Never falsify CI.

## 6. Evidence vocabulary

CODE OBSERVED · IMPLEMENTED · MERGED · LOCAL TESTED · CI GREEN · DEPLOYED · LIVE VERIFIED · BLOCKED.

A passed unit test is not production proof. An attempted action is not a completed one. Q must not say "opened / sent / booked / verified" without a real confirmation.

## 7. Session checkpoint (required)

At the end of every substantial session:

1. Update `docs/ai-handoff/STATE.md` and `ACTIVE-TASKS.md`.
2. Append an entry to `HANDOFF-LOG.md` (use its template).
3. Commit and push.

If something can't be pushed, label it **LOCAL ONLY** with the file list.

## 8. Parallel work

- One owner per branch or worktree.
- Separate worktrees for parallel agents.
- Never create links or run builds inside another agent's checkout.
- Never commit `node_modules` or `dist` (including symlinks named `dist`).

## 9. Secrets

- Never commit, log or paste Railway, Supabase or provider tokens, account passwords, magic links or private customer data.
- Record credential **names** and access methods only (see START-HERE).
- Rotate anything that was exposed.
