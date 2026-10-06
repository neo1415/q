-- Data room (A3), deck extractions (A5) and a founder as a person (A7).
--
-- EXPECTED DB BEHAVIOUR: evidence tables are server-only (RLS on, no
-- policies, no client grants); reference data is readable by signed-in
-- clients; person facts are readable by their own person only.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the server decides the reader, the level and the
-- projection; an investor never receives a title it may not see).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(35);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000080c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Room Co A', 'room-co-a'),
  ('00000000-0000-4000-8000-0000000080c2', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'Room Co R', 'room-co-r');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000080e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Room Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000008001', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000080c1', '00000000-0000-4000-8000-0000000080e2', 'DISCOVERED');
insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000080d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000080c1', pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Deck v3', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000080d2', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000080c1', pg_temp.rls_id('org_a'), 'LEGAL', 'Litigation with X', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000080d3', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-0000000080c2', pg_temp.rls_id('org_r'), 'LEGAL', 'Other tenant doc', pg_temp.rls_id('user_r'));
insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id) values
  ('00000000-0000-4000-8000-0000000080f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000080d1', 1, 'company-private', 'documents/80d1/v1', 'deck.pdf', 'application/pdf', 900, repeat('c', 64), pg_temp.rls_id('user_a'));

insert into core.founder_person_facts (user_id, tenant_id, birth_year) values
  (pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'), 1992);

-- Server-only tables.
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'evidence.data_room_entries'::regclass, 'evidence.data_room_access_requests'::regclass,
  'evidence.data_room_request_decisions'::regclass, 'evidence.data_room_views'::regclass,
  'evidence.deck_extractions'::regclass, 'evidence.deck_extraction_confirmations'::regclass)), true,
  'row level security is on for every data-room and deck table');
select is((select count(*)::int from pg_policies where schemaname = 'evidence'
            and tablename in ('data_room_entries', 'data_room_access_requests', 'data_room_request_decisions',
                              'data_room_views', 'deck_extractions', 'deck_extraction_confirmations')), 0,
  'server-only: no policies on the tenant tables');
select ok(not has_table_privilege('authenticated', 'evidence.data_room_entries', 'select')
          and not has_table_privilege('anon', 'evidence.data_room_entries', 'select')
          and not has_table_privilege('authenticated', 'evidence.data_room_access_requests', 'insert')
          and not has_table_privilege('authenticated', 'evidence.deck_extractions', 'select'),
  'no client role reads or writes them');

-- Reference data.
select ok((select count(*) from evidence.data_room_checklist_items where min_stage_rank = 1) = 8,
  'the pre-seed checklist has the eight research items');
select ok((select count(*) from evidence.data_room_checklist_items where min_stage_rank <= 2 and country_codes is null) = 18,
  'seed has eighteen');
select is((select country_labels->>'NG' from evidence.data_room_checklist_items where code = 'registry_extract'),
  'Shareholders and directors (CAC 1.1)', 'country words are reference data');

-- Levels and their ADR-001 scope (derived, never chosen).
select lives_ok(
  $$ insert into evidence.data_room_entries (document_id, tenant_id, company_id, folder_code, checklist_item_code, level, updated_by_user_id)
     values ('00000000-0000-4000-8000-0000000080d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000080c1', 'fundraising', 'pitch_deck', 'PUBLIC', pg_temp.rls_id('user_a')) $$,
  'a founder files their deck as public');
select is((select visibility_scope from evidence.data_room_entries where document_id = '00000000-0000-4000-8000-0000000080d1'),
  'network_visible', 'PUBLIC is network_visible, never public_external');
