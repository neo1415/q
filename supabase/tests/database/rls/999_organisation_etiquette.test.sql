-- Decision 112 · q_runtime.organisation_etiquette_versions ("How Q speaks
-- for us").
--
-- The server (the API, after asking organisation.admin: owners and admins)
-- writes versions; every active member of the organisation reads them
-- through RLS; no browser principal writes, whatever their role; another
-- tenant and a revoked member read nothing; versions are never rewritten
-- or deleted, and the organisation's own deletion still cascades.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the owner/admin rule is the API's, tested in
-- apps/api/test/organisation-etiquette-routes.test.ts).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(17);

-- Shape --------------------------------------------------------------------------
select ok((select relrowsecurity and relforcerowsecurity from pg_class
            where oid = 'q_runtime.organisation_etiquette_versions'::regclass),
  'RLS is on and forced');
select is((select count(*)::int from pg_policies where schemaname = 'q_runtime'
            and tablename = 'organisation_etiquette_versions' and cmd <> 'SELECT'),
  0, 'no client write policy');

-- The server writes (an owner's or admin's save, decided by the API) -------------
select lives_ok(
  $$ insert into q_runtime.organisation_etiquette_versions
       (id, tenant_id, organisation_id, version, source_kind, body, body_sha256, created_by_user_id)
     values ('00000000-0000-4000-8000-0000000e8101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
             1, 'PASTE', 'Formal with investors.', repeat('a', 64), pg_temp.rls_id('user_a')) $$,
  'the server records the organisation''s first version');
insert into q_runtime.organisation_etiquette_versions
  (id, tenant_id, organisation_id, version, source_kind, body, body_sha256, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000e8102', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 2, 'PASTE', 'Warm, then formal.', repeat('b', 64), pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000e8201', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 1, 'PASTE', 'Short and direct.', repeat('c', 64), pg_temp.rls_id('user_b'));

select throws_ok(
  $$ insert into q_runtime.organisation_etiquette_versions
       (tenant_id, organisation_id, version, source_kind, body, body_sha256, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 2, 'PASTE', 'Again.', repeat('d', 64), pg_temp.rls_id('user_a')) $$,
  '23505', null, 'one row per version per organisation');
select throws_ok(
  $$ insert into q_runtime.organisation_etiquette_versions
       (tenant_id, organisation_id, version, source_kind, body, body_sha256, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_b'), 1, 'PASTE', 'Crossed.', repeat('d', 64), pg_temp.rls_id('user_a')) $$,
  '23503', null, 'an organisation is named under its own tenant only');
select throws_ok(
  $$ insert into q_runtime.organisation_etiquette_versions
       (tenant_id, organisation_id, version, source_kind, body, body_sha256, created_by_user_id, visibility_scope)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 3, 'PASTE', 'Shared?', repeat('d', 64), pg_temp.rls_id('user_a'), 'network_visible') $$,
  '23514', null, 'an organisation guide is organisation_private only');

-- Append-only history --------------------------------------------------------------
select throws_ok(
  $$ update q_runtime.organisation_etiquette_versions set body = 'Rewritten.' where version = 1 $$,
  '23514', null, 'a version is never rewritten');
select throws_ok(
  $$ delete from q_runtime.organisation_etiquette_versions where version = 1 $$,
  '23514', null, 'nor deleted');

-- RLS, with schema usage opened inside this transaction only (rolled back) ----------
grant usage on schema q_runtime to authenticated;

select pg_temp.act_as_user_a();
select is((select count(*)::int from q_runtime.organisation_etiquette_versions), 2,
  'a member reads their organisation''s versions');
select is((select body from q_runtime.organisation_etiquette_versions order by version desc limit 1),
  'Warm, then formal.', 'and the newest is the one in force');
select is((select count(*)::int from q_runtime.organisation_etiquette_versions
            where organisation_id = pg_temp.rls_id('org_b')), 0,
  'another tenant''s organisation guide is invisible');
select throws_ok(
  $$ insert into q_runtime.organisation_etiquette_versions
       (tenant_id, organisation_id, version, source_kind, body, body_sha256, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 3, 'PASTE', 'Mine.', repeat('e', 64), pg_temp.rls_id('user_a')) $$,
  '42501', null, 'no browser principal writes, whatever their role (the API does)');
select throws_ok(
  $$ update q_runtime.organisation_etiquette_versions set body = 'x' $$,
  '42501', null, 'nor rewrites');

select pg_temp.act_as_user_b();
select is((select count(*)::int from q_runtime.organisation_etiquette_versions
            where tenant_id = pg_temp.rls_id('tenant_a')), 0,
  'user B (other tenant) reads none of tenant A''s');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from q_runtime.organisation_etiquette_versions), 0,
  'a revoked member reads nothing');

select pg_temp.act_as_anonymous();
select throws_ok($$ select 1 from q_runtime.organisation_etiquette_versions $$, '42501', null,
  'anonymous visitors cannot read it');

-- The organisation's deletion still cascades -----------------------------------------
select pg_temp.act_as_privileged();
select lives_ok(
  $$ delete from identity.tenant_organisations
      where tenant_id = pg_temp.rls_id('tenant_b') and organisation_id = pg_temp.rls_id('org_b') $$,
  'removing the organisation from its tenant takes its guide with it');

select * from finish();

rollback;
