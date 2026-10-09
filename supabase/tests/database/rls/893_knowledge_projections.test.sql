-- Recovery K (Tier B) · prepared business knowledge.
--
-- knowledge.company_profiles holds only what Discover may show, for listed
-- (network_visible / public_external) companies; never founder-private
-- fields or an unconfirmed Q inference. It is kept current in the same
-- transaction as each canonical change, with a version that moves on every
-- real change. Mandate and fit summaries are the investor's own.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(30);

-- Shape ------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'knowledge' and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity),
  3, 'all three projections have RLS on and forced');
select is(
  (select count(*)::int from pg_policies where schemaname = 'knowledge' and cmd <> 'SELECT'),
  0, 'no client write policy');
select ok(not has_table_privilege('authenticated', 'knowledge.company_profiles', 'INSERT'),
  'a browser session cannot write a projection');
select ok(not has_function_privilege('authenticated', 'knowledge.refresh_company_profile(uuid)', 'EXECUTE'),
  'nor run its refresh');
select ok(not has_table_privilege('anon', 'knowledge.company_profiles', 'SELECT'),
  'an anonymous visitor reads nothing');
select ok(
  exists (select 1 from pg_indexes where schemaname = 'knowledge' and indexname = 'company_profiles_sectors_gin'),
  'sector GIN index for DISCOVER_COMPANIES');

-- Rows: a listed fintech company in tenant A, a private one -------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, headquarters_country,
                            current_stage_code, short_description, marketplace_visibility)
values
  ('00000000-0000-4000-8000-00000000d101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'Ledger Lane', 'ledger-lane-k', 'NG', 'seed', 'Invoices for SMEs.', 'network_visible'),
  ('00000000-0000-4000-8000-00000000d102', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'Quiet Co', 'quiet-co-k', 'NG', 'seed', 'Not listed.', 'organisation_private');

-- A declared sector (counts) and an unconfirmed Q inference (never counts).
insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
select pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-00000000d101', n.id, 'user_selected'
  from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
 where v.code = 'industry' and n.canonical_code = 'fintech';
insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source, confidence)
select pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-00000000d101', n.id, 'q_inferred', 0.9
  from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
 where v.code = 'industry' and n.canonical_code = 'clean_energy';

select ok(
  (select listed and 'fintech' = any(sector_codes) and 'financial_services' = any(sector_codes)
     from knowledge.company_profiles where company_id = '00000000-0000-4000-8000-00000000d101'),
  'a listed company is projected at once, with its declared sector and its parent');
select ok(
  (select not ('clean_energy' = any(sector_codes))
     from knowledge.company_profiles where company_id = '00000000-0000-4000-8000-00000000d101'),
  'an unconfirmed Q inference never enters the projection');
select ok(
  (select 'nigeria' = any(geography_codes) and 'west_africa' = any(geography_codes) and 'africa' = any(geography_codes)
     from knowledge.company_profiles where company_id = '00000000-0000-4000-8000-00000000d101'),
  'its country resolves to the geography codes and their ancestors');
select is(
  (select count(*)::int from knowledge.company_profiles where company_id = '00000000-0000-4000-8000-00000000d102'),
  0, 'an organisation-private company never enters the projection');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'knowledge' and table_name = 'company_profiles'
      and column_name in ('target_amount', 'raise_objective', 'valuation_amount', 'raw_mandate_text',
                          'primary_contact', 'readiness', 'marketplace_readiness_state', 'logo_storage_key')),
  0, 'no founder-private or organisation-internal field exists in it');

-- Change propagation ---------------------------------------------------------------
create temporary table k_seen (label text primary key, version bigint) on commit drop;
insert into k_seen select 'v1', version from knowledge.company_profiles
 where company_id = '00000000-0000-4000-8000-00000000d101';

update core.companies set short_description = 'Invoices and payments for SMEs.'
 where id = '00000000-0000-4000-8000-00000000d101';
select ok(
  (select version > (select version from k_seen where label = 'v1')
          and short_description = 'Invoices and payments for SMEs.'
     from knowledge.company_profiles where company_id = '00000000-0000-4000-8000-00000000d101'),
  'a company edit moves the version in the same transaction');

insert into k_seen select 'v2', version from knowledge.company_profiles
 where company_id = '00000000-0000-4000-8000-00000000d101';
update core.companies set updated_at = updated_at where id = '00000000-0000-4000-8000-00000000d101';
select is(
  (select version from knowledge.company_profiles where company_id = '00000000-0000-4000-8000-00000000d101'),
  (select version from k_seen where label = 'v2'),
  'a touch that changes nothing the projection shows keeps the version');

update taxonomy.entity_assignments set status = 'SUPERSEDED', valid_to = clock_timestamp()
 where entity_id = '00000000-0000-4000-8000-00000000d101' and assignment_source = 'user_selected';
