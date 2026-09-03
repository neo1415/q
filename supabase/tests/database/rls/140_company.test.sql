-- CQ-COMP-001 · core.companies is organisation-private.
--
-- A member of the owning organisation may read the company; nobody else may
-- read it, and no browser principal may write it. Revocation removes access
-- at the database boundary. The marketplace_visibility column exists but
-- grants nothing: a company is not discoverable because a column says so.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(21);

-- Seed one company per organisation as the privileged role.
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, short_description)
values
  ('00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Company A', 'company-a', 'A private description'),
  ('00000000-0000-4000-8000-0000000000c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Company B', 'company-b', 'B private description');

-- Defaults: private and not marketplace eligible, whatever the caller did.
select is((select marketplace_visibility from core.companies where id = '00000000-0000-4000-8000-0000000000c1'), 'organisation_private',
  'a new company is organisation_private by default');
select is((select marketplace_readiness_state from core.companies where id = '00000000-0000-4000-8000-0000000000c1'), 'not_assessed',
  'a new company is not_assessed (not marketplace eligible) by default');
select is((select company_status from core.companies where id = '00000000-0000-4000-8000-0000000000c1'), 'active',
  'a new company is active');
select is((select version from core.companies where id = '00000000-0000-4000-8000-0000000000c1'), 1,
  'a new company is version 1');

-- Tenant/organisation coherence is relational.
select throws_ok(
  $$ insert into core.companies (tenant_id, organisation_id, canonical_name, slug)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_b'), 'Wrong tenant', 'wrong-tenant') $$,
  '23503', null, 'a company cannot name an organisation under a tenant that does not own it');

-- User A ----------------------------------------------------------------------

select pg_temp.act_as_user_a();
select is((select count(*)::int from core.companies where id = '00000000-0000-4000-8000-0000000000c1'), 1,
  'companies: A -> Company A visible');
select is((select count(*)::int from core.companies where id = '00000000-0000-4000-8000-0000000000c2'), 0,
  'companies: A -> Company B invisible (valid id, wrong tenant)');
select is((select count(*)::int from core.companies where slug = 'company-b'), 0,
  'companies: A cannot find Company B by slug');
select is((select count(*)::int from core.companies), 1, 'companies: A sees exactly one company');
select throws_ok(
  $$ insert into core.companies (tenant_id, organisation_id, canonical_name, slug)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Browser Co', 'browser-co') $$,
  '42501', null, 'companies: a browser principal cannot insert');
select throws_ok(
  $$ update core.companies set marketplace_visibility = 'public_external' where id = '00000000-0000-4000-8000-0000000000c1' $$,
  '42501', null, 'companies: a browser principal cannot self-enable marketplace visibility');
select throws_ok(
  $$ delete from core.companies where id = '00000000-0000-4000-8000-0000000000c1' $$,
  '42501', null, 'companies: a browser principal cannot delete');

-- User B ----------------------------------------------------------------------

select pg_temp.act_as_user_b();
select is((select count(*)::int from core.companies where id = '00000000-0000-4000-8000-0000000000c2'), 1,
  'companies: B -> Company B visible');
select is((select count(*)::int from core.companies where id = '00000000-0000-4000-8000-0000000000c1'), 0,
  'companies: B -> Company A invisible');

-- Revocation (fixture revoked user, then live) --------------------------------

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from core.companies), 0, 'companies: a revoked member sees nothing');

select pg_temp.act_as_privileged();
update identity.organisation_memberships
   set membership_status = 'revoked', left_at = now()
 where id = pg_temp.rls_id('membership_a');
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.companies where id = '00000000-0000-4000-8000-0000000000c1'), 0,
  'companies: live revocation removes Company A from A');

-- Anonymous and service role ---------------------------------------------------

select pg_temp.act_as_anonymous();
select throws_ok($$ select * from core.companies $$, '42501', null, 'companies: anonymous denied');
select throws_ok($$ select * from core.company_creation_requests $$, '42501', null, 'creation idempotency: anonymous denied');

select pg_temp.act_as_user_b();
select throws_ok($$ select * from core.company_creation_requests $$, '42501', null, 'creation idempotency: authenticated denied');

select pg_temp.act_as_service_role();
select throws_ok($$ select * from core.companies $$, '42501', null, 'service_role: no grant on companies');

-- Privileged server role: EXPECTED DB BEHAVIOR; APPLICATION AUTHORIZATION
-- (company.view / company.edit) IS STILL REQUIRED.
select pg_temp.act_as_privileged();
select is((select count(*)::int from core.companies), 2, 'privileged: server role sees both companies (expected; not business authorization)');

select * from finish();

rollback;
