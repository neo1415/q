-- Data-room access goes through the relationship (2026-10-08).
--
-- EXPECTED DB BEHAVIOUR: a data-room request row exists only for a
-- relationship whose history holds an accepted connection (the server
-- refuses first; this is the second layer). The settings table is
-- server-only like the rest of evidence.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the server locks the room's view and refuses
-- opens and shares for an unconnected investor).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(11);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000089c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Gate Co A', 'gate-co-a');
-- One investor organisation per organisation (unique): a second firm.
insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug) values
  ('00000000-0000-4000-8000-0000000089b2', pg_temp.rls_id('tenant_b'), 'investment_firm', 'Gate Firm Two', 'gate-firm-two');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000089e1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Gate Capital One'),
  ('00000000-0000-4000-8000-0000000089e2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000089b2', 'VC', 'Gate Capital Two');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  -- Interest expressed, not accepted.
  ('00000000-0000-4000-8000-000000008901', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000089c1', '00000000-0000-4000-8000-0000000089e1', 'INTEREST_EXPRESSED'),
  -- Accepted; the cached state still lags (the rule reads history).
  ('00000000-0000-4000-8000-000000008902', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000089c1', '00000000-0000-4000-8000-0000000089e2', 'INTEREST_EXPRESSED');
insert into network.relationship_events (tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, correlation_id) values
  (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008901', 1, 'interest_expressed', 'HUMAN', pg_temp.rls_id('user_b'), 'DISCOVER', 'relationship_shared', 'cor_00000000-0000-4000-8000-000000008911'),
  (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008902', 1, 'interest_expressed', 'HUMAN', pg_temp.rls_id('user_b'), 'DISCOVER', 'relationship_shared', 'cor_00000000-0000-4000-8000-000000008912'),
  (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008902', 2, 'connection_accepted', 'HUMAN', pg_temp.rls_id('user_a'), 'MANUAL', 'relationship_shared', 'cor_00000000-0000-4000-8000-000000008913');

-- The rule.
select is(private.relationship_is_connected('00000000-0000-4000-8000-000000008901'), false,
  'an interest the founder has not accepted is not a connection');
select is(private.relationship_is_connected('00000000-0000-4000-8000-000000008902'), true,
  'an accepted connection is, whatever the cached state says');
select is(private.relationship_is_connected('00000000-0000-4000-8000-0000000089ff'), false,
  'no relationship is no connection');

-- Requests (negative first).
select throws_ok(
  $$ insert into evidence.data_room_access_requests (tenant_id, company_id, document_id, relationship_id, investor_organisation_id, requested_by_user_id, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000089c1', null,
             '00000000-0000-4000-8000-000000008901', '00000000-0000-4000-8000-0000000089e1', pg_temp.rls_id('user_b'), 'gate-request-0001') $$,
  '42501', null, 'an unconnected investor''s request is refused by the database too');
select lives_ok(
  $$ insert into evidence.data_room_access_requests (tenant_id, company_id, document_id, relationship_id, investor_organisation_id, requested_by_user_id, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000089c1', null,
             '00000000-0000-4000-8000-000000008902', '00000000-0000-4000-8000-0000000089e2', pg_temp.rls_id('user_b'), 'gate-request-0002') $$,
  'a connected investor''s request is recorded');

-- Settings: server-only, default off, company tenant only.
select ok((select relrowsecurity from pg_class where oid = 'evidence.data_room_settings'::regclass),
  'row level security is on for the settings');
select ok(not has_table_privilege('authenticated', 'evidence.data_room_settings', 'select')
          and not has_table_privilege('authenticated', 'evidence.data_room_settings', 'insert')
          and not has_table_privilege('anon', 'evidence.data_room_settings', 'select'),
  'no client role reads or writes the settings');
select ok(not has_function_privilege('authenticated', 'private.relationship_is_connected(uuid)', 'execute'),
  'no client role calls the rule directly');
select throws_ok(
  $$ insert into evidence.data_room_settings (company_id, tenant_id, updated_by_user_id)
     values ('00000000-0000-4000-8000-0000000089c1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b')) $$,
  '23503', null, 'cross-tenant: settings belong to the company''s tenant');

select lives_ok(
  $$ insert into evidence.data_room_settings (company_id, tenant_id, updated_by_user_id)
     values ('00000000-0000-4000-8000-0000000089c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a')) $$,
  'a company''s settings are recorded');
select is((select outline_before_connection from evidence.data_room_settings where company_id = '00000000-0000-4000-8000-0000000089c1'),
  false, 'the outline is hidden from unconnected investors unless the founder allows it');
select * from finish();
rollback;
