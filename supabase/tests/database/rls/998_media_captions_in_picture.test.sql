-- QA F-31 · A video's captions-in-picture flag: false by default for new and
-- existing rows, and server-only (no browser session reads or changes it,
-- in any tenant).
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(8);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000998c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Captions Co A', 'captions-co-a-998'),
  ('00000000-0000-4000-8000-0000000998c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Captions Co B', 'captions-co-b-998');

insert into media.media_assets
  (id, tenant_id, owner_type, owner_id, owner_organisation_id, purpose, created_by_user_id)
values
  ('00000000-0000-4000-8000-0000000998a1', pg_temp.rls_id('tenant_a'), 'COMPANY',
   '00000000-0000-4000-8000-0000000998c1', pg_temp.rls_id('org_a'), 'FOUNDER_PITCH', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000998a2', pg_temp.rls_id('tenant_b'), 'COMPANY',
   '00000000-0000-4000-8000-0000000998c2', pg_temp.rls_id('org_b'), 'FOUNDER_PITCH', pg_temp.rls_id('user_b'));

-- Shape ------------------------------------------------------------------------------
select has_column('media', 'media_assets', 'captions_in_picture', 'media assets say whether captions are in the picture');
select col_not_null('media', 'media_assets', 'captions_in_picture', 'the flag is never unknown');
select is((select captions_in_picture from media.media_assets where id = '00000000-0000-4000-8000-0000000998a1'),
  false, 'a new asset has no captions in its picture by default');

-- The server sets it ------------------------------------------------------------------
select lives_ok(
  $$ update media.media_assets set captions_in_picture = true where id = '00000000-0000-4000-8000-0000000998a1' $$,
  'the server can mark an asset as carrying captions in its picture');

-- RLS: server-only, and cross-tenant negative ---------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select captions_in_picture from media.media_assets $$, '42501', null,
  'a browser session cannot read the flag, even its own organisation''s');
select throws_ok(
  $$ update media.media_assets set captions_in_picture = true where id = '00000000-0000-4000-8000-0000000998a1' $$,
  '42501', null, 'a browser session cannot set the flag on its own asset');
select throws_ok(
  $$ update media.media_assets set captions_in_picture = true where id = '00000000-0000-4000-8000-0000000998a2' $$,
  '42501', null, 'a browser session cannot set the flag on another tenant''s asset');
select pg_temp.act_as_privileged();
select is((select captions_in_picture from media.media_assets where id = '00000000-0000-4000-8000-0000000998a2'),
  false, 'the other tenant''s asset is untouched');

select * from finish();
rollback;
