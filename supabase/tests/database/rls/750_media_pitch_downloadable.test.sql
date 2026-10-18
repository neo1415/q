-- ADR 0047 · A pitch's download permission: off by default, a founder pitch
-- only, and still server-only (no browser session reads or changes it, in
-- any tenant).
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(11);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000750c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Download Co A', 'download-co-a-750'),
  ('00000000-0000-4000-8000-0000000750c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Download Co B', 'download-co-b-750');

insert into media.media_assets
  (id, tenant_id, owner_type, owner_id, owner_organisation_id, purpose, created_by_user_id)
values
  ('00000000-0000-4000-8000-0000000750a1', pg_temp.rls_id('tenant_a'), 'COMPANY',
   '00000000-0000-4000-8000-0000000750c1', pg_temp.rls_id('org_a'), 'FOUNDER_PITCH', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000750a2', pg_temp.rls_id('tenant_b'), 'COMPANY',
   '00000000-0000-4000-8000-0000000750c2', pg_temp.rls_id('org_b'), 'FOUNDER_PITCH', pg_temp.rls_id('user_b'));

-- Shape ------------------------------------------------------------------------------
select has_column('media', 'media_assets', 'downloadable', 'media assets carry a download permission');
select col_not_null('media', 'media_assets', 'downloadable', 'the permission is never unknown');
select is((select downloadable from media.media_assets where id = '00000000-0000-4000-8000-0000000750a1'),
  false, 'a new pitch is watch-only by default (doc 20 §219)');

-- Rules (positive and negative) -----------------------------------------------------
select lives_ok(
  $$ update media.media_assets set downloadable = true where id = '00000000-0000-4000-8000-0000000750a1' $$,
  'a founder pitch can be opened for download');
select lives_ok(
  $$ update media.media_assets set downloadable = false where id = '00000000-0000-4000-8000-0000000750a1' $$,
  'and closed again');
select lives_ok(
  $$ insert into media.media_assets
       (tenant_id, owner_type, owner_id, owner_organisation_id, purpose, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000750c1',
             pg_temp.rls_id('org_a'), 'COMPANY_PRODUCT_DEMO', pg_temp.rls_id('user_a')) $$,
  'control: the same non-pitch asset is fine while watch-only');
select throws_ok(
  $$ insert into media.media_assets
       (tenant_id, owner_type, owner_id, owner_organisation_id, purpose, created_by_user_id, downloadable)
     values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000750c1',
             pg_temp.rls_id('org_a'), 'COMPANY_PRODUCT_DEMO', pg_temp.rls_id('user_a'), true) $$,
  '23514', null, 'nothing but a founder pitch is ever downloadable');

-- RLS: server-only, and cross-tenant negative ---------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select downloadable from media.media_assets $$, '42501', null,
  'a browser session cannot read the permission, even its own organisation''s');
select throws_ok(
  $$ update media.media_assets set downloadable = true where id = '00000000-0000-4000-8000-0000000750a1' $$,
  '42501', null, 'a browser session cannot open its own pitch for download directly');
select throws_ok(
  $$ update media.media_assets set downloadable = true where id = '00000000-0000-4000-8000-0000000750a2' $$,
  '42501', null, 'a browser session cannot open another tenant''s pitch for download');
select pg_temp.act_as_privileged();
select is((select downloadable from media.media_assets where id = '00000000-0000-4000-8000-0000000750a2'),
  false, 'the other tenant''s pitch is untouched and watch-only');

select * from finish();
rollback;
