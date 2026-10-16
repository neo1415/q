-- Video settlement bills from the provider request, not our own setup
-- (lead 2026-10-16: 93 s settled for 84 s in the room).
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(7);
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000fc01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Settle Capital');
insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000fc11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fc01', pg_temp.rls_id('org_b'),
   'gq_456789abcdefghjkmnpqrs09ab', 'Seed programme', pg_temp.rls_id('user_b'));
insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000fc21', '00000000-0000-4000-8000-00000000fc11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed-stage fintech', 'gateq-qualification.v1',
   pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());
insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000fc31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fc11',
   '00000000-0000-4000-8000-00000000fc21', 'ga_456789abcdefghjkmnpqrs09ab'),
  ('00000000-0000-4000-8000-00000000fc32', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fc11',
   '00000000-0000-4000-8000-00000000fc21', 'ga_56789abcdefghjkmnpqrs09abc');

-- Our session row was written 100 s ago; the provider was asked 40 s ago.
insert into gateq.application_video_sessions
  (id, tenant_id, application_id, bridge_token_hash, guest_credential_sealed, max_seconds, created_at, ends_at)
values
  ('00000000-0000-4000-8000-00000000fc41', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fc31',
   repeat('d',64), 'sealed:v1:opaque', 180, now() - interval '100 seconds', now() + interval '60 seconds'),
  ('00000000-0000-4000-8000-00000000fc42', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fc32',
   repeat('e',64), 'sealed:v1:opaque', 180, now() - interval '50 seconds', now() + interval '60 seconds');

select lives_ok($$update gateq.application_video_sessions set provider_request_at = now() - interval '40 seconds'
  where id = '00000000-0000-4000-8000-00000000fc41'$$, 'the provider request is stamped while starting');
select throws_ok($$update gateq.application_video_sessions set provider_request_at = now()
  where id = '00000000-0000-4000-8000-00000000fc41'$$,
  '23514', null, 'and never moved');
select throws_ok($$update gateq.application_video_sessions set provider_request_at = now() - interval '200 seconds'
  where id = '00000000-0000-4000-8000-00000000fc42'$$,
  '23514', null, 'it cannot predate the session');

select lives_ok($$update gateq.application_video_sessions
  set status = 'ENDED', ended_reason = 'APPLICANT_ENDED', ended_at = now()
  where id in ('00000000-0000-4000-8000-00000000fc41', '00000000-0000-4000-8000-00000000fc42')$$,
  'both sessions end');
select is((select settled_seconds from billing.video_session_reservations
            where session_id = '00000000-0000-4000-8000-00000000fc41'), 40,
  'settled from the provider request (40 s), not from our row (100 s)');
select is((select settled_seconds from billing.video_session_reservations
            where session_id = '00000000-0000-4000-8000-00000000fc42'), 50,
  'a session without the stamp settles from its row, as before');
select throws_ok($$update gateq.application_video_sessions set provider_request_at = now()
  where id = '00000000-0000-4000-8000-00000000fc42'$$,
  '23514', null, 'never stamped after the session left starting');
select * from finish();
rollback;
