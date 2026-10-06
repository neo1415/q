-- P14 (20261209110000): a startup-alert notice is the investor's own, once per
-- alert and company.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(6);

select lives_ok(
  $$ insert into communication.notifications (tenant_id, user_id, kind, title, body, link_path, dedupe_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'STARTUP_ALERT',
             'New on Capital Q: Ledgerline', 'Ledgerline matches your alert "fintech in Nigeria".',
             '/company/00000000-0000-4000-8000-0000000086c1',
             'startup-alert:00000000-0000-4000-8000-0000000086a1:00000000-0000-4000-8000-0000000086c1') $$,
  'a startup-alert notice is a known kind');
select lives_ok(
  $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'STARTUP_ALERT', 'Again',
             'startup-alert:00000000-0000-4000-8000-0000000086a1:00000000-0000-4000-8000-0000000086c1')
     on conflict (user_id, dedupe_key) do nothing $$,
  'telling them again about the same alert and company is a no-op');
select is(
  (select count(*)::int from communication.notifications
    where dedupe_key = 'startup-alert:00000000-0000-4000-8000-0000000086a1:00000000-0000-4000-8000-0000000086c1'),
  1, 'the same alert and company tell them once');

select pg_temp.act_as_user_a();
select is((select count(*)::int from communication.notifications where kind = 'STARTUP_ALERT'), 1,
  'the investor reads their own notice');
select pg_temp.act_as_user_b();
select is((select count(*)::int from communication.notifications where kind = 'STARTUP_ALERT'), 0,
  'another tenant''s person never reads it');
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from communication.notifications where kind = 'STARTUP_ALERT'), 0,
  'a revoked user reads nothing');

select * from finish();
rollback;
