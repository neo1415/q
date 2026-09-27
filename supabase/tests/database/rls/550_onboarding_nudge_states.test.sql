-- (lead-owned migration test, for review)
-- onboarding.nudge_states: one row per person, constrained, and
-- server-only (no browser principal reads anyone's reminder state, their
-- own included; the API and Q read it for the authenticated person).
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(12);

-- Positive ----------------------------------------------------------------------------
select lives_ok(
  $$ insert into onboarding.nudge_states (user_id, policy_version)
     values (pg_temp.rls_id('user_a'), 'onboarding-nudge/test') $$,
  'a person''s empty reminder state is recorded');
select lives_ok(
  $$ update onboarding.nudge_states
        set last_shown_at = now(), last_surface = 'Q_NOTE', shown_count = 1,
            last_conversation_id = '00000000-0000-4000-8000-0000000005a1',
            snoozed_until = now() + interval '3 days'
      where user_id = pg_temp.rls_id('user_a') $$,
  'a reminder given in a Q conversation is recorded');
select lives_ok(
  $$ update onboarding.nudge_states set stopped_at = now() where user_id = pg_temp.rls_id('user_a') $$,
  '"stop reminding me" is recorded');

-- One row per person -------------------------------------------------------------------
select throws_ok(
  $$ insert into onboarding.nudge_states (user_id, policy_version)
     values (pg_temp.rls_id('user_a'), 'onboarding-nudge/test') $$,
  '23505', null, 'one reminder state per person');

-- Constraints --------------------------------------------------------------------------
select throws_ok(
  $$ insert into onboarding.nudge_states (user_id, policy_version, last_shown_at, last_surface)
     values (pg_temp.rls_id('user_b'), 'onboarding-nudge/test', now(), 'EMAIL') $$,
  '23514', null, 'surface vocabulary is closed');
select throws_ok(
  $$ insert into onboarding.nudge_states (user_id, policy_version, last_shown_at)
     values (pg_temp.rls_id('user_b'), 'onboarding-nudge/test', now()) $$,
  '23514', null, 'a shown reminder names its surface');
select throws_ok(
  $$ insert into onboarding.nudge_states (user_id, policy_version, shown_count)
     values (pg_temp.rls_id('user_b'), 'onboarding-nudge/test', 2) $$,
  '23514', null, 'nothing counted as shown without a time');
select throws_ok(
  $$ insert into onboarding.nudge_states (user_id, policy_version)
     values (pg_temp.rls_id('user_b'), '') $$,
  '23514', null, 'the policy version is named');
select throws_ok(
  $$ insert into onboarding.nudge_states (user_id, policy_version)
     values ('00000000-0000-4000-8000-0000000005ff', 'onboarding-nudge/test') $$,
  '23503', null, 'only a real person has reminder state');

-- Exposure -----------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from onboarding.nudge_states $$, '42501', null,
  'browser user A cannot read the raw state, even their own');
select pg_temp.act_as_user_b();
select throws_ok(
  $$ update onboarding.nudge_states set stopped_at = null where user_id = pg_temp.rls_id('user_a') $$,
  '42501', null, 'another person cannot change user A''s reminders');
select pg_temp.act_as_anonymous();
select throws_ok(
  $$ insert into onboarding.nudge_states (user_id, policy_version)
     values (pg_temp.rls_id('user_b'), 'x') $$,
  '42501', null, 'anonymous denied');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
