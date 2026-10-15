-- W3 (20261222091000): name pronunciations are server-only, tenant-owned,
-- scoped, and a user's own word is never verified.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(12);

select ok(
  (select relrowsecurity from pg_class where oid = 'q_runtime.name_pronunciations'::regclass),
  'RLS is on');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'q_runtime' and tablename = 'name_pronunciations'),
  0, 'no policies: the table is server-only');

insert into q_runtime.name_pronunciations
  (tenant_id, scope, user_id, name_key, display_name, kind, value, source, created_by)
values
  (pg_temp.rls_id('tenant_a'), 'user', pg_temp.rls_id('user_a'), 'Sadi kiSta',
   'Shadi Qishta', 'pronunciation', 'SHAH-dee KISH-tah', 'USER_CORRECTION', pg_temp.rls_id('user_a'));
select pass('a user-scoped correction is stored');

select lives_ok($$
  insert into q_runtime.name_pronunciations
    (tenant_id, scope, organisation_id, name_key, display_name, kind, value, source, source_ref, created_by)
  values (pg_temp.rls_id('tenant_a'), 'organisation', pg_temp.rls_id('org_a'), 'k', 'Qishta',
          'pronunciation', 'KISH-tah', 'VERIFIED_GUIDE', 'profile-recording:1', pg_temp.rls_id('user_a')) $$,
  'an organisation-scoped verified guide with a source is stored');

select throws_ok($$
  insert into q_runtime.name_pronunciations
    (tenant_id, scope, user_id, name_key, display_name, kind, value, source, created_by)
  values (pg_temp.rls_id('tenant_a'), 'user', pg_temp.rls_id('user_a'), 'k', 'Qishta',
          'pronunciation', 'KISH-tah', 'VERIFIED_GUIDE', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'verified without a source reference is refused');

select throws_ok($$
  insert into q_runtime.name_pronunciations
    (tenant_id, scope, user_id, name_key, display_name, kind, value, source, source_ref, created_by)
  values (pg_temp.rls_id('tenant_a'), 'user', pg_temp.rls_id('user_a'), 'k', 'Qishta',
          'pronunciation', 'KISH-tah', 'USER_CORRECTION', 'looks-official', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'a user correction cannot carry a verification source');

select throws_ok($$
  insert into q_runtime.name_pronunciations
    (tenant_id, scope, user_id, organisation_id, name_key, display_name, kind, value, source, created_by)
  values (pg_temp.rls_id('tenant_a'), 'user', pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), 'k', 'Q',
          'pronunciation', 'K', 'USER_CORRECTION', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'a row has exactly one owner (user xor organisation)');

select throws_ok($$
  insert into q_runtime.name_pronunciations
    (tenant_id, scope, organisation_id, name_key, display_name, kind, value, source, created_by)
  values (pg_temp.rls_id('tenant_a'), 'organisation', pg_temp.rls_id('org_b'), 'k', 'Q',
          'spelling', 'Qishta', 'USER_CORRECTION', pg_temp.rls_id('user_a')) $$,
  '23503', null, 'an organisation from another tenant cannot own a row');

select ok(
  not has_table_privilege('service_role', 'q_runtime.name_pronunciations', 'UPDATE'),
  'corrections are new rows: update is not granted');

select is(
  (select count(*)::int from q_runtime.name_pronunciations
    where tenant_id = pg_temp.rls_id('tenant_b')),
  0, 'tenant B owns no rows: a tenant-filtered read cannot see tenant A''s');

set local role authenticated;
select throws_ok($$ select 1 from q_runtime.name_pronunciations $$,
  '42501', null, 'a browser principal cannot read');
select throws_ok($$ insert into q_runtime.name_pronunciations
  (tenant_id, scope, user_id, name_key, display_name, kind, value, source, created_by)
  values (gen_random_uuid(), 'user', gen_random_uuid(), 'k', 'Q', 'spelling', 'Q', 'USER_CORRECTION', gen_random_uuid()) $$,
  '42501', null, 'nor write');
reset role;

select * from finish();
rollback;
