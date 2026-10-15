-- The founder's clock starts when the interviewer is in the room, bounded
-- by a 30 s join grace, for GateQ and Rehearsals; the ledger counts what
-- may have run (20261227140000).
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(16);

update billing.video_allowance_config set monthly_cap_seconds = 1000000;

insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000931b1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Room Capital');
insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000931b2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000931b1', pg_temp.rls_id('org_b'),
   'gq_23456789abcdefghjkmnpq9310', 'Room programme', pg_temp.rls_id('user_b'));
insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-0000000931b3', '00000000-0000-4000-8000-0000000931b2', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Room seed', 'gateq-qualification.v1',
   pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());
insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-0000000931b4', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000931b2',
   '00000000-0000-4000-8000-0000000931b3', 'ga_23456789abcdefghjkmnpq9310');
-- Allocated 13 s ago, as in the live run.
insert into gateq.application_video_sessions
  (id, tenant_id, application_id, bridge_token_hash, events_token_hash, guest_credential_sealed, max_seconds, created_at, ends_at)
values ('00000000-0000-4000-8000-0000000931b5', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000931b4',
        repeat('a', 64), repeat('b', 64), 'sealed:v1:opaque', 180,
        now() - interval '13 seconds', now() + interval '167 seconds');

select throws_ok($$update gateq.application_video_sessions
                     set status = 'LIVE', provider_conversation_id = 'c931', room_ready_at = now(),
                         ends_at = now() + interval '240 seconds'
                   where id = '00000000-0000-4000-8000-0000000931b5'$$,
  '23514', null, 'a joinable room may stop no later than ready + grace + cap');
select lives_ok($$update gateq.application_video_sessions
                    set status = 'LIVE', provider_conversation_id = 'c931', room_ready_at = now(),
                        ends_at = now() + interval '30 seconds' + make_interval(secs => max_seconds)
                  where id = '00000000-0000-4000-8000-0000000931b5'$$,
  'a joinable room gets its provisional end, the hard stop');
select is((select live_at from gateq.application_video_sessions
            where id = '00000000-0000-4000-8000-0000000931b5'),
  null::timestamptz, 'the clock has not started before Q is in the room');
select throws_ok($$update gateq.application_video_sessions
                     set live_at = room_ready_at + interval '31 seconds',
                         ends_at = room_ready_at + interval '31 seconds' + make_interval(secs => max_seconds)
                   where id = '00000000-0000-4000-8000-0000000931b5'$$,
  '23514', null, 'Q in the room after the grace never extends the stop');
select throws_ok($$update gateq.application_video_sessions
                     set live_at = room_ready_at + interval '13 seconds',
                         ends_at = room_ready_at + interval '20 seconds' + make_interval(secs => max_seconds)
                   where id = '00000000-0000-4000-8000-0000000931b5'$$,
  '23514', null, 'Q in the room sets the end to exactly live + cap');
select lives_ok($$update gateq.application_video_sessions
                    set live_at = room_ready_at + interval '13 seconds',
                        ends_at = room_ready_at + interval '13 seconds' + make_interval(secs => max_seconds)
                  where id = '00000000-0000-4000-8000-0000000931b5'$$,
  'Q in the room starts the full cap from then');
select is((select extract(epoch from ends_at - live_at)::integer from gateq.application_video_sessions
            where id = '00000000-0000-4000-8000-0000000931b5'),
  180, 'the founder gets all 180 s with Q');
select throws_ok($$update gateq.application_video_sessions
                     set live_at = live_at + interval '1 second', ends_at = ends_at + interval '1 second'
                   where id = '00000000-0000-4000-8000-0000000931b5'$$,
  '23514', null, 'the clock never moves again');
select throws_ok($$update gateq.application_video_sessions set events_token_hash = repeat('c', 64)
                   where id = '00000000-0000-4000-8000-0000000931b5'$$,
  '23514', null, 'the callback secret''s hash never changes');

-- Ends 30 s after the stop would have fallen without the grace: counted in full.
update gateq.application_video_sessions
   set status = 'ENDED', ended_reason = 'TIME_LIMIT', ended_at = created_at + interval '206 seconds'
 where id = '00000000-0000-4000-8000-0000000931b5';
select is((select settled_seconds from billing.video_session_reservations
            where session_id = '00000000-0000-4000-8000-0000000931b5'),
  206, 'the ledger counts the grace it ran, never capped at 180');
select is((select billed_minutes from billing.video_usage_ledger
            where session_id = '00000000-0000-4000-8000-0000000931b5' and event = 'SETTLED'),
  4, 'billed in whole minutes, cap + grace at most');

-- Rehearsals: the same rule (live run 22c3cc68: the face came 17 s late).
insert into q_runtime.rehearsals (id, tenant_id, user_id, counterpart_kind, counterpart_id, counterpart_name, persona)
values ('00000000-0000-4000-8000-0000000931a1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
        'COMPANY', gen_random_uuid(), 'Company', '{}');
insert into q_runtime.rehearsal_video_sessions
  (id, tenant_id, user_id, rehearsal_id, interviewer_id, bridge_token_hash, events_token_hash, created_at, ends_at)
values ('00000000-0000-4000-8000-0000000931a2', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
        '00000000-0000-4000-8000-0000000931a1', 'partner-steve', repeat('d', 64), repeat('f', 64),
        now() - interval '5 seconds', now() + interval '175 seconds');
select lives_ok($$update q_runtime.rehearsal_video_sessions
                    set status = 'LIVE', provider_key_index = 0, provider_pal_id = 'p931',
                        provider_conversation_id = 'c931', sealed_join_url = repeat('x', 48),
                        room_ready_at = now(), ends_at = now() + interval '210 seconds'
                  where id = '00000000-0000-4000-8000-0000000931a2'$$,
  'a joinable rehearsal room gets the hard stop, ready + 30 s + 180 s');
select throws_ok($$update q_runtime.rehearsal_video_sessions
                     set live_at = room_ready_at + interval '31 seconds',
                         ends_at = room_ready_at + interval '211 seconds'
                   where id = '00000000-0000-4000-8000-0000000931a2'$$,
  '23514', null, 'a late interviewer never extends the rehearsal stop');
select lives_ok($$update q_runtime.rehearsal_video_sessions
                    set live_at = room_ready_at + interval '17 seconds',
                        ends_at = room_ready_at + interval '197 seconds'
                  where id = '00000000-0000-4000-8000-0000000931a2'$$,
  'the interviewer in the room starts the founder''s 180 s');
select throws_ok($$update q_runtime.rehearsal_video_sessions
                     set ends_at = ends_at + interval '1 second'
                   where id = '00000000-0000-4000-8000-0000000931a2'$$,
  '23514', null, 'the rehearsal clock never moves again');
update q_runtime.rehearsal_video_sessions
   set status = 'ENDED', ended_reason = 'TIME_LIMIT', ended_at = created_at + interval '205 seconds', seconds = 205
 where id = '00000000-0000-4000-8000-0000000931a2';
select is((select settled_seconds from billing.video_session_reservations
            where session_id = '00000000-0000-4000-8000-0000000931a2'),
  205, 'a rehearsal settles what it ran, no longer clipped at 180');

select * from finish();
rollback;
