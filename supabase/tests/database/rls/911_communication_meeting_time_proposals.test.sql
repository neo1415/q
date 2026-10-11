-- C (20261222130000): meeting time proposals are server-only; CONFIRMED needs a
-- recorded, attributed acceptance; the history is append-only and idempotent;
-- one proposal per idempotency key per relationship; existing meetings are
-- not changed by the migration.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the party/side check is in the service).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(16);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000091c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Proposal Co A', 'proposal-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000091e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Proposal Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000009101', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000091c1', '00000000-0000-4000-8000-0000000091e2', 'CONNECTED');

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('communication.meeting_time_proposals'::regclass,
                  'communication.meeting_time_proposal_events'::regclass)),
  'RLS is on for both proposal tables');

select lives_ok($$
  insert into communication.meeting_time_proposals
    (id, tenant_id, relationship_id, purpose, proposed_by_user_id, options, idempotency_key)
  values ('00000000-0000-4000-8000-000000009102', pg_temp.rls_id('tenant_a'),
          '00000000-0000-4000-8000-000000009101', 'Intro call', pg_temp.rls_id('user_a'),
          '[{"startsAt":"2027-01-01T10:00:00.000Z","endsAt":"2027-01-01T10:30:00.000Z","timeZone":"Europe/London"}]',
          'founder-propose-9101') $$,
  'the server records a proposal (PROPOSED)');

select throws_ok($$
  insert into communication.meeting_time_proposals
    (tenant_id, relationship_id, purpose, proposed_by_user_id, options, idempotency_key)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009101', 'Again',
          pg_temp.rls_id('user_a'),
          '[{"startsAt":"2027-01-02T10:00:00.000Z","endsAt":"2027-01-02T10:30:00.000Z","timeZone":"Europe/London"}]',
          'founder-propose-9101') $$,
  '23505', null, 'one proposal per idempotency key per relationship');

select throws_ok($$
  insert into communication.meeting_time_proposals
    (tenant_id, relationship_id, purpose, proposed_by_user_id, options, idempotency_key)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009101', 'No options',
          pg_temp.rls_id('user_a'), '[]', 'founder-propose-empty') $$,
  '23514', null, 'a proposal carries between one and five options');

select throws_ok($$
  update communication.meeting_time_proposals set state = 'CONFIRMED'
   where id = '00000000-0000-4000-8000-000000009102' $$,
  '23514', null, 'nothing is CONFIRMED without a recorded, attributed acceptance');

select throws_ok($$
  update communication.meeting_time_proposals set state = 'BOOKED'
   where id = '00000000-0000-4000-8000-000000009102' $$,
  '23514', null, 'only the five states exist');

select lives_ok($$
  update communication.meeting_time_proposals
     set state = 'CONFIRMED', accepted_from = 'OPTIONS', accepted_option = 0,
         accepted_by_user_id = pg_temp.rls_id('user_b'), accepted_at = now()
   where id = '00000000-0000-4000-8000-000000009102' $$,
  'a recorded acceptance by the investor side makes it CONFIRMED');

select throws_ok($$
  update communication.meeting_time_proposals set state = 'COUNTERPROPOSED'
   where id = '00000000-0000-4000-8000-000000009102' $$,
  '23514', null, 'a COUNTERPROPOSED state carries counter options (and a confirmed row keeps its acceptance)');

select lives_ok($$
  insert into communication.meeting_time_proposal_events
    (proposal_id, tenant_id, event_type, from_state, to_state, actor_user_id, actor_side, option_index, idempotency_key)
  values ('00000000-0000-4000-8000-000000009102', pg_temp.rls_id('tenant_a'), 'ACCEPTED',
          'INVESTOR_REVIEW', 'CONFIRMED', pg_temp.rls_id('user_b'), 'INVESTOR', 0, 'investor-accept-9101') $$,
  'the acceptance is appended to the history with its idempotency key');

select throws_ok($$
  insert into communication.meeting_time_proposal_events
    (proposal_id, tenant_id, event_type, from_state, to_state, actor_user_id, actor_side, idempotency_key)
  values ('00000000-0000-4000-8000-000000009102', pg_temp.rls_id('tenant_a'), 'ACCEPTED',
          'INVESTOR_REVIEW', 'CONFIRMED', pg_temp.rls_id('user_b'), 'INVESTOR', 'investor-accept-9101') $$,
  '23505', null, 'the same acceptance twice is one event (idempotent)');

select throws_ok($$
  update communication.meeting_time_proposal_events set actor_side = 'FOUNDER' $$,
  '55000', null, 'history is never changed');
select throws_ok($$
  delete from communication.meeting_time_proposal_events $$,
  '55000', null, 'history is never deleted');

select throws_ok($$
  insert into communication.meeting_time_proposal_events
    (proposal_id, tenant_id, event_type, to_state, actor_side, idempotency_key)
  values ('00000000-0000-4000-8000-000000009102', pg_temp.rls_id('tenant_a'), 'ACCEPTED',
          'CONFIRMED', 'ADMIN', 'bad-side-9101') $$,
  '23514', null, 'an actor side is FOUNDER or INVESTOR, nothing else');

set local role authenticated;
select throws_ok($$ select 1 from communication.meeting_time_proposals $$,
  '42501', null, 'a browser principal cannot read proposals (server-only)');
select throws_ok($$ select 1 from communication.meeting_time_proposal_events $$,
  '42501', null, 'nor their history');
reset role;

select * from finish();
rollback;
