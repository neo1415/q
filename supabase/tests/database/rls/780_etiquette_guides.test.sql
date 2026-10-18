-- ADR 0050 · business etiquette guides (How Q conducts business).
--
-- platform_ops.etiquette_guide_versions / etiquette_guide_active: the
-- platform's house guide. Server-only: no browser session reads or writes
-- it, so only the API (which lets only a platform admin with step-up write)
-- can change it. Revisions are append-only.
--
-- q_runtime.etiquette_guide_versions: a person's own guide,
-- personal_private. The owner (an active member of the row's tenant) reads
-- their own rows; nobody else does, in any tenant; nobody in a browser
-- writes; versions are never rewritten.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(27);

-- Shape ------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'platform_ops.etiquette_guide_versions'::regclass),
  'platform guide versions: RLS is on');
select ok((select relrowsecurity from pg_class where oid = 'platform_ops.etiquette_guide_active'::regclass),
  'platform guide pointer: RLS is on');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'q_runtime.etiquette_guide_versions'::regclass),
  'personal guides: RLS is on and forced');
select is((select count(*)::int from pg_policies where schemaname = 'platform_ops' and tablename like 'etiquette_guide%'),
  0, 'no policy for any client role on the platform guide');
select ok((select qual from pg_policies where schemaname = 'q_runtime' and tablename = 'etiquette_guide_versions'
           and policyname = 'etiquette_guide_versions_select_own') like '%current_app_user_id%is_tenant_member%',
  'the personal policy is the reader''s own rows in a tenant they belong to');
select is((select count(*)::int from pg_policies where schemaname = 'q_runtime' and tablename = 'etiquette_guide_versions'
           and cmd <> 'SELECT'), 0, 'no client write policy on personal guides');

-- Platform rules -----------------------------------------------------------------
select lives_ok(
  $$ insert into platform_ops.etiquette_guide_versions
       (id, version, title, source_kind, body, body_sha256, created_by)
     values ('00000000-0000-4000-8000-0000000e7101', 1, 'House guide', 'PASTE', 'Be warm.',
             repeat('a', 64), pg_temp.rls_id('user_a')) $$,
  'the server records a platform guide version');
select lives_ok(
  $$ insert into platform_ops.etiquette_guide_active (version_id, updated_by)
     values ('00000000-0000-4000-8000-0000000e7101', pg_temp.rls_id('user_a')) $$,
  'and makes it the one in force');
select throws_ok(
  $$ insert into platform_ops.etiquette_guide_active (version_id, updated_by)
     values (null, pg_temp.rls_id('user_a')) $$,
  '23505', null, 'there is one pointer only');
select throws_ok(
  $$ update platform_ops.etiquette_guide_versions set body = 'Be curt.' $$,
  '23514', null, 'a platform version is never rewritten');
select throws_ok(
  $$ delete from platform_ops.etiquette_guide_versions $$,
  '23514', null, 'nor deleted');
select throws_ok(
  $$ insert into platform_ops.etiquette_guide_versions
       (version, title, source_kind, body, body_sha256, created_by)
     values (2, 'From a file', 'FILE', 'Be warm.', repeat('b', 64), pg_temp.rls_id('user_a')) $$,
  '23514', null, 'a file version names its file and type');
select throws_ok(
  $$ insert into platform_ops.etiquette_guide_versions
       (version, title, source_kind, file_name, media_type, body, body_sha256, created_by)
     values (2, 'Script', 'FILE', 'x.html', 'text/html', 'Be warm.', repeat('b', 64), pg_temp.rls_id('user_a')) $$,
  '23514', null, 'only PDF, Word, text and Markdown are accepted');

-- Personal rules -----------------------------------------------------------------
insert into q_runtime.etiquette_guide_versions
  (id, tenant_id, user_id, version, source_kind, body, body_sha256) values
  ('00000000-0000-4000-8000-0000000e7201', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 1, 'PASTE', 'Formal with investors.', repeat('c', 64)),
  ('00000000-0000-4000-8000-0000000e7202', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 2, 'PASTE', 'Sign off Warmly, A.', repeat('d', 64)),
  ('00000000-0000-4000-8000-0000000e7203', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 1, 'PASTE', 'Short and direct.', repeat('e', 64));

select throws_ok(
  $$ insert into q_runtime.etiquette_guide_versions (tenant_id, user_id, version, source_kind, body, body_sha256)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 2, 'PASTE', 'Again.', repeat('f', 64)) $$,
  '23505', null, 'one row per version per person');
select throws_ok(
  $$ insert into q_runtime.etiquette_guide_versions (tenant_id, user_id, version, source_kind, body, body_sha256, visibility_scope)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 3, 'PASTE', 'Shared?', repeat('f', 64), 'network_visible') $$,
  '23514', null, 'a personal guide is personal_private only');
select throws_ok(
  $$ update q_runtime.etiquette_guide_versions set body = 'Rewritten.' where version = 1 $$,
  '23514', null, 'a personal version is never rewritten');

-- RLS: platform guide is server-only --------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select body from platform_ops.etiquette_guide_versions $$, '42501', null,
  'a member cannot read the platform guide table');
select throws_ok(
  $$ insert into platform_ops.etiquette_guide_versions (version, title, source_kind, body, body_sha256, created_by)
     values (9, 'Mine', 'PASTE', 'Be curt.', repeat('9', 64), pg_temp.rls_id('user_a')) $$,
  '42501', null, 'nor write one (only the admin API, through the server, can)');
select throws_ok(
  $$ update platform_ops.etiquette_guide_active set version_id = null $$,
  '42501', null, 'nor switch which one is in force');
select pg_temp.act_as_anonymous();
select throws_ok($$ select 1 from platform_ops.etiquette_guide_active $$, '42501', null,
  'anonymous visitors cannot read it');

-- RLS: personal guides, with the schema closed to browsers ----------------------
select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from q_runtime.etiquette_guide_versions $$, '42501', null,
  'user B (other tenant) cannot read guide rows from a browser');
select throws_ok(
  $$ insert into q_runtime.etiquette_guide_versions (tenant_id, user_id, version, source_kind, body, body_sha256)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 5, 'PASTE', 'Mine.', repeat('5', 64)) $$,
  '42501', null, 'nobody writes a guide from a browser');

-- The policy itself, exercised with schema usage opened inside this
-- transaction only (rolled back): own rows yes, other tenant's no, a revoked
-- member's none.
select pg_temp.act_as_privileged();
grant usage on schema q_runtime to authenticated;

select pg_temp.act_as_user_a();
select is((select count(*)::int from q_runtime.etiquette_guide_versions), 2,
  'the owner reads their own versions');
select is((select count(*)::int from q_runtime.etiquette_guide_versions where user_id = pg_temp.rls_id('user_b')), 0,
  'and not another tenant''s person''s guide');
select throws_ok(
  $$ delete from q_runtime.etiquette_guide_versions where user_id = pg_temp.rls_id('user_a') $$,
  '42501', null, 'removal goes through the server, not the browser');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from q_runtime.etiquette_guide_versions), 0,
  'a revoked member reads nothing');

select pg_temp.act_as_privileged();
select is((select count(*)::int from q_runtime.etiquette_guide_versions), 3,
  'the privileged server role reads every row');

select * from finish();
rollback;
