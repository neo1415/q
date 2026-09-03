-- CQ-NET-001 · relationship spine: server-internal until CQ-PERM-001.
--
-- One canonical relationship per Company ↔ Investor Organisation pair, with
-- the company's tenant as storage anchor (ADR 0003) even when the investor
-- lives in another tenant. History is append-only and sequence-ordered.
-- No browser principal may read or write either table; the privileged
-- server role may, which is infrastructure, not business authorisation.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(27);

-- Company A lives in tenant A; the investor organisation lives in tenant B.
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Company A', 'company-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000000e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Investor B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id) values
  ('00000000-0000-4000-8000-00000000ab01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2');
insert into network.relationship_events (id, tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, payload, correlation_id) values
  ('00000000-0000-4000-8000-00000000ab11', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ab01', 1, 'discovered', 'HUMAN', pg_temp.rls_id('user_b'), 'DISCOVER', 'investor_private', '{"note":"PRIVATE-RELATIONSHIP-EVENT-DATA-DO-NOT-EMIT"}', 'cor_00000000-0000-4000-8000-000000000001');

-- Invariants ------------------------------------------------------------------------
select is((select current_state from network.relationships where id = '00000000-0000-4000-8000-00000000ab01'), 'DISCOVERED', 'a new relationship is DISCOVERED');
select is((select tenant_id from network.relationships where id = '00000000-0000-4000-8000-00000000ab01'), pg_temp.rls_id('tenant_a'),
  'the relationship is anchored in the company tenant while the investor lives in another tenant');
select is((select count(*)::int from network.relationships where investor_organisation_id = '00000000-0000-4000-8000-0000000000e2'), 1,
  'no duplicate row exists under the investor tenant: one pair, one row');
select throws_ok(
  $$ insert into network.relationships (tenant_id, company_id, investor_organisation_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2') $$,
  '23505', null, 'ONE relationship per company/investor pair');
select throws_ok(
  $$ insert into network.relationships (tenant_id, company_id, investor_organisation_id)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2') $$,
  '23505', null, 'the pair stays unique even under another tenant (no per-tenant duplicate)');
select throws_ok(
  $$ update network.relationships set tenant_id = pg_temp.rls_id('tenant_b') where id = '00000000-0000-4000-8000-00000000ab01' $$,
  '23503', null, 'the tenant anchor cannot drift from the company tenant');
select throws_ok(
  $$ insert into network.relationship_events (tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, correlation_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ab01', 1, 'discovered', 'HUMAN', pg_temp.rls_id('user_b'), 'DISCOVER', 'investor_private', 'cor_00000000-0000-4000-8000-000000000002') $$,
  '23505', null, 'sequence is unique per relationship');
select throws_ok(
  $$ insert into network.relationship_events (tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, correlation_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ab01', 2, 'discovered', 'HUMAN', pg_temp.rls_id('user_b'), 'DISCOVER', 'public', 'cor_00000000-0000-4000-8000-000000000002') $$,
  '23514', null, 'legacy "public" is not a visibility scope');
select throws_ok(
  $$ insert into network.relationship_events (tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, correlation_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ab01', 2, 'discovered', 'HUMAN', pg_temp.rls_id('user_b'), 'FEED_IMPRESSION', 'investor_private', 'cor_00000000-0000-4000-8000-000000000002') $$,
  '23514', null, 'source vocabulary is closed');
select throws_ok(
  $$ insert into network.relationship_events (tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, correlation_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ab01', 2, 'discovered', 'LLM', pg_temp.rls_id('user_b'), 'DISCOVER', 'investor_private', 'cor_00000000-0000-4000-8000-000000000002') $$,
  '23514', null, 'actor vocabulary is the canonical HUMAN/Q/SYSTEM/CONNECTED_SYSTEM set');
select throws_ok(
  $$ insert into network.relationship_events (tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, correlation_id)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ab01', 2, 'discovered', 'HUMAN', pg_temp.rls_id('user_b'), 'DISCOVER', 'investor_private', 'cor_00000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'history cannot name a relationship under another tenant');
select lives_ok(
  $$ insert into network.relationship_events (tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, correlation_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ab01', 2, 'discovered', 'HUMAN', pg_temp.rls_id('user_a'), 'GATEQ', 'founder_private', 'cor_00000000-0000-4000-8000-000000000003') $$,
  'the same relationship carries founder_private and investor_private events side by side');
select results_eq(
  $$ select visibility_scope from network.relationship_events where relationship_id = '00000000-0000-4000-8000-00000000ab01' order by sequence $$,
  $$ values ('investor_private'), ('founder_private') $$,
  'visibility scopes persist exactly as chosen');

-- Browser principals: nothing, in either direction -------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from network.relationships $$, '42501', null, 'relationships: company-side user A has no raw access');
select throws_ok($$ select * from network.relationship_events $$, '42501', null, 'history: company-side user A has no raw access');
select throws_ok($$ update network.relationship_events set visibility_scope = 'relationship_shared' where id = '00000000-0000-4000-8000-00000000ab11' $$, '42501', null, 'history: user A cannot escalate a scope');
select throws_ok($$ delete from network.relationship_events where id = '00000000-0000-4000-8000-00000000ab11' $$, '42501', null, 'history: user A cannot delete');
select throws_ok($$ update network.relationships set current_state = 'MATCHED' where id = '00000000-0000-4000-8000-00000000ab01' $$, '42501', null, 'relationships: user A cannot set a state');
select pg_temp.act_as_user_b();
select throws_ok($$ select * from network.relationships $$, '42501', null, 'relationships: investor-side user B has no raw access either');
select throws_ok($$ select * from network.relationship_events $$, '42501', null, 'history: investor-side user B has no raw access either');
select throws_ok($$ insert into network.relationships (tenant_id, company_id, investor_organisation_id) values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2') $$, '42501', null, 'relationships: a browser principal cannot create');
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from network.relationships $$, '42501', null, 'relationships: anonymous denied');
select throws_ok($$ select * from network.relationship_events $$, '42501', null, 'history: anonymous denied');
select pg_temp.act_as_service_role();
select throws_ok($$ select * from network.relationships $$, '42501', null, 'service_role: no grant on relationships');

-- Privileged server role: EXPECTED DB BEHAVIOUR; DB BYPASS ≠ BUSINESS AUTHORISATION.
select pg_temp.act_as_privileged();
select is((select count(*)::int from network.relationships), 1, 'privileged: the server role reads the relationship (infrastructure, not authorisation)');
select is((select count(*)::int from network.relationship_events), 2, 'privileged: the server role reads the history');
select is((select count(*)::int from information_schema.tables where table_schema = 'network' and table_name in ('interests', 'matches', 'deals', 'opportunities')), 0,
  'no interest, match, deal or opportunity table exists');

select * from finish();

rollback;
