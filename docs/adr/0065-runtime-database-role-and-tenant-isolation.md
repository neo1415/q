# ADR 0065: Runtime database role and tenant isolation for server traffic

Status: Proposed (recovery workstream F, 2026-10-08). Needs the lead's and the founder's decision; nothing in production changes until then.
Amends, if accepted: CLAUDE.md "Data / Tenant / Permission Rules" ("UI hiding is not authorization. Enforce server-side _and_ with RLS"), doc 15 (RLS as a second layer), doc 13 (runtime roles). Relates to audit DEF-A2 / F-R1.

## Context

Verified on hosted, read-only, on 2026-10-08 (`pg_stat_activity ⋈ pg_roles`, aggregates only):

- The four services reach Postgres through Supavisor as **`postgres`**: 8 client backends, `rolbypassrls = true`, `rolsuper = false`. PostgREST runs as `authenticator` (no bypass), but no Capital Q code uses PostgREST (the web uses Supabase for auth only).
- `packages/database/src/client.ts:24-41` opens the pool with no `SET ROLE` and no request GUC. The 86 policies are written `to authenticated`; the 9 FORCE-RLS tables are forced against their owner, but `postgres` bypasses RLS regardless.
- So for server traffic, **tenant isolation is the `tenant_id` predicate each hand-written query carries** and the actor context each repository takes. RLS protects only a client path that does not exist. CLAUDE.md asks for both layers.

Two ways forward were weighed.

### Option A: a non-bypass application role with a transaction-local tenant GUC

- A role `capital_q_app` (`NOLOGIN`, `NOBYPASSRLS`), granted the table privileges the services use today. The pooled login stays `postgres`; each request transaction begins with `set local role capital_q_app` and `select set_config('capital_q.tenant_id', $1, true)`, `set_config('capital_q.user_id', $2, true)`. `SET LOCAL` and `set_config(…, true)` end with the transaction, which is what makes them safe under Supavisor's transaction pooling; a session `SET` would leak between clients.
- Policies `to capital_q_app using (tenant_id = current_setting('capital_q.tenant_id', true)::uuid)` on every tenant-owned table, beside the existing `to authenticated` ones.
- The privileged paths (workers' cross-tenant sweeps, the outbox publisher, retention, migrations) keep `postgres`, named explicitly (`@capital-q/database/privileged` already exists for this).
- Cost and risk: a policy for each of ~180 tenant-owned tables, and every repository call must run inside a transaction that set the GUC (many run as single autocommit statements today). Every system sweep in q-api (instructions, approved actions, errands, work tick) reads across tenants and must move to the privileged client. A missed GUC fails closed (zero rows), which in production looks like data loss. It is several days of work across every workstream, with a full pgTAP and integration pass; it cannot land during the recovery.

### Option B: accepted app-layer isolation with compensating controls

- The actor-context and repository discipline stays the isolation boundary, which it already is in practice (`apps/api/src/security/actor-context.ts`, `packages/security/src/postgres/actor-context-resolver.ts`, every repository taking an explicit tenant). RLS stays as the browser-facing layer and as defence if a client path is ever added.
- Compensating controls make the app layer harder to get wrong and catch what slips:
  1. **History guards in the database** (`20261220190000`): UPDATE and TRUNCATE on `network.relationship_events`, `audit.material_actions`, `audit.security_events` raise for every role, the bypass role included. Done.
  2. **A tenant-predicate ratchet** (`packages/database/test/tenant-predicate-guard.test.ts`): every raw statement in the riskiest repositories (`apps/q-api/src/composition/{instructions,workforce,work}/store.ts`, `apps/api/src/q-work-port.ts`) that touches an application table must name `tenant_id` or be in a reviewed baseline (49 statements today: by primary key after a scoped read, by owning person, or system sweeps). Done.
  3. **Cross-tenant negative integration tests** for the repositories behind Q's tools, run against the local stack: actor A cannot read, list or mutate tenant B's row through the repository API. To do (G and the owning workstreams).
  4. **DELETE guard, second step.** Sixteen integration-test and dev cleanups delete fixture rows from the history tables (`apps/q-api/src/dev/smoke-runner.ts:746,755`; `apps/q-api/test/{approval-continuation,q-events}.integration.test.ts`; `packages/{audit,integrations,network,q-actions,q-daily,q-orchestrator,q-runtime}/test/*.integration.test.ts`; `packages/q-evals/src/fixtures/world.ts:925-929`). The guard extends to DELETE once each cleanup opts in with `select set_config('capital_q.history_cleanup', 'on', true)` inside its transaction, and governed retention uses the same switch. Guarding first would break every shared database.
  5. **Widen the ratchet** to every `*.ts` under `apps/*/src` and `packages/*/src` that holds raw SQL, one owner at a time, each with its reviewed baseline.

## Decision (proposed)

**Option B now, Option A as a scheduled hardening packet after the recovery.** The defect class Option A removes (a forgotten predicate) is real, but changing the runtime role during the recovery would put every query path at risk at once, while Option B's controls are cheap, local and testable today. Option A is not abandoned: it is the end state CLAUDE.md describes, and the ratchet's baseline is its migration checklist.

The runtime role in production is not changed by this ADR.

## Consequences

- CLAUDE.md's "server-side _and_ RLS" is, for server traffic, "server-side, with database-level guards on history and a tested predicate ratchet" until Option A lands. The amendment should say so rather than leave the sentence untrue.
- A new statement without `tenant_id` in the watched repositories needs a reviewer's eye in the same change.
- History rewrites fail loudly (`55000`) in every environment, including a developer's local stack.

## Verification

- `supabase/tests/database/rls/895_history_append_only_guards.test.sql` (13 assertions; runs as the owner on purpose).
- `npx vitest run packages/database/test/tenant-predicate-guard.test.ts` (8 tests).
- Hosted role: `node scripts/handoff/live/hosted-read.mjs "select a.usename, a.application_name, count(*), r.rolbypassrls from pg_stat_activity a left join pg_roles r on r.rolname = a.usename where a.datname = current_database() group by 1,2,4"`.
