-- Diligence (2026-10-02) · network.diligence_requests and
-- network.diligence_fulfilments: server-only, append-only, bound to their
-- relationship's tenant. What is shared lives in permissions.
-- disclosure_policies (resource_type 'document', relationship_shared).
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the server decides the party and the side).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(12);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000065c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Diligence Co A', 'diligence-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000065e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Diligence Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000006501', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000065c1', '00000000-0000-4000-8000-0000000065e2', 'IN_DILIGENCE');
insert into network.diligence_requests (id, tenant_id, relationship_id, requested_by_user_id, title, idempotency_key) values
  ('00000000-0000-4000-8000-0000000065a1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000006501', pg_temp.rls_id('user_b'), 'Last 12 months of management accounts', 'diligence-req-0001');

select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'network.diligence_requests'::regclass, 'network.diligence_fulfilments'::regclass)), true,
  'row level security is on for both tables');
select ok(not has_table_privilege('authenticated', 'network.diligence_requests', 'select')
          and not has_table_privilege('authenticated', 'network.diligence_requests', 'insert'),
  'no client role reads or writes requests');
select ok(not has_table_privilege('anon', 'network.diligence_fulfilments', 'select'),
  'the anonymous role has no grant on fulfilments');
select is((select count(*)::int from pg_policies where schemaname = 'network'
            and tablename in ('diligence_requests', 'diligence_fulfilments')), 0,
  'server-only: no policies at all');

select throws_ok(
  $$ insert into network.diligence_requests (tenant_id, relationship_id, requested_by_user_id, title, idempotency_key)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000006501', pg_temp.rls_id('user_b'), 'x', 'diligence-req-0002') $$,
  '23503', null, 'a request belongs to its relationship''s tenant');
select throws_ok(
  $$ insert into network.diligence_requests (tenant_id, relationship_id, requested_by_user_id, title, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000006501', pg_temp.rls_id('user_b'), '', 'diligence-req-0003') $$,
  '23514', null, 'a request has a title');
select throws_ok(
  $$ insert into network.diligence_requests (tenant_id, relationship_id, requested_by_user_id, title, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000006501', pg_temp.rls_id('user_b'), 'again', 'diligence-req-0001') $$,
  '23505', null, 'one request per person per idempotency key');
select throws_ok(
  $$ update network.diligence_requests set title = 'rewritten' where id = '00000000-0000-4000-8000-0000000065a1' $$,
  '55000', null, 'even the server role cannot rewrite a request');
select throws_ok(
  $$ delete from network.diligence_requests where id = '00000000-0000-4000-8000-0000000065a1' $$,
  '55000', null, 'even the server role cannot delete a request');
select throws_ok(
  $$ insert into network.diligence_fulfilments (request_id, tenant_id, disclosure_policy_id, document_id, fulfilled_by_user_id)
     values ('00000000-0000-4000-8000-0000000065a1', pg_temp.rls_id('tenant_a'), gen_random_uuid(), gen_random_uuid(), pg_temp.rls_id('user_a')) $$,
  '23503', null, 'a fulfilment names a real share (disclosure policy)');

select pg_temp.act_as_user_a();
select throws_ok($$ select * from network.diligence_requests $$, '42501', null,
  'the founder side has no raw access: requests are read through the server');
select pg_temp.act_as_user_b();
select throws_ok($$ insert into network.diligence_requests (tenant_id, relationship_id, requested_by_user_id, title, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000006501', pg_temp.rls_id('user_b'), 'direct', 'diligence-req-0004') $$,
  '42501', null, 'the investor side cannot write a request directly');

select * from finish();
rollback;
