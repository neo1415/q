-- Journey audit 2026-11-13 D1 · the widened communication.notifications
-- kind check (20261231510000): every kind that existed before still passes,
-- INTEREST_ACCEPTED passes, an unknown kind is still refused, and the
-- per-person dedupe key holds one acceptance notice per interest.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(31);

select lives_ok(
  format(
    $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key)
       values (%L, %L, %L, 'A notice', %L) $$,
    pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), kind, 'kind-test-' || kind),
  'the kind ' || kind || ' passes')
from unnest(array[
  -- Every value before 20261231510000, unchanged.
  'REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
  'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
  'COMMITMENT_DETECTED', 'ACCOUNT_PAUSED', 'Q_WORK', 'Q_STAND_IN',
  'INTEREST_RECEIVED', 'CONNECTION_REQUESTED', 'Q_MESSAGE', 'TIME_PROPOSED',
  'HUMAN_REVIEW', 'VERIFICATION_DECIDED', 'VERIFICATION_REQUESTED',
  'RELATIONSHIP_OUTCOME', 'DILIGENCE', 'EMAIL_RECEIVED', 'CHAT_MESSAGE',
  'COMMITMENT', 'STARTUP_ALERT', 'COMPANY_SAVED', 'VIEWING_DIGEST',
  -- New.
  'INTEREST_ACCEPTED'
]) as kind;

select throws_ok(
  format(
    $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key)
       values (%L, %L, 'INTEREST_WITHDRAWN', 'A notice', 'kind-test-unknown') $$,
    pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a')),
  '23514', null, 'an unknown kind is still refused');

-- The handler inserts with `on conflict (user_id, dedupe_key) do nothing`:
-- a redelivered acceptance adds nothing.
select lives_ok(
  format(
    $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key)
       values (%L, %L, 'INTEREST_ACCEPTED', 'Accepted again', 'kind-test-INTEREST_ACCEPTED')
       on conflict (user_id, dedupe_key) do nothing $$,
    pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a')),
  'a repeated acceptance notice is absorbed by the dedupe key');

select is(
  (select count(*)::int from communication.notifications
    where user_id = pg_temp.rls_id('user_a')
      and dedupe_key = 'kind-test-INTEREST_ACCEPTED'),
  1, 'one acceptance notice per person per interest');

select * from finish();
rollback;
