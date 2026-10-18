-- F26: per-section review of Q's deck reading, "Read again" and its budget.
--
-- EXPECTED DB BEHAVIOUR: server-only (RLS on, no policies, no client
-- grants); append-only; a new reading of the same version is appended under
-- a new reading_number; "Read again" is capped at two per version; reviews
-- and requests belong to their reading's tenant.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the server decides the owner).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(13);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000081c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Review Co A', 'review-co-a');
insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000081d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000081c1', pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Deck', pg_temp.rls_id('user_a'));
insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id) values
  ('00000000-0000-4000-8000-0000000081f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000081d1', 1, 'company-private', 'documents/81d1/v1', 'deck.pdf', 'application/pdf', 900, repeat('d', 64), pg_temp.rls_id('user_a'));
insert into evidence.deck_extractions (id, tenant_id, company_id, document_id, document_version_id, prompt_version, schema_version, sections) values
  ('00000000-0000-4000-8000-0000000081b1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000081c1', '00000000-0000-4000-8000-0000000081d1',
   '00000000-0000-4000-8000-0000000081f1', 1, 1, (select jsonb_agg('{}'::jsonb) from generate_series(1, 12)));

select is((select reading_number from evidence.deck_extractions where id = '00000000-0000-4000-8000-0000000081b1'), 1,
  'an existing reading is reading 1');
select lives_ok(
  $$ insert into evidence.deck_extractions (tenant_id, company_id, document_id, document_version_id, prompt_version, schema_version, sections, reading_number, reading_origin, set_aside)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000081c1', '00000000-0000-4000-8000-0000000081d1',
             '00000000-0000-4000-8000-0000000081f1', 1, 1, (select jsonb_agg('{}'::jsonb) from generate_series(1, 12)), 2, 'READ_AGAIN', '[]'::jsonb) $$,
  'a second reading of the same version is appended');
select throws_ok(
  $$ insert into evidence.deck_extractions (tenant_id, company_id, document_id, document_version_id, prompt_version, schema_version, sections, reading_number)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000081c1', '00000000-0000-4000-8000-0000000081d1',
             '00000000-0000-4000-8000-0000000081f1', 1, 1, (select jsonb_agg('{}'::jsonb) from generate_series(1, 12)), 2) $$,
  '23505', null, 'a reading number is used once per version and prompt');

select lives_ok(
  $$ insert into evidence.deck_section_reviews (tenant_id, extraction_id, section, action, reviewed_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000081b1', 'BUSINESS_MODEL', 'DISMISS', pg_temp.rls_id('user_a')) $$,
  'a founder dismisses one section');
select throws_ok(
  $$ insert into evidence.deck_section_reviews (tenant_id, extraction_id, section, action, reviewed_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000081b1', 'TRACTION', 'CORRECT', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'a correction carries the founder''s words');
select throws_ok(
  $$ insert into evidence.deck_section_reviews (tenant_id, extraction_id, section, action, reviewed_by_user_id)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000081b1', 'TRACTION', 'CONFIRM', pg_temp.rls_id('user_b')) $$,
  '23503', null, 'cross-tenant: only the reading''s tenant reviews it');
select throws_ok(
  $$ update evidence.deck_section_reviews set action = 'CONFIRM' $$, '55000', null, 'a review is never rewritten');

select lives_ok(
  $$ insert into evidence.deck_read_again_requests (tenant_id, extraction_id, document_version_id, requested_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000081b1', '00000000-0000-4000-8000-0000000081f1', pg_temp.rls_id('user_a')),
            (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000081b1', '00000000-0000-4000-8000-0000000081f1', pg_temp.rls_id('user_a')) $$,
  'two "Read again" per version');
select throws_ok(
  $$ insert into evidence.deck_read_again_requests (tenant_id, extraction_id, document_version_id, requested_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000081b1', '00000000-0000-4000-8000-0000000081f1', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'a third is refused (budget)');
select throws_ok(
  $$ delete from evidence.deck_read_again_requests $$, '55000', null, 'a request is never deleted');

select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'evidence.deck_section_reviews'::regclass, 'evidence.deck_read_again_requests'::regclass,
  'evidence.deck_read_again_outcomes'::regclass)), true, 'row level security is on');
select is((select count(*)::int from pg_policies where schemaname = 'evidence'
            and tablename in ('deck_section_reviews', 'deck_read_again_requests', 'deck_read_again_outcomes')), 0,
  'server-only: no policies');

select pg_temp.act_as_user_a();
select throws_ok($$ select * from evidence.deck_section_reviews $$, '42501', null,
  'even the founder never reads reviews directly');

select * from finish();
rollback;
