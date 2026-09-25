-- CQ-NET-010 · network.interests and network.interest_requests: Express
-- Interest, server-internal like the rest of the network schema.
--
--   Interest ≠ Match ≠ Save ≠ Viewing ≠ Relationship State
--
-- One open interest per party per relationship; every interest names the
-- history row it was recorded with; idempotency records hold hashes only.
-- No browser principal may read or write either table, in either tenant.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(25);

-- Company A in tenant A; the investor organisation in tenant B.
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000001c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Interest Co A', 'interest-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000001e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Interest Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id) values
  ('00000000-0000-4000-8000-000000001b01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000001c1', '00000000-0000-4000-8000-0000000001e2');
insert into network.relationship_events (id, tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, payload, correlation_id) values
  ('00000000-0000-4000-8000-000000001b11', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000001b01', 1, 'discovered', 'HUMAN', pg_temp.rls_id('user_b'), 'RECOMMENDATION', 'investor_private', '{}', 'cor_00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000001b12', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000001b01', 2, 'interest_expressed', 'HUMAN', pg_temp.rls_id('user_b'), 'RECOMMENDATION', 'relationship_shared', '{"interestId":"00000000-0000-4000-8000-000000001b21"}', 'cor_00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000001b13', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000001b01', 3, 'interest_expressed', 'HUMAN', pg_temp.rls_id('user_b'), 'RECOMMENDATION', 'relationship_shared', '{}', 'cor_00000000-0000-4000-8000-000000000012');
insert into network.interests (id, tenant_id, relationship_id, expressed_by_party, expressed_by_user_id, expressed_in_organisation_id, relationship_event_id) values
  ('00000000-0000-4000-8000-000000001b21', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000001b01', 'INVESTOR', pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-000000001b12');
insert into network.interest_requests (user_id, organisation_id, tenant_id, idempotency_key_hash, request_hash, interest_id) values
  (pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), pg_temp.rls_id('tenant_b'), repeat('a', 64), repeat('b', 64), '00000000-0000-4000-8000-000000001b21');

-- Shape ----------------------------------------------------------------------------
select is((select bool_and(relrowsecurity) from pg_class where oid in ('network.interests'::regclass, 'network.interest_requests'::regclass)), true,
  'row level security is on for both tables');
select is((select count(*)::int from pg_policies where schemaname = 'network' and tablename in ('interests', 'interest_requests')), 0,
  'no policies: server-internal');
select is((select status from network.interests where id = '00000000-0000-4000-8000-000000001b21'), 'EXPRESSED', 'a new interest is EXPRESSED');
select is((select current_state from network.relationships where id = '00000000-0000-4000-8000-000000001b01'), 'DISCOVERED',
  'an interest does not set relationship state (the projector owns it)');
select is((select count(*)::int from information_schema.tables where table_schema = 'network' and table_name in ('matches', 'deals', 'opportunities')), 0,
  'interest brings no match, deal or opportunity table');

-- Invariants -----------------------------------------------------------------------
select throws_ok(
  $$ insert into network.interests (tenant_id, relationship_id, expressed_by_party, expressed_by_user_id, expressed_in_organisation_id, relationship_event_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000001b01', 'INVESTOR', pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-000000001b13') $$,
  '23505', null, 'one open interest per party per relationship: expressing twice is one interest');
select throws_ok(
  $$ insert into network.interests (tenant_id, relationship_id, expressed_by_party, status, expressed_by_user_id, expressed_in_organisation_id, relationship_event_id, withdrawn_at)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000001b01', 'INVESTOR', 'WITHDRAWN', pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-000000001b12', now()) $$,
  '23505', null, 'a history row backs at most one interest');
select throws_ok(
  $$ insert into network.interests (tenant_id, relationship_id, expressed_by_party, expressed_by_user_id, expressed_in_organisation_id, relationship_event_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000001b01', 'COMPANY', pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-000000001b13') $$,
  '23514', null, 'interest is investor pull only (a founder''s push is GateQ)');
select throws_ok(
  $$ insert into network.interests (tenant_id, relationship_id, expressed_by_party, status, expressed_by_user_id, expressed_in_organisation_id, relationship_event_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000001b01', 'INVESTOR', 'WITHDRAWN', pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-000000001b13') $$,
  '23514', null, 'a withdrawn interest carries its withdrawal time');
