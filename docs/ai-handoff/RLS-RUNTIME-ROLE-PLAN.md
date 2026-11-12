# RLS runtime-role plan: from `postgres` to a least-privilege role

**Status: PROPOSED** (security-test lane, 2026-11-12). Not approved. Nothing changes in production until the lead and the founder approve it. It puts ADR 0065 Option A into phases and is meant to sit beside that ADR, not to replace it.

## 1. Where we are (measured, not assumed)

- All four services reach Postgres through Supavisor as `postgres` (`rolbypassrls = true`; ADR 0065, re-measured on 12 Nov). `packages/database/src/client.ts` opens the pool with no `SET ROLE` and no request GUC; `transaction.ts` (`createTransactionManager`) is a plain `sql.begin`.
- **No server code runs `SET ROLE`.** The only hit for "set role" (`packages/platform-admin/src/team.ts:97`) is an `UPDATE … set role = …` on `identity.platform_admins`. No server code sets `request.jwt.claims` or any `capital_q.*` GUC.
- The browser-facing policies are written `to authenticated` and use `private.current_app_user_id()`, `private.is_tenant_member()` and `private.is_organisation_member()`, which read `request.jwt.claims`. Most tenant tables (onboarding, network history, evidence, Q conversations, Q memory) are **server-only**: RLS on, no grant and no policy for any client role (`supabase/tests/database/rls/130_schema_guard.test.sql`).
- So tenant isolation for server traffic is the `tenant_id` predicate in each query plus the `ActorContext` each repository takes. The compensating controls are the history guards (`20261220190000`) and the predicate ratchet (`packages/database/test/tenant-predicate-guard.test.ts`).

### Inventory of server SQL entry points (heuristic count)

The count covers `*.ts` under `apps/*/src` and `packages/*/src`, excluding tests, `testing/` and `dev/`, that hold tagged-template SQL (a `sql`, `tx` or `executor` tag) or `.unsafe(`. It finds **≈186 files and ≈1,400 call sites**. Three `apps/web` hits were false positives and are excluded.

|   Files | Where                                                                                                                               |
| ------: | ----------------------------------------------------------------------------------------------------------------------------------- |
|      31 | apps/q-api (`src/composition/*`, `src/voice/*`)                                                                                     |
|      12 | packages/platform-admin                                                                                                             |
|      11 | packages/network                                                                                                                    |
| 10 each | packages/onboarding, packages/discovery                                                                                             |
|       9 | packages/q-knowledge                                                                                                                |
|  7 each | packages/evidence; apps/workers (`retention/retention.ts`, `queue/pgmq.ts`, `network/*-handler.ts`, `documents/redrive.ts`)         |
|  6 each | packages/taxonomy, gateq-intake, communication                                                                                      |
|  5 each | packages/security (actor-context and policy sources), companies                                                                     |
|  4 each | packages/q-runtime, q-artifacts, model-gateway, investors, engagement, verification                                                 |
|  3 each | packages/q-evals, organisations, eventing, database, billing                                                                        |
|  2 each | packages/readiness, q-actions, public-identity, integrations, capital, audit; apps/api (`onboarding-coverage.ts`, `q-work-port.ts`) |
|  1 each | packages/q-presence, q-daily, permissions, media, investor-onboarding, gateq, founder-onboarding, board                             |

Reproduce:

