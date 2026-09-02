# RLS testing harness

Database-level tenant isolation is verified with pgTAP through the Supabase
CLI. The harness lives under `supabase/tests/database/rls/` and is test-only:
nothing in it exists in a migration or in production.

RLS answers "can this database principal see or change this row at all?".
Business authorization is a separate layer (`ActorContext` +
`AuthorizationService`) and is tested in TypeScript. Both are required;
neither replaces the other.

## Commands

```bash
pnpm test:db      # every suite under supabase/tests/database (includes rls/)
pnpm test:rls     # only supabase/tests/database/rls
pnpm db:reset     # apply migrations from a clean database first if needed
```

The suites need the local Supabase stack (`pnpm db:start`). CI does not run
them today because the baseline CI runner has no Docker; run them locally
before merging any migration. That gate is documented, not hidden.

## Fixture identities

`support/fixture.psql` creates, inside the suite's own transaction:

| Label        | What                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User A       | auth user A → application user A, Tenant A, Organisation A, active membership A, persisted active context, `organisation_admin` role                     |
| User B       | auth user B → application user B, Tenant B, Organisation B, active membership B, persisted active context                                                |
| Revoked user | auth user R → application user R, Tenant R, Organisation R, membership R with `membership_status = 'revoked'`, and a stale active context pointing at it |
| Anonymous    | role `anon`, no JWT                                                                                                                                      |
| Service role | Supabase `service_role` (BYPASSRLS, but holds no grants on Capital Q schemas)                                                                            |
| Privileged   | the runner/server role (`postgres` locally): BYPASSRLS                                                                                                   |

Ids are fixed synthetic UUIDs (`…00a1`, `…00a3`, … see the file). Application
UserIds are created by the real auth-profile trigger and read back, because
`AuthUserId ≠ UserId`. There is no cross-membership. Person, organisation and
membership are always separate rows.

Everything rolls back: no auth users, tenants, organisations, memberships or
grants survive a suite, and suites never depend on each other.

## Acting as a principal

```sql
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql        -- relative to the suite file
select pg_temp.rls_setup();
select plan(N);

select pg_temp.act_as_user_a();         -- role authenticated, JWT sub = auth user A
select pg_temp.act_as_user_b();
select pg_temp.act_as_revoked_user();
select pg_temp.act_as('auth_b');        -- any fixture auth label
select pg_temp.act_as_anonymous();      -- role anon, auth.uid() is null
select pg_temp.act_as_service_role();   -- role service_role
select pg_temp.act_as_privileged();     -- back to the server/runner role
select pg_temp.reset_test_identity();   -- same as act_as_privileged

select pg_temp.rls_id('tenant_b');      -- fixture id by label

select * from finish();
rollback;
```

Each `act_as_*` resets the role and replaces the JWT claims, so nothing from
the previous principal leaks. The simulated JWT carries only `sub` and `role`:
it proves who is asking. Tenant and organisation access still come from real
membership rows through `private.is_tenant_member` /
`private.is_organisation_member`; claims are never authority.

Assertions stay explicit. Write the query a reviewer needs to see:

```sql
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.companies where id = pg_temp.rls_id('company_b')), 0,
  'companies: A cannot see Company B (valid id, wrong tenant)');
```

## Service role means

`act_as_privileged()` and `act_as_service_role()` demonstrate database
behaviour only. A row being visible to a BYPASSRLS role is **expected DB
behaviour** and says nothing about whether an action is permitted:
**RLS bypass ≠ business authorization**. Never assert "service role can see
the row, therefore the action is authorised". The controls are: never expose
a privileged credential, application authorization on every path, audit,
least privilege. Today `service_role` holds no grants on Capital Q schemas;
the server connects as the migration-owner role.

## Required matrix for a new tenant-owned table

Example: a future `core.companies` (do not create it here).

1. Add the table to `rls_inventory` in `130_schema_guard.test.sql` as
   `RLS_REQUIRED` (or `INTERNAL_SERVER_ONLY` with an explanation in the
   migration, or `PUBLIC_REFERENCE`). The guard fails on any unclassified
   table in a guarded schema, and on any classified table without RLS.
2. Add a suite `1xx_<domain>.test.sql` using the fixture and, at minimum:
   - User A sees Company A.
   - User A cannot see Company B **by its real id** (the guessed-UUID case),
     nor by any other lookup key.
   - User B the reverse.
   - Anonymous cannot see private Company A.
   - Wrong-tenant `INSERT` / `UPDATE` / `DELETE` are denied.
   - Membership revoked → access disappears, history rows remain.
   - Where sharing exists later: no access by default → explicit share →
     access → share revoked → no access.
3. If the table is server-only, no client role may hold any privilege and
   no policy may exist; the guard checks both.

Silence is not acceptable: the guard lists the offending table by name.

## What the baseline suites cover

- `100_principals` — auth.uid / current_app_user_id per principal, no
  leakage on switching, JWT carries only `sub` and `role`, helper matrices,
  helpers never take a caller user id, service/privileged sentinel.
- `110_identity_baseline` — profiles, tenants, organisations, memberships,
  membership roles, active contexts: A→A, A→B, B→B, B→A, anonymous,
  revocation (fixture and live), reference data vs raw grants, wrong-tenant
  writes.
- `120_infrastructure_exposure` — outbox, audit, pgmq, tenant mapping:
  authenticated, anonymous and service_role denied; privileged role sees rows
  (expected).
- `130_schema_guard` — inventory completeness, RLS enabled, grants,
  policies on server-only tables, `private` helper safety.

Data API exposure (`private`, `identity`, `permissions`, `events`, `audit`,
`pgmq` not in `supabase/config.toml` schemas) is asserted by
`packages/database/test/supabase-config.test.ts`.
