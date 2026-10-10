-- W2: research entities are server-only, researched rows are scoped to the
-- tenant and asker, seeds are platform data, and briefs are append-only.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(13);

select ok(
  (select relrowsecurity from pg_class where oid = 'q_runtime.external_persons'::regclass),
  'RLS is on for external_persons');
select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('q_runtime.external_person_briefs'::regclass,
                  'q_runtime.external_entity_aliases'::regclass,
                  'q_runtime.external_entity_sources'::regclass,
                  'q_runtime.external_entity_facts'::regclass)),
  'RLS is on for the briefs, aliases, sources and facts tables');

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
  '23505', null, 'one row per entity per asker');

select lives_ok($$
  insert into q_runtime.external_persons
    (id, tenant_id, user_id, profile_key, display_name, confidence)
  values (gen_random_uuid(), pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),
          'linkedin.com/in/shadi-qishta-282453a', 'Shadi Qishta', 'STRONG') $$,
  'another tenant researches the same person as its own separate record');

select lives_ok($$
  insert into q_runtime.external_persons
    (id, tenant_id, user_id, entity_kind, research_status, requires_refresh,
     profile_key, display_name, confidence)
  values ('00000000-0000-4000-8000-000000000910', null, null, 'GOVERNMENT_AGENCY',
          'PREPARED_PUBLIC_SEED', true, 'qa-demo-invest-qatar', 'Invest Qatar', 'STRONG') $$,
  'a prepared seed is platform data with no owner');

select throws_ok($$
  insert into q_runtime.external_persons
    (id, tenant_id, user_id, research_status, profile_key, display_name, confidence)
  values (gen_random_uuid(), null, null, 'RESEARCHED', 'x', 'X', 'STRONG') $$,
  '23514', null, 'a researched record must have an owner');

select throws_ok($$
  insert into q_runtime.external_persons
    (id, tenant_id, user_id, entity_kind, profile_key, display_name, role, confidence)
  values (gen_random_uuid(), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
          'ORGANIZATION', 'org-1', 'QInvest', 'CEO', 'STRONG') $$,
  '23514', null, 'an organisation carries no personal role');

select lives_ok($$
  insert into q_runtime.external_entity_aliases (external_person_id, alias_key, alias)
  values ('00000000-0000-4000-8000-000000000910', 'invast katar', 'Invest Qatar') $$,
  'an alias is filed against its entity');

select lives_ok($$
  insert into q_runtime.external_person_briefs
    (external_person_id, tenant_id, user_id, version, built_at, fresh_until, sources, assertions)
  values ('00000000-0000-4000-8000-000000000909', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
          1, now(), now() + interval '14 days', '[]', '[]') $$,
  'a brief version is appended');

select ok(
  not has_table_privilege('service_role', 'q_runtime.external_person_briefs', 'UPDATE'),
  'briefs are append-only: the service role cannot update them');

set local role authenticated;
select throws_ok($$ select 1 from q_runtime.external_persons $$,
  '42501', null, 'a browser principal cannot read entities');
select throws_ok($$ select 1 from q_runtime.external_entity_aliases $$,
  '42501', null, 'nor aliases');
reset role;

select * from finish();
rollback;
