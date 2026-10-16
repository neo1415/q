-- Lane ob1 · onboarding.pending_writes: a confirmed change held for retry is
-- constrained, one PENDING per session step, immutable in what it carries,
-- settles once, is never deleted, and is server-only (no browser principal
-- reads or writes it, its owner included).
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(16);

insert into onboarding.definitions (id, journey_type, name)
values ('00000000-0000-4000-8000-0000000961d0', 'external_investor_conversion', 'Pending writes (test)')
on conflict (journey_type) do nothing;
insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
values ('00000000-0000-4000-8000-0000000961d1', (select id from onboarding.definitions where journey_type = 'external_investor_conversion'), 61,
        '{"schemaVersion": 1, "phases": [], "runtime": {"subjectType": "COMPANY", "allowUnboundStart": true}}',
        repeat('d', 64));
insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, required, configuration)
values ('00000000-0000-4000-8000-0000000961d1', 'intent', 0, 'short_text', true, '{"prompt": "What brings you here?"}');
insert into onboarding.sessions (id, user_id, journey_type, definition_version_id, current_step_key)
values ('00000000-0000-4000-8000-0000000961e1', pg_temp.rls_id('user_a'), 'external_investor_conversion', '00000000-0000-4000-8000-0000000961d1', 'intent');

-- Positive ----------------------------------------------------------------------------
select lives_ok(
  $$ insert into onboarding.pending_writes (id, session_id, user_id, step_key, response, origin, idempotency_key)
     values ('00000000-0000-4000-8000-0000000961f1', '00000000-0000-4000-8000-0000000961e1', pg_temp.rls_id('user_a'),
             'intent', '{"value": {"type": "TEXT", "text": "Raising a seed round"}}', 'CONVERSATION',
             '00000000-0000-4000-8000-0000000961a1') $$,
  'a confirmed change is held');

-- One pending per step ------------------------------------------------------------------
select throws_ok(
  $$ insert into onboarding.pending_writes (session_id, user_id, step_key, response, origin, idempotency_key)
     values ('00000000-0000-4000-8000-0000000961e1', pg_temp.rls_id('user_a'), 'intent',
             '{"value": {"type": "TEXT", "text": "Raising a Series A"}}', 'CONVERSATION', '00000000-0000-4000-8000-0000000961a2') $$,
  '23505', null, 'one PENDING change per session step');
select throws_ok(
  $$ insert into onboarding.pending_writes (session_id, user_id, step_key, response, origin, idempotency_key, status, settled_at)
     values ('00000000-0000-4000-8000-0000000961e1', pg_temp.rls_id('user_a'), 'other',
             '{"value": {"type": "TEXT", "text": "x"}}', 'FORM', '00000000-0000-4000-8000-0000000961a1', 'APPLIED', now()) $$,
  '23505', null, 'an idempotency key is used once per session');

-- Constraints --------------------------------------------------------------------------
select throws_ok(
  $$ insert into onboarding.pending_writes (session_id, user_id, step_key, response, origin, idempotency_key)
     values ('00000000-0000-4000-8000-0000000961e1', pg_temp.rls_id('user_a'), 'x', '{}', 'EMAIL', gen_random_uuid()) $$,
  '23514', null, 'origin vocabulary is closed');
select throws_ok(
  $$ insert into onboarding.pending_writes (session_id, user_id, step_key, response, origin, idempotency_key)
     values ('00000000-0000-4000-8000-0000000961e1', pg_temp.rls_id('user_a'), 'x', '[1]', 'FORM', gen_random_uuid()) $$,
  '23514', null, 'the response is an object');
select throws_ok(
  $$ insert into onboarding.pending_writes (session_id, user_id, step_key, response, origin, idempotency_key)
     values ('00000000-0000-4000-8000-0000000961e1', pg_temp.rls_id('user_a'), 'not a key!', '{}', 'FORM', gen_random_uuid()) $$,
  '23514', null, 'a step key is a stable key');
select throws_ok(
  $$ insert into onboarding.pending_writes (session_id, user_id, step_key, response, origin, idempotency_key, last_error)
     values ('00000000-0000-4000-8000-0000000961e1', pg_temp.rls_id('user_a'), 'y', '{}', 'FORM', gen_random_uuid(), 'connect ECONNREFUSED 10.0.0.1') $$,
  '23514', null, 'an error is a stable code, never a raw message');
select throws_ok(
  $$ insert into onboarding.pending_writes (session_id, user_id, step_key, response, origin, idempotency_key, status)
     values ('00000000-0000-4000-8000-0000000961e1', pg_temp.rls_id('user_a'), 'z', '{}', 'FORM', gen_random_uuid(), 'APPLIED') $$,
  '23514', null, 'a settled change carries when it settled');

-- Lifecycle ----------------------------------------------------------------------------
select lives_ok(
  $$ update onboarding.pending_writes set attempts = attempts + 1, last_error = 'UPSTREAM_UNAVAILABLE'
      where id = '00000000-0000-4000-8000-0000000961f1' $$,
  'a retry is counted');
select throws_ok(
  $$ update onboarding.pending_writes set response = '{"value": {"type": "TEXT", "text": "changed"}}'
      where id = '00000000-0000-4000-8000-0000000961f1' $$,
  '23001', null, 'what was confirmed cannot be rewritten');
select lives_ok(
  $$ update onboarding.pending_writes set status = 'APPLIED', settled_at = now()
      where id = '00000000-0000-4000-8000-0000000961f1' $$,
  'it settles once it lands');
select throws_ok(
  $$ update onboarding.pending_writes set status = 'PENDING', settled_at = null
      where id = '00000000-0000-4000-8000-0000000961f1' $$,
  '23001', null, 'a settled change never moves again');
select throws_ok(
  $$ delete from onboarding.pending_writes where id = '00000000-0000-4000-8000-0000000961f1' $$,
  '23001', null, 'a held change is never deleted');

-- Exposure -----------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from onboarding.pending_writes $$, '42501', null,
  'browser user A cannot read held changes, even their own');
select pg_temp.act_as_user_b();
select throws_ok($$ select * from onboarding.pending_writes where session_id = '00000000-0000-4000-8000-0000000961e1' $$, '42501', null,
  'another person cannot read user A''s held changes');
select pg_temp.act_as_anonymous();
select throws_ok(
  $$ insert into onboarding.pending_writes (session_id, user_id, step_key, response, origin, idempotency_key)
     values ('00000000-0000-4000-8000-0000000961e1', pg_temp.rls_id('user_a'), 'w', '{}', 'FORM', gen_random_uuid()) $$,
  '42501', null, 'anonymous denied');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
