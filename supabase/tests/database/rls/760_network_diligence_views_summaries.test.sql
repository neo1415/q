-- Diligence, the requester's side (2026-10-04) ·
-- network.diligence_document_views and network.diligence_document_summaries:
-- server-only, append-only, bound to their relationship's or version's tenant.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the server decides the party and shows a summary
-- only beside a share the reader can already open).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(13);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000076c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Views Co A', 'views-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000076e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Views Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000007601', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000076c1', '00000000-0000-4000-8000-0000000076e2', 'IN_DILIGENCE');
insert into evidence.documents (id, tenant_id, owner_organisation_id, document_type, title, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000076d1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Pitch deck v3', pg_temp.rls_id('user_a'));
insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id) values
  ('00000000-0000-4000-8000-0000000076f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000076d1', 1, 'company-private', 'documents/76d1/v1', 'deck.pdf', 'application/pdf', 613, repeat('b', 64), pg_temp.rls_id('user_a'));

select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'network.diligence_document_views'::regclass, 'network.diligence_document_summaries'::regclass)), true,
  'row level security is on for both tables');
select is((select count(*)::int from pg_policies where schemaname = 'network'
            and tablename in ('diligence_document_views', 'diligence_document_summaries')), 0,
  'server-only: no policies at all');
select ok(not has_table_privilege('authenticated', 'network.diligence_document_summaries', 'select')
          and not has_table_privilege('anon', 'network.diligence_document_views', 'select'),
  'no client role reads either table');

-- Views: the first open per person, once.
select throws_ok(
  $$ insert into network.diligence_document_views (relationship_id, tenant_id, document_id, viewed_by_user_id)
     values ('00000000-0000-4000-8000-000000007601', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000076d1', pg_temp.rls_id('user_b')) $$,
  '23503', null, 'a view belongs to its relationship''s tenant');
select lives_ok(
  $$ insert into network.diligence_document_views (relationship_id, tenant_id, document_id, viewed_by_user_id)
     values ('00000000-0000-4000-8000-000000007601', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000076d1', pg_temp.rls_id('user_b')) $$,
  'the investor''s first open is recorded');
select throws_ok(
  $$ insert into network.diligence_document_views (relationship_id, tenant_id, document_id, viewed_by_user_id)
     values ('00000000-0000-4000-8000-000000007601', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000076d1', pg_temp.rls_id('user_b')) $$,
  '23505', null, 'one row per relationship, document and person');
select throws_ok(
  $$ delete from network.diligence_document_views where relationship_id = '00000000-0000-4000-8000-000000007601' $$,
  '55000', null, 'a view is never deleted');

-- Summaries: one per version, bounded, append-only.
select throws_ok(
  $$ insert into network.diligence_document_summaries (document_version_id, tenant_id, document_id, summary, prompt_version)
     values ('00000000-0000-4000-8000-0000000076f1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000076d1', 'cross', 1) $$,
  '23503', null, 'a summary belongs to its version''s tenant');
select lives_ok(
  $$ insert into network.diligence_document_summaries (document_version_id, tenant_id, document_id, summary, prompt_version)
     values ('00000000-0000-4000-8000-0000000076f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000076d1',
             'Pitch deck · 14 slides · ARR $84k (self-reported)', 1) $$,
  'Q''s one line on a version is stored');
select throws_ok(
  $$ insert into network.diligence_document_summaries (document_version_id, tenant_id, document_id, summary, prompt_version)
     values ('00000000-0000-4000-8000-0000000076f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000076d1', 'again', 1) $$,
  '23505', null, 'one summary per version');
select throws_ok(
  $$ update network.diligence_document_summaries set summary = 'ARR $1m' where document_version_id = '00000000-0000-4000-8000-0000000076f1' $$,
  '55000', null, 'even the server role cannot rewrite Q''s line');

select pg_temp.act_as_user_b();
select throws_ok($$ select * from network.diligence_document_summaries $$, '42501', null,
  'the investor side reads summaries only through the server, beside a share');
select pg_temp.act_as_user_a();
select throws_ok($$ insert into network.diligence_document_views (relationship_id, tenant_id, document_id, viewed_by_user_id)
     values ('00000000-0000-4000-8000-000000007601', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000076d1', pg_temp.rls_id('user_a')) $$,
  '42501', null, 'no one marks a document viewed directly');

select * from finish();
rollback;
