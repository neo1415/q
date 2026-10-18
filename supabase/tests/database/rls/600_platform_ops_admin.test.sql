-- ADMIN · platform_ops.* and identity.platform_admins.role.
--
-- Server-only: no client role (anon, authenticated -- including a member
-- whose membership is active, or revoked) reads or writes any of it. The
-- ledgers are append-only; a break-glass request is decided once, never by
-- its requester as a "second person", and SOLO is explicit.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (packages/platform-admin decides who may act).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(24);

-- Shape ------------------------------------------------------------------------
select has_schema('platform_ops', 'platform_ops schema exists');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform_ops' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'RLS is on for every platform_ops table');
select is(
  (select count(*)::int from pg_policies where schemaname = 'platform_ops'),
  0, 'no RLS policy exists for any client role');
select ok(not has_schema_privilege('anon', 'platform_ops', 'usage')
      and not has_schema_privilege('authenticated', 'platform_ops', 'usage'),
  'no client role has usage on platform_ops');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated') and table_schema = 'platform_ops'),
  0, 'no client role holds any privilege on platform_ops tables');
select is(
  (select array_agg(key order by key) from platform_ops.feature_flags where enabled),
  array['q.autonomy.delegations', 'q.autonomy.errands', 'q.daily'],
  'the three kill switches are seeded and on');
select col_not_null('identity', 'platform_admins', 'role', 'every admin has a role');
select col_hasnt_default('identity', 'platform_admins', 'role', 'a new admin must be granted a named role');

-- Fixtures (server role) ---------------------------------------------------------
insert into identity.platform_admins (user_id, role, note)
  values (pg_temp.rls_id('user_a'), 'platform_owner', 'fixture owner');
insert into identity.platform_admins (user_id, role, granted_by, note)
  values (pg_temp.rls_id('user_b'), 'trust_and_safety', pg_temp.rls_id('user_a'), 'fixture t&s');

select throws_ok(
  $$insert into identity.platform_admins (user_id, role) values (pg_temp.rls_id('user_r'), 'superuser')$$,
  '23514', null, 'an unknown role is refused');

insert into platform_ops.account_suspensions (user_id, action, reason, actor_user_id)
  values (pg_temp.rls_id('user_r'), 'SUSPENDED', 'Fixture reason', pg_temp.rls_id('user_a'));
select throws_ok(
  $$update platform_ops.account_suspensions set reason = 'rewritten'$$,
  '23001', null, 'a suspension is never rewritten');
select throws_ok(
  $$insert into platform_ops.account_suspensions (user_id, action, reason, actor_user_id)
      values (pg_temp.rls_id('user_a'), 'UNSUSPENDED', 'self lift', pg_temp.rls_id('user_a'))$$,
  '23514', null, 'nobody lifts their own suspension');

select throws_ok(
  $$insert into platform_ops.step_ups (user_id, method, verified_at, expires_at)
      values (pg_temp.rls_id('user_a'), 'password', now(), now() + interval '2 hours')$$,
  '23514', null, 'a step-up never lasts longer than 30 minutes');

-- Break-glass ------------------------------------------------------------------
insert into platform_ops.break_glass_requests (id, requester_user_id, target_type, target_id, reason)
  values ('00000000-0000-4000-8000-00000000bb01', pg_temp.rls_id('user_a'), 'RELATIONSHIP_CHAT',
          '00000000-0000-4000-8000-00000000bb99', 'Fixture: a report alleges harassment in this chat');
select throws_ok(
  $$update platform_ops.break_glass_requests
       set status = 'APPROVED', approval_kind = 'SECOND_PERSON', decided_by_user_id = pg_temp.rls_id('user_a'),
           decided_at = now(), expires_at = now() + interval '30 minutes'
     where id = '00000000-0000-4000-8000-00000000bb01'$$,
  '23514', null, 'the requester is never the second person');
select lives_ok(
  $$update platform_ops.break_glass_requests
       set status = 'APPROVED', approval_kind = 'SECOND_PERSON', decided_by_user_id = pg_temp.rls_id('user_b'),
           decided_at = now(), expires_at = now() + interval '30 minutes'
     where id = '00000000-0000-4000-8000-00000000bb01'$$,
  'a second admin approves');
select throws_ok(
  $$update platform_ops.break_glass_requests set status = 'DENIED', approval_kind = null, expires_at = null
     where id = '00000000-0000-4000-8000-00000000bb01'$$,
  '23001', null, 'a decided request is never decided again');
select throws_ok(
  $$delete from platform_ops.break_glass_requests where id = '00000000-0000-4000-8000-00000000bb01'$$,
  '23001', null, 'a break-glass request is never deleted');
select throws_ok(
  $$insert into platform_ops.break_glass_requests (requester_user_id, target_type, target_id, reason)
      values (pg_temp.rls_id('user_a'), 'Q_RUN', gen_random_uuid(), 'too short')$$,
  '23514', null, 'a break-glass reason is at least 20 characters');
insert into platform_ops.break_glass_requests (id, requester_user_id, target_type, target_id, reason)
  values ('00000000-0000-4000-8000-00000000bb02', pg_temp.rls_id('user_a'), 'Q_RUN',
          '00000000-0000-4000-8000-00000000bb98', 'Fixture: Q run failed for a customer, need content');
select lives_ok(
  $$update platform_ops.break_glass_requests
       set status = 'APPROVED', approval_kind = 'SOLO', decided_by_user_id = pg_temp.rls_id('user_a'),
           decided_at = now(), expires_at = now() + interval '30 minutes'
     where id = '00000000-0000-4000-8000-00000000bb02'$$,
  'a SOLO approval is explicit and names the requester');

-- Flags ------------------------------------------------------------------------
select throws_ok(
  $$update platform_ops.feature_flags set enabled = false, updated_by = pg_temp.rls_id('user_a') where key = 'q.daily'$$,
  '23514', null, 'a flag change names its reason');
insert into platform_ops.feature_flag_events (key, enabled, actor_user_id, reason)
  values ('q.daily', false, pg_temp.rls_id('user_a'), 'Fixture: pause the Daily');
select throws_ok(
  $$delete from platform_ops.feature_flag_events$$,
  '23001', null, 'flag history is append-only');

-- Client roles -------------------------------------------------------------------
select pg_temp.act_as('auth_a');
select throws_ok($$select count(*) from platform_ops.account_suspensions$$, '42501', null,
  'an authenticated person (even an admin) cannot read operations tables directly');
select throws_ok($$select role from identity.platform_admins$$, '42501', null,
  'an authenticated person cannot read who is an admin');
select pg_temp.act_as('auth_r');
select throws_ok($$insert into platform_ops.step_ups (user_id, method, expires_at)
                   values (pg_temp.rls_id('user_r'), 'password', now() + interval '5 minutes')$$,
  '42501', null, 'a revoked member cannot mint a step-up');
select pg_temp.act_as_anonymous();
select throws_ok($$select count(*) from platform_ops.feature_flags$$, '42501', null,
  'the anonymous role reads nothing');

select * from finish();
rollback;
