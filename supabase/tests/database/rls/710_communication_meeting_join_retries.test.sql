-- meet-47 (20261202090000): a meeting is BOOKED or JOINED (Q asked to join
-- a running Google Meet); Q's record carries its retry state and what its
-- bot was booked for. Participants still read the record; nobody in the
-- browser writes it.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes these columns.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(10);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000071c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Join Co A', 'join-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000071e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Join Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000007101', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000071c1', '00000000-0000-4000-8000-0000000071e2', 'CONNECTED');

select col_default_is('communication', 'meetings', 'origin', 'BOOKED'::text,
  'a meeting is BOOKED unless it was joined');

select lives_ok(
  $$ insert into communication.meetings (id, tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, status, google_event_id, meet_link, idempotency_key, origin) values
     ('00000000-0000-4000-8000-000000007102', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000007101', pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'),
      'Call with Join Capital B', now(), now() + interval '1 hour', 'UTC', 'SCHEDULED',
      '000000000000400080000000000007102', 'https://meet.google.com/abc-defg-hij', 'join:fixture-join-1', 'JOINED') $$,
  'a call Q was asked to join is recorded as JOINED');

select throws_ok(
  $$ insert into communication.meetings (id, tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, status, google_event_id, meet_link, idempotency_key, origin) values
     ('00000000-0000-4000-8000-000000007103', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000007101', pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'),
      'Call', now(), now() + interval '1 hour', 'UTC', 'SCHEDULED',
      '000000000000400080000000000007103', 'https://meet.google.com/abc-defg-hij', 'join:fixture-join-2', 'ZOOM') $$,
  '23514', null, 'an origin outside BOOKED and JOINED is refused');

insert into communication.meeting_participants (meeting_id, participant_tenant_id, user_id, role, display_name, email) values
  ('00000000-0000-4000-8000-000000007102', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'ORGANISER', 'A', 'a@example.invalid'),
  ('00000000-0000-4000-8000-000000007102', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'ATTENDEE', 'B', 'b@example.invalid');

select lives_ok(
  $$ insert into communication.meeting_assistants (meeting_id, tenant_id, user_id, provider, status, idempotency_key, attempts, next_attempt_at, failure)
     values ('00000000-0000-4000-8000-000000007102', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'recall', 'REQUESTED',
             'enlist:fixture-join-1', 2, now() + interval '2 minutes',
             'Q couldn''t be booked into the call yet; trying again at 10:02 UTC.') $$,
  'a failed bot creation waits for its retry, said on the record');

select col_default_is('communication', 'meeting_assistants', 'attempts', '0'::text,
  'a new record has not tried yet');

select throws_ok(
  $$ update communication.meeting_assistants set attempts = 51
      where meeting_id = '00000000-0000-4000-8000-000000007102' $$,
  '23514', null, 'tries are bounded');

select lives_ok(
  $$ update communication.meeting_assistants
        set status = 'SCHEDULED', provider_bot_id = 'bot-0000-fixture', attempts = 3, next_attempt_at = null,
            failure = null, booked_starts_at = now(), booked_meet_link = 'https://meet.google.com/abc-defg-hij'
      where meeting_id = '00000000-0000-4000-8000-000000007102' $$,
  'a booked bot keeps the start and link it was booked for');

select pg_temp.act_as_user_b();
select is((select status from communication.meeting_assistants
            where meeting_id = '00000000-0000-4000-8000-000000007102'), 'SCHEDULED',
  'the other side of a joined call reads Q''s record');
select throws_ok(
  $$ update communication.meeting_assistants set attempts = 0 $$,
  '42501', null, 'nobody in the browser changes Q''s retry state');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from communication.meetings
            where id = '00000000-0000-4000-8000-000000007102'), 0,
  'a revoked member does not see the call');

select * from finish();
rollback;
