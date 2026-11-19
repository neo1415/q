-- Console System health · platform_ops.service_heartbeats: one row per
-- background service, its last heartbeat, pool counts and last check.
-- Server-only: no browser session, member or anonymous, reads or writes it;
-- only a known service name and JSON objects are stored.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads and writes it.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the API shows it only to operators holding
-- overview.read).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(15);

-- Shape ------------------------------------------------------------------------
select has_table('platform_ops', 'service_heartbeats', 'service heartbeats are kept');
select ok((select relrowsecurity from pg_class where oid = 'platform_ops.service_heartbeats'::regclass),
  'RLS is on');
select is((select count(*)::int from pg_policies where schemaname = 'platform_ops' and tablename = 'service_heartbeats'),
  0, 'no policy for any client role');

-- Rules (positive and negative) -------------------------------------------------
select lives_ok(
  $$ insert into platform_ops.service_heartbeats (service, beat_at, pool, ops_check)
     values ('workers', now(), '{"slots":10,"held":1}', '{"findings":[]}')
     on conflict (service) do update set beat_at = excluded.beat_at $$,
  'the server records the workers'' heartbeat');
select lives_ok(
  $$ insert into platform_ops.service_heartbeats (service, beat_at)
     values ('workers', now())
     on conflict (service) do update set beat_at = excluded.beat_at $$,
  'and upserts it on the next check');
select throws_ok(
  $$ insert into platform_ops.service_heartbeats (service, beat_at) values ('web', now()) $$,
  '23514', null, 'only a known service is recorded');
select throws_ok(
  $$ insert into platform_ops.service_heartbeats (service, beat_at, pool)
     values ('workers', now(), '[1,2]')
     on conflict (service) do update set pool = excluded.pool $$,
  '23514', null, 'the pool is a JSON object');
select throws_ok(
  $$ insert into platform_ops.service_heartbeats (service, beat_at, ops_check)
     values ('workers', now(), '"ok"')
     on conflict (service) do update set ops_check = excluded.ops_check $$,
  '23514', null, 'the last check is a JSON object');
select throws_ok(
  $$ insert into platform_ops.service_heartbeats (service, beat_at) values ('workers', null) $$,
  '23502', null, 'every heartbeat has a time');

-- RLS: server-only; members, revoked members and anonymous are refused --------
select pg_temp.act_as_user_a();
select throws_ok($$ select beat_at from platform_ops.service_heartbeats $$, '42501', null,
  'a member cannot read heartbeats');
select throws_ok(
  $$ insert into platform_ops.service_heartbeats (service, beat_at) values ('workers', now()) $$,
  '42501', null, 'nor write one');
select pg_temp.act_as_revoked_user();
select throws_ok($$ select 1 from platform_ops.service_heartbeats $$, '42501', null,
  'a person whose membership was revoked cannot read them');
select pg_temp.act_as_anonymous();
select throws_ok($$ select 1 from platform_ops.service_heartbeats $$, '42501', null,
  'anonymous visitors cannot read them');
select throws_ok(
  $$ insert into platform_ops.service_heartbeats (service, beat_at) values ('workers', now()) $$,
  '42501', null, 'anonymous visitors cannot write one');
select pg_temp.act_as_privileged();
select is((select count(*)::int from platform_ops.service_heartbeats), 1,
  'the privileged server role reads the one row');

select * from finish();
rollback;
