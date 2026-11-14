-- GateQ voice sessions record their speech provider: ElevenLabs (Q's own
-- voice, the default) or Deepgram (fallback); nothing else.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(3);
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000fc01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Voice Capital');
insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000fc11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fc01', pg_temp.rls_id('org_b'),
   'gq_23456789abcdefghjkmnpqrs0c', 'Seed programme', pg_temp.rls_id('user_b'));
insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000fc21', '00000000-0000-4000-8000-00000000fc11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed-stage fintech', 'gateq-qualification.v1',
   pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());
insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000fc31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fc11',
   '00000000-0000-4000-8000-00000000fc21', 'ga_23456789abcdefghjkmnpqrs0c');

select lives_ok($$insert into gateq.application_voice_sessions
  (id, tenant_id, application_id, bridge_token_hash, guest_credential_sealed, provider, max_seconds, ends_at)
  values ('00000000-0000-4000-8000-00000000fc41', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fc31',
          repeat('e',64), 'sealed:v1:opaque', 'ELEVENLABS', 180, now() + interval '180 seconds')$$,
  'an ElevenLabs session is recorded as ElevenLabs');
select is((select provider from gateq.application_voice_sessions where id = '00000000-0000-4000-8000-00000000fc41'),
  'ELEVENLABS', 'the provider is kept as written');
select throws_ok($$insert into gateq.application_voice_sessions
  (id, tenant_id, application_id, bridge_token_hash, guest_credential_sealed, provider, max_seconds, ends_at)
  values ('00000000-0000-4000-8000-00000000fc42', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fc31',
          repeat('f',64), 'sealed:v1:opaque', 'OTHER', 180, now() + interval '180 seconds')$$,
  '23514', null, 'no other provider is accepted');
select * from finish();
rollback;
