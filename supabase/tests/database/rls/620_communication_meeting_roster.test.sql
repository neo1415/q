-- MEET-HOST (20261111020000): the roster of a call Q hosted. Participants
-- read it; nobody else does; nobody in the browser writes it; rows are
-- never changed.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role appends every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(18);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000062c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Roster Co A', 'roster-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000062e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Roster Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000006201', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000062c1', '00000000-0000-4000-8000-0000000062e2', 'CONNECTED');
insert into communication.meetings (id, tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, status, google_event_id, meet_link, idempotency_key) values
  ('00000000-0000-4000-8000-000000006202', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000006201', pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b'),
   'Intro call', now() + interval '1 day', now() + interval '1 day 30 minutes', 'Europe/London', 'SCHEDULED',
   '000000000000400080000000000006202', 'https://meet.google.com/abc-defg-hij', 'q-action:fixture-roster-1');
insert into communication.meeting_participants (meeting_id, participant_tenant_id, user_id, role, display_name, email) values
  ('00000000-0000-4000-8000-000000006202', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'ORGANISER', 'B', 'b@example.invalid'),
  ('00000000-0000-4000-8000-000000006202', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'), 'ATTENDEE', 'R', 'r@example.invalid');

-- A second call, organised by A, with B invited.
insert into communication.meetings (id, tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, status, google_event_id, meet_link, idempotency_key) values
  ('00000000-0000-4000-8000-000000006203', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000006201', pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'),
   'Second call', now() + interval '2 days', now() + interval '2 days 30 minutes', 'Europe/London', 'SCHEDULED',
   '000000000000400080000000000006203', 'https://meet.google.com/abc-defg-hik', 'q-action:fixture-roster-2');
insert into communication.meeting_participants (meeting_id, participant_tenant_id, user_id, role, display_name, email) values
  ('00000000-0000-4000-8000-000000006203', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'ORGANISER', 'A', 'a@example.invalid'),
  ('00000000-0000-4000-8000-000000006203', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'ATTENDEE', 'B', 'b@example.invalid');
insert into communication.meeting_host_notes (meeting_id, tenant_id, kind, body, requested_by_name) values
  ('00000000-0000-4000-8000-000000006203', pg_temp.rls_id('tenant_a'), 'PROPOSAL', 'Send the deck', 'B');
insert into communication.meeting_host_notes (meeting_id, tenant_id, kind) values
  ('00000000-0000-4000-8000-000000006203', pg_temp.rls_id('tenant_a'), 'NO_SHOW');

-- Positive (server) -----------------------------------------------------------------
select lives_ok(
  $$ insert into communication.meeting_roster_entries
       (meeting_id, tenant_id, participant_key, call_name, kind, source, user_id, side, name, organisation)
     values ('00000000-0000-4000-8000-000000006202', pg_temp.rls_id('tenant_b'), '1', 'B on a phone',
             'ARRIVED', 'CAPITAL_Q_IDENTITY', pg_temp.rls_id('user_b'), 'INVESTOR', 'B', 'Roster Capital B') $$,
  'the server records an invited person arriving');
select lives_ok(
  $$ insert into communication.meeting_roster_entries
       (meeting_id, tenant_id, participant_key, call_name, kind, source, name, role)
     values ('00000000-0000-4000-8000-000000006202', pg_temp.rls_id('tenant_b'), '3', 'Galaxy S24',
             'INTRODUCED', 'SELF_INTRODUCTION', 'Amaka', 'Diligence') $$,
  'the server records a guest''s own introduction, organisation unknown');

select lives_ok(
  $$ insert into communication.meeting_host_notes (meeting_id, tenant_id, kind, body, requested_by_name)
     values ('00000000-0000-4000-8000-000000006202', pg_temp.rls_id('tenant_b'), 'PROPOSAL', 'Move the call to Thursday', 'R') $$,
  'the server notes a proposal for the organiser');
select lives_ok(
  $$ insert into communication.meeting_host_notes (meeting_id, tenant_id, kind, absent_side)
     values ('00000000-0000-4000-8000-000000006202', pg_temp.rls_id('tenant_b'), 'ONE_SIDED', 'FOUNDER') $$,
  'the server notes that one side did not come');

-- Constraints -----------------------------------------------------------------------
select throws_ok(
  $$ update communication.meeting_host_notes set body = 'Changed' $$,
  '55000', null, 'host notes are never changed');
select throws_ok(
  $$ insert into communication.meeting_roster_entries
       (meeting_id, tenant_id, participant_key, call_name, kind, source)
     values ('00000000-0000-4000-8000-000000006202', pg_temp.rls_id('tenant_b'), '4', 'X', 'ARRIVED', 'CAPITAL_Q_IDENTITY') $$,
  '23514', null, 'an identity is never claimed without a matched person');
select throws_ok(
  $$ insert into communication.meeting_roster_entries
       (meeting_id, tenant_id, participant_key, call_name, kind, source, user_id)
     values ('00000000-0000-4000-8000-000000006202', pg_temp.rls_id('tenant_b'), '4', 'X', 'ARRIVED', 'CALL_NAME', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'a call name never carries an identity');
select throws_ok(
  $$ update communication.meeting_roster_entries set name = 'Someone else' $$,
  '55000', null, 'rows are never changed');
select throws_ok(
  $$ delete from communication.meeting_roster_entries $$,
  '55000', null, 'rows are never removed');

-- Participant (B, organiser) --------------------------------------------------------
select pg_temp.act_as_user_b();
select is((select count(*)::int from communication.meeting_roster_entries), 2,
  'an invited participant reads who was in the call');
select throws_ok(
  $$ insert into communication.meeting_roster_entries
       (meeting_id, tenant_id, participant_key, call_name, kind, source)
     values ('00000000-0000-4000-8000-000000006202', pg_temp.rls_id('tenant_b'), '5', 'Fake', 'ARRIVED', 'CALL_NAME') $$,
  '42501', null, 'a participant cannot write the roster');
select is((select count(*)::int from communication.meeting_host_notes
            where meeting_id = '00000000-0000-4000-8000-000000006202'), 2,
  'the organiser reads the proposal and the outcome');
select is((select array_agg(kind)::text from communication.meeting_host_notes
            where meeting_id = '00000000-0000-4000-8000-000000006203'), '{NO_SHOW}',
  'an invited attendee reads the outcome, never the organiser''s proposals');

-- Cross-tenant negative (A was not invited) -----------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from communication.meeting_host_notes
            where meeting_id = '00000000-0000-4000-8000-000000006202'), 0,
  'someone not invited reads no host notes');
select pg_temp.act_as_user_a();
select is((select count(*)::int from communication.meeting_roster_entries
            where meeting_id = '00000000-0000-4000-8000-000000006202'), 0,
  'someone not invited reads nothing');

-- Revoked membership ----------------------------------------------------------------
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from communication.meeting_roster_entries), 0,
  'a revoked person no longer reads the roster');

-- Anonymous -------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from communication.meeting_roster_entries $$, '42501', null,
  'an anonymous visitor cannot read the roster');

-- The server role reads every row ----------------------------------------------------
select pg_temp.act_as_privileged();
select is((select count(*)::int from communication.meeting_roster_entries), 2,
  'the server reads every roster row');

select * from finish();
rollback;
