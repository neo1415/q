-- BIZ-008 · communication.meetings, communication.meeting_participants,
-- communication.meeting_briefs, communication.reminders,
-- communication.notifications.
--
-- A person reads a meeting they organise or were invited to, their own
-- participant rows, briefs, reminders and notifications; only while an
-- active member of the tenant the row names for them; never another
-- tenant's; never after revocation; never anonymously. No client writes.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the server also requires a party check and an
-- approved action).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(27);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Meet Co A', 'meet-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000009e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Meet Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000009b01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000009c1', '00000000-0000-4000-8000-0000000009e2', 'CONNECTED');

-- B (investor) organises a meeting with A; the revoked person R was once
-- invited (their membership has since been revoked).
insert into communication.meetings (id, tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, status, google_event_id, meet_link, idempotency_key) values
  ('00000000-0000-4000-8000-000000009a01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009b01', pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b'),
   'Intro call', now() + interval '2 days', now() + interval '2 days 30 minutes', 'Europe/London', 'SCHEDULED',
   '000000000000400080000000000009a01', 'https://meet.google.com/abc-defg-hij', 'q-action:fixture-m-1');
insert into communication.meeting_participants (meeting_id, participant_tenant_id, user_id, role, display_name, email) values
  ('00000000-0000-4000-8000-000000009a01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'ORGANISER', 'B', 'b@example.invalid'),
  ('00000000-0000-4000-8000-000000009a01', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'ATTENDEE', 'A', 'a@example.invalid'),
  ('00000000-0000-4000-8000-000000009a01', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'), 'ATTENDEE', 'R', 'r@example.invalid');
insert into communication.meeting_briefs (meeting_id, tenant_id, user_id, composer_version, body) values
  ('00000000-0000-4000-8000-000000009a01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'prep-brief.v1', 'Brief for B');
insert into communication.reminders (id, tenant_id, owner_user_id, relationship_id, title, due_at, channel, source, idempotency_key) values
  ('00000000-0000-4000-8000-000000009d01', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-000000009b01', 'Follow up with B', now() + interval '1 day', 'EMAIL', 'PERSON', 'fixture-rem-a-1'),
  ('00000000-0000-4000-8000-000000009d02', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), null, 'B''s own note', now() + interval '1 day', 'IN_APP', 'PERSON', 'fixture-rem-b-1'),
  ('00000000-0000-4000-8000-000000009d03', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'), null, 'R''s note', now() + interval '1 day', 'IN_APP', 'PERSON', 'fixture-rem-r-1');
insert into communication.notifications (tenant_id, user_id, kind, title, reminder_id, dedupe_key) values
  (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'REMINDER', 'Follow up with B', '00000000-0000-4000-8000-000000009d01', 'reminder:fixture-a-1'),
  (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'MEETING_PREP_READY', 'Prep brief ready', null, 'brief:fixture-b-1');

-- Shape ------------------------------------------------------------------------
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'communication.meetings'::regclass, 'communication.meeting_participants'::regclass,
  'communication.meeting_briefs'::regclass, 'communication.reminders'::regclass,
  'communication.notifications'::regclass)), true, 'row level security is on for every table');
select ok(not has_column_privilege('authenticated', 'communication.meetings', 'idempotency_key', 'select'),
  'no client may read a meeting''s idempotency key');
select ok(not has_column_privilege('authenticated', 'communication.meetings', 'google_event_id', 'select'),
  'no client may read the provider event id');

-- Constraints ------------------------------------------------------------------
select throws_ok(
  $$ insert into communication.meetings (tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, google_event_id, idempotency_key)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000009b01', pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b'), 'x', now(), now() + interval '1 hour', 'UTC', 'abcde12345', 'q-action:fixture-m-2') $$,
  '23503', null, 'a meeting belongs to its relationship''s tenant');
select throws_ok(
  $$ insert into communication.meetings (tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, google_event_id, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009b01', pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b'), 'x', now(), now() - interval '1 hour', 'UTC', 'abcde12346', 'q-action:fixture-m-3') $$,
  '23514', null, 'a meeting ends after it starts');
select throws_ok(
  $$ insert into communication.meetings (tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, google_event_id, idempotency_key, status)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009b01', pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b'), 'x', now(), now() + interval '1 hour', 'UTC', 'abcde12347', 'q-action:fixture-m-4', 'SCHEDULED') $$,
  '23514', null, 'a scheduled meeting has its Meet link');
select throws_ok(
  $$ insert into communication.meetings (tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, google_event_id, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009b01', pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b'), 'x', now(), now() + interval '1 hour', 'UTC', 'abcde12348', 'q-action:fixture-m-1') $$,
  '23505', null, 'one meeting per execution identity');
select throws_ok(
  $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key, link_path)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'REMINDER', 'x', 'reminder:fixture-a-2', 'https://evil.example/') $$,
  '23514', null, 'a notification links same-origin only');
select throws_ok(
  $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'REMINDER', 'again', 'reminder:fixture-a-1') $$,
  '23505', null, 'one notification per happening');
select throws_ok(
  $$ insert into communication.reminders (tenant_id, owner_user_id, title, due_at, source, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'x', now(), 'MEETING', 'fixture-rem-a-2') $$,
  '23514', null, 'a meeting reminder names its meeting');

-- Privileged server role -----------------------------------------------------------
select is((select count(*)::int from communication.reminders), 3, 'the server role reads every reminder');

-- Positive: A (invited) --------------------------------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from communication.meetings), 1, 'an invited participant sees the meeting');
select is((select count(*)::int from communication.meeting_participants), 1, 'and only their own participant row');
select is((select count(*)::int from communication.meeting_briefs), 0, 'but not the organiser''s prep brief');
select is((select count(*)::int from communication.reminders), 1, 'A sees exactly their own reminder');
select is((select title from communication.notifications), 'Follow up with B', 'A sees their own notification');
select throws_ok($$ select idempotency_key from communication.meetings $$, '42501', null,
  'A cannot read the meeting''s idempotency key');
select throws_ok($$ update communication.reminders set status = 'DISMISSED' $$, '42501', null,
  'A cannot write a reminder');
select throws_ok($$ update communication.notifications set read_at = now() $$, '42501', null,
  'A cannot write a notification');

-- Positive: B (organiser) -----------------------------------------------------------
select pg_temp.act_as_user_b();
select is((select count(*)::int from communication.meetings), 1, 'the organiser sees their meeting');
select is((select count(*)::int from communication.meeting_briefs), 1, 'and their own prep brief');
-- Cross-tenant negative
select is((select count(*)::int from communication.reminders where owner_user_id <> pg_temp.rls_id('user_b')), 0,
  'B never sees another person''s reminder');
select is((select count(*)::int from communication.notifications where user_id <> pg_temp.rls_id('user_b')), 0,
  'B never sees another person''s notification');

-- Revoked membership -----------------------------------------------------------------
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from communication.meetings), 0,
  'a revoked person no longer sees a meeting they were invited to');
select is((select count(*)::int from communication.reminders), 0,
  'nor even their own reminder');

-- Anonymous --------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from communication.meetings $$, '42501', null,
  'an anonymous visitor cannot read meetings');
select throws_ok($$ select count(*) from communication.reminders $$, '42501', null,
  'an anonymous visitor cannot read reminders');

select * from finish();
rollback;
