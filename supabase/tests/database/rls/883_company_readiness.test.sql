-- Q.03 / Q.04 (20261216090000): the founder's readiness is founder-private.
-- Positive: the company's own members read it. Negative: another tenant,
-- a revoked member, an investor organisation in a relationship with the
-- company, and anon read nothing; no browser principal writes; history is
-- append-only.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(14);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000088c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Ready Co A', 'ready-co-a');
-- Organisation B is an investor with a relationship to the company: the
-- exact principal the firewall must keep out.
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000088b1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Watching Capital');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-0000000088e1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000088c1',
   '00000000-0000-4000-8000-0000000088b1', 'DISCOVERED');

select lives_ok(
  $$ insert into core.company_readiness_assessments
       (id, tenant_id, company_id, revision, rules_version, basis_hash, assessment)
     values ('00000000-0000-4000-8000-0000000088a1', pg_temp.rls_id('tenant_a'),
             '00000000-0000-4000-8000-0000000088c1', 1, 'readiness-rules/v1',
             repeat('a', 64), '{"pillars": []}') $$,
  'the server records an assessment revision');
select lives_ok(
  $$ insert into core.company_readiness_action_events
       (id, tenant_id, company_id, action_key, event, actor_user_id, rules_version)
     values ('00000000-0000-4000-8000-0000000088d1', pg_temp.rls_id('tenant_a'),
             '00000000-0000-4000-8000-0000000088c1', 'upload-deck', 'MARKED_DONE',
             pg_temp.rls_id('user_a'), 'readiness-rules/v1') $$,
  'the server records an action mark');
select throws_ok(
  $$ insert into core.company_readiness_assessments
       (tenant_id, company_id, revision, rules_version, basis_hash, assessment)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000088c1', 1,
             'readiness-rules/v1', repeat('b', 64), '{}') $$,
  '23505', null, 'one row per revision');
select throws_ok(
  $$ insert into core.company_readiness_assessments
       (tenant_id, company_id, revision, rules_version, basis_hash, assessment)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000088c1', 2,
             'readiness-rules/v1', repeat('c', 64), '{}') $$,
  '23503', null, 'the company and its tenant must match');
select throws_ok(
  $$ update core.company_readiness_assessments set revision = 9
      where id = '00000000-0000-4000-8000-0000000088a1' $$,
  '42501', null, 'an assessment revision is never rewritten');
select throws_ok(
  $$ delete from core.company_readiness_action_events
      where id = '00000000-0000-4000-8000-0000000088d1' $$,
  '42501', null, 'an action mark is never deleted');

select pg_temp.act_as_user_a();
select is((select count(*)::int from core.company_readiness_assessments
            where company_id = '00000000-0000-4000-8000-0000000088c1'), 1,
  'a member of the company reads its readiness');
select is((select count(*)::int from core.company_readiness_action_events
            where company_id = '00000000-0000-4000-8000-0000000088c1'), 1,
  'a member of the company reads its action history');
select throws_ok(
  $$ insert into core.company_readiness_action_events
       (tenant_id, company_id, action_key, event, actor_user_id, rules_version)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000088c1',
             'upload-deck', 'REOPENED', pg_temp.rls_id('user_a'), 'readiness-rules/v1') $$,
  '42501', null, 'a member cannot write directly; the server does');

select pg_temp.act_as_user_b();
select is((select count(*)::int from core.company_readiness_assessments), 0,
  'an investor with a relationship to the company never reads its readiness');
select is((select count(*)::int from core.company_readiness_action_events), 0,
  'an investor never reads its action plan');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from core.company_readiness_assessments), 0,
  'a revoked user reads nothing');

select pg_temp.act_as_anonymous();
select throws_ok(
  $$ select count(*) from core.company_readiness_assessments $$,
  '42501', null, 'anon has no access at all');

select pg_temp.act_as_service_role();
select throws_ok(
  $$ select count(*) from core.company_readiness_action_events $$,
  '42501', null, 'the service role holds no grant either');

select * from finish();
rollback;
