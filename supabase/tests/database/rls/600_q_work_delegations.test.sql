-- AUTO · ADR 0030 · q_runtime.delegations, delegation_lanes,
-- delegation_steps, presence; communication.push_subscriptions,
-- notification_settings; messages.q_envelope.
--
-- A person reads their own delegations, lanes, steps, presence and push
-- settings; only while an active member of the tenant the row names; never
-- another person's or tenant's; never after revocation; never anonymously.
-- No client writes. Steps are append-only even for the server role. A push
-- endpoint and its keys are never readable by a client.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(27);

insert into q_runtime.delegations (id, tenant_id, user_id, kind, q_action_id, grant_plan, thread_id, expires_at) values
  ('00000000-0000-4000-8000-00000000d001', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'INVESTOR_OUTREACH',
   '00000000-0000-4000-8000-00000000a001', '{"maxCompanies": 3}', 'work:00000000d001', now() + interval '14 days'),
  ('00000000-0000-4000-8000-00000000d002', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'FOUNDER_STAND_IN',
   '00000000-0000-4000-8000-00000000a002', '{"brief": "x"}', 'work:00000000d002', now() + interval '30 days'),
  ('00000000-0000-4000-8000-00000000d003', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'), 'FOUNDER_STAND_IN',
   '00000000-0000-4000-8000-00000000a003', '{"brief": "x"}', 'work:00000000d003', now() + interval '30 days');
insert into q_runtime.delegation_lanes (id, delegation_id, tenant_id, user_id, company_id, counterpart_name, stage) values
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000d001', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),
   '00000000-0000-4000-8000-00000000c001', 'Lane Co', 'WAITING_ACCEPTANCE');
insert into q_runtime.delegation_steps (delegation_id, lane_id, tenant_id, user_id, step_key, words) values
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000e001', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'interest:c001', 'Expressed interest in Lane Co.'),
  ('00000000-0000-4000-8000-00000000d002', null, pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'started', 'Started standing in.');
insert into q_runtime.presence (user_id, tenant_id) values
  (pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a')),
  (pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b'));
insert into communication.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth) values
  (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'https://push.example.invalid/a1',
   repeat('B', 87), repeat('k', 22));
insert into communication.notification_settings (user_id, tenant_id, push, email) values
  (pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'), true, false);

-- Shape ------------------------------------------------------------------------
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'q_runtime.delegations'::regclass, 'q_runtime.delegation_lanes'::regclass,
  'q_runtime.delegation_steps'::regclass, 'q_runtime.presence'::regclass,
  'communication.push_subscriptions'::regclass, 'communication.notification_settings'::regclass)),
  true, 'row level security is on for every new table');
select ok(not has_column_privilege('authenticated', 'communication.push_subscriptions', 'endpoint', 'select'),
  'no client may read a push endpoint');
select ok(not has_column_privilege('authenticated', 'communication.push_subscriptions', 'auth', 'select'),
  'no client may read a push auth secret');

-- Constraints ------------------------------------------------------------------
select throws_ok(
  $$ insert into q_runtime.delegations (tenant_id, user_id, kind, q_action_id, grant_plan, thread_id, expires_at)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'INVESTOR_OUTREACH', '00000000-0000-4000-8000-00000000a001', '{}', 'work:again000', now()) $$,
  '23505', null, 'one delegation per approved action');
select throws_ok(
  $$ insert into q_runtime.delegation_lanes (delegation_id, tenant_id, user_id, company_id, counterpart_name, stage)
     values ('00000000-0000-4000-8000-00000000d001', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000c001', 'Dup', 'SHORTLISTED') $$,
  '23505', null, 'one lane per company in a delegation');
select throws_ok(
  $$ insert into q_runtime.delegation_lanes (delegation_id, tenant_id, user_id, counterpart_name, stage)
     values ('00000000-0000-4000-8000-00000000d001', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'Nobody', 'SHORTLISTED') $$,
  '23514', null, 'a lane names its counterpart');
select throws_ok(
  $$ update q_runtime.delegation_steps set words = 'rewritten' $$,
  '42501', null, 'steps are append-only, even for the server');
select throws_ok(
  $$ delete from q_runtime.delegation_steps $$,
  '42501', null, 'steps cannot be deleted');
select throws_ok(
  $$ insert into communication.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'http://insecure.example.invalid/x', repeat('B', 87), repeat('k', 22)) $$,
  '23514', null, 'a push endpoint is https only');
select throws_ok(
  $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key, priority)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'Q_WORK', 'x', 'work:fixture-1', 'URGENT') $$,
  '23514', null, 'priority is NEEDS_YOU or UPDATE');
select throws_ok(
  $$ update q_runtime.delegation_lanes set report = '{"headline": "x"}'::jsonb $$,
  '23514', null, 'a report carries the time it was written');
select lives_ok(
  $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key, priority)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'Q_WORK', 'Q needs your times', 'work:fixture-2', 'NEEDS_YOU') $$,
  'a Q_WORK notice that needs the person is accepted');

-- Server role ------------------------------------------------------------------
select is((select count(*)::int from q_runtime.delegations
            where user_id in (pg_temp.rls_id('user_a'), pg_temp.rls_id('user_b'), pg_temp.rls_id('user_r'))),
          3, 'the server role reads every delegation');

-- Clients: q_runtime is a server-only schema (no usage grant); the owner
-- policies above are a second layer should that ever change. -----------------
select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from q_runtime.delegations $$, '42501', null,
  'B cannot reach delegations directly; the API answers for their own');
select throws_ok($$ select count(*) from q_runtime.delegation_steps $$, '42501', null,
  'B cannot reach the step trail directly');
select throws_ok($$ insert into q_runtime.presence (user_id, tenant_id) values (pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b')) $$,
  '42501', null, 'B cannot write presence directly');
select is((select count(*)::int from communication.push_subscriptions), 0, 'B sees no other person''s device');
select is((select count(*)::int from communication.notification_settings), 0, 'B sees no other person''s settings');
select is((select count(*)::int from communication.notifications where kind = 'Q_WORK'), 1, 'B sees their own Q_WORK notice');

-- Positive: A (founder) ------------------------------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from communication.push_subscriptions), 1, 'A sees their own device');
select is((select email from communication.notification_settings), false, 'A reads their own settings');
select throws_ok($$ update communication.notification_settings set push = false $$, '42501', null,
  'A cannot write settings directly (the API does)');
select is((select count(*)::int from communication.notifications where kind = 'Q_WORK'), 0, 'A never sees B''s notice');

-- Revoked membership ----------------------------------------------------------------
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from communication.notification_settings), 0,
  'a revoked person reads no settings');

-- Anonymous -------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from q_runtime.delegations $$, '42501', null,
  'an anonymous visitor cannot read delegations');
select throws_ok($$ select count(*) from communication.push_subscriptions $$, '42501', null,
  'an anonymous visitor cannot read push subscriptions');
select throws_ok($$ select count(*) from communication.notification_settings $$, '42501', null,
  'an anonymous visitor cannot read notification settings');

select * from finish();
rollback;
