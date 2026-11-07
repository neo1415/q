-- Q Workspace §8 A6 · the widened communication.notifications kind check
-- (20261231410000): every kind that existed before still passes, the two
-- new ones pass, and an unknown kind is still refused.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(28);

select lives_ok(
  format(
    $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key)
       values (%L, %L, %L, 'A notice', %L) $$,
    pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), kind, 'kind-test-' || kind),
  'the kind ' || kind || ' passes')
from unnest(array[
  -- Every value before 20261231410000, unchanged.
  'REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
  'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
  'COMMITMENT_DETECTED', 'ACCOUNT_PAUSED', 'Q_WORK', 'Q_STAND_IN',
  'INTEREST_RECEIVED', 'CONNECTION_REQUESTED', 'Q_MESSAGE', 'TIME_PROPOSED',
  'HUMAN_REVIEW', 'VERIFICATION_DECIDED', 'VERIFICATION_REQUESTED',
  'RELATIONSHIP_OUTCOME', 'DILIGENCE', 'EMAIL_RECEIVED', 'CHAT_MESSAGE',
  'COMMITMENT', 'STARTUP_ALERT',
  -- New.
  'COMPANY_SAVED', 'VIEWING_DIGEST'
]) as kind;

select throws_ok(
  format(
    $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key)
       values (%L, %L, 'VIEWED_YOU', 'A notice', 'kind-test-unknown') $$,
    pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a')),
  '23514', null, 'an unknown kind is still refused');

select * from finish();
rollback;
