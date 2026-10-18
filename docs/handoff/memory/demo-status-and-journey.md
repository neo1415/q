---
name: demo-status-and-journey
description: pnpm demo:status answers STOPPED/STARTING/READY/DEGRADED/FAILED and pnpm demo:journey drives the key journey; an unrelated nemkyc project shares ports 3000/3001 and answers 404 during our restarts
metadata: 
  node_type: memory
  type: project
  originSessionId: 527a3870-2616-4832-9211-ae49f1424757
  modified: 2026-09-20T11:23:31.405Z
---

Two commands added in CQ-REC-007R C and its acceptance:

- `pnpm demo:status` — one of STOPPED / STARTING / READY / DEGRADED / FAILED, plus a line per component and what q-api reports its provider routing to be. `pnpm demo:status -- 240` polls (pnpm forwards a literal `--`, so the seconds are positional). Exit 0/3/1/2/4.
- `pnpm demo:journey` — the recommendation journey end to end through public HTTP paths only. Needs `pnpm dev:bootstrap` first.

**Why:** four things that cost hours and are invisible otherwise.

1. An unrelated **nemkyc** project (long-running, started 2026-09-18) listens on 3000 and 3001. Windows lets it hold the wildcard address while ours holds 127.0.0.1, so both run — but while our api restarts, a request to 127.0.0.1:3001 is answered by nemkyc with a **plausible 404**, not a refused connection. Never trust a 404 from these ports; check `/health/ready` reports `service: "api"` / `"q-api"` first.
2. `DETACHED_PROCESS` (0x8) in `Win32_Process.Create` is harmful: cmd.exe runs and its own redirect writes, but a **node child writes nothing**, giving a 0-byte `demo.log`. Use `CREATE_NEW_PROCESS_GROUP` (0x200) alone — Windows disables Ctrl+C for a new group, which is the protection wanted.
3. `demo-stop.ps1` writes a `.demo-stopped` marker file (gitignored). It cannot write to `demo.log`: the dying turbo still holds that file open and the next launch truncates it.
4. `node --watch` also fires on a watched file that was merely **READ**. Any script that loads a package's built output — `dev:marketplace-ready` loads `packages/companies/dist` — restarts the api underneath whatever is running. Answering `/health/ready` once is not the same as being up: wait for three consecutive healthy answers. `pnpm demo:journey` and the acceptance script both do.

**How to apply:** start with `pnpm demo:detached -- --local`, wait with `pnpm demo:status -- 300`, and treat DEGRADED/FAILED as real. `.env.local` names the **hosted** Supabase, so local scripts (`dev:bootstrap`, `dev:marketplace-ready`) need `SUPABASE_URL=http://127.0.0.1:54321` / `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` passed in, or they correctly refuse. See [[claude-app-process-tree-kills-servers]] and [[synthetic-demo-model-routing]].
