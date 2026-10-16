-- Investor materials: FUND_DECK, INVESTMENT_THESIS, LP_LETTER as the firm's
-- own documents. Same defaults and the same server-only access as every
-- evidence document; another tenant's firm document is still its own record.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (packages/evidence decides who may read a document).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(8);

select lives_ok(
  $$ insert into evidence.documents (id, tenant_id, owner_organisation_id, document_type, title, created_by_user_id) values
       ('00000000-0000-4000-8000-00000000d968', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'FUND_DECK', 'Fund I deck', pg_temp.rls_id('user_a')),
       ('00000000-0000-4000-8000-00000000d969', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'INVESTMENT_THESIS', 'Thesis', pg_temp.rls_id('user_a')),
       ('00000000-0000-4000-8000-00000000d970', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'LP_LETTER', 'Q3 letter', pg_temp.rls_id('user_b')) $$,
  'a firm holds its fund deck, thesis and LP letter as its own documents');
select is(
  (select visibility_scope || '/' || sensitivity_class from evidence.documents where id = '00000000-0000-4000-8000-00000000d968'),
  'organisation_private/CONFIDENTIAL', 'an investor document defaults to organisation_private and CONFIDENTIAL');
select is(
  (select company_id from evidence.documents where id = '00000000-0000-4000-8000-00000000d969'),
  null, 'an investor document belongs to no company');
select throws_ok(
  $$ insert into evidence.documents (tenant_id, owner_organisation_id, document_type, title, created_by_user_id)
       values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'FUND_MEMO', 'x', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'an unknown document type is still refused');

-- RLS: server-only, including a cross-tenant and a revoked reader.
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from evidence.documents $$, '42501', null, 'anonymous cannot read investor documents');
select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from evidence.documents where document_type = 'LP_LETTER' $$, '42501', null,
  'a browser session cannot read another tenant''s LP letter, nor its own firm''s directly');
select pg_temp.act_as('auth_r');
select throws_ok($$ select count(*) from evidence.documents where document_type = 'FUND_DECK' $$, '42501', null,
  'a revoked member reads no fund deck');
select pg_temp.act_as_privileged();
select is((select count(*)::int from evidence.documents where id in
  ('00000000-0000-4000-8000-00000000d968', '00000000-0000-4000-8000-00000000d969', '00000000-0000-4000-8000-00000000d970')), 3,
  'the privileged server role reads every investor document (physical access, not authorisation)');

select * from finish();
rollback;
