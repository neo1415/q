-- Shared video allowance (5 a week per person across GateQ and Rehearsals),
-- the monthly account safeguard, testers, and the append-only usage ledger.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(20);

-- Isolate from any other reservations this month; the cap is tested below.
update billing.video_allowance_config set monthly_cap_seconds = 1000000;

create function pg_temp.rehearsal_video(account text, tenant text) returns uuid language plpgsql as $$
declare rid uuid := gen_random_uuid(); sid uuid := gen_random_uuid(); stamp timestamptz := clock_timestamp();
begin
  insert into q_runtime.rehearsals (id,tenant_id,user_id,counterpart_kind,counterpart_id,counterpart_name,persona)
  values (rid,pg_temp.rls_id(tenant),pg_temp.rls_id(account),'COMPANY',gen_random_uuid(),'Company','{}');
  insert into q_runtime.rehearsal_video_sessions (id,tenant_id,user_id,rehearsal_id,interviewer_id,bridge_token_hash,created_at,ends_at)
  values (sid,pg_temp.rls_id(tenant),pg_temp.rls_id(account),rid,'partner-steve',repeat(replace(rid::text,'-',''),2),stamp,stamp+interval '180 seconds');
  return sid;
end;
$$;
create function pg_temp.reserve(subject text) returns void language sql as $$
  select billing.reserve_video_session(gen_random_uuid(), 'GATEQ', gen_random_uuid(), subject, 180);
$$;

-- A rehearsal row reserves for its user, in the same statement.
select lives_ok($$select pg_temp.rehearsal_video('user_a','tenant_a')$$, 'a rehearsal video session reserves for its user');
select is((select count(*)::int from billing.video_session_reservations
            where subject_key = 'user:' || pg_temp.rls_id('user_a')::text and product = 'REHEARSAL'),
  1, 'the reservation is keyed to the signed-in user');
select is((select event from billing.video_usage_ledger l join billing.video_session_reservations r using (session_id)
            where r.subject_key = 'user:' || pg_temp.rls_id('user_a')::text),
  'RESERVED', 'and ledgered');

-- Four more for the same person (any product) fill the week; the sixth is refused.
select lives_ok($$select pg_temp.reserve('user:' || pg_temp.rls_id('user_a')::text) from generate_series(1, 4)$$,
  'GateQ sessions share the same weekly allowance');
select is((select remaining from billing.video_allowance_status('user:' || pg_temp.rls_id('user_a')::text)),
  0, 'the status shows none left this week');
select throws_ok($$select pg_temp.reserve('user:' || pg_temp.rls_id('user_a')::text)$$,
  'P0001', 'CQ_VIDEO_WEEKLY_ALLOWANCE_EXHAUSTED', 'a sixth session in the week is refused');
select is((select remaining from billing.video_allowance_status('email:' || repeat('b', 64))),
  5, 'another person keeps their own five');
select ok((select resets_at > now() and resets_at <= now() + interval '7 days'
             from billing.video_allowance_status('email:' || repeat('b', 64))), 'the week resets within seven days');
select throws_ok($$select billing.reserve_video_session(gen_random_uuid(), 'GATEQ', gen_random_uuid(), 'email:' || repeat('b', 64), 181)$$,
  'P0001', 'CQ_VIDEO_SESSION_TOO_LONG', 'no session may exceed 180 seconds');

-- Settlement: billed in whole minutes; a room that never existed is released.
select lives_ok($$select billing.reserve_video_session('00000000-0000-4000-8000-0000000929a1', 'GATEQ', gen_random_uuid(), 'email:' || repeat('c', 64), 180)$$,
  'a reservation with a known id');
select lives_ok($$select billing.settle_video_session('00000000-0000-4000-8000-0000000929a1', 61, false)$$, 'it settles');
select is((select billed_minutes from billing.video_usage_ledger where session_id = '00000000-0000-4000-8000-0000000929a1' and event = 'SETTLED'),
  2, '61 seconds is two billed minutes');
select lives_ok($$select billing.reserve_video_session('00000000-0000-4000-8000-0000000929a2', 'GATEQ', gen_random_uuid(), 'email:' || repeat('c', 64), 180)$$,
  'a second reservation');
select lives_ok($$select billing.settle_video_session('00000000-0000-4000-8000-0000000929a2', 0, true)$$, 'it is released');
select is((select used from billing.video_allowance_status('email:' || repeat('c', 64))), 1, 'a released session gives the allowance back');

-- Append-only and forward-only.
select throws_ok($$update billing.video_usage_ledger set seconds = 0$$, '23514', null, 'the ledger is never rewritten');
select throws_ok($$update billing.video_session_reservations set status = 'RESERVED', settled_at = null, settled_seconds = null
                    where session_id = '00000000-0000-4000-8000-0000000929a1'$$, '23514', null, 'a settled reservation never reopens');

-- Testers skip the weekly allowance but are ledgered and count against the cap.
insert into billing.video_allowance_testers values ('user:' || pg_temp.rls_id('user_a')::text, 'acceptance tester');
select lives_ok($$select pg_temp.reserve('user:' || pg_temp.rls_id('user_a')::text)$$, 'a listed tester is not limited by the week');
update billing.video_allowance_config set monthly_cap_seconds = 0;
select throws_ok($$select pg_temp.reserve('user:' || pg_temp.rls_id('user_a')::text)$$,
  'P0001', 'CQ_VIDEO_GLOBAL_CAP', 'the monthly account safeguard binds testers too');

select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'billing' and table_name in ('video_allowance_config', 'video_allowance_testers',
              'video_session_reservations', 'video_usage_ledger') and grantee in ('anon', 'authenticated')),
  0, 'no browser grants on the allowance tables');

select * from finish();
rollback;
