---
name: hosted-supabase-state
description: Hosted Supabase project vcohxiqsmnkzxnvawgri (eu-central-1) is fully migrated as of 2026-09-22 (db:push reports upToDate) and is what Railway staging runs against; use the session pooler with sslmode=require; the tester preview stack uses a separate Supabase project
metadata:
  node_type: memory
  type: project
  originSessionId: 5ccf5f0a-3807-4920-93a0-1987d61e45af
  modified: 2026-09-22T11:50:01.473Z
---

Project ref `vcohxiqsmnkzxnvawgri`, region eu-central-1. `DATABASE_URL` in `.env.local` is the session pooler (`aws-0-eu-central-1.pooler.supabase.com:5432`, user `postgres.<ref>`); Google is enabled in its dashboard. **On 2026-09-22 the last 10 migrations were pushed (`20260926` through `20261005_q_artifacts`) and `pnpm db:push --dry-run` now reports `upToDate: true`.** This is the project Railway staging validates tokens against.

This is the hosted **development/staging** project, not production: the tester preview stack runs on a Supabase project of its own (see the header of `scripts/preview.mjs`), and Capital Q has no customers.

**Why:** the direct host is IPv6-only and times out here; the Supabase CLI needs `?sslmode=require` on the pooler URL or it reports a wrong password for a right one (the Node driver connects fine either way). `scripts/db-push.mjs` adds it and refuses a URL naming the local stack.

**How to apply:** `pnpm db:push --dry-run` first — it is safe and prints exactly what would apply. Never `supabase db reset` against hosted. To run the **local web UI against Railway**, `apps/web/.env.local` must use the **hosted** `NEXT_PUBLIC_SUPABASE_URL`/`_PUBLISHABLE_KEY`, because a token minted by the local stack 401s on every Railway request; that file was switched on 2026-09-22 with the previous local-only version saved beside it as `.env.local.before-railway`. Accounts created against local Supabase do not exist hosted — sign up afresh. Reading hosted user rows is blocked here by the auto-mode classifier as a production read. Related: [[render-vercel-state]], [[turbo-strict-env-drops-overrides]].
