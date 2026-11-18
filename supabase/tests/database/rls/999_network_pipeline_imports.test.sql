-- CRM import (migration 20261231598370): a prepared pipeline import and its
-- rows, private to the importing organisation. Server-only; content is
-- history (no delete; an import moves PREPARED -> APPLIED once; a row gains
-- its outcome once).
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(24);

select ok((select relrowsecurity from pg_class where oid = 'network.pipeline_imports'::regclass), 'imports have RLS on');
select ok((select relrowsecurity from pg_class where oid = 'network.pipeline_import_rows'::regclass), 'import rows have RLS on');
select is((select count(*)::int from pg_policies where schemaname = 'network' and tablename in ('pipeline_imports', 'pipeline_import_rows')), 0, 'no client policies: server-only');
select ok(not has_table_privilege('authenticated', 'network.pipeline_imports', 'SELECT'), 'members read imports only through the scoped API');
select ok(not has_table_privilege('authenticated', 'network.pipeline_import_rows', 'INSERT'), 'members cannot write import rows around the API');
select ok(not has_table_privilege('anon', 'network.pipeline_import_rows', 'SELECT'), 'anonymous cannot read import rows');

-- Investor B imports its pipeline; company A is the one it names.
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Import Company A', 'import-company-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000000e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Import Investor B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id) values
  ('00000000-0000-4000-8000-00000000ab01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2');

create function pg_temp.import_for(p_id uuid, p_org text, p_tenant text, p_investor uuid, p_company uuid default null) returns void language sql as $$
  insert into network.pipeline_imports
    (id, tenant_id, organisation_id, company_id, investor_organisation_id, created_by_user_id,
     document_id, document_version_id, file_name, source_format, row_count, mapping, mapping_source, proposal_hash)
  values
    (p_id, pg_temp.rls_id(p_tenant), pg_temp.rls_id(p_org), p_company, p_investor, pg_temp.rls_id('user_b'),
     gen_random_uuid(), gen_random_uuid(), 'pipeline.csv', 'CSV', 2, '{"counterpartName":"Company"}', 'HEADERS', repeat('a', 64));
$$;

-- Positive: the investor's own side.
select lives_ok($$select pg_temp.import_for('00000000-0000-4000-8000-00000000d001', 'org_b', 'tenant_b', '00000000-0000-4000-8000-0000000000e2')$$, 'an investor prepares an import on its own side');
select lives_ok($$insert into network.pipeline_import_rows (import_id, row_number, tenant_id, organisation_id, counterpart_name, website_domain, match_status, matched_party_id)
  values ('00000000-0000-4000-8000-00000000d001', 1, pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Import Company A', 'company-a.example', 'MATCHED', '00000000-0000-4000-8000-0000000000c1')$$, 'a matched row is stored');
select lives_ok($$insert into network.pipeline_import_rows (import_id, row_number, tenant_id, organisation_id, counterpart_name, match_status)
  values ('00000000-0000-4000-8000-00000000d001', 2, pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Not On Capital Q Ltd', 'NEW')$$, 'an unmatched row stays a private prospect row');

-- Cross-tenant and wrong-side negatives.
select throws_ok($$select pg_temp.import_for('00000000-0000-4000-8000-00000000d002', 'org_a', 'tenant_a', '00000000-0000-4000-8000-0000000000e2')$$, '23503', null, 'another organisation cannot import onto the investor''s side');
select throws_ok($$select pg_temp.import_for('00000000-0000-4000-8000-00000000d003', 'org_b', 'tenant_b', '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000c1')$$, '23514', null, 'an import has exactly one side');
select throws_ok($$insert into network.pipeline_import_rows (import_id, row_number, tenant_id, organisation_id, counterpart_name, match_status)
  values ('00000000-0000-4000-8000-00000000d001', 3, pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'x', 'NEW')$$, '23503', null, 'a row cannot be filed under another organisation''s import');
select throws_ok($$insert into network.pipeline_import_rows (import_id, row_number, tenant_id, organisation_id, counterpart_name, match_status)
  values ('00000000-0000-4000-8000-00000000d001', 4, pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'x', 'MATCHED')$$, '23514', null, 'a matched row names its party');
select throws_ok($$insert into network.pipeline_import_rows (import_id, row_number, tenant_id, organisation_id, counterpart_name, match_status)
  values ('00000000-0000-4000-8000-00000000d001', 5001, pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'x', 'NEW')$$, '23514', null, 'an import is bounded to 5,000 rows');

-- History: content never changes; a row gains its outcome once; nothing is deleted.
select throws_ok($$update network.pipeline_import_rows set counterpart_name = 'rewritten' where row_number = 1$$, '23514', null, 'a prepared row is never rewritten');
select throws_ok($$update network.pipeline_import_rows set outcome = 'LINKED' where row_number = 2$$, '23514', null, 'an unmatched row is never linked (no relationship)');
select lives_ok($$update network.pipeline_import_rows set outcome = 'LINKED', relationship_id = '00000000-0000-4000-8000-00000000ab01' where row_number = 1$$, 'a matched row is linked to the one relationship');
select throws_ok($$update network.pipeline_import_rows set outcome = 'SKIPPED', relationship_id = null where row_number = 1$$, '23514', null, 'an outcome is set once');
select throws_ok($$delete from network.pipeline_import_rows where row_number = 2$$, '23514', null, 'a row is never deleted');
select throws_ok($$update network.pipeline_imports set mapping = '{}' where id = '00000000-0000-4000-8000-00000000d001'$$, '23514', null, 'a prepared mapping is never rewritten');
select lives_ok($$update network.pipeline_imports set status = 'APPLIED', apply_idempotency_key = gen_random_uuid(), approved_by_user_id = pg_temp.rls_id('user_b'), applied_at = now(), result = '{"linked":1}' where id = '00000000-0000-4000-8000-00000000d001'$$, 'an approved import is applied once');
select throws_ok($$update network.pipeline_imports set result = '{"linked":2}' where id = '00000000-0000-4000-8000-00000000d001'$$, '23514', null, 'an applied import is never changed');

-- No browser principal reads imports: the importer, the counterpart, revoked.
select pg_temp.act_as_user_b();
select throws_ok('select * from network.pipeline_imports', '42501', null, 'the importer too reads only through the API');
select pg_temp.act_as_user_a();
select throws_ok('select * from network.pipeline_import_rows', '42501', null, 'the named company cannot read the investor''s import');
reset role;
select pg_temp.reset_test_identity();

select * from finish();
rollback;
