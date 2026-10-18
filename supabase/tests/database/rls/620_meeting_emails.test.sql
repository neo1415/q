-- AUTO (founder report 2026-10-02): the booked-call email ledger is
-- worker-only. No client role may read or write it.

begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select has_table('communication', 'meeting_emails', 'communication.meeting_emails exists');
select col_is_pk('communication', 'meeting_emails', array['meeting_id', 'user_id'],
  'one ledger row per meeting and person');
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'communication' and c.relname = 'meeting_emails'),
  'RLS enabled on meeting_emails');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'communication' and table_name = 'meeting_emails'),
  0, 'no client role holds any privilege on meeting_emails');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'communication' and tablename = 'meeting_emails'),
  0, 'no policies: nothing is client-readable');

select * from finish();
rollback;
