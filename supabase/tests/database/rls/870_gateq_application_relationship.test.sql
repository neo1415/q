-- P14 (20261209133000): a founder's GateQ application joins the ONE canonical
-- company-investor relationship, and only its own pair.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(5);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-00000000fbc1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Applicant Co', 'applicant-co'),
  ('00000000-0000-4000-8000-00000000fbc2', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Other Co', 'other-co');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000fb01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Pair Capital');
insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000fb11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fb01', pg_temp.rls_id('org_b'),
   'gq_fb3456789abcdefghjkmnpqrs0', 'Seed gate', pg_temp.rls_id('user_b'));
insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000fb21', '00000000-0000-4000-8000-00000000fb11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed', 'gateq-qualification.v1', pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());
insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000fb31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fb11',
   '00000000-0000-4000-8000-00000000fb21', 'ga_fb3456789abcdefghjkmnpqrs1');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-00000000fb41', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000fbc1',
   '00000000-0000-4000-8000-00000000fb01', 'DISCOVERED'),
  ('00000000-0000-4000-8000-00000000fb42', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000fbc2',
   '00000000-0000-4000-8000-00000000fb01', 'DISCOVERED');
insert into gateq.application_founders (application_id, tenant_id, founder_user_id, company_id)
values ('00000000-0000-4000-8000-00000000fb31', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_a'),
        '00000000-0000-4000-8000-00000000fbc1');

select lives_ok(
  $$ update gateq.application_founders set relationship_id = '00000000-0000-4000-8000-00000000fb41'
      where application_id = '00000000-0000-4000-8000-00000000fb31' $$,
  'the application joins its own company-investor relationship');
select throws_ok(
  $$ update gateq.application_founders set relationship_id = '00000000-0000-4000-8000-00000000fb42'
      where application_id = '00000000-0000-4000-8000-00000000fb31' $$,
  '23514', null, 'another company''s relationship is refused');
select is((select count(*)::int from network.relationships
            where company_id = '00000000-0000-4000-8000-00000000fbc1'
              and investor_organisation_id = '00000000-0000-4000-8000-00000000fb01'), 1,
  'one canonical pair, never a parallel record');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from gateq.application_founders $$, '42501', null,
  'a browser principal never reads the link');
select pg_temp.act_as_revoked_user();
select throws_ok($$ select count(*) from gateq.application_founders $$, '42501', null,
  'a revoked user reads nothing');

select * from finish();
rollback;
