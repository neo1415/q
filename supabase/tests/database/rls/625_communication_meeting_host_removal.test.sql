-- ADR 0039 (20261111030000): leave requests, the organiser's removal and
-- unrecorded portions are host notes both sides read; append-only.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(5);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000063c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Removal Co A', 'removal-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000063e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Removal Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000006301', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000063c1', '00000000-0000-4000-8000-0000000063e2', 'CONNECTED');
insert into communication.meetings (id, tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, status, google_event_id, meet_link, idempotency_key) values
  ('00000000-0000-4000-8000-000000006302', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000006301', pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b'),
   'Intro call', now() + interval '1 day', now() + interval '1 day 30 minutes', 'Europe/London', 'SCHEDULED',
   '000000000000400080000000000006302', 'https://meet.google.com/abc-defg-hij', 'q-action:fixture-removal-1');
insert into communication.meeting_participants (meeting_id, participant_tenant_id, user_id, role, display_name, email) values
  ('00000000-0000-4000-8000-000000006302', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'ORGANISER', 'B', 'b@example.invalid'),
  ('00000000-0000-4000-8000-000000006302', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'ATTENDEE', 'A', 'a@example.invalid');

select lives_ok(
  $$ insert into communication.meeting_host_notes (meeting_id, tenant_id, kind, requested_by_name)
     values ('00000000-0000-4000-8000-000000006302', pg_temp.rls_id('tenant_b'), 'LEAVE_REQUESTED', 'A') $$,
  'a request in the call for Q to leave is recorded');
select lives_ok(
  $$ insert into communication.meeting_host_notes (meeting_id, tenant_id, kind, body, requested_by_name, requested_by_user_id)
     values ('00000000-0000-4000-8000-000000006302', pg_temp.rls_id('tenant_b'), 'REMOVED', 'Q was removed by B at 10:20 UTC.', 'B', pg_temp.rls_id('user_b')),
            ('00000000-0000-4000-8000-000000006302', pg_temp.rls_id('tenant_b'), 'UNRECORDED', 'Unrecorded portion: 10:20 UTC–11:00 UTC, removed by B.', 'B', pg_temp.rls_id('user_b')) $$,
  'the organiser''s removal and the unrecorded portion are recorded');
select throws_ok($$ update communication.meeting_host_notes set body = 'Nothing happened.' $$, '55000', null,
  'the record of a removal is never changed');

select pg_temp.act_as_user_a();
select is((select array_agg(kind order by kind)::text from communication.meeting_host_notes
            where meeting_id = '00000000-0000-4000-8000-000000006302'), '{LEAVE_REQUESTED,REMOVED,UNRECORDED}',
  'the other side reads who removed Q and what is unrecorded');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from communication.meeting_host_notes $$, '42501', null,
  'an anonymous visitor reads nothing');

select * from finish();
rollback;