select lives_ok(
  $$ insert into evidence.data_room_entries (document_id, tenant_id, company_id, folder_code, level, updated_by_user_id)
     values ('00000000-0000-4000-8000-0000000080d2', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000080c1', 'legal_ip', 'SHARED_ONLY', pg_temp.rls_id('user_a')) $$,
  'a sensitive document is shared-only');
select is((select visibility_scope from evidence.data_room_entries where document_id = '00000000-0000-4000-8000-0000000080d2'),
  'specifically_shared', 'SHARED_ONLY is specifically_shared');
update evidence.data_room_entries set level = 'PRIVATE' where document_id = '00000000-0000-4000-8000-0000000080d2';
select is((select visibility_scope from evidence.data_room_entries where document_id = '00000000-0000-4000-8000-0000000080d2'),
  'organisation_private', 'PRIVATE is organisation_private, and the scope follows the level');
select throws_ok(
  $$ update evidence.data_room_entries set visibility_scope = 'public_external' where document_id = '00000000-0000-4000-8000-0000000080d1' $$,
  '428C9', null, 'the scope cannot be set apart from the level');
select throws_ok(
  $$ update evidence.data_room_entries set level = 'EVERYONE' where document_id = '00000000-0000-4000-8000-0000000080d1' $$,
  '23514', null, 'only the four levels exist');

-- Cross-tenant negatives.
select throws_ok(
  $$ insert into evidence.data_room_entries (document_id, tenant_id, company_id, folder_code, level, updated_by_user_id)
     values ('00000000-0000-4000-8000-0000000080d3', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000080c1', 'legal_ip', 'PUBLIC', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'cross-tenant: another tenant''s document cannot enter this room');
select throws_ok(
  $$ insert into evidence.data_room_entries (document_id, tenant_id, company_id, folder_code, level, updated_by_user_id)
     values ('00000000-0000-4000-8000-0000000080d3', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-0000000080c1', 'legal_ip', 'PUBLIC', pg_temp.rls_id('user_r')) $$,
  '23514', null, 'cross-tenant: a document cannot be filed under another company');

-- Requests, decisions, views.
select lives_ok(
  $$ insert into evidence.data_room_access_requests (id, tenant_id, company_id, document_id, relationship_id, investor_organisation_id, requested_by_user_id, note, idempotency_key)
     values ('00000000-0000-4000-8000-0000000080a1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000080c1', '00000000-0000-4000-8000-0000000080d2',
             '00000000-0000-4000-8000-000000008001', '00000000-0000-4000-8000-0000000080e2', pg_temp.rls_id('user_b'), 'For our committee', 'request-key-0001') $$,
  'the investor''s request is recorded');
select throws_ok(
  $$ insert into evidence.data_room_access_requests (tenant_id, company_id, document_id, relationship_id, investor_organisation_id, requested_by_user_id, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000080c1', '00000000-0000-4000-8000-0000000080d2',
             '00000000-0000-4000-8000-000000008001', '00000000-0000-4000-8000-0000000080e2', pg_temp.rls_id('user_b'), 'request-key-0001') $$,
  '23505', null, 'a retried request is one request (idempotency key)');
select throws_ok(
  $$ insert into evidence.data_room_access_requests (tenant_id, company_id, document_id, relationship_id, investor_organisation_id, requested_by_user_id, idempotency_key)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000080c1', null,
             '00000000-0000-4000-8000-000000008001', '00000000-0000-4000-8000-0000000080e2', pg_temp.rls_id('user_b'), 'request-key-0002') $$,
  '23503', null, 'cross-tenant: a request belongs to the company''s tenant');
select throws_ok(
  $$ insert into evidence.data_room_request_decisions (request_id, tenant_id, decision, decided_by_user_id)
     values ('00000000-0000-4000-8000-0000000080a1', pg_temp.rls_id('tenant_a'), 'APPROVED', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'an approval always carries an expiry');
select throws_ok(
  $$ insert into evidence.data_room_request_decisions (request_id, tenant_id, decision, expires_at, decided_by_user_id)
     values ('00000000-0000-4000-8000-0000000080a1', pg_temp.rls_id('tenant_b'), 'APPROVED', now() + interval '30 days', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'cross-tenant: a decision belongs to its request''s tenant');
select lives_ok(
  $$ insert into evidence.data_room_request_decisions (request_id, tenant_id, decision, expires_at, decided_by_user_id)
     values ('00000000-0000-4000-8000-0000000080a1', pg_temp.rls_id('tenant_a'), 'APPROVED', clock_timestamp() + interval '30 days', pg_temp.rls_id('user_a')) $$,
  'the founder approves for 30 days');
select throws_ok(
  $$ insert into evidence.data_room_request_decisions (request_id, tenant_id, decision, decided_by_user_id)
     values ('00000000-0000-4000-8000-0000000080a1', pg_temp.rls_id('tenant_a'), 'DECLINED', pg_temp.rls_id('user_a')) $$,
  '23505', null, 'one answer per request');
select throws_ok(
  $$ update evidence.data_room_request_decisions set expires_at = now() + interval '900 days' $$,
  '55000', null, 'an answer is never rewritten');
select lives_ok(
  $$ insert into evidence.data_room_views (document_id, tenant_id, investor_organisation_id, viewed_by_user_id)
     values ('00000000-0000-4000-8000-0000000080d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000080e2', pg_temp.rls_id('user_b')) $$,
  'the first open is recorded');
select throws_ok(
  $$ delete from evidence.data_room_views $$, '55000', null, 'a view is never deleted');

-- Deck extractions and the Write Gate.
select lives_ok(
  $$ insert into evidence.deck_extractions (id, tenant_id, company_id, document_id, document_version_id, prompt_version, schema_version, sections)
     values ('00000000-0000-4000-8000-0000000080b1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000080c1', '00000000-0000-4000-8000-0000000080d1',
             '00000000-0000-4000-8000-0000000080f1', 1, 1, (select jsonb_agg('{}'::jsonb) from generate_series(1, 12))) $$,
  'Q''s reading of a deck version is stored');
select throws_ok(
  $$ insert into evidence.deck_extractions (tenant_id, company_id, document_id, document_version_id, prompt_version, schema_version, sections)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000080c1', '00000000-0000-4000-8000-0000000080d1',
             '00000000-0000-4000-8000-0000000080f1', 2, 1, '[]'::jsonb) $$,
  '23514', null, 'always exactly twelve sections');
select throws_ok(
  $$ insert into evidence.deck_extractions (tenant_id, company_id, document_id, document_version_id, prompt_version, schema_version, sections)
     values (pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-0000000080c2', '00000000-0000-4000-8000-0000000080d1',
             '00000000-0000-4000-8000-0000000080f1', 3, 1, (select jsonb_agg('{}'::jsonb) from generate_series(1, 12))) $$,
  '23503', null, 'cross-tenant: an extraction belongs to its version''s tenant');
select throws_ok(
  $$ update evidence.deck_extractions set prompt_version = 9 $$, '55000', null, 'an extraction is never rewritten');
select throws_ok(
  $$ insert into evidence.deck_extraction_confirmations (extraction_id, tenant_id, confirmed_by_user_id)
     values ('00000000-0000-4000-8000-0000000080b1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b')) $$,
  '23503', null, 'cross-tenant: only the company''s tenant confirms');

-- Client roles.
select pg_temp.act_as_user_b();
select throws_ok($$ select * from evidence.data_room_entries $$, '42501', null,
  'an investor never reads the levels (or titles) directly');
select throws_ok($$ select * from evidence.deck_extractions $$, '42501', null,
  'an investor never reads an extraction directly');
select throws_ok($$ select * from evidence.data_room_folders $$, '42501', null,
  'even the reference data is served by the server only');
select pg_temp.act_as_user_b();
select is((select count(*)::int from core.founder_person_facts), 0,
  'another person never reads a founder''s facts directly (age included)');
select pg_temp.act_as_user_a();
select is((select birth_year from core.founder_person_facts), 1992,
  'a founder reads their own facts');

select * from finish();
rollback;
