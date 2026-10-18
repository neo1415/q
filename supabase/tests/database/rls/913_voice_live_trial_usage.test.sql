-- GPT-Live trial (20261222160000): active speech used per provider session.
--
-- Owner-private and server-only: no browser principal reads or writes a
-- row, its own included. A row only grows, keeps its owner, and is never
-- deleted by the server role. A person's use is the sum of their rows,
-- read with an explicit tenant and user.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the Q API writes usage only as the person on
-- the line, with their tenant and user).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(17);

select ok(
  (select relrowsecurity from pg_class where oid = 'q_runtime.voice_live_trial_usage'::regclass),
  'RLS is on');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'q_runtime' and tablename = 'voice_live_trial_usage'),
  0, 'no policies: the table is server-only');
select ok(
  not has_table_privilege('service_role', 'q_runtime.voice_live_trial_usage', 'DELETE'),
  'spent allowance is not given back: delete is not granted');

-- Writing usage ---------------------------------------------------------------------
select lives_ok(
  $$ insert into q_runtime.voice_live_trial_usage
       (tenant_id, user_id, provider_session_id, voice_session_id, speech_seconds)
     values
       (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'sess_a1', 'b623d495-dee0-4d99-9035-4b68adee3938', 42.5),
       (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'sess_a2', 'b623d495-dee0-4d99-9035-4b68adee3938', 10),
       (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'sess_b1', 'line-b', 7) $$,
  'the Q API records each provider session''s speech');
select lives_ok(
  $$ update q_runtime.voice_live_trial_usage set speech_seconds = 60
      where tenant_id = pg_temp.rls_id('tenant_a') and user_id = pg_temp.rls_id('user_a')
        and provider_session_id = 'sess_a1' $$,
  'a session''s count grows as it is measured');
select throws_ok(
  $$ update q_runtime.voice_live_trial_usage set speech_seconds = 1
      where provider_session_id = 'sess_a1' $$,
  '23514', null, 'a count never decreases');
select throws_ok(
  $$ update q_runtime.voice_live_trial_usage set user_id = pg_temp.rls_id('user_b'), speech_seconds = 61
      where provider_session_id = 'sess_a1' $$,
  '23514', null, 'a row keeps its owner');
select throws_ok(
  $$ insert into q_runtime.voice_live_trial_usage
       (tenant_id, user_id, provider_session_id, voice_session_id, speech_seconds)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'sess_neg', 'line-a', -1) $$,
  '23514', null, 'seconds are never negative');
select throws_ok(
  $$ insert into q_runtime.voice_live_trial_usage
       (tenant_id, user_id, provider_session_id, voice_session_id, speech_seconds)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '{"payload":1}', 'line-a', 1) $$,
  '23514', null, 'a provider session id is opaque, never a payload');

-- Positive and cross-tenant reads (the server role, filtered as the Q API does) ------
select is(
  (select sum(speech_seconds) from q_runtime.voice_live_trial_usage
    where tenant_id = pg_temp.rls_id('tenant_a') and user_id = pg_temp.rls_id('user_a')),
  70.00::numeric, 'a person''s use is the sum of their sessions');
select is(
  (select coalesce(sum(speech_seconds), 0) from q_runtime.voice_live_trial_usage
    where tenant_id = pg_temp.rls_id('tenant_b') and user_id = pg_temp.rls_id('user_a')),
  0::numeric, 'another tenant''s read for the same person sees none of it');

-- Browser principals ------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from q_runtime.voice_live_trial_usage $$,
  '42501', null, 'anonymous cannot read usage');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from q_runtime.voice_live_trial_usage $$,
  '42501', null, 'an authenticated browser session cannot read usage, even its own');
select throws_ok(
  $$ update q_runtime.voice_live_trial_usage set speech_seconds = 0 $$,
  '42501', null, 'a browser session cannot reset usage');
select throws_ok(
  $$ delete from q_runtime.voice_live_trial_usage $$,
  '42501', null, 'a browser session cannot delete usage');

select pg_temp.act_as_revoked_user();
select throws_ok($$ select count(*) from q_runtime.voice_live_trial_usage $$,
  '42501', null, 'a revoked user reads nothing');

select pg_temp.act_as_privileged();
select is((select count(*)::int from q_runtime.voice_live_trial_usage), 3,
  'the privileged server role reads every row; DB privilege is not business authorisation');

select * from finish();
rollback;
