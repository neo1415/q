-- ADR 0041 · A pitch deck's download audience: private by default, a deck
-- only, two values, and still server-only (no browser session reads or
-- changes it, in any tenant).
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(12);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000630c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Deck Co A', 'deck-co-a-630'),
  ('00000000-0000-4000-8000-0000000630c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Deck Co B', 'deck-co-b-630');

insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000630d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000630c1', pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Seed deck', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000630d2', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000630c1', pg_temp.rls_id('org_a'), 'FINANCIAL_MODEL', 'Model', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000630d3', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000630c2', pg_temp.rls_id('org_b'), 'PITCH_DECK', 'Their deck', pg_temp.rls_id('user_b'));

-- Shape ------------------------------------------------------------------------------
select has_column('evidence', 'documents', 'download_audience', 'documents carry a download audience');
select col_not_null('evidence', 'documents', 'download_audience', 'the audience is never unknown');
select is((select download_audience from evidence.documents where id = '00000000-0000-4000-8000-0000000630d1'),
  'ORGANISATION', 'a new deck is private to its organisation by default');

-- Rules ------------------------------------------------------------------------------
select lives_ok(
  $$ update evidence.documents set download_audience = 'INVESTORS' where id = '00000000-0000-4000-8000-0000000630d1' $$,
  'a pitch deck can be opened to investors');
select lives_ok(
  $$ update evidence.documents set download_audience = 'ORGANISATION' where id = '00000000-0000-4000-8000-0000000630d1' $$,
  'and closed again');
select throws_ok(
  $$ update evidence.documents set download_audience = 'INVESTORS' where id = '00000000-0000-4000-8000-0000000630d2' $$,
  '23514', null, 'any other document type is never opened to investors');
select throws_ok(
  $$ update evidence.documents set download_audience = 'NETWORK' where id = '00000000-0000-4000-8000-0000000630d1' $$,
  '23514', null, 'the audience is one of two values; there is no public or network value');
update evidence.documents set download_audience = 'INVESTORS' where id = '00000000-0000-4000-8000-0000000630d1';
select throws_ok(
  $$ update evidence.documents set document_type = 'LEGAL' where id = '00000000-0000-4000-8000-0000000630d1' $$,
  '23514', null, 'a shared deck cannot be reclassified while still shared');
select is((select visibility_scope from evidence.documents where id = '00000000-0000-4000-8000-0000000630d1'),
  'organisation_private', 'opening the download never widens the document''s visibility scope');

-- RLS: server-only -------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select download_audience from evidence.documents $$, '42501', null,
  'a browser session cannot read the audience, even its own organisation''s');
select throws_ok(
  $$ update evidence.documents set download_audience = 'INVESTORS' where id = '00000000-0000-4000-8000-0000000630d3' $$,
  '42501', null, 'a browser session cannot open another tenant''s deck (or its own)');
select pg_temp.act_as_privileged();
select is((select download_audience from evidence.documents where id = '00000000-0000-4000-8000-0000000630d3'),
  'ORGANISATION', 'the other tenant''s deck is untouched and private');

select * from finish();
rollback;
