# ADR 0082: A non-bypass request role, per-transaction claims and a schema-by-schema RLS rollout

- Status: Proposed (W2-C, enterprise audit 21 Nov 2026, finding 1). Design plus a proof of concept; production access is unchanged until the owner approves each rollout step below.
- Amends: `CLAUDE.md` Data / Tenant / Permission Rules ("UI hiding is not authorization. Enforce server-side and with RLS") by making RLS bind the server's own request path, not only the browser roles. Builds on CQ-SEC-004 (`supabase/tests/database/rls/130_schema_guard.test.sql`) and the access classes in `packages/config/src/database.ts` (`REQUEST`, `PRIVILEGED_SERVICE`, `MIGRATION`).
- Related: ADR 0014 (Railway, Supavisor), the 16 Nov 2026 pooler work (`SET LOCAL` limits per transaction), the 19 Nov 2026 pool incident.

## Context

api, q-api and workers connect with `DATABASE_URL` as `postgres`. On Supabase that role has `BYPASSRLS`, so every policy is skipped for every server query: tenant isolation on the server path rests entirely on application code (ActorContext, AuthorizationService, the tenant predicate in each repository). RLS is enabled, and usually forced, on every guarded table, but it binds only the browser roles (`anon`, `authenticated`), which hold almost nothing.

The inventory (Appendix A, read from a fresh local database at this commit) shows **346 RLS-enabled tables in 24 application schemas; before this ADR's migration 247 of them had no policy at all** (the audit counted 334 and 247 on 21 Nov; it is 245 after the PoC gives `workspace` its two tables' policies). They are the INTERNAL_SERVER_ONLY tables: correct today (no browser role may reach them), but they would deny everything to a non-bypass server role, so the policies must be written before any service can move. The other 101 tables have policies for `authenticated` only (the browser), which `cq_app` does not inherit: they need `cq_app` policies too.

One bug in one repository's tenant predicate is therefore one cross-tenant read. The audit asks for the database to refuse that read too.

## Decision

### 1. A request role that never bypasses RLS: `cq_app`

- `cq_app` is `NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER` (created by `20261231600100_cq_app_request_role_workspace.sql`). It stays `NOLOGIN` until step 4 of the rollout.
- api, q-api and workers will use it for the `REQUEST` access class. A login role, `cq_app_login`, will be a member of `cq_app` (`SET ROLE`-free: `INHERIT` on the login role, `NOINHERIT` on `cq_app` itself). It will have its own password in `DATABASE_URL`, and `postgres` will leave the request path.
- Its grants are the server's grants today, table by table (select / insert / update as each migration already grants `postgres, service_role`). There are no `DELETE` grants that the server does not hold now. Schema usage is granted only for rolled-out schemas.

### 2. Claims per transaction, set by the existing transaction helper

- Four transaction-local settings, written only by `createTransactionManager` (`packages/database/src/transaction.ts`, `RLS_CLAIM_SETTINGS`):
  - `cq.tenant_id`
  - `cq.user_id`: the application user (`identity.user_profiles.id`), never the auth id
  - `cq.organisation_id`
  - `cq.actor_type`
