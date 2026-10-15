-- Q's face in Google Meet (20261227160000): one face per meeting, reserved
-- in the shared video ledger as MEETING in the same statement, bounded by
-- the organiser's weekly allowance, the monthly safeguard, its own hard
-- length and concurrency; settled from the provider request; no browser
-- access.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(20);

update billing.video_allowance_config set monthly_cap_seconds = 1000000;

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000931c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Face Co A', 'face-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000931e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Face Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000093101', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000931c1', '00000000-0000-4000-8000-0000000931e2', 'CONNECTED');
insert into communication.meetings (id, tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, status, google_event_id, meet_link, idempotency_key)
select ('00000000-0000-4000-8000-00000009310' || n)::uuid, pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000093101',
       pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'), 'Intro call', now() + interval '1 day', now() + interval '1 day 30 minutes',
       'Europe/London', 'SCHEDULED', '00000000000040008000000000009310' || n, 'https://meet.google.com/abc-defg-hij', 'q-action:fixture-face-' || n
  from generate_series(2, 4) n;

create function pg_temp.face(meeting text, seconds integer) returns uuid language plpgsql as $$
declare sid uuid := gen_random_uuid(); stamp timestamptz := clock_timestamp();
begin
  insert into communication.meeting_face_sessions
    (id, tenant_id, meeting_id, organiser_user_id, face_id, bridge_token_hash, created_at, ends_at)
  values (sid, pg_temp.rls_id('tenant_a'), meeting::uuid, pg_temp.rls_id('user_a'), 'r4f5b5ef55c8',
          encode(sha256(convert_to(sid::text, 'UTF8')), 'hex'), stamp, stamp + make_interval(secs => seconds));
  return sid;
end;
$$;

select ok((select relrowsecurity from pg_class where oid = 'communication.meeting_face_sessions'::regclass),
  'RLS is on for meeting face sessions');
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'communication' and table_name = 'meeting_face_sessions'
              and grantee in ('anon', 'authenticated')),
  0, 'no browser grants on meeting face sessions');

-- A face reserves for the organiser, as MEETING, in the same statement.
select lives_ok($$select pg_temp.face('00000000-0000-4000-8000-000000093102', 600)$$, 'a ten-minute face starts');
select is((select product || ':' || reserved_seconds from billing.video_session_reservations r
             join communication.meeting_face_sessions f on f.id = r.session_id
            where f.meeting_id = '00000000-0000-4000-8000-000000093102'),
  'MEETING:600', 'reserved as MEETING for its full hard length');
select is((select subject_key from billing.video_session_reservations r
             join communication.meeting_face_sessions f on f.id = r.session_id
            where f.meeting_id = '00000000-0000-4000-8000-000000093102'),
  'user:' || pg_temp.rls_id('user_a')::text, 'keyed to the organiser, sharing their weekly allowance');

-- One face per meeting; one at a time by default.
select throws_ok($$select pg_temp.face('00000000-0000-4000-8000-000000093102', 600)$$,
  '23505', null, 'a meeting never gets a second face');
select lives_ok($$insert into communication.meeting_face_sessions
                     (id, tenant_id, meeting_id, organiser_user_id, face_id, bridge_token_hash, created_at, ends_at)
                   values (gen_random_uuid(), pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000093102',
                           pg_temp.rls_id('user_a'), 'r4f5b5ef55c8', repeat('a', 64), now(), now() + interval '600 seconds')
                   on conflict (meeting_id) do nothing$$,
  'a retried start (ON CONFLICT DO NOTHING) is quiet');
select is((select count(*)::int from billing.video_session_reservations where product = 'MEETING'),
  1, 'and makes no second row or reservation');
select throws_ok($$select pg_temp.face('00000000-0000-4000-8000-000000093103', 600)$$,
  'P0001', 'CQ_VIDEO_CONCURRENCY_LIMIT', 'a second face at the same time is refused');

