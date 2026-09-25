---
name: render-vercel-state
description: "Superseded by Railway: ADR 0014 (2026-09-22) moved api/q-api/workers off Render onto Railway project Q, live at capital-qapi-production / capital-qq-api-production; render.yaml is marked SUPERSEDED, do not apply it; Vercel still not authenticated on this machine"
metadata:
  node_type: memory
  type: project
  originSessionId: 5ccf5f0a-3807-4920-93a0-1987d61e45af
  modified: 2026-09-24T17:11:01.239Z
---

**Railway is the platform now, not Render.** ADR 0014 (`docs/adr/0014-railway-replaces-render-for-node-services.md`) amends ADR 0001. Railway project `Q` (id `9e615d28-7db0-406e-a415-c5118a275427`), environment named `production` but running `CAPITAL_Q_ENV=staging`, region `europe-west4`. Live since 2026-09-22 on `recovery/2026-09-12` @ `2e8aaa6`:

- api `https://capital-qapi-production.up.railway.app`, private `capital-qapi.railway.internal:3001`
- q-api `https://capital-qq-api-production.up.railway.app` (this is `Q_API_PUBLIC_URL`; ngrok is no longer used)
- workers: private, no public domain, both queue consumers running

**Update 2026-09-24: web now also serves from Railway** at `https://capital-qweb-production.up.railway.app` (user asked for a testable URL). Its service instance was repointed by GraphQL (`railway api`): buildCommand `pnpm deploy:build:web`, full watchPatterns, deploy trigger branch `main` → `recovery/2026-09-12`, plus 10 web vars. Deployed `0ac0b28`. api got OPENAI_API_KEY + CLOUDFLARE_*; workers OPENAI_API_KEY. Workers must NOT get the synthetic-demo vars: unlike q-api, `apps/workers/src/main.ts` passes no `hostedAttested`/project ref, so they crash it at startup (happened; reverted). Hosted auth has email confirmation on — the web origin must be in Supabase Auth redirect URLs. Every Railway service is capped at 1 GB RAM / 2 vCPU and new volumes get 500 MB (no resize via API), so the TEI embedding runtime (needs ~3-4 GB) cannot run there; the user chose to keep embeddings on local Docker only and not spend time on it — Railway retrieval is keyword-only until they revisit (OpenAI embeddings at dimensions=1024 is the fallback idea).

`render.yaml` is kept but carries a SUPERSEDED header — never apply it. Render was abandoned because the workspace's payment method failed at the Deploy Blueprint step and nothing ever ran there.

**Why:** the packet's premise (Railway "already locked") contradicted an Accepted ADR choosing Render, so the conflict was flagged and the user chose Railway plus an ADR amendment rather than a silent contradiction.

**How to apply:** everything operational is in `docs/deployment/staging.md` — env table, the `deploy:build:*` scripts, and the Windows-only Railway IaC gotcha (`railway config plan` needs PowerShell **and** `$env:_` pointed at `...\@railway\cli\bin\railway.exe`, or the SDK guard wrongly claims the CLI is too old). Vercel is still **not** installed/authenticated here: `npm i -g vercel && vercel login`. The Railway `@capital-q/web` service is left stopped and declared in `.railway/railway.ts` pinned to `main` so a whole-project apply neither redeploys nor deletes it; delete both once Vercel serves staging. `CQ_SYNTHETIC_DEMO_ROUTING` must never be set on Railway — it throws at startup there, by design. Related: [[hosted-supabase-state]], [[synthetic-demo-model-routing]].
