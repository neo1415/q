-- GateQ guest throttle buckets cannot be read or changed by a browser role.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(9);

insert into gateq.guest_throttle_buckets (key_hash) values (repeat('b', 64));

select has_table('gateq', 'guest_throttle_buckets', 'shared guest throttle exists');
select is((select relrowsecurity from pg_class where oid = 'gateq.guest_throttle_buckets'::regclass), true, 'throttle RLS is enabled');
select is((select count(*)::int from pg_policies where schemaname = 'gateq' and tablename = 'guest_throttle_buckets'), 0, 'no browser policy');
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'gateq' and table_name = 'guest_throttle_buckets' and grantee in ('anon', 'authenticated')), 0, 'no browser grant');
select throws_ok($$insert into gateq.guest_throttle_buckets(key_hash) values ('TURN:00000000-0000-4000-8000-000000000001')$$, '23514', null, 'a raw session id cannot be stored');
select throws_ok($$insert into gateq.guest_throttle_buckets(key_hash, count) values (repeat('c',64), 0)$$, '23514', null, 'count is at least one');

set local role anon;
select throws_ok($$select count(*) from gateq.guest_throttle_buckets$$, '42501', null, 'anon cannot read buckets');
reset role;
set local role authenticated;
select throws_ok($$select count(*) from gateq.guest_throttle_buckets$$, '42501', null, 'authenticated cannot read buckets');
select throws_ok($$insert into gateq.guest_throttle_buckets(key_hash) values (repeat('d',64))$$, '42501', null, 'authenticated cannot write buckets');
reset role;

select * from finish();
rollback;
