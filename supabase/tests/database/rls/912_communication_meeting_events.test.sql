-- D (20261222140000): the meeting event record is server-only and append-only;
-- an owner or due time exists only on a commitment; a commitment needs a stance;
-- one sequence number per meeting.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role appends every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the host runtime writes only for a call it hosts).
-- communication is not a schema 130_schema_guard inventories; this suite is
-- the table's own guard (RLS on, no client grant, no policy).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(14);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000092c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Events Co A', 'events-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000092e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Events Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000009201', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000092c1', '00000000-0000-4000-8000-0000000092e2', 'CONNECTED');
insert into communication.meetings (id, tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, status, google_event_id, meet_link, idempotency_key) values
  ('00000000-0000-4000-8000-000000009202', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009201', pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'),
   'Intro call', now() + interval '1 day', now() + interval '1 day 30 minutes', 'Europe/London', 'SCHEDULED',
   '000000000000400080000000000009202', 'https://meet.google.com/abc-defg-hij', 'q-action:fixture-events-1');

select ok(
  (select relrowsecurity from pg_class where oid = 'communication.meeting_events'::regclass),
  'RLS is on for the meeting event record');
select ok(
  not has_table_privilege('authenticated', 'communication.meeting_events', 'select')
  and not has_table_privilege('anon', 'communication.meeting_events', 'select'),
  'no browser role may read the record');
select is(
  (select count(*)::int from pg_policies where schemaname = 'communication' and tablename = 'meeting_events'),
  0, 'server-only: no policy at all');

select lives_ok($$
  insert into communication.meeting_events (meeting_id, tenant_id, seq, occurred_at, speaker_name, speaker_side, kind, stance, body)
  values ('00000000-0000-4000-8000-000000009202', pg_temp.rls_id('tenant_a'), 1, now(), 'Ada', 'FOUNDER', 'PROPOSAL', 'SUGGESTION', 'Let''s do Tuesday 3pm') $$,
  'the server records a suggestion (a proposed time)');
select lives_ok($$
  insert into communication.meeting_events (meeting_id, tenant_id, seq, occurred_at, speaker_name, speaker_user_id, kind, stance, body, owner_name, owner_user_id, due_text)
  values ('00000000-0000-4000-8000-000000009202', pg_temp.rls_id('tenant_a'), 2, now(), 'Ada', pg_temp.rls_id('user_a'), 'COMMITMENT', 'COMMITMENT', 'I will send the deck', 'Ada', pg_temp.rls_id('user_a'), 'friday') $$,
  'the server records a commitment with its owner and due time');
select lives_ok($$
  insert into communication.meeting_events (meeting_id, tenant_id, seq, occurred_at, kind, body, refers_to, source_refs)
  values ('00000000-0000-4000-8000-000000009202', pg_temp.rls_id('tenant_a'), 3, now(), 'CORRECTION', 'Corrected: Let''s do Tuesday 3pm',
          (select id from communication.meeting_events where seq = 1), '["line:1"]') $$,
  'a correction is a new event that refers to the earlier one');

select throws_ok($$
  insert into communication.meeting_events (meeting_id, tenant_id, seq, occurred_at, kind, stance, body, owner_name)
  values ('00000000-0000-4000-8000-000000009202', pg_temp.rls_id('tenant_a'), 4, now(), 'ACTION_ITEM', 'SUGGESTION', 'Send the model', 'Khalid') $$,
  '23514', null, 'a suggestion can never carry an owner');
select throws_ok($$
  insert into communication.meeting_events (meeting_id, tenant_id, seq, occurred_at, kind, stance, body, due_text)
  values ('00000000-0000-4000-8000-000000009202', pg_temp.rls_id('tenant_a'), 4, now(), 'COMMITMENT', 'TENTATIVE', 'I will try', 'monday') $$,
  '23514', null, 'a tentative promise can never carry a due time');
select throws_ok($$
  insert into communication.meeting_events (meeting_id, tenant_id, seq, occurred_at, kind, body)
  values ('00000000-0000-4000-8000-000000009202', pg_temp.rls_id('tenant_a'), 4, now(), 'COMMITMENT', 'I will') $$,
  '23514', null, 'a commitment needs a stance');
select throws_ok($$
  insert into communication.meeting_events (meeting_id, tenant_id, seq, occurred_at, kind, body)
  values ('00000000-0000-4000-8000-000000009202', pg_temp.rls_id('tenant_a'), 4, now(), 'BOOKED', 'x') $$,
  '23514', null, 'an unknown kind is refused');
select throws_ok($$
  insert into communication.meeting_events (meeting_id, tenant_id, seq, occurred_at, kind, body)
  values ('00000000-0000-4000-8000-000000009202', pg_temp.rls_id('tenant_a'), 1, now(), 'QUESTION', 'Again?') $$,
  '23505', null, 'one sequence number per meeting');

select throws_ok(
  $$ update communication.meeting_events set body = 'Changed' $$,
  '55000', null, 'events are never changed');
select throws_ok(
  $$ delete from communication.meeting_events $$,
  '55000', null, 'events are never deleted');
select is(
  (select count(*)::int from communication.meeting_events),
  3, 'three events survive');

select * from finish();
rollback;
