-- CQ-NET-011 · network.interest_responses, network.matches and
-- network.interest_response_requests: the company's answer to an interest
-- and the formal bilateral connection, server-internal.
--
--   Interest ≠ Response ≠ Match ≠ Relationship State
--
-- One answer per interest, tied to that interest's own relationship; at
-- most one active match per relationship, each made by one acceptance;
-- idempotency records hold hashes only. No browser principal may read or
-- write any of it, from either side.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(25);

-- Company A in tenant A (user A, org A); the investor in tenant B (user B).
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000002c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Match Co A', 'match-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000002e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Match Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id) values
  ('00000000-0000-4000-8000-000000002b01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000002c1', '00000000-0000-4000-8000-0000000002e2');
insert into network.relationship_events (id, tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, payload, correlation_id) values
  ('00000000-0000-4000-8000-000000002b11', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', 1, 'discovered', 'HUMAN', pg_temp.rls_id('user_b'), 'RECOMMENDATION', 'investor_private', '{}', 'cor_00000000-0000-4000-8000-000000000021'),
  ('00000000-0000-4000-8000-000000002b12', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', 2, 'interest_expressed', 'HUMAN', pg_temp.rls_id('user_b'), 'RECOMMENDATION', 'relationship_shared', '{}', 'cor_00000000-0000-4000-8000-000000000021'),
  ('00000000-0000-4000-8000-000000002b13', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', 3, 'connection_accepted', 'HUMAN', pg_temp.rls_id('user_a'), 'MANUAL', 'relationship_shared', '{}', 'cor_00000000-0000-4000-8000-000000000022'),
  ('00000000-0000-4000-8000-000000002b14', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', 4, 'interest_declined', 'HUMAN', pg_temp.rls_id('user_a'), 'MANUAL', 'relationship_shared', '{}', 'cor_00000000-0000-4000-8000-000000000023');
insert into network.interests (id, tenant_id, relationship_id, expressed_by_party, expressed_by_user_id, expressed_in_organisation_id, relationship_event_id) values
  ('00000000-0000-4000-8000-000000002b21', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', 'INVESTOR', pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-000000002b12');
insert into network.interest_responses (id, tenant_id, relationship_id, interest_id, decision, responded_by_user_id, responded_in_organisation_id, relationship_event_id) values
  ('00000000-0000-4000-8000-000000002b31', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', '00000000-0000-4000-8000-000000002b21', 'ACCEPTED', pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-000000002b13');
insert into network.interest_response_requests (user_id, organisation_id, tenant_id, idempotency_key_hash, request_hash, interest_response_id) values
  (pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('tenant_a'), repeat('a', 64), repeat('b', 64), '00000000-0000-4000-8000-000000002b31');

select throws_ok(
  $$ insert into network.matches (tenant_id, relationship_id, match_source, interest_response_id, status, ended_at)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000002b01', 'INTEREST_ACCEPTED', '00000000-0000-4000-8000-000000002b31', 'ACTIVE', null) $$,
  '23503', null, 'a match cannot name the relationship under another tenant');
select lives_ok(
  $$ insert into network.matches (id, tenant_id, relationship_id, match_source, interest_response_id)
     values ('00000000-0000-4000-8000-000000002b41', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', 'INTEREST_ACCEPTED', '00000000-0000-4000-8000-000000002b31') $$,
  'the acceptance opens a match on the same relationship, in its tenant');

-- Shape ----------------------------------------------------------------------------
select is((select bool_and(relrowsecurity) from pg_class where oid in ('network.interest_responses'::regclass, 'network.matches'::regclass, 'network.interest_response_requests'::regclass)), true,
  'row level security is on for all three tables');
select is((select count(*)::int from pg_policies where schemaname = 'network' and tablename in ('interest_responses', 'matches', 'interest_response_requests')), 0,
  'no policies: server-internal');
select is((select status from network.matches where id = '00000000-0000-4000-8000-000000002b41'), 'ACTIVE', 'a new match is ACTIVE');
select is((select current_state from network.relationships where id = '00000000-0000-4000-8000-000000002b01'), 'DISCOVERED',
  'a match does not set relationship state (the projector owns it)');

-- Invariants -----------------------------------------------------------------------
select throws_ok(
  $$ insert into network.interest_responses (tenant_id, relationship_id, interest_id, decision, responded_by_user_id, responded_in_organisation_id, relationship_event_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', '00000000-0000-4000-8000-000000002b21', 'DECLINED', pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-000000002b14') $$,
  '23505', null, 'one answer per interest: a second answer is refused, never an overwrite');
select throws_ok(
  $$ insert into network.interest_responses (tenant_id, relationship_id, interest_id, decision, responded_by_user_id, responded_in_organisation_id, relationship_event_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', '00000000-0000-4000-8000-000000002b21', 'MAYBE', pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-000000002b14') $$,
  '23514', null, 'the answer is ACCEPTED or DECLINED, nothing else');
select throws_ok(
  $$ insert into network.interest_responses (tenant_id, relationship_id, interest_id, decision, responded_by_user_id, responded_in_organisation_id, relationship_event_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', '00000000-0000-4000-8000-00000000ffff', 'DECLINED', pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-000000002b14') $$,
  '23503', null, 'an answer names a real interest on its own relationship');
select throws_ok(
  $$ insert into network.interest_responses (tenant_id, relationship_id, interest_id, decision, responded_by_user_id, responded_in_organisation_id, relationship_event_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', '00000000-0000-4000-8000-000000002b21', 'ACCEPTED', pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-000000002b13') $$,
  '23505', null, 'a history row backs at most one answer');
select throws_ok(
  $$ insert into network.matches (tenant_id, relationship_id, match_source, interest_response_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', 'INTEREST_ACCEPTED', '00000000-0000-4000-8000-000000002b31') $$,
  '23505', null, 'one active match per relationship, and one match per acceptance');
select throws_ok(
  $$ insert into network.matches (tenant_id, relationship_id, match_source, interest_response_id, status)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', 'SWIPE', '00000000-0000-4000-8000-000000002b31', 'ENDED') $$,
  '23514', null, 'match sources are a closed vocabulary: no swipe');
select throws_ok(
  $$ insert into network.matches (tenant_id, relationship_id, match_source, interest_response_id, status)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', 'INTEREST_ACCEPTED', '00000000-0000-4000-8000-000000002b31', 'INVESTED') $$,
  '23514', null, 'a match is not an investment');
select throws_ok(
  $$ insert into network.interest_response_requests (user_id, organisation_id, tenant_id, idempotency_key_hash, request_hash, interest_response_id)
     values (pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('tenant_a'), 'raw-client-key', repeat('c', 64), '00000000-0000-4000-8000-000000002b31') $$,
  '23514', null, 'only a key hash is stored, never the raw key');

-- Capability reference data --------------------------------------------------------
select is((select count(*)::int from permissions.role_capabilities rc
             join permissions.roles r on r.id = rc.role_id
             join permissions.capabilities c on c.id = rc.capability_id
            where c.code in ('company.interest.view', 'company.interest.respond') and rc.effect = 'ALLOW'
              and r.code in ('organisation_admin', 'organisation_member')), 4,
  'company.interest.view and company.interest.respond are granted to admins and members');

-- Browser principals: nothing, from either side ----------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from network.interest_responses $$, '42501', null, 'responses: the company-side user has no raw access');
select throws_ok($$ select * from network.matches $$, '42501', null, 'matches: the company-side user has no raw access');
select throws_ok(
  $$ insert into network.matches (tenant_id, relationship_id, match_source, interest_response_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', 'INTEREST_ACCEPTED', '00000000-0000-4000-8000-000000002b31') $$,
  '42501', null, 'matches: a founder cannot make a match directly');
select pg_temp.act_as_user_b();
select throws_ok($$ select * from network.matches $$, '42501', null, 'matches: the investor-side user has no raw access');
select throws_ok($$ update network.interest_responses set decision = 'ACCEPTED' $$, '42501', null, 'responses: the investor cannot rewrite an answer');
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from network.matches $$, '42501', null, 'matches: anonymous denied');
select pg_temp.act_as_service_role();
select throws_ok($$ select * from network.interest_responses $$, '42501', null, 'service_role: no grant on responses');
select throws_ok($$ select * from network.interest_response_requests $$, '42501', null, 'service_role: no grant on response requests');

-- Privileged server role: EXPECTED DB BEHAVIOUR; DB BYPASS ≠ BUSINESS AUTHORISATION.
select pg_temp.act_as_privileged();
select is((select count(*)::int from network.matches where tenant_id = pg_temp.rls_id('tenant_a')), 1,
  'privileged: the server role reads the match (infrastructure, not authorisation)');
select is((select count(*)::int from information_schema.tables where table_schema = 'network' and table_name in ('deals', 'opportunities', 'messages', 'conversations')), 0,
  'a match brings no deal, opportunity or message table');

select * from finish();

rollback;
