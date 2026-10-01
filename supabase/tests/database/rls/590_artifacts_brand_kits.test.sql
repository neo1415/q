-- DOCS · artifacts.brand_kit_versions: a company's look for its own
-- documents, append-only, server-only.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads and appends.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION. Ownership (tenant + organisation) is enforced in
-- the repository's where clause; what is asserted here is that no browser
-- principal reaches the table, that versions append and never change, and
-- that what may be stored is bounded.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(14);

insert into artifacts.brand_kit_versions
  (id, tenant_id, organisation_id, version, status, source, source_url, palette, created_by_user_id)
values
  ('00000000-0000-4000-8000-00000000bb01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'),
   1, 'RECOMMENDED', 'WEBSITE', 'https://example.com/', '{"primary":"#1f4f7a"}'::jsonb,
   pg_temp.rls_id('user_b'));

-- Shape and posture -------------------------------------------------------------------
select has_table('artifacts', 'brand_kit_versions', 'brand kit versions exist');
select is((select relrowsecurity from pg_class where oid = 'artifacts.brand_kit_versions'::regclass), true,
  'row level security is on');
select is((select count(*)::int from pg_policies
            where schemaname = 'artifacts' and tablename = 'brand_kit_versions'), 0,
  'and no policy: server-only, like every artifacts table');

-- Positive: the server role appends a confirmation of exactly that suggestion.
select lives_ok($$
  insert into artifacts.brand_kit_versions
    (tenant_id, organisation_id, version, status, source, palette, based_on_version, created_by_user_id)
  values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 2, 'CONFIRMED', 'WEBSITE',
          '{"primary":"#1f4f7a"}'::jsonb, 1, pg_temp.rls_id('user_b'))
$$, 'a confirmation appends as a new version naming the suggestion it confirms');

-- Cross-tenant / browser principals: no grant at all, so no row either way.
set local role authenticated;
select throws_ok($$ select * from artifacts.brand_kit_versions $$, '42501', null,
  'an authenticated browser session cannot read any brand kit, its own tenant''s or another''s');
select throws_ok($$
  insert into artifacts.brand_kit_versions
    (tenant_id, organisation_id, version, status, source, palette, created_by_user_id)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 1, 'CONFIRMED', 'PERSON',
          '{"primary":"#000000"}'::jsonb, pg_temp.rls_id('user_a'))
$$, '42501', null, 'nor write one');
reset role;
set local role anon;
select throws_ok($$ select * from artifacts.brand_kit_versions $$, '42501', null,
  'anon cannot read brand kits');
reset role;

-- Revoked: there is nothing to revoke from browser roles because nothing was granted.
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'artifacts' and table_name = 'brand_kit_versions'
              and grantee in ('anon', 'authenticated')), 0,
  'neither anon nor authenticated holds any grant');

-- Append-only ------------------------------------------------------------------------------
select throws_ok($$
  update artifacts.brand_kit_versions set palette = '{"primary":"#ff0000"}'::jsonb
   where id = '00000000-0000-4000-8000-00000000bb01'
$$, '55000', null, 'a version is never changed: a correction is a new version');
select throws_ok($$
  delete from artifacts.brand_kit_versions where id = '00000000-0000-4000-8000-00000000bb01'
$$, '55000', null, 'and never deleted');
select throws_ok($$
  insert into artifacts.brand_kit_versions
    (tenant_id, organisation_id, version, status, source, palette, created_by_user_id)
  values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 1, 'CONFIRMED', 'PERSON',
          '{"primary":"#000000"}'::jsonb, pg_temp.rls_id('user_b'))
$$, '23505', null, 'one version number per organisation');

-- What may be stored -----------------------------------------------------------------------
select throws_ok($$
  insert into artifacts.brand_kit_versions
    (tenant_id, organisation_id, version, status, source, palette, created_by_user_id)
  values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 3, 'CONFIRMED', 'PERSON',
          '{"secondary":"#000000"}'::jsonb, pg_temp.rls_id('user_b'))
$$, '23514', null, 'a palette names its primary colour');
select throws_ok($$
  insert into artifacts.brand_kit_versions
    (tenant_id, organisation_id, version, status, source, palette, logo, created_by_user_id)
  values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 3, 'CONFIRMED', 'PERSON',
          '{"primary":"#000000"}'::jsonb, '\x89504e470d0a1a0a'::bytea, pg_temp.rls_id('user_b'))
$$, '23514', null, 'a logo carries its content type');
select throws_ok($$
  insert into artifacts.brand_kit_versions
    (tenant_id, organisation_id, version, status, source, palette, based_on_version, created_by_user_id)
  values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 3, 'RECOMMENDED', 'WEBSITE',
          '{"primary":"#000000"}'::jsonb, 1, pg_temp.rls_id('user_b'))
$$, '23514', null, 'only a confirmation or a decline names a suggestion');

select * from finish();
rollback;