select ok(
  (select cardinality(sector_codes) = 0 and version > (select version from k_seen where label = 'v2')
     from knowledge.company_profiles where company_id = '00000000-0000-4000-8000-00000000d101'),
  'a classification change re-projects the sector and moves the version');

insert into k_seen select 'v3', version from knowledge.company_profiles
 where company_id = '00000000-0000-4000-8000-00000000d101';
update core.companies set marketplace_visibility = 'organisation_private'
 where id = '00000000-0000-4000-8000-00000000d101';
select ok(
  (select not listed and canonical_name is null and short_description is null
          and version > (select version from k_seen where label = 'v3')
     from knowledge.company_profiles where company_id = '00000000-0000-4000-8000-00000000d101'),
  'withdrawn from the network: a tombstone with no content and a newer version');
update core.companies set marketplace_visibility = 'network_visible'
 where id = '00000000-0000-4000-8000-00000000d101';
select ok(
  (select listed from knowledge.company_profiles where company_id = '00000000-0000-4000-8000-00000000d101'),
  'listed again: the content returns');

update core.companies set company_status = 'closed'
 where id = '00000000-0000-4000-8000-00000000d101';
select ok(
  (select not discovery_eligible from knowledge.company_profiles
    where company_id = '00000000-0000-4000-8000-00000000d101'),
  'a closed company is no longer discovery-eligible');
update core.companies set company_status = 'active'
 where id = '00000000-0000-4000-8000-00000000d101';

-- Reconciliation repairs a missed change.
delete from knowledge.company_profiles where company_id = '00000000-0000-4000-8000-00000000d101';
select ok(knowledge.reconcile(500) >= 1, 'reconciliation finds the missing row');
select is(
  (select count(*)::int from knowledge.company_profiles
    where company_id = '00000000-0000-4000-8000-00000000d101' and listed),
  1, 'and restores it');

-- Mandate and fit summaries (investor B) ---------------------------------------------
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
values ('00000000-0000-4000-8000-00000000d201', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'),
        'VC', 'Fixture Capital');
insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from,
                                    min_cheque, max_cheque, currency_code, created_by_user_id)
values ('00000000-0000-4000-8000-00000000d301', pg_temp.rls_id('tenant_b'),
        '00000000-0000-4000-8000-00000000d201', 'Seed fintech', 'ACTIVE', now(),
        250000, 1000000, 'USD', pg_temp.rls_id('user_b'));
insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion, source)
select pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000d301', n.id, 'MUST', false, 'user_selected'
  from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
 where v.code = 'industry' and n.canonical_code = 'fintech';

select ok(
  (select 'fintech' = any(sector_codes) and mandate_version = 1 and min_cheque = 250000
     from knowledge.mandate_summaries where mandate_id = '00000000-0000-4000-8000-00000000d301'),
  'a mandate is summarised with its own version, money as numeric');
select is(
  (select count(*)::int from knowledge.fit_summaries where mandate_id = '00000000-0000-4000-8000-00000000d301'),
  1, 'and its fit summary exists');
insert into k_seen select 'm1', version from knowledge.mandate_summaries
 where mandate_id = '00000000-0000-4000-8000-00000000d301';
update core.investor_mandates set version = 2, max_cheque = 2000000
 where id = '00000000-0000-4000-8000-00000000d301';
select ok(
  (select mandate_version = 2 and version > (select version from k_seen where label = 'm1')
     from knowledge.mandate_summaries where mandate_id = '00000000-0000-4000-8000-00000000d301'),
  'a mandate edit moves both the mandate version and the summary version');

-- RLS ------------------------------------------------------------------------------
select pg_temp.act_as_privileged();
grant usage on schema core, taxonomy to authenticated;

select pg_temp.act_as_user_b();
select is(
  (select count(*)::int from knowledge.company_profiles
    where company_id = '00000000-0000-4000-8000-00000000d101'),
  1, 'another tenant''s participant reads a listed company (network-visible)');
select is(
  (select count(*)::int from knowledge.company_profiles where not listed), 0,
  'tombstones are never shown to a browser');
select is(
  (select count(*)::int from knowledge.mandate_summaries
    where mandate_id = '00000000-0000-4000-8000-00000000d301'),
  1, 'the investor reads their own mandate summary');

select pg_temp.act_as_user_a();
select is(
  (select count(*)::int from knowledge.mandate_summaries
    where mandate_id = '00000000-0000-4000-8000-00000000d301'),
  0, 'another tenant never reads the investor''s mandate summary');
select is(
  (select count(*)::int from knowledge.fit_summaries
    where mandate_id = '00000000-0000-4000-8000-00000000d301'),
  0, 'nor its fit summary');
select is(
  (select count(*)::int from knowledge.company_profiles
    where company_id = '00000000-0000-4000-8000-00000000d102'),
  0, 'not even its own organisation reads an unlisted company here');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from knowledge.company_profiles), 0,
  'a revoked member reads no company knowledge');
select is((select count(*)::int from knowledge.mandate_summaries), 0,
  'and no mandate summary');

select * from finish();
rollback;
