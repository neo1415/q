-- The founder's video clock starts when the room is ready, once; billing
-- still reserves from allocation (20261226160000).
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(8);

update billing.video_allowance_config set monthly_cap_seconds = 1000000;

-- A rehearsal whose provider took 88 s to make the room.
insert into q_runtime.rehearsals (id, tenant_id, user_id, counterpart_kind, counterpart_id, counterpart_name, persona)
values ('00000000-0000-4000-8000-0000000930a1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
        'COMPANY', gen_random_uuid(), 'Company', '{}');
insert into q_runtime.rehearsal_video_sessions
  (id, tenant_id, user_id, rehearsal_id, interviewer_id, bridge_token_hash, created_at, ends_at)
values ('00000000-0000-4000-8000-0000000930a2', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
        '00000000-0000-4000-8000-0000000930a1', 'partner-steve', repeat('d', 64),
        now() - interval '88 seconds', now() + interval '92 seconds');

select throws_ok($$update q_runtime.rehearsal_video_sessions set ends_at = ends_at + interval '10 seconds'
                    where id = '00000000-0000-4000-8000-0000000930a2'$$,
  '23514', null, 'a rehearsal clock never moves except by going live');
select lives_ok($$update q_runtime.rehearsal_video_sessions
                    set status = 'LIVE', provider_key_index = 0, provider_pal_id = 'p930',
                        provider_conversation_id = 'c930', sealed_join_url = repeat('x', 48),
                        live_at = now(), ends_at = now() + interval '180 seconds'
                  where id = '00000000-0000-4000-8000-0000000930a2'$$,
  'going live starts the founder''s full three minutes');
select ok((select ends_at - created_at > interval '260 seconds' from q_runtime.rehearsal_video_sessions
            where id = '00000000-0000-4000-8000-0000000930a2'),
  'the three minutes run from ready, not from allocation');
select throws_ok($$update q_runtime.rehearsal_video_sessions
                     set live_at = live_at + interval '1 second', ends_at = ends_at + interval '1 second'
                   where id = '00000000-0000-4000-8000-0000000930a2'$$,
  '23514', null, 'the ready time and the clock never move again');
select is((select reserved_seconds from billing.video_session_reservations
            where session_id = '00000000-0000-4000-8000-0000000930a2'),
  180, 'billing still reserves from allocation');

-- GateQ: only exactly ready + cap, and only within the original window.
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000930b1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Clock Capital');
insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000930b2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000930b1', pg_temp.rls_id('org_b'),
   'gq_23456789abcdefghjkmnpq9300', 'Clock programme', pg_temp.rls_id('user_b'));
insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-0000000930b3', '00000000-0000-4000-8000-0000000930b2', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Clock seed', 'gateq-qualification.v1',
   pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());
insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-0000000930b4', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000930b2',
   '00000000-0000-4000-8000-0000000930b3', 'ga_23456789abcdefghjkmnpq9300');
insert into gateq.application_video_sessions
  (id, tenant_id, application_id, bridge_token_hash, guest_credential_sealed, max_seconds, created_at, ends_at)
values ('00000000-0000-4000-8000-0000000930b5', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000930b4',
        repeat('e', 64), 'sealed:v1:opaque', 180, now() - interval '88 seconds', now() + interval '92 seconds');

select throws_ok($$update gateq.application_video_sessions
                     set status = 'LIVE', provider_conversation_id = 'c930', live_at = now(),
                         ends_at = now() + interval '200 seconds'
                   where id = '00000000-0000-4000-8000-0000000930b5'$$,
  '23514', null, 'going live may set the end only to exactly ready + cap');
select lives_ok($$update gateq.application_video_sessions
                    set status = 'LIVE', provider_conversation_id = 'c930', live_at = now(),
                        ends_at = now() + make_interval(secs => max_seconds)
                  where id = '00000000-0000-4000-8000-0000000930b5'$$,
  'a GateQ applicant also gets the full cap from ready');
select throws_ok($$insert into gateq.application_video_sessions
                     (id, tenant_id, application_id, bridge_token_hash, guest_credential_sealed, max_seconds, created_at, ends_at, live_at)
                   values (gen_random_uuid(), pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000930b4',
                           repeat('f', 64), 'sealed:v1:opaque', 180, now() - interval '200 seconds',
                           now() + interval '170 seconds', now() - interval '10 seconds')$$,
  '23514', null, 'a room ready after its original window is refused');

select * from finish();
rollback;