-- It moves forward only, and its clock never changes.
select throws_ok($$update communication.meeting_face_sessions set ends_at = ends_at + interval '1 minute'
                    where meeting_id = '00000000-0000-4000-8000-000000093102'$$,
  '23514', null, 'the hard length is fixed when the face starts');

-- Asked the provider for a room: settled from the elapsed time, never released.
update communication.meeting_face_sessions
   set pal_id = 'pal931', provider_request_started_at = now(), provider_conversation_id = 'c931', status = 'LIVE'
 where meeting_id = '00000000-0000-4000-8000-000000093102';
update communication.meeting_face_sessions
   set status = 'ENDED', ended_reason = 'CALL_ENDED', ended_at = created_at + interval '250 seconds'
 where meeting_id = '00000000-0000-4000-8000-000000093102';
select is((select r.status || ':' || r.settled_seconds from billing.video_session_reservations r
             join communication.meeting_face_sessions f on f.id = r.session_id
            where f.meeting_id = '00000000-0000-4000-8000-000000093102'),
  'SETTLED:250', 'a face that ran 250 s is settled at 250 s (past the 240 s rehearsal ceiling)');
select is((select billed_minutes from billing.video_usage_ledger l
             join communication.meeting_face_sessions f on f.id = l.session_id
            where f.meeting_id = '00000000-0000-4000-8000-000000093102' and l.event = 'SETTLED'),
  5, 'in whole billed minutes');
select throws_ok($$update communication.meeting_face_sessions set status = 'LIVE'
                    where meeting_id = '00000000-0000-4000-8000-000000093102'$$,
  '23514', null, 'an ended face never reopens');

-- Never reached the provider: released, the allowance comes back.
select lives_ok($$select pg_temp.face('00000000-0000-4000-8000-000000093103', 300)$$, 'the next meeting may have a face once the first ended');
update communication.meeting_face_sessions
   set status = 'FAILED', ended_reason = 'PROVIDER_FAILED', ended_at = now()
 where meeting_id = '00000000-0000-4000-8000-000000093103';
select is((select r.status from billing.video_session_reservations r
             join communication.meeting_face_sessions f on f.id = r.session_id
            where f.meeting_id = '00000000-0000-4000-8000-000000093103'),
  'RELEASED', 'a face that never reached the provider is released');

-- Its own hard length, from the ledger's configuration.
update billing.video_allowance_config set meeting_max_seconds = 300;
select throws_ok($$select pg_temp.face('00000000-0000-4000-8000-000000093104', 600)$$,
  'P0001', 'CQ_VIDEO_SESSION_TOO_LONG', 'no face may run past the configured meeting length');
select throws_ok($$select billing.reserve_video_session(gen_random_uuid(), 'GATEQ', gen_random_uuid(), 'email:' || repeat('d', 64), 181)$$,
  'P0001', 'CQ_VIDEO_SESSION_TOO_LONG', 'GateQ and Rehearsals keep their own 180 s cap');

-- The monthly safeguard binds faces too; turning faces off refuses at once.
update billing.video_allowance_config set monthly_cap_seconds = 0;
select throws_ok($$select pg_temp.face('00000000-0000-4000-8000-000000093104', 300)$$,
  'P0001', 'CQ_VIDEO_GLOBAL_CAP', 'the monthly account safeguard refuses a face');
update billing.video_allowance_config set monthly_cap_seconds = 1000000, meeting_concurrent = 0;
select throws_ok($$select pg_temp.face('00000000-0000-4000-8000-000000093104', 300)$$,
  'P0001', 'CQ_VIDEO_CONCURRENCY_LIMIT', 'meeting_concurrent = 0 turns faces off');
select is((select count(*)::int from communication.meeting_face_sessions
            where meeting_id = '00000000-0000-4000-8000-000000093104'),
  0, 'a refused face leaves no row (and no reservation)');

select * from finish();
rollback;
