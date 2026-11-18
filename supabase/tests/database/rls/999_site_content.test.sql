-- Decision 107 (20261231598950): the site content store is server-only.
-- No browser principal reads or writes any of it -- not anon, not a signed-in
-- person, not even a platform admin from a browser session (the console goes
-- through the API, which checks the role and the step-up). Versions and the
-- publish history are immutable; the pointer names only a version of its own
-- page; a legal page cannot be a plain draft; a non-seed version names its author.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(22);

insert into site_content.pages (id, slug, kind, title, status) values
  ('00000000-0000-4000-8000-0000000c0001', 'cms-test-faq', 'faq', 'FAQ', 'DRAFT'),
  ('00000000-0000-4000-8000-0000000c0002', 'cms-test-terms', 'legal', 'Terms', 'DRAFT_PENDING_LEGAL_REVIEW');
insert into site_content.page_versions (id, page_id, version_number, title, blocks, source) values
  ('00000000-0000-4000-8000-0000000c0101', '00000000-0000-4000-8000-0000000c0001', 1, 'FAQ', '[]', 'SEED'),
  ('00000000-0000-4000-8000-0000000c0102', '00000000-0000-4000-8000-0000000c0002', 1, 'Terms', '[]', 'SEED');
insert into site_content.page_drafts (page_id, title, blocks) values
  ('00000000-0000-4000-8000-0000000c0001', 'FAQ', '[]');
insert into site_content.published_pointers (page_id, version_id) values
  ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-0000000c0101');
insert into site_content.publish_events (page_id, version_id, version_number, action) values
  ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-0000000c0101', 1, 'PUBLISH');

-- RLS on everywhere, no client grants ---------------------------------------
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'site_content' and c.relkind = 'r' and not c.relrowsecurity), 0,
  'every site_content table has RLS enabled');
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'site_content' and grantee in ('anon', 'authenticated', 'PUBLIC')), 0,
  'neither anon nor authenticated holds any grant in site_content');
select is((select count(*)::int from pg_policies where schemaname = 'site_content'), 0,
  'server-only tables carry no policies');

-- Immutability ----------------------------------------------------------------
select throws_ok($$ update site_content.page_versions set title = 'changed' $$,
  'P0001', null, 'a version is never updated');
select throws_ok($$ delete from site_content.page_versions $$,
  'P0001', null, 'nor deleted');
select throws_ok($$ update site_content.publish_events set reason = 'rewritten' $$,
  'P0001', null, 'the publish history is append-only');
select throws_ok($$ delete from site_content.publish_events $$,
  'P0001', null, 'and never removed');
select throws_ok($$ delete from site_content.settings $$,
  'P0001', null, 'the settings record cannot be removed');

-- Integrity ---------------------------------------------------------------------
select throws_ok($$
  insert into site_content.page_versions (page_id, version_number, title, blocks, source)
  values ('00000000-0000-4000-8000-0000000c0001', 1, 'Again', '[]', 'SEED') $$,
  '23505', null, 'a version number is unique per page');
select throws_ok($$
  update site_content.published_pointers
     set version_id = '00000000-0000-4000-8000-0000000c0102'
   where page_id = '00000000-0000-4000-8000-0000000c0001' $$,
  '23503', null, 'the pointer can only name a version of its own page');
select throws_ok($$
  insert into site_content.pages (slug, kind, title, status) values ('cms-test-legal', 'legal', 'Privacy', 'DRAFT') $$,
  '23514', null, 'a legal page starts pending legal review, never a plain draft');
select throws_ok($$
  insert into site_content.page_versions (page_id, version_number, title, blocks, source)
  values ('00000000-0000-4000-8000-0000000c0001', 2, 'Edited', '[]', 'EDITOR') $$,
  '23514', null, 'an editor version names its author');
select throws_ok($$
  insert into site_content.pages (slug, kind, title) values ('Not A Slug', 'faq', 'x') $$,
  '23514', null, 'slugs are lowercase words joined by hyphens');
select throws_ok($$
  insert into site_content.page_versions (page_id, version_number, title, blocks, source)
  values ('00000000-0000-4000-8000-0000000c0001', 3, 'x', '{"not": "an array"}', 'SEED') $$,
  '23514', null, 'blocks are a JSON array');

-- Browser sessions: denied ------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from site_content.pages $$, '42501', null,
  'a signed-in person cannot read pages');
select throws_ok($$ select * from site_content.page_drafts $$, '42501', null,
  'nor drafts');
select throws_ok($$ select * from site_content.page_versions $$, '42501', null,
  'nor versions, even published ones (the public reads through the API)');
select throws_ok($$ update site_content.settings set company_name = 'Hijacked' $$, '42501', null,
  'nor change the placeholder record');
reset role;

-- Even a platform admin's browser session is just authenticated.
insert into identity.platform_admins (user_id, role)
values (pg_temp.rls_id('user_b'), 'platform_owner')
on conflict (user_id) do update set role = excluded.role;
select pg_temp.act_as_user_b();
select throws_ok($$
  insert into site_content.published_pointers (page_id, version_id)
  values ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-0000000c0102') $$,
  '42501', null, 'a platform admin cannot publish from a browser session');
reset role;

set local role anon;
select throws_ok($$ select * from site_content.published_pointers $$, '42501', null,
  'anon reads nothing');
select throws_ok($$ select * from site_content.settings $$, '42501', null,
  'not even the settings');
reset role;

select is((select status from site_content.pages where slug = 'cms-test-terms'),
  'DRAFT_PENDING_LEGAL_REVIEW', 'the legal page is still pending');

select * from finish();
rollback;
