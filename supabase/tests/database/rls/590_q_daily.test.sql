-- The Q Daily · q_runtime.daily_preferences, daily_editions,
-- daily_cluster_issues (DAILY, docs/specs/2026-10/daily.md).
--
-- A person reads their own preferences and editions and nobody else's;
-- nobody in a browser writes any of it; the shared public gathering is
-- invisible to browser principals; an edition is history.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(17);

insert into q_runtime.daily_preferences (user_id, tenant_id, frequency, next_due_at) values
  (pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'), 'WEEKLY', now() + interval '1 day'),
  (pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b'), 'DAILY', now() + interval '1 hour');

insert into q_runtime.daily_cluster_issues (id, cluster_key, issue_date, topics, stories) values
  ('00000000-0000-4000-8000-0000000005c1', repeat('a', 64), current_date, '["Fintech"]', '[]');

insert into q_runtime.daily_editions (id, user_id, tenant_id, edition_date, number, frequency, cluster_issue_id, content) values
  ('00000000-0000-4000-8000-0000000005e1', pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'), current_date, 1,
   'WEEKLY', '00000000-0000-4000-8000-0000000005c1', '{"lead": null}'),
  ('00000000-0000-4000-8000-0000000005e2', pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b'), current_date, 1,
   'DAILY', '00000000-0000-4000-8000-0000000005c1', '{"lead": null}');

-- Shape ------------------------------------------------------------------------
select is((select relrowsecurity from pg_class where oid = 'q_runtime.daily_preferences'::regclass), true,
  'preferences: row level security is on');
select is((select relrowsecurity from pg_class where oid = 'q_runtime.daily_editions'::regclass), true,
  'editions: row level security is on');
select is((select relrowsecurity from pg_class where oid = 'q_runtime.daily_cluster_issues'::regclass), true,
  'cluster issues: row level security is on');

-- Rules ------------------------------------------------------------------------
select throws_ok(
  $$ insert into q_runtime.daily_preferences (user_id, tenant_id, frequency)
     values (pg_temp.rls_id('user_r'), pg_temp.rls_id('tenant_a'), 'HOURLY') $$,
  '23514', null, 'frequency is weekly, daily or off');
select throws_ok(
  $$ delete from q_runtime.daily_editions where id = '00000000-0000-4000-8000-0000000005e1' $$,
  '23514', null, 'an edition is never deleted');
select throws_ok(
  $$ update q_runtime.daily_editions set content = '{"lead": "changed"}' where id = '00000000-0000-4000-8000-0000000005e1' $$,
  '23514', null, 'an edition''s content never changes');
select lives_ok(
  $$ update q_runtime.daily_editions set emailed_at = now() where id = '00000000-0000-4000-8000-0000000005e1' $$,
  'delivery is recorded on the edition');
select throws_ok(
  $$ insert into q_runtime.daily_editions (user_id, tenant_id, edition_date, number, frequency, content)
     values (pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'), current_date, 2, 'WEEKLY', '{}') $$,
  '23505', null, 'one edition per person per day');

-- Browser principals -------------------------------------------------------------
-- q_runtime is not a browser schema: every read is the Q API's, by the
-- resolved actor's own user id. The own-row policies are defence in depth
-- for the day the schema is exposed.
select ok((select qual from pg_policies where schemaname = 'q_runtime' and tablename = 'daily_editions'
           and policyname = 'daily_editions_select_own') like '%current_app_user_id%',
  'the edition policy is the reader''s own rows');
select ok((select qual from pg_policies where schemaname = 'q_runtime' and tablename = 'daily_preferences'
           and policyname = 'daily_preferences_select_own') like '%is_tenant_member%',
  'the preferences policy also requires current tenant membership');
select is((select count(*)::int from pg_policies where schemaname = 'q_runtime' and tablename = 'daily_cluster_issues'), 0,
  'no policy on the shared gathering: server-internal');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from q_runtime.daily_editions $$, '42501', null,
  'user A cannot read edition rows directly, even their own');
select throws_ok($$ select count(*) from q_runtime.daily_cluster_issues $$, '42501', null,
  'a shared public gathering is not readable from a browser');
select throws_ok(
  $$ update q_runtime.daily_preferences set frequency = 'OFF' where user_id = pg_temp.rls_id('user_a') $$,
  '42501', null, 'preferences are written by the server only');

select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from q_runtime.daily_preferences $$, '42501', null,
  'user B (other tenant) cannot read preference rows');

select pg_temp.act_as_revoked_user();
select throws_ok($$ select count(*) from q_runtime.daily_editions $$, '42501', null,
  'a revoked member reads no editions');

select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from q_runtime.daily_editions $$, '42501', null,
  'an anonymous visitor cannot read editions');

select * from finish();
rollback;