```bash
grep -rlE --include=*.ts '\b(sql|tx|trx|db|executor|client|t)`|\.unsafe\(' apps/*/src packages/*/src \
  | grep -vE '/testing/|\.test\.ts|/test/|/dev/'
```

## 2. Target

- `capital_q_app`: `NOLOGIN NOBYPASSRLS NOINHERIT`, granted exactly the table privileges the services use. The pooled login stays `postgres`. The one `postgres` session switches per transaction, never per session, because Supavisor pools by transaction:
  `begin; set local role capital_q_app; select set_config('request.jwt.claims', $claims, true), set_config('capital_q.tenant_id', $tenant, true); …; commit;`
- Policies `to capital_q_app` key on `current_setting('capital_q.tenant_id', true)::uuid`, plus the actor's user or organisation where the browser policy already does. They sit beside the existing `to authenticated` policies and never replace them.
- `@capital-q/database/privileged` (`createPrivilegedDatabaseClient`, `PRIVILEGED_SERVICE`) stays `postgres`, named at each call site. It serves: cross-tenant sweeps in q-api (instructions, approved actions, errands, work tick), the outbox publisher and pgmq, retention, redrive and backfill workers, migrations and test cleanups.

## 3. Phases (each one reversible on its own)

| #   | Change                                                                                                                                                                                                                                       | Flag / switch                                                     | Rollback                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 0   | Additive migration: create `capital_q_app`, grant it to `postgres`, no table grants yet. Add `TransactionManager.runAs(actor, work)`, which opens the transaction, runs `set local role` and sets the GUCs. The existing `run` is unchanged. | none (dead code)                                                  | Drop the role in a forward migration; delete `runAs`.                                |
| 1   | Shadow mode: `runAs` sets the GUCs but **not** the role. A debug assertion compares each repository's `tenant_id` argument with the GUC and logs mismatches only.                                                                            | `CQ_DB_TENANT_GUC=shadow`                                         | Unset the flag.                                                                      |
| 2   | For each table group, add `capital_q_app` grants and policies, plus pgTAP proving positive, cross-tenant-negative and revoked access under `set local role capital_q_app`. No traffic uses the role yet.                                     | none                                                              | Forward migration that drops the new policies and grants (allowed: it only narrows). |
| 3   | Repository by repository, low risk first: switch from `run` to `runAs` with the role on. Order: q_runtime conversations/messages → q_knowledge memory → onboarding → evidence → network (relationships last).                                | `CQ_DB_RUNTIME_ROLE=<repo,…>` allowlist, read on each transaction | Remove the repository from the allowlist; it falls back to `postgres` immediately.   |
| 4   | Default on: the allowlist becomes a denylist. Every remaining `postgres` use must import `/privileged` and appear in a reviewed baseline, enforced by a ratchet test.                                                                        | `CQ_DB_RUNTIME_ROLE=all`                                          | Back to the allowlist.                                                               |
| 5   | Amend CLAUDE.md "server-side _and_ RLS" so it says what is now true. Close ADR 0065.                                                                                                                                                         | none                                                              | n/a                                                                                  |

## 4. What breaks first (in order of likelihood)

1. **Autocommit statements.** Many repositories run a tagged `sql` statement outside `transactions.run`. `SET LOCAL` outside a transaction does nothing, and Postgres only warns. Each call site must move inside `runAs`, or the policies fail closed: zero rows, which looks like data loss.
2. **The 130-classified INTERNAL_SERVER_ONLY tables** (onboarding.\*, network.relationships/relationship_events/interests/matches, evidence.\*, q_runtime.conversations/messages/runs, q_knowledge.memory_items). They have no policy for any role, so under `capital_q_app` they return nothing even to the rightful tenant. The new suite `999_tenant_isolation_server_only_probe` proves this default deny today (phase 2 of that suite).
3. **Cross-tenant by design.** `network.relationships` lives in the company's tenant while the investor reads it from its own (ADR 0003). The same holds for discovery slates, the Q subject resolvers with `QSubjectViewPort`, GateQ inbox and data-room access. These need party-based policies, not a plain `tenant_id = GUC`, or they must stay on `/privileged` behind the disclosure check.
4. **Bootstrap rows with `tenant_id is null`** (unbound onboarding sessions) and user-owned rows (`person_standing`, `founder_person_facts`) need a user GUC, not a tenant one.
5. **Workers and q-api sweeps** that read across tenants: everything in apps/workers and the q-api system ticks must move explicitly to `/privileged` before phase 4.
6. **`security definer` helpers** in `private` read `request.jwt.claims`. Their claim shape must match what `runAs` writes, or membership checks quietly return false.

## 5. Test gates per phase

- **pgTAP** (CI job `supabase test db`): for each table group, positive, cross-tenant-negative, revoked-membership and anonymous cases under both `authenticated` and `capital_q_app`. `130_schema_guard` gains a `capital_q_app` privilege column.
- **Vitest:** extend `tenant-predicate-guard.test.ts` to every raw-SQL file (ADR 0065 control 5), add a ratchet that every `/privileged` import is in the baseline, and keep resolver-level tests with leaky fakes (`packages/q-runtime/test/subject-tenant-isolation.test.ts`).
- **Integration** (local stack): each switched repository runs its existing `*.integration.test.ts` with the flag on. A zero-row regression fails the phase.
- **Production:** read-only `pg_stat_activity` by role (ADR 0065 verification query), and the error rate and empty-result rate per switched repository for 24 hours before the next one.

## 6. Deviations and decisions for the owner (flagged, not decided)

1. **This deviates from the locked text until phase 5.** CLAUDE.md says "Enforce server-side _and_ with RLS", which is not true for server traffic today. ADR 0065 Option B is the interim position. The owner must accept either the interim amendment or this schedule.
2. **A second policy family** (`to capital_q_app` beside `to authenticated`) doubles policy count on ~180 tables. Doc 13 (runtime roles) and doc 15 (RLS as a second layer) should be amended by ADR. Do not let the families drift silently.
3. **`postgres` stays the pooled login.** A dedicated login role would change Supavisor and Railway secrets (`DATABASE_URL`). That is an infrastructure change for the owner, and is out of scope here.
4. **Person-scoped versus membership-scoped access.** `core.founder_person_facts` and `core.founder_background_entries` are readable by their owner after their membership is revoked: the policy is `user_id = current_app_user_id()` only. That may be intended, since it is the person's own data, but it differs from "revoked loses access". The owner should decide it; it is not asserted by the new pgTAP suite.
5. **Fail-closed incidents.** Phase 3 will produce some "my data vanished" reports. The rollback (removing a repository from the allowlist) is immediate, but the owner should approve that risk window.
6. **`service_role` grants.** Some tables grant `service_role` (for example `q_runtime.conversation_states` and `conversation_summary_revisions`). The fixture claims that `service_role` "holds NO grants on the application schemas". These should be reconciled before `capital_q_app` grants are designed.
