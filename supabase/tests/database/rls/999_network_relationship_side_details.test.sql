-- CRM import gaps (migration 20261231599520): each side's own pipeline
-- fields on one canonical relationship. Server-only, organisation_private,
-- one row per relationship and side, revisioned, never deleted.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(31);

select ok((select relrowsecurity from pg_class where oid = 'network.relationship_side_details'::regclass), 'side details have RLS on');
select is((select count(*)::int from pg_policies where schemaname = 'network' and tablename = 'relationship_side_details'), 0, 'no client policies: server-only');
select ok(not has_table_privilege('anon', 'network.relationship_side_details', 'SELECT'), 'anonymous cannot read side details');
select ok(not has_table_privilege('authenticated', 'network.relationship_side_details', 'SELECT'), 'members read side details only through the scoped API');
select ok(not has_table_privilege('authenticated', 'network.relationship_side_details', 'INSERT'), 'members cannot write around the API');
select ok(not has_table_privilege('authenticated', 'network.relationship_side_details', 'UPDATE'), 'members cannot change around the API');
select ok(not has_function_privilege('anon', 'network.relationship_side_details_guard()', 'EXECUTE'), 'the guard function is not public');

-- Company A (tenant A, org A) and Investor B (tenant B, org B), one
-- relationship between them; a second company in org A with no relationship.
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Side Company A', 'side-company-a'),
  ('00000000-0000-4000-8000-0000000000c2', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Side Company A2', 'side-company-a2');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000000e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Side Investor B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id) values
  ('00000000-0000-4000-8000-00000000ab01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2');

-- Investor B's side: its own tenant, organisation, owner and party.
create function pg_temp.investor_side(
  p_org text default 'org_b',
  p_tenant text default 'tenant_b',
  p_owner_membership text default 'membership_b',
  p_owner_user text default 'user_b',
  p_amount numeric default 250000,
  p_currency text default 'USD',
  p_party text default 'INVESTOR'
) returns void language sql as $$
  insert into network.relationship_side_details
    (relationship_id, party, tenant_id, organisation_id, investor_organisation_id,
     stage, stage_label, owner_membership_id, owner_user_id, source, introducer_name,
     expected_amount, expected_currency, priority, updated_by_user_id)
  values
    ('00000000-0000-4000-8000-00000000ab01', p_party, pg_temp.rls_id(p_tenant), pg_temp.rls_id(p_org),
     '00000000-0000-4000-8000-0000000000e2', 'DILIGENCE', 'Deep dive', pg_temp.rls_id(p_owner_membership),
     pg_temp.rls_id(p_owner_user), 'Warm intro', 'Ngozi Eze', p_amount, p_currency, 'HIGH',
     pg_temp.rls_id('user_b'));
$$;

-- Company A's side.
create function pg_temp.company_side(
  p_company uuid default '00000000-0000-4000-8000-0000000000c1'
) returns void language sql as $$
  insert into network.relationship_side_details
    (relationship_id, party, tenant_id, organisation_id, company_id, stage, priority, updated_by_user_id)
  values
    ('00000000-0000-4000-8000-00000000ab01', 'COMPANY', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
     p_company, 'MEETING', 'LOW', pg_temp.rls_id('user_a'));
$$;

-- Wrong-party negative (before any row exists, so only the keys decide):
-- a company that is not a party of the relationship.
select throws_ok($$select pg_temp.company_side('00000000-0000-4000-8000-0000000000c2')$$, '23503', null, 'a side that is not a party of the relationship is refused');

-- Cross-tenant, other-side negative: org A cannot write on the investor's side.
select throws_ok(
  $$insert into network.relationship_side_details
      (relationship_id, party, tenant_id, organisation_id, investor_organisation_id, stage, updated_by_user_id)
    values ('00000000-0000-4000-8000-00000000ab01', 'INVESTOR', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
            '00000000-0000-4000-8000-0000000000e2', 'MEETING', pg_temp.rls_id('user_a'))$$,
  '23503', null, 'another tenant''s organisation cannot write on the investor''s side');

-- Positive: each side keeps its own fields on the one shared relationship.
select lives_ok($$select pg_temp.investor_side()$$, 'the investor side keeps its own fields');
select lives_ok($$select pg_temp.company_side()$$, 'the founder side keeps its own fields');
select is((select count(*)::int from network.relationship_side_details where relationship_id = '00000000-0000-4000-8000-00000000ab01'), 2, 'one row per side of the one relationship');
select is((select expected_amount from network.relationship_side_details where party = 'INVESTOR'), 250000.00::numeric, 'the expected ticket is exact numeric');

-- One row per relationship and side.
select throws_ok($$select pg_temp.investor_side()$$, '23505', null, 'a side has one row per relationship');

-- Other-side negatives: org A's member cannot own the investor's side, and
-- a row never moves to the other side.
select throws_ok(
  $$update network.relationship_side_details
       set owner_membership_id = pg_temp.rls_id('membership_a'), owner_user_id = pg_temp.rls_id('user_a'), revision = revision + 1
     where party = 'INVESTOR'$$,
  '23503', null, 'a member of another organisation cannot own the investor''s side');
select throws_ok(
  $$update network.relationship_side_details set party = 'COMPANY', revision = revision + 1 where party = 'INVESTOR'$$,
  '23514', null, 'a row never moves to the other side');

-- Shape: money needs its currency, vocabularies are checked, bounds hold.
select throws_ok(
  $$update network.relationship_side_details set expected_currency = null, revision = revision + 1 where party = 'INVESTOR'$$,
  '23514', null, 'an amount is never without its currency');
select throws_ok(
  $$update network.relationship_side_details set expected_amount = 0, revision = revision + 1 where party = 'INVESTOR'$$,
  '23514', null, 'an expected amount is more than zero');
select throws_ok(
  $$update network.relationship_side_details set expected_currency = 'usd', revision = revision + 1 where party = 'INVESTOR'$$,
  '23514', null, 'a currency is an ISO code');
select throws_ok(
  $$update network.relationship_side_details set stage = 'term sheet', revision = revision + 1 where party = 'INVESTOR'$$,
  '23514', null, 'a stage is a vocabulary code');
select throws_ok(
  $$update network.relationship_side_details set source = repeat('x', 201), revision = revision + 1 where party = 'INVESTOR'$$,
  '23514', null, 'a source is bounded');
select throws_ok(
  $$update network.relationship_side_details set owner_user_id = null, revision = revision + 1 where party = 'INVESTOR'$$,
  '23514', null, 'an owner is a membership and its person together');

-- Revisioned: one revision at a time, never deleted, for every role.
select lives_ok(
  $$update network.relationship_side_details set priority = 'MEDIUM', revision = revision + 1 where party = 'INVESTOR'$$,
  'the side changes its priority as the next revision');
select is((select revision from network.relationship_side_details where party = 'INVESTOR'), 2, 'the revision rose by one');
select throws_ok(
  $$update network.relationship_side_details set priority = 'LOW' where party = 'INVESTOR'$$,
  '23514', null, 'a change without the next revision is refused');
select throws_ok(
  $$delete from network.relationship_side_details where party = 'INVESTOR'$$,
  '23514', null, 'side details are never deleted');

-- No browser principal reads either side: owner, counterpart, revoked, anonymous.
select pg_temp.act_as_user_b();
select throws_ok('select * from network.relationship_side_details', '42501', null, 'the investor too reads only through the API');
select pg_temp.act_as_user_a();
select throws_ok('select * from network.relationship_side_details', '42501', null, 'the counterpart founder cannot read the investor''s fields');
select pg_temp.act_as_revoked_user();
select throws_ok('select * from network.relationship_side_details', '42501', null, 'a revoked member cannot read side details');
select pg_temp.act_as_anonymous();
select throws_ok('select * from network.relationship_side_details', '42501', null, 'anonymous cannot read side details');
reset role;
select pg_temp.reset_test_identity();

-- The import screen's own mapping is a recorded source.
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conname = 'pipeline_imports_mapping_source_check') like '%PERSON%',
  'an import may carry the person''s own mapping');

select * from finish();
rollback;
