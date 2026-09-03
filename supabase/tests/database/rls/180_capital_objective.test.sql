-- CQ-CAP-001 · capital objectives and their goal-evolution history.
--
-- Readable by members of the organisation that owns the company; invisible
-- to every other tenant, to anonymous callers and to revoked members even
-- when they remain a current founder of the company. No browser principal
-- writes. Database invariants: exact positive money with a currency, one
-- ACTIVE objective per company, closed_at coherent with status, closed
-- vocabularies, bounded typed history payloads, tenant coherence.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(32);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, current_stage_code) values
  ('00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Company A', 'company-a', 'seed'),
  ('00000000-0000-4000-8000-0000000000c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Company B', 'company-b', null);
insert into core.capital_objectives (id, tenant_id, company_id, target_amount, currency_code, target_stage, instrument_code, use_of_funds_summary, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000ca01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c1', 4000000.10, 'USD', 'series_a', 'safe', 'PRIVATE-USE-OF-FUNDS-DO-NOT-EMIT', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-00000000cb01', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000c2', 250000, 'EUR', null, null, 'B private use of funds', pg_temp.rls_id('user_b'));
insert into core.capital_objective_events (id, tenant_id, capital_objective_id, event_type, actor_type, actor_id, payload) values
  ('00000000-0000-4000-8000-00000000ea01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ca01', 'CREATED', 'HUMAN', pg_temp.rls_id('user_a'), '{"kind":"CREATED"}'),
  ('00000000-0000-4000-8000-00000000eb01', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000cb01', 'CREATED', 'HUMAN', pg_temp.rls_id('user_b'), '{"kind":"CREATED"}');

-- Defaults and invariants -------------------------------------------------------
select is((select status from core.capital_objectives where id = '00000000-0000-4000-8000-00000000ca01'), 'ACTIVE', 'a new objective is ACTIVE');
select is((select objective_type from core.capital_objectives where id = '00000000-0000-4000-8000-00000000ca01'), 'RAISE', 'a new objective is a RAISE');
select is((select version from core.capital_objectives where id = '00000000-0000-4000-8000-00000000ca01'), 1, 'a new objective is version 1');
select is((select target_amount::text from core.capital_objectives where id = '00000000-0000-4000-8000-00000000ca01'), '4000000.10', 'money is exact numeric');
select is((select current_stage_code from core.companies where id = '00000000-0000-4000-8000-0000000000c1'), 'seed',
  'the objective''s series_a target stage did not touch the company''s seed stage');
select throws_ok(
  $$ insert into core.capital_objectives (tenant_id, company_id, target_amount, currency_code, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c1', 1000000, 'USD', pg_temp.rls_id('user_a')) $$,
  '23505', null, 'at most one ACTIVE objective per company');
select throws_ok(
  $$ update core.capital_objectives set target_amount = 0 where id = '00000000-0000-4000-8000-00000000ca01' $$,
  '23514', null, 'a target must be greater than zero');
select throws_ok(
  $$ update core.capital_objectives set currency_code = '$' where id = '00000000-0000-4000-8000-00000000ca01' $$,
  '23514', null, 'a currency symbol is not a currency code');
select throws_ok(
  $$ update core.capital_objectives set status = 'FAILED', closed_at = now() where id = '00000000-0000-4000-8000-00000000ca01' $$,
  '23514', null, 'there is no FAILED status');
select throws_ok(
  $$ update core.capital_objectives set status = 'ACHIEVED' where id = '00000000-0000-4000-8000-00000000ca01' $$,
  '23514', null, 'a terminal status requires closed_at');
select throws_ok(
  $$ update core.capital_objectives set objective_type = 'safe' where id = '00000000-0000-4000-8000-00000000ca01' $$,
  '23514', null, 'objective type is not an instrument');
select throws_ok(
  $$ update core.capital_objectives set tenant_id = pg_temp.rls_id('tenant_b')
      where id = '00000000-0000-4000-8000-00000000ca01' $$,
  '23503', null, 'an objective cannot drift to another tenant than its company');
select throws_ok(
  $$ insert into core.capital_objective_events (tenant_id, capital_objective_id, event_type, actor_type, actor_id, payload)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ca01', 'FAILED', 'HUMAN', pg_temp.rls_id('user_a'), '{}') $$,
  '23514', null, 'history event vocabulary is closed');
select throws_ok(
  $$ insert into core.capital_objective_events (tenant_id, capital_objective_id, event_type, actor_type, actor_id, payload)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ca01', 'CREATED', 'HUMAN', pg_temp.rls_id('user_b'), '{}') $$,
  '23503', null, 'history cannot name an objective under another tenant');
select lives_ok(
  $$ update core.capital_objectives set status = 'CLOSED_BY_FOUNDER', closed_at = clock_timestamp(), version = version + 1
      where id = '00000000-0000-4000-8000-00000000cb01' $$,
  'closing below target as CLOSED_BY_FOUNDER is a valid terminal state');
select lives_ok(
  $$ insert into core.capital_objectives (tenant_id, company_id, target_amount, currency_code, created_by_user_id)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000c2', 6000000, 'EUR', pg_temp.rls_id('user_b')) $$,
  'after closure a new ACTIVE objective may begin; the closed one remains');
select is((select count(*)::int from core.capital_objectives where company_id = '00000000-0000-4000-8000-0000000000c2'), 2,
  'historical objectives remain distinct rows');

-- User A ------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.capital_objectives where id = '00000000-0000-4000-8000-00000000ca01'), 1, 'objectives: A -> Company A objective visible');
select is((select count(*)::int from core.capital_objectives where id = '00000000-0000-4000-8000-00000000cb01'), 0, 'objectives: A -> Company B objective invisible (valid id, wrong tenant)');
select is((select count(*)::int from core.capital_objective_events where capital_objective_id = '00000000-0000-4000-8000-00000000ca01'), 1, 'history: A reads Company A history');
select is((select count(*)::int from core.capital_objective_events where id = '00000000-0000-4000-8000-00000000eb01'), 0, 'history: a guessed history B id leaks nothing');
select throws_ok(
  $$ update core.capital_objectives set target_amount = 9 where id = '00000000-0000-4000-8000-00000000ca01' $$,
  '42501', null, 'objectives: a browser principal cannot write');
select throws_ok(
  $$ delete from core.capital_objectives where id = '00000000-0000-4000-8000-00000000ca01' $$,
  '42501', null, 'objectives: a browser principal cannot delete fundraising history');
select throws_ok(
  $$ insert into core.capital_objective_events (tenant_id, capital_objective_id, event_type, actor_type, actor_id, payload)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ca01', 'CLOSED', 'HUMAN', pg_temp.rls_id('user_a'), '{}') $$,
  '42501', null, 'history: a browser principal cannot append');

-- User B ------------------------------------------------------------------------
select pg_temp.act_as_user_b();
select is((select count(*)::int from core.capital_objectives where company_id = '00000000-0000-4000-8000-0000000000c2'), 2, 'objectives: B -> Company B objectives (current and closed) visible');
select is((select count(*)::int from core.capital_objectives where use_of_funds_summary like '%DO-NOT-EMIT%'), 0, 'objectives: B cannot read A''s use of funds');

-- Founder without organisation membership --------------------------------------------
select pg_temp.act_as_privileged();
insert into core.company_members (tenant_id, company_id, user_id, is_founder, business_title)
values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('user_a'), true, 'CEO');
update identity.organisation_memberships
   set membership_status = 'revoked', left_at = now()
 where id = pg_temp.rls_id('membership_a');
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.capital_objectives), 0,
  'objectives: a current founder/CEO whose organisation membership is revoked reads nothing');
select is((select count(*)::int from core.capital_objective_events), 0,
  'history: likewise nothing');

-- Anonymous and service role ---------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from core.capital_objectives $$, '42501', null, 'objectives: anonymous denied');
select throws_ok($$ select * from core.capital_objective_events $$, '42501', null, 'history: anonymous denied');
select throws_ok($$ select * from core.capital_objective_creation_requests $$, '42501', null, 'creation idempotency: anonymous denied');
select pg_temp.act_as_service_role();
select throws_ok($$ select * from core.capital_objectives $$, '42501', null, 'service_role: no grant on capital objectives');

select * from finish();

rollback;
