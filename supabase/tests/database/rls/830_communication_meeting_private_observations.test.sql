-- P5 (20261208090000): Q's private screen observations are the assistant owner's alone.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(6);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000064c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Vision Co A', 'vision-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000064e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Vision Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000006401', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000064c1', '00000000-0000-4000-8000-0000000064e2', 'CONNECTED');
insert into communication.meetings (id, tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, status, google_event_id, meet_link, idempotency_key) values
  ('00000000-0000-4000-8000-000000006402', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000006401', pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b'),
   'Intro call', now() + interval '1 day', now() + interval '1 day 30 minutes', 'Europe/London', 'SCHEDULED',
   '000000000000400080000000000006402', 'https://meet.google.com/abc-defg-hij', 'q-action:fixture-vision-1');
insert into communication.meeting_participants (meeting_id, participant_tenant_id, user_id, role, display_name, email) values
  ('00000000-0000-4000-8000-000000006402', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'ORGANISER', 'B', 'b@example.invalid'),
  ('00000000-0000-4000-8000-000000006402', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'ATTENDEE', 'A', 'a@example.invalid');

select lives_ok(
  $$ insert into communication.meeting_private_observations (meeting_id, tenant_id, owner_user_id, source, shared_by_name, body, observed_at)
     values ('00000000-0000-4000-8000-000000006402', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'SCREEN_SHARE', 'A',
             'A slide titled Unit economics: CAC 120, payback 9 months; no source shown.', now()) $$,
  'Q records a private observation of a shared screen for the owner');
select throws_ok($$ update communication.meeting_private_observations set body = 'Nothing.' $$, '55000', null,
  'a private observation is never changed');

select pg_temp.act_as_user_b();
select is((select count(*)::int from communication.meeting_private_observations
            where meeting_id = '00000000-0000-4000-8000-000000006402'), 1,
  'the owner reads Q''s private observation');
select pg_temp.act_as_user_a();
select is((select count(*)::int from communication.meeting_private_observations
            where meeting_id = '00000000-0000-4000-8000-000000006402'), 0,
  'the other participant never reads the owner''s private observations');
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from communication.meeting_private_observations), 0,
  'a revoked user reads nothing');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from communication.meeting_private_observations $$, '42501', null,
  'an anonymous visitor reads nothing');

select * from finish();
rollback;
