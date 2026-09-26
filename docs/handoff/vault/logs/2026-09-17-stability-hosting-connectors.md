---
title: Stability, hosting and connectors
project: capital-q
date: 2026-09-17
tags: [session-log]
---

# Stability, hosting and connectors

**Objective:** stop Q apologising after a delivered answer, stop the local stack dying, prepare the hosted deployment, and lay MCP/LangChain infrastructure.

**What changed**
- `packages/model-gateway/src/q/index.ts` — an answer whose text was read before its object was refused is persisted as the message; the run completes.
- `packages/q-core/src/prompts/schemas/company-intelligence.ts` — citation labels normalised and unresolvable ones dropped before the schema.
- `apps/q-api/src/voice/turn.ts` — no recovery line after a run fails once its answer was spoken.
- `scripts/demo.mjs` — `--local` mode, local/hosted consistency check, GOOGLE_* aliases; `demo-detached.ps1` / `demo-stop.ps1` start the stack outside the app's process tree; `turbo.json` dev task `envMode: loose`.
- `scripts/db-push.mjs`, `render.yaml`, `docs/modules/hosted-deployment.md` — hosted Supabase migrations, Render blueprint with TEI private service, runbook.
- `packages/q-connectors` (new) — MCP client tools as registry definitions, MCP server façade, LangChain projection; `apps/q-api/src/http/q-mcp.ts` mounted behind `Q_MCP_SERVER=enabled`.

**Decisions**
- see [[decisions]] 2026-09-17 entries.

**Open questions**
- Hosted DB password: the pooler rejects the one in `.env.local`; push blocked until reset.
- `apps/web/.env.local` still local; switch with the hosted values once the DB is reachable.
- `q-events.test.ts` "several authorised connections" flaked once under load, passes alone.

**Next step**
- Once the password is right: `pnpm db:push --dry-run`, `pnpm db:push`, hosted web env, then `pnpm demo` in hosted mode.

## Later the same day
- Hosted DB: all 42 migrations applied to vcohxiqsmnkzxnvawgri (eu-central-1) via session pooler.
- Third-transcript fixes (audit §P): first-person routing, spoken figures, trailing promises, transcript dedupe, welcome greeting, number words, option matching, spoken URLs, currency inference, upload step deferral, silent lookup failures, person lookup without a company row, per-session key terms.
- Not done: profile enrichment from Q's understanding; upload control on the voice stage; smarter model needs paid tier.

## Evening: ADR 0011 and profile editing
- `docs/adr/0011-meaning-by-model-authority-by-code.md`; `apps/q-api/src/composition/company-profile-action.ts` (action + board); `packages/q-core` analyst v3 + `ProfileUpdateSchema`; gateway/specialist note readings; web approval card; voice "Shall I go ahead?" + spoken yes.
- Not done: Q offering its own presence findings into the profile (same action, next); Render/Vercel setup (user signed in; secrets must be entered by the user).

## Night: fourth transcript
- Approval turn ends immediately (was stuck "Thinking" a minute); "go ahead" is a yes; held answers dropped on a new subject; spoken yes reports the run's end; barge-in by player state; conductor v2 (no spelling); website description offered into an empty short description via the same action; End → "Go to chat"; dead review button replaced.
- Still open: Render/Vercel setup via browser (user signed in; secrets are theirs to paste); "Talk to Q" as Home's primary surface beyond the label change; keyterms from the interview's company name (session settings are fixed at connect).