select throws_ok(
  $$ insert into network.interests (tenant_id, relationship_id, expressed_by_party, status, expressed_by_user_id, expressed_in_organisation_id, relationship_event_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000001b01', 'INVESTOR', 'MATCHED', pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-000000001b13') $$,
  '23514', null, 'MATCHED is not an interest status: Interest ≠ Match');
select throws_ok(
  $$ insert into network.interests (tenant_id, relationship_id, expressed_by_party, status, expressed_by_user_id, expressed_in_organisation_id, relationship_event_id, withdrawn_at)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000001b01', 'INVESTOR', 'WITHDRAWN', pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-000000001b13', now()) $$,
  '23503', null, 'an interest cannot name the relationship under another tenant');
select throws_ok(
  $$ insert into network.interests (tenant_id, relationship_id, expressed_by_party, status, expressed_by_user_id, expressed_in_organisation_id, relationship_event_id, withdrawn_at)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000001b01', 'INVESTOR', 'WITHDRAWN', pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-00000000ffff', now()) $$,
  '23503', null, 'an interest must name a real history row');
select throws_ok(
  $$ insert into network.interest_requests (user_id, organisation_id, tenant_id, idempotency_key_hash, request_hash, interest_id)
     values (pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), pg_temp.rls_id('tenant_b'), repeat('a', 64), repeat('c', 64), '00000000-0000-4000-8000-000000001b21') $$,
  '23505', null, 'an idempotency key is recorded once per person and organisation');
select throws_ok(
  $$ insert into network.interest_requests (user_id, organisation_id, tenant_id, idempotency_key_hash, request_hash, interest_id)
     values (pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), pg_temp.rls_id('tenant_b'), 'raw-client-key', repeat('c', 64), '00000000-0000-4000-8000-000000001b21') $$,
  '23514', null, 'only a key hash is stored, never the raw key');
select throws_ok(
  $$ insert into network.interest_requests (user_id, organisation_id, tenant_id, idempotency_key_hash, request_hash, interest_id)
     values (pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), pg_temp.rls_id('tenant_a'), repeat('d', 64), repeat('c', 64), '00000000-0000-4000-8000-000000001b21') $$,
  '23503', null, 'the request''s organisation and tenant must agree');

-- Capability reference data --------------------------------------------------------
select is((select count(*)::int from permissions.role_capabilities rc
             join permissions.roles r on r.id = rc.role_id
             join permissions.capabilities c on c.id = rc.capability_id
            where c.code = 'investor.interest.express' and rc.effect = 'ALLOW'
              and r.code in ('organisation_admin', 'organisation_member')), 2,
  'investor.interest.express is granted to admins and members');

-- Browser principals: nothing, in either direction --------------------------------------
select pg_temp.act_as_user_b();
select throws_ok($$ select * from network.interests $$, '42501', null, 'interests: the investor-side user has no raw access');
select throws_ok($$ select * from network.interest_requests $$, '42501', null, 'interest_requests: the investor-side user has no raw access');
select throws_ok(
  $$ insert into network.interests (tenant_id, relationship_id, expressed_by_party, expressed_by_user_id, expressed_in_organisation_id, relationship_event_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000001b01', 'INVESTOR', pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-000000001b13') $$,
  '42501', null, 'interests: a browser principal cannot express interest directly');
select pg_temp.act_as_user_a();
select throws_ok($$ select * from network.interests $$, '42501', null, 'interests: the company-side user has no raw access (founder visibility is the API''s)');
select throws_ok($$ update network.interests set status = 'WITHDRAWN', withdrawn_at = now() $$, '42501', null, 'interests: the company-side user cannot withdraw an investor''s interest');
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from network.interests $$, '42501', null, 'interests: anonymous denied');
select pg_temp.act_as_service_role();
select throws_ok($$ select * from network.interests $$, '42501', null, 'service_role: no grant on interests');
select throws_ok($$ select * from network.interest_requests $$, '42501', null, 'service_role: no grant on interest_requests');

-- Privileged server role: EXPECTED DB BEHAVIOUR; DB BYPASS ≠ BUSINESS AUTHORISATION.
select pg_temp.act_as_privileged();
select is((select count(*)::int from network.interests), 1, 'privileged: the server role reads the interest (infrastructure, not authorisation)');

select * from finish();

rollback;