- They are set with `set_config(name, value, true)`: the value is gone at COMMIT or ROLLBACK, so nothing leaks to the next client of a Supavisor transaction-mode server connection. That is the same mechanism the statement and lock limits use today.
- The values are bound parameters, sent as one statement pipelined ahead of the unit's first statement. That costs no extra round trip, and a failure fails the unit.
- `run(work, { claims })` takes `DatabaseClaims`, built by the server from the authenticated `ActorContext`, never from a client. Behind the flag `DATABASE_RLS_CLAIMS` (`off` by default; implemented and unit-tested in this ADR's commit), a unit without claims sets none. Under `cq_app` such a unit sees no rows.
- Policies read the claims through invoker helpers in `private`: `cq_claim_tenant_id()`, `cq_claim_user_id()`, `cq_claim_organisation_id()` and `cq_claim_actor_type()`. A missing, empty or malformed claim is `null`, and `null` matches no row.
- Policies use `(select private.cq_claim_…())` so the planner evaluates each helper once per statement, not once per row.
- **Queries outside a transaction.** About 270 source files query `database.sql` directly, outside `transactions.run`. Under `cq_app` those statements carry no claims and would see nothing. Before a schema rolls out, every reader of it moves to one of two forms:
  - a unit run with claims; or
  - a new request-scoped executor, `database.forClaims(claims)`. It wraps each statement in a short claimed transaction, pipelining BEGIN, the claims, the statement and COMMIT.
- The tenant-predicate guard (`packages/database/test/tenant-predicate-guard.test.ts`) gains a rule: a repository of a rolled-out schema takes a claimed executor.

### 3. Policies, schema by schema

- Each schema gets one migration of `to cq_app` policies, never shared with a browser role (guarded in `130_schema_guard`), and one pgTAP suite. The suite covers:
  - the owner positive;
  - another person in the same tenant;
  - another tenant;
  - no claims and a malformed claim;
  - a revoked grant;
  - the browser roles unchanged.
- Policy shapes by tenancy (Appendix A):
  - **personal** (`tenant_id` and `user_id`): both claims match;
  - **organisation** (`tenant_id` and `organisation_id`): tenant matches, plus active membership of the claimed organisation (`private.is_organisation_member` re-keyed to the claim user);
  - **relationship** (`network`, GateQ): the existing side-membership helpers, re-keyed the same way;
  - **reference data** (`taxonomy`, `site_content`): `select` for any claimed actor, writes only on the privileged path;
  - **tables without a tenant column** (Appendix A, "no tenant column"): a parent-join policy, or a tenant column added first, decided per table.
- A revoked membership must lose access in the same transaction it is revoked, so organisation policies check `membership_status = 'active'` live, never a cached claim.

### 4. A named privileged path, kept isolated

These operations keep bypassing RLS through `@capital-q/database/privileged` (`createPrivilegedDatabaseClient`, `DATABASE_PRIVILEGED_URL`, a separate role and secret):

- **Migrations**: `DATABASE_MIGRATION_URL` / `scripts/handoff/hosted-migrate-https.mjs`, unchanged.
- **The outbox relay and its consumers** in workers, which read every tenant's rows by design.
- **The operational checks and heartbeats** (`platform_ops`), cross-tenant counts only.
- **Data-rights export and erasure**, the GDPR jobs.
- **Admin break-glass**: platform-operator reads through the console. Each one is audited (`audit` schema, `who`, `why`, `which tenant`) and time-boxed.

Each privileged import site is listed in this ADR's follow-up and guarded the way W1-A guards inline SQL: a debt-guard baseline that may only shrink, and a new privileged import fails the guard. The privileged client never serves a person's request.

### 5. Rollout: schema by schema, behind flags, shadow first

For each schema, in the order of Appendix B:

1. **Policies merged and applied** (additive; `cq_app` still `NOLOGIN`). pgTAP green.
2. **Claims on**: `DATABASE_RLS_CLAIMS=on` per service. Claims are set and still bypassed (the connection is still `postgres`), so nothing changes for anyone. The flag lets the claim plumbing be live-verified first.
3. **Shadow mode**: `DATABASE_RLS_SHADOW=<schema,…>`.
   - For a sample of claimed units (default 5%), the helper also runs the unit's reads of those schemas a second time under `set local role cq_app`, inside a savepoint that is always rolled back. The sample is configurable.
   - It compares the row counts. Where they differ, it logs `RLS_WOULD_DENY {schema, table, statementKind, rowsBypass, rowsEnforced}`: counts only, never the rows.
   - Nothing is denied, and the person's answer always comes from the bypass read.
   - Metrics, from the W1-B traffic counter pattern: would-deny per schema, per service, shown on the console's health card. They also feed an operator alert (`ops:rls-would-deny:<schema>`, de-duplicated with a cooldown).
   - Exit criterion: seven days with zero would-deny on real traffic, and zero on the synthetic rehearsal journeys.
   - Shadow needs `grant cq_app to <request login>` so the bypass connection can drop to `cq_app` inside the savepoint. That only narrows what the connection can do, never widens it. It is still a change to production roles, so it is owner-approved like step 4.
4. **Enforce**:
   - `cq_app_login` gets `LOGIN`, and the request URL of one service moves to it, for the schemas in `DATABASE_RLS_ENFORCED`.
   - Units touching any schema not yet enforced keep running on the `postgres` pool, so two pools exist for the duration of the rollout. The `REQUEST` client routes by schema list, and workers go last.
5. **Rollback**:
   - Instant: remove the schema from `DATABASE_RLS_ENFORCED`, or point `DATABASE_URL` back at `postgres`. Both are Railway variables, so no deploy or migration is needed.
   - Policies stay in place (inert under `postgres`).
   - A bad policy is fixed forward by a new migration, never edited.

Production access changes only at step 4, and each step 4 needs the owner's approval.

### 6. Effect on the connection pool and performance

- **Round trips:**
  - Claims ride the existing pipelined `set_config` statement, so a claimed unit costs zero extra round trips. That makes about 0 ms for transactional work.
  - A statement moved off `database.sql` into `forClaims` costs about one round trip, for BEGIN and COMMIT pipelined around it: about 9 ms per statement at the measured 9.4 ms (R4).
  - Hot paths (the feed slate, Q's prepared reads) should batch their reads into one claimed unit rather than pay that per statement. The shadow sample reruns reads only for the sampled 5%.
- **Planner cost:** policies of the form `tenant_id = (select …)` are index-friendly. Every guarded table already leads its indexes with `tenant_id`. The membership check in organisation policies is one indexed lookup on `organisation_memberships (organisation_id, user_id)` per statement, because the helper is `stable` and wrapped in `select`.
  - Expected overhead: under 1 ms per statement, measured per schema in shadow mode before step 4.
- **Pool:**
  - During steps 4 and 5 a service holds two pools (`postgres` and `cq_app_login`), each at `DATABASE_POOL_MAX`. Supavisor's 15-slot budget (ADR 0014; `DATABASE_POOL_MAX` 5, the warm floor of 2 per process) must be split, not doubled. For the rollout each pool runs at `DATABASE_POOL_MAX=3`, warm floor 1. After the last schema the `postgres` request pool is removed.
  - Transaction pooling stays safe: settings are transaction-local, and no `SET ROLE` or session state survives COMMIT.
- **LISTEN:** unaffected. It is wake-up only and reads no rows.

## Proof of concept (this commit)

- **Migration** `20261231600100_cq_app_request_role_workspace.sql`. It creates `cq_app` (`NOLOGIN`) and the claim helpers, and adds `cq_app` grants and policies to `workspace`: two tables, `tenant_id` and `user_id` on both, personal-private, the smallest schema with clear tenant columns. It is additive: no drop, no revoke, no browser-role policy, and RLS stays forced. The services keep connecting as `postgres`, so it changes no access.
- **pgTAP** `supabase/tests/database/rls/999_cq_app_workspace.test.sql`, 22 assertions:
  - the role never bypasses RLS and cannot log in;
  - the owner reads, adds and changes their own items and history;
  - another person in the same tenant reads nothing, cannot plant an item and cannot update one;
  - another tenant reads and writes nothing;
  - no claims, or a malformed claim, read nothing;
  - with the grant revoked, the owner is refused (42501);
  - `authenticated` still holds nothing.
- `130_schema_guard` now allows server-only tables to carry policies only for `cq_app`, and only policies for `cq_app` alone.
- **Transaction helper**:
  - `run(work, { claims })` and `DATABASE_RLS_CLAIMS` (off by default);
  - unit tests in `packages/database/test/rls-claims.unit.test.ts`: off sends nothing; on sets four transaction-local claims as bound values before the work; no claims sets none; the claims sit beside the limits; a failure fails the unit; and the flag is parsed strictly.

## Consequences

- Until step 4 for a schema, nothing anyone can read or write changes.
- Every repository of a schema must pass claims before that schema enforces, which is the bulk of the work (Appendix A effort).
- The privileged path becomes the one place cross-tenant access is possible, which makes it the place to audit.
- Two pools during the rollout cost connection budget; that is why the pools are split, as in section 6.

## Appendix A: inventory

See the table below. It was generated from a fresh local database at this commit, with every migration applied. Counts are of tables with RLS enabled.

| Schema                 | Tables (RLS on) | No policy | Policies | cq_app policies | With `tenant_id` | Without `tenant_id`                                                                                                                                                                                                                                                       | Effort                                     |
| ---------------------- | --------------: | --------: | -------: | --------------: | ---------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `ai_ops`               |               5 |         5 |        0 |               0 |                1 | 4: model_prices, models, providers, routing_policies                                                                                                                                                                                                                      | privileged / reference                     |
| `analytics`            |               5 |         2 |        3 |               0 |                2 | 3: platform_setting_changes, platform_settings, viewing_privacy_settings                                                                                                                                                                                                  | M                                          |
| `artifacts`            |               6 |         6 |        0 |               0 |                6 | 0                                                                                                                                                                                                                                                                         | M                                          |
| `audit`                |               2 |         2 |        0 |               0 |                2 | 0                                                                                                                                                                                                                                                                         | S (append; reads privileged)               |
| `billing`              |              16 |        16 |        0 |               0 |                2 | 14: credit_entries, customers, features, fee_schedules, limit_overrides, plan_assignments, plan_features, plans, provider_events, subscriptions, usage_events, video_allowance_config, video_allowance_testers, video_usage_ledger                                        | L (14 without tenant_id: parent joins)     |
| `communication`        |              25 |         7 |       19 |               0 |               21 | 4: meeting_emails, meeting_participants, report_reasons, scout_cursor                                                                                                                                                                                                     | L                                          |
| `core`                 |              33 |        11 |       22 |               0 |               31 | 2: reserved_handles, shareable_identity_scans                                                                                                                                                                                                                             | L                                          |
| `events`               |               1 |         1 |        0 |               0 |                1 | 0                                                                                                                                                                                                                                                                         | privileged (outbox relay)                  |
| `evidence`             |              29 |        29 |        0 |               0 |               26 | 3: data_room_checklist_items, data_room_folders, document_processing_runs                                                                                                                                                                                                 | L (data room, documents)                   |
| `gateq`                |              35 |        35 |        0 |               0 |               32 | 3: contact_verification_limits, guest_throttle_buckets, pass_reasons                                                                                                                                                                                                      | L (inbox, guests)                          |
| `identity`             |              14 |         5 |        9 |               0 |                7 | 7: account_deletion_requests, data_export_requests, membership_roles, platform_admins, tenants, user_active_contexts, user_profiles                                                                                                                                       | L (memberships are the policy basis)       |
| `integrations`         |               5 |         1 |        4 |               0 |                5 | 0                                                                                                                                                                                                                                                                         | S                                          |
| `knowledge`            |               3 |         0 |        3 |               0 |                2 | 1: company_profiles                                                                                                                                                                                                                                                       | S (network_visible reads)                  |
| `media`                |               4 |         4 |        0 |               0 |                4 | 0                                                                                                                                                                                                                                                                         | S                                          |
| `network`              |              29 |        22 |        9 |               0 |               27 | 2: commitment_review_flags, relationship_pass_reasons                                                                                                                                                                                                                     | L (relationship sides)                     |
| `onboarding`           |              16 |        16 |        0 |               0 |                2 | 14: definition_versions, definitions, interview_questions, interview_readings, interview_turns, nudge_states, pending_writes, responses, session_creation_requests, session_mutation_requests, step_states, steps, suggestions, utterances                                | L (14 keyed by session: parent joins)      |
| `permissions`          |               5 |         2 |        3 |               0 |                2 | 3: capabilities, role_capabilities, roles                                                                                                                                                                                                                                 | S (reference + grants)                     |
| `platform_ops`         |              16 |        16 |        0 |               0 |                2 | 14: account_suspensions, admin_actions, admin_role_events, break_glass_reads, break_glass_requests, email_deliveries, etiquette_guide_active, etiquette_guide_versions, feature_flag_events, feature_flags, meeting_digests, report_reviews, service_heartbeats, step_ups | privileged (operator tables)               |
| `q_knowledge`          |              13 |        13 |        0 |               0 |               13 | 0                                                                                                                                                                                                                                                                         | M                                          |
| `q_runtime`            |              57 |        27 |       30 |               0 |               48 | 9: checkpoint_blobs, checkpoint_migrations, checkpoint_writes, checkpoints, daily_cluster_issues, external_entity_aliases, external_entity_facts, external_entity_sources, ui_translations                                                                                | XL (Q hot path, checkpoints)               |
| `recommendation`       |              11 |        11 |        0 |               0 |               10 | 1: fx_reference_rates                                                                                                                                                                                                                                                     | M                                          |
| `site_content`         |               6 |         6 |        0 |               0 |                0 | 6: page_drafts, page_versions, pages, publish_events, published_pointers, settings                                                                                                                                                                                        | reference (public read, privileged writes) |
| `taxonomy`             |               8 |         8 |        0 |               0 |                3 | 5: aliases, classification_candidates, node_edges, nodes, vocabularies                                                                                                                                                                                                    | reference                                  |
| `workspace`            |               2 |         0 |        5 |               5 |                2 | 0                                                                                                                                                                                                                                                                         | S (done: this PoC)                         |
| **Total (24 schemas)** |         **346** |   **245** |  **107** |           **5** |          **251** | **95**                                                                                                                                                                                                                                                                    |                                            |

Effort:

- **S**: up to 3 tables with clear tenant columns, about half a day with tests.
- **M**: 4 to 15 tables, about 1 to 2 days.
- **L**: over 15 tables, or tables without a tenant column, or relationship or membership policies, about 3 to 5 days.
- **XL**: q_runtime, where Q's hot path and the outbox meet, about a week, with performance measured in shadow mode.

## Appendix B: proposed order

1. `workspace` (this PoC), then `media`, `integrations`, `knowledge`, `audit`: small, clear tenant columns.
2. Reference data (`taxonomy`, `site_content`, `permissions` roles and capabilities, `ai_ops` catalogues): `select` for any claimed actor, writes only on the privileged path.
3. `artifacts`, `analytics`, `recommendation`, `q_knowledge`: personal and organisation shapes, already tenant-keyed.
4. `identity`: memberships become the basis for every organisation policy, so they go before the schemas that rely on them.
5. `core`, `evidence`, `communication`, `network`, `gateq`, `billing`, `onboarding`: organisation and relationship policies, plus the parent-join tables.
6. `q_runtime` last: Q's hot path, with shadow-mode latency measured per statement.
7. Stays privileged by design: `events` (outbox relay) and `platform_ops` (operator tables, break-glass, heartbeats).
