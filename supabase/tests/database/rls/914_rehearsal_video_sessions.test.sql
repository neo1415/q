-- Video rehearsals (20261222175000): one provider session per rehearsal.
--
-- Server-only: no browser principal reads or writes a row, its own
-- included. One session per rehearsal (idempotency), the cap fixed at
-- creation and never longer than three minutes, the bridge bearer stored
-- only as a hash, the provider key kept by index and never changed, and a
-- closed session never reopens.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the Q API reads a session only for its own
-- founder, with tenant and user, or by the hash of the bearer it issued).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(19);

insert into q_runtime.rehearsals
  (id, tenant_id, user_id, counterpart_kind, counterpart_id, counterpart_name, persona)
values
  ('00000000-0000-4000-8000-0000000914a1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
   'INVESTOR_ORGANISATION', '00000000-0000-4000-8000-0000000914f1', 'Fund One', '{}'),
  ('00000000-0000-4000-8000-0000000914b1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),
   'INVESTOR_ORGANISATION', '00000000-0000-4000-8000-0000000914f2', 'Fund Two', '{}');

select ok(
  (select relrowsecurity from pg_class where oid = 'q_runtime.rehearsal_video_sessions'::regclass),
  'RLS is on');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'q_runtime' and tablename = 'rehearsal_video_sessions'),
  0, 'no policies: the table is server-only');
select ok(
  not has_table_privilege('service_role', 'q_runtime.rehearsal_video_sessions', 'DELETE'),
  'a session record is never deleted');

-- Writing sessions -----------------------------------------------------------------
select lives_ok(
  $$ insert into q_runtime.rehearsal_video_sessions
       (id, tenant_id, user_id, rehearsal_id, interviewer_id, bridge_token_hash, ends_at)
     values
       ('00000000-0000-4000-8000-0000000914a2', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
        '00000000-0000-4000-8000-0000000914a1', 'partner-steve', repeat('a', 64),
        clock_timestamp() + interval '180 seconds'),
       ('00000000-0000-4000-8000-0000000914b2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),
        '00000000-0000-4000-8000-0000000914b1', 'partner-steve', repeat('b', 64),
        clock_timestamp() + interval '180 seconds') $$,
  'the Q API records a video session per rehearsal');
select throws_ok(
  $$ insert into q_runtime.rehearsal_video_sessions
       (id, tenant_id, user_id, rehearsal_id, interviewer_id, bridge_token_hash, ends_at)
     values ('00000000-0000-4000-8000-0000000914a3', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-0000000914a1', 'partner-steve', repeat('c', 64),
             clock_timestamp() + interval '180 seconds') $$,
  '23505', null, 'one video session per rehearsal: a second is refused');
select throws_ok(
  $$ insert into q_runtime.rehearsal_video_sessions
       (id, tenant_id, user_id, rehearsal_id, interviewer_id, bridge_token_hash, created_at, ends_at)
     values ('00000000-0000-4000-8000-0000000914a4', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-0000000914f1', 'partner-steve', repeat('d', 64),
             '2026-10-12T10:00:00Z', '2026-10-12T10:10:00Z') $$,
  '23514', null, 'a session can never be longer than three minutes');
select throws_ok(
  $$ insert into q_runtime.rehearsal_video_sessions
       (id, tenant_id, user_id, rehearsal_id, interviewer_id, bridge_token_hash, ends_at)
     values ('00000000-0000-4000-8000-0000000914a5', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-0000000914f1', 'partner-steve', 'plain-secret-not-a-hash',
             clock_timestamp() + interval '180 seconds') $$,
  '23514', null, 'the bridge bearer is stored only as a SHA-256 hash');
select lives_ok(
  $$ update q_runtime.rehearsal_video_sessions
        set status = 'LIVE', provider_key_index = 2, provider_pal_id = 'p9abc',
            provider_conversation_id = 'c123abc'
      where id = '00000000-0000-4000-8000-0000000914a2'
        and tenant_id = pg_temp.rls_id('tenant_a') and user_id = pg_temp.rls_id('user_a') $$,
  'the session goes live with the provider key it used');
select throws_ok(
  $$ update q_runtime.rehearsal_video_sessions
        set ends_at = ends_at + interval '60 seconds'
      where id = '00000000-0000-4000-8000-0000000914a2' $$,
  '23514', null, 'the cap never moves');
select throws_ok(
  $$ update q_runtime.rehearsal_video_sessions
        set provider_key_index = 3
      where id = '00000000-0000-4000-8000-0000000914a2' $$,
  '23514', null, 'a session keeps its provider key, so ending uses the same account');
select throws_ok(
  $$ update q_runtime.rehearsal_video_sessions
        set user_id = pg_temp.rls_id('user_b')
      where id = '00000000-0000-4000-8000-0000000914a2' $$,
  '23514', null, 'a session keeps its owner');
select lives_ok(
  $$ update q_runtime.rehearsal_video_sessions
        set status = 'ENDED', ended_reason = 'TIME_LIMIT', ended_at = clock_timestamp(), seconds = 180
      where id = '00000000-0000-4000-8000-0000000914a2' $$,
  'the session ends with its reason and seconds');
select throws_ok(
  $$ update q_runtime.rehearsal_video_sessions
        set status = 'LIVE', ended_reason = null, ended_at = null
      where id = '00000000-0000-4000-8000-0000000914a2' $$,
  '23514', null, 'a closed session never reopens');

-- Cross-tenant read, as the Q API filters ----------------------------------------------
select is(
  (select count(*)::int from q_runtime.rehearsal_video_sessions
    where tenant_id = pg_temp.rls_id('tenant_b') and user_id = pg_temp.rls_id('user_a')),
  0, 'another tenant''s read for the same person sees none of it');

-- Browser principals ------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from q_runtime.rehearsal_video_sessions $$,
  '42501', null, 'anonymous cannot read sessions');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from q_runtime.rehearsal_video_sessions $$,
  '42501', null, 'an authenticated browser session cannot read sessions, even its own');
select throws_ok(
  $$ update q_runtime.rehearsal_video_sessions set status = 'LIVE' $$,
  '42501', null, 'a browser session cannot change a session');

select pg_temp.act_as_revoked_user();
select throws_ok($$ select count(*) from q_runtime.rehearsal_video_sessions $$,
  '42501', null, 'a revoked user reads nothing');

select pg_temp.act_as_privileged();
select is((select count(*)::int from q_runtime.rehearsal_video_sessions), 2,
  'the privileged server role reads every row; DB privilege is not business authorisation');

select * from finish();
rollback;
