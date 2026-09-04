-- CQ-ONB-003 · investor portfolio references (ADR 0007) and Investor
-- Definition v1 as published reference data.
--
-- Portfolio references are readable by current members of the organisation
-- behind the investor organisation, invisible to other tenants and to
-- anonymous callers, never written by a browser principal, and kept as
-- history on removal. The investor definition is published, current and
-- frozen.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(20);

-- Fixtures ------------------------------------------------------------------------
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000000e1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'VC', 'Investor A'),
  ('00000000-0000-4000-8000-0000000000e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'ANGEL', 'Investor B');
insert into core.investor_portfolio_references (id, tenant_id, investor_organisation_id, company_name, website_url, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000c001', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000e1', 'Portfolio A One', 'https://a-one.example', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-00000000c002', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000e1', 'Portfolio A Two', null, pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-00000000c101', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000e2', 'Portfolio B Private', null, pg_temp.rls_id('user_b'));

-- Shape and invariants ------------------------------------------------------------
select is((select source from core.investor_portfolio_references where id = '00000000-0000-4000-8000-00000000c001'), 'USER_ENTERED', 'v1 provenance is user-entered');
select is((select removed_at from core.investor_portfolio_references where id = '00000000-0000-4000-8000-00000000c001'), null, 'a new reference is current');
select throws_ok(
  $$ insert into core.investor_portfolio_references (tenant_id, investor_organisation_id, company_name, source, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000e1', 'X', 'PUBLIC_RESEARCH', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'only approved provenance sources are accepted');
select throws_ok(
  $$ insert into core.investor_portfolio_references (tenant_id, investor_organisation_id, company_name, website_url, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000e1', 'X', 'ftp://nope', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'a website must be http(s)');
select throws_ok(
  $$ insert into core.investor_portfolio_references (tenant_id, investor_organisation_id, company_name, created_by_user_id)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000e1', 'Cross', pg_temp.rls_id('user_b')) $$,
  '23503', null, 'a reference cannot point at an investor organisation in another tenant');
select throws_ok(
  $$ insert into core.investor_portfolio_references (tenant_id, investor_organisation_id, company_name, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000e1', '', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'a company name is required');
select has_column('core', 'investor_portfolio_references', 'removed_at', 'removal is soft (removed_at)');
select hasnt_column('core', 'investor_portfolio_references', 'linked_company_id', 'no premature link to a canonical company');
select hasnt_column('core', 'investor_portfolio_references', 'ownership_percentage', 'no speculative ownership data');

-- RLS ------------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select results_eq(
  $$ select company_name from core.investor_portfolio_references order by company_name $$,
  $$ values ('Portfolio A One'), ('Portfolio A Two') $$,
  'a member reads only their investor organisation''s references');
select throws_ok(
  $$ insert into core.investor_portfolio_references (tenant_id, investor_organisation_id, company_name, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000e1', 'Browser write', pg_temp.rls_id('user_a')) $$,
  '42501', null, 'a browser principal cannot insert references');
select throws_ok(
  $$ update core.investor_portfolio_references set removed_at = now() where id = '00000000-0000-4000-8000-00000000c001' $$,
  '42501', null, 'a browser principal cannot remove references');
select throws_ok(
  $$ delete from core.investor_portfolio_references where id = '00000000-0000-4000-8000-00000000c001' $$,
  '42501', null, 'a browser principal cannot delete references');
select pg_temp.act_as_user_b();
select results_eq(
  $$ select company_name from core.investor_portfolio_references $$,
  $$ values ('Portfolio B Private') $$,
  'another tenant sees only its own references');
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from core.investor_portfolio_references $$, '42501', null, 'anonymous denied');
select pg_temp.act_as_privileged();

-- Investor Definition v1 -----------------------------------------------------------
select is(
  (select current_version from onboarding.definitions where journey_type = 'investor'),
  1, 'investor definition points new sessions at version 1');
select is(
  (select count(*)::int
     from onboarding.definition_versions v
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 1 and v.published_at is not null),
  1, 'investor v1 is published');
create temporary view investor_steps as
  select s.*
    from onboarding.steps s
    join onboarding.definition_versions v on v.id = s.definition_version_id
    join onboarding.definitions d on d.id = v.definition_id
   where d.journey_type = 'investor' and v.version = 1;
select is((select count(*)::int from investor_steps), 35, 'investor v1 has 35 steps');
select is(
  (select configuration ->> 'resourceType' from investor_steps where step_key = 'I1.mandate_context'),
  'INVESTOR_MANDATE', 'the mandate context is a typed mandate reference, not hidden JSON');
select is(
  (select writes_to from investor_steps where step_key = 'I10.inbound_preference'),
  '[]'::jsonb, 'the inbound preference is journey state only until GateQ');

select * from finish();
rollback;
