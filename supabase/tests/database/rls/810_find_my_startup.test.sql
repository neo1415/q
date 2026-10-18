-- F3 · "Find my startup": a founder's claim request on a canonical company,
-- and an investor's saved search.
--
--   a claim request ≠ a membership
--   a saved search ≠ a mandate
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads and writes; no
-- browser principal reaches either table. APPLICATION AUTHORISATION IS
-- STILL REQUIRED: DB BYPASS ≠ BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(15);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, website_url)
values ('00000000-0000-4000-8000-0000000f0c01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'),
        'Kora Health', 'kora-health-f3', 'https://korahealth.ng');

-- Shape ---------------------------------------------------------------------------------
select is((select relrowsecurity from pg_class where oid = 'core.company_claim_requests'::regclass), true,
  'row level security is on for claim requests');
select is((select relrowsecurity from pg_class where oid = 'gateq.startup_alerts'::regclass), true,
  'and for saved searches');
select is((select count(*)::int from information_schema.role_table_grants
            where ((table_schema = 'core' and table_name = 'company_claim_requests')
                or (table_schema = 'gateq' and table_name = 'startup_alerts'))
              and grantee in ('anon', 'authenticated')), 0,
  'neither anon nor authenticated holds any grant');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'core' and table_name = 'company_claim_requests'
              and column_name in ('membership_id', 'role', 'verified')), 0,
  'a claim request carries no membership, role or verified flag of its own');

-- Positive: the server path -----------------------------------------------------------------
select lives_ok($$
  insert into core.company_claim_requests (tenant_id, company_id, requester_user_id, method, work_email, client_request_id)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000f0c01', pg_temp.rls_id('user_b'),
          'WORK_EMAIL', 'amara@korahealth.ng', 'claim-f3000001')
$$, 'a founder asks to claim with their work email');

select throws_ok($$
  insert into core.company_claim_requests (tenant_id, company_id, requester_user_id, method, client_request_id)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000f0c01', pg_temp.rls_id('user_b'),
          'ASK_MEMBERS', 'claim-f3000002')
$$, '23505', null, 'one open request per person per company');

select throws_ok($$
  insert into core.company_claim_requests (tenant_id, company_id, requester_user_id, method, client_request_id)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000f0c01', pg_temp.rls_id('user_a'),
          'WORK_EMAIL', 'claim-f3000003')
$$, '23514', null, 'an email claim names the email');

select throws_ok($$
  insert into core.company_claim_requests (tenant_id, company_id, requester_user_id, method, work_email, client_request_id)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000f0c01', pg_temp.rls_id('user_a'),
          'WORK_EMAIL', 'Amara@KoraHealth.ng', 'claim-f3000004')
$$, '23514', null, 'and keeps it lower case, as the domain check reads it');

select throws_ok($$
  insert into core.company_claim_requests (tenant_id, company_id, requester_user_id, method, client_request_id)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000f0c01', pg_temp.rls_id('user_a'),
          'ASK_MEMBERS', 'claim-f3000005')
$$, '23514', null, 'cross-tenant: a request is filed under the company''s own tenant');

select throws_ok($$
  insert into core.company_claim_requests (tenant_id, company_id, requester_user_id, method, status, client_request_id)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000f0c01', pg_temp.rls_id('user_a'),
          'ASK_MEMBERS', 'APPROVED', 'claim-f3000006')
$$, '23514', null, 'a decision always says when it was made');

select lives_ok($$
  insert into gateq.startup_alerts (tenant_id, organisation_id, user_id, description, filters, client_request_id)
  values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), pg_temp.rls_id('user_b'),
          'Seed fintech in Nigeria or Ghana', '{"stageCodes":["seed"],"countryCodes":["NG","GH"]}'::jsonb, 'alert-f3000001')
$$, 'an investor saves a search');

select throws_ok($$
  insert into gateq.startup_alerts (tenant_id, organisation_id, user_id, description, filters, client_request_id)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_b'), pg_temp.rls_id('user_a'),
          'Wrong tenant', '{}'::jsonb, 'alert-f3000002')
$$, '23503', null, 'cross-tenant: an alert belongs to an organisation in its own tenant');

-- Negative: browser principals -------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from core.company_claim_requests $$, '42501', null,
  'user A cannot read anyone''s claim requests');
select throws_ok($$ select count(*) from gateq.startup_alerts $$, '42501', null,
  'nor tenant B''s saved searches');
select pg_temp.reset_test_identity();

select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from core.company_claim_requests $$, '42501', null,
  'an anonymous visitor reaches nothing');
select pg_temp.reset_test_identity();

select * from finish();
rollback;
