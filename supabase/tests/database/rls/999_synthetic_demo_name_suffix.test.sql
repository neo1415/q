-- Demo hygiene (20261231596000): a trailing " (fictional)" leaves the names
-- and titles of synthetic demo tenants only. A tenant is synthetic when
-- every member's auth account carries fictional_demo = synthetic = true; a
-- real customer's row with the same suffix is untouched. Each change moves
-- the row's version and leaves an append-only audit record; slugs stay.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(22);

-- Tenant A becomes a synthetic demo tenant; tenant B (unmarked member) is a
-- real customer; tenant R's only member is revoked and unmarked.
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
         || '{"fictional_demo": true, "synthetic": true}'::jsonb
 where id = pg_temp.rls_id('auth_a');

update identity.organisations set display_name = 'Org A (fictional)'
 where id = pg_temp.rls_id('org_a');
update identity.organisations set display_name = 'Org B (fictional)'
 where id = pg_temp.rls_id('org_b');

insert into core.companies (id, tenant_id, organisation_id, canonical_name, legal_name, slug) values
  ('00000000-0000-4000-8000-00000000f5a1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'Maji Loop (fictional)', 'Maji Loop Water Ltd (Fictional)', 'maji-loop-fictional'),
  ('00000000-0000-4000-8000-00000000f5a2', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'Saleh Dune (fictional QA fund)', null, 'saleh-dune'),
  ('00000000-0000-4000-8000-00000000f5b1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'),
   'Real Customer (fictional)', 'Real Customer Ltd (fictional)', 'real-customer'),
  ('00000000-0000-4000-8000-00000000f5c1', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'),
   'Revoked Tenant (fictional)', null, 'revoked-tenant');

insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000f5a3', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'VC', 'Savanna Seed Partners (fictional)'),
  ('00000000-0000-4000-8000-00000000f5b3', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'),
   'VC', 'Real Capital (fictional)');

insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000f5a4', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000f5a1',
   pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Maji Loop investor deck (fictional)', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-00000000f5a5', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000f5a1',
   pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Fund deck (fictional, release Z)', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-00000000f5b4', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000f5b1',
   pg_temp.rls_id('org_b'), 'PITCH_DECK', 'Real deck (fictional)', pg_temp.rls_id('user_b'));

select is(
  private.strip_synthetic_demo_name_suffix(),
  '{"companies": 1, "investorOrganisations": 1, "organisations": 1, "documents": 1}'::jsonb,
  'one company, investor, organisation and document lose the suffix');

-- Synthetic tenant: suffix gone, slug and other parentheticals kept.
select is((select canonical_name from core.companies where id = '00000000-0000-4000-8000-00000000f5a1'),
  'Maji Loop', 'a seeded company''s canonical name loses " (fictional)"');
select is((select legal_name from core.companies where id = '00000000-0000-4000-8000-00000000f5a1'),
  'Maji Loop Water Ltd', 'its legal name loses " (Fictional)" too');
select is((select slug from core.companies where id = '00000000-0000-4000-8000-00000000f5a1'),
  'maji-loop-fictional', 'its slug is unchanged');
select is((select version from core.companies where id = '00000000-0000-4000-8000-00000000f5a1'),
  2, 'the rename moves the company''s version by one');
select is((select canonical_name from core.companies where id = '00000000-0000-4000-8000-00000000f5a2'),
  'Saleh Dune (fictional QA fund)', 'another parenthetical is not the suffix and stays');
select is((select display_name from core.investor_organisations where id = '00000000-0000-4000-8000-00000000f5a3'),
  'Savanna Seed Partners', 'a seeded investor''s name loses the suffix');
select is((select display_name from identity.organisations where id = pg_temp.rls_id('org_a')),
  'Org A', 'a seeded workspace organisation''s name loses the suffix');
select is((select title from evidence.documents where id = '00000000-0000-4000-8000-00000000f5a4'),
  'Maji Loop investor deck', 'a seeded document title loses the suffix');
select is((select version from evidence.documents where id = '00000000-0000-4000-8000-00000000f5a4'),
  2, 'the document''s version moves by one');
select is((select title from evidence.documents where id = '00000000-0000-4000-8000-00000000f5a5'),
  'Fund deck (fictional, release Z)', 'a title without the exact suffix stays');

-- Real customers: untouched, version and all.
select is((select canonical_name || ' | ' || legal_name || ' | ' || version
             from core.companies where id = '00000000-0000-4000-8000-00000000f5b1'),
  'Real Customer (fictional) | Real Customer Ltd (fictional) | 1',
  'a company in a tenant with an unmarked member is untouched');
select is((select canonical_name from core.companies where id = '00000000-0000-4000-8000-00000000f5c1'),
  'Revoked Tenant (fictional)', 'a revoked unmarked member still excludes the tenant');
select is((select display_name from core.investor_organisations where id = '00000000-0000-4000-8000-00000000f5b3'),
  'Real Capital (fictional)', 'a real investor''s name is untouched');
select is((select display_name from identity.organisations where id = pg_temp.rls_id('org_b')),
  'Org B (fictional)', 'a real workspace organisation''s name is untouched');
select is((select title || ' | ' || version from evidence.documents where id = '00000000-0000-4000-8000-00000000f5b4'),
  'Real deck (fictional) | 1', 'a real customer''s document title is untouched');

-- History: one append-only audit record per changed row, none for others.
select is((select count(*)::int from audit.material_actions
            where metadata ->> 'reason' = 'synthetic_demo_name_suffix'
              and actor_type = 'capital_q_system'
              and tenant_id = pg_temp.rls_id('tenant_a')),
  4, 'each renamed row has its system audit record');
select is((select metadata -> 'changedFields' from audit.material_actions
            where resource_type = 'company' and resource_id = '00000000-0000-4000-8000-00000000f5a1'
              and metadata ->> 'reason' = 'synthetic_demo_name_suffix'),
  '["canonicalName", "legalName"]'::jsonb, 'the record names the changed fields, never the text');
select is((select count(*)::int from audit.material_actions
            where metadata ->> 'reason' = 'synthetic_demo_name_suffix'
              and tenant_id in (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('tenant_r'))),
  0, 'no record for a real customer');

-- Idempotent, and not callable by a client role.
select is(
  private.strip_synthetic_demo_name_suffix(),
  '{"companies": 0, "investorOrganisations": 0, "organisations": 0, "documents": 0}'::jsonb,
  'a second run finds nothing to change');
select ok(not has_function_privilege('authenticated', 'private.strip_synthetic_demo_name_suffix()', 'execute'),
  'a browser principal cannot run it');
select ok(not has_function_privilege('anon', 'private.synthetic_demo_tenant_ids()', 'execute'),
  'nor read which tenants are synthetic');

select * from finish();
rollback;
