-- W2: external person records are server-only, scoped to tenant and asker,
-- and briefs are append-only.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(8);

select ok(
  (select relrowsecurity from pg_class where oid = 'q_runtime.external_persons'::regclass),
  'RLS is on for external_persons');
select ok(
  (select relrowsecurity from pg_class where oid = 'q_runtime.external_person_briefs'::regclass),
  'RLS is on for external_person_briefs');

insert into q_runtime.external_persons
  (id, tenant_id, user_id, profile_key, display_name, confidence)
values
  ('00000000-0000-4000-8000-000000000909', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
   'linkedin.com/in/shadi-qishta-282453a', 'Shadi Qishta', 'STRONG');

select throws_ok($$
  insert into q_runtime.external_persons
    (id, tenant_id, user_id, profile_key, display_name, confidence)
  values (gen_random_uuid(), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
          'linkedin.com/in/shadi-qishta-282453a', 'Shadi Qishta', 'STRONG') $$,
  '23505', null, 'one row per person per asker');

select lives_ok($$
  insert into q_runtime.external_person_briefs
    (external_person_id, tenant_id, user_id, version, built_at, fresh_until, sources, assertions)
  values ('00000000-0000-4000-8000-000000000909', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
          1, now(), now() + interval '14 days', '[]', '[]') $$,
  'a brief version is appended');

select throws_ok($$
  insert into q_runtime.external_person_briefs
    (external_person_id, tenant_id, user_id, version, built_at, fresh_until, sources, assertions)
  values ('00000000-0000-4000-8000-000000000909', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_a'),
          2, now(), now() + interval '14 days', '[]', '[]') $$,
  '23503', null, 'a brief cannot be filed under another tenant');

select ok(
  not has_table_privilege('service_role', 'q_runtime.external_person_briefs', 'UPDATE'),
  'briefs are append-only: the service role cannot update them');

set local role authenticated;
select throws_ok($$ select 1 from q_runtime.external_persons $$,
  '42501', null, 'a browser principal cannot read persons');
select throws_ok($$ select 1 from q_runtime.external_person_briefs $$,
  '42501', null, 'nor briefs');
reset role;

select * from finish();
rollback;
