-- BIZ-004 · core.handles, core.reserved_handles, core.shareable_identities,
-- core.shareable_identity_scans: handles and the Q Card, server-internal.
--
-- Handles are global and lowercase; reserved names cannot be inserted; one
-- live row per handle and one active handle per subject; rows are history
-- (never deleted, never re-owned in place); a retired handle is never
-- recycled. A card can only name public_external or network_visible, so
-- no narrower scope has a way onto it. No browser principal may read or
-- write any of these tables.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(24);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000002c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Handle Co A', 'handle-co-a');
insert into core.handles (id, handle, tenant_id, organisation_id, subject_type, subject_id) values
  ('00000000-0000-4000-8000-0000000002a1', 'handle-co-a', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'COMPANY', '00000000-0000-4000-8000-0000000002c1');
insert into core.shareable_identities (id, tenant_id, organisation_id, subject_type, subject_id, public_code, field_scopes) values
  ('00000000-0000-4000-8000-0000000002b1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'COMPANY', '00000000-0000-4000-8000-0000000002c1',
   'abcde12345', '{"canonicalName":"public_external","currentStageCode":"network_visible"}');
insert into core.shareable_identity_scans (shareable_identity_id, day, scans) values
  ('00000000-0000-4000-8000-0000000002b1', current_date, 3);

-- Shape ------------------------------------------------------------------------
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'core.handles'::regclass, 'core.reserved_handles'::regclass,
  'core.shareable_identities'::regclass, 'core.shareable_identity_scans'::regclass)), true,
  'row level security is on for every table');
select is((select count(*)::int from pg_policies where schemaname = 'core'
  and tablename in ('handles', 'reserved_handles', 'shareable_identities', 'shareable_identity_scans')), 0,
  'no policies: server-internal');
select ok((select count(*) from core.reserved_handles where handle in ('admin', 'q', 'capitalq', 'support', 'api', 'www')) = 6,
  'the reserved list holds the platform and role names');
select is((select count(*)::int from information_schema.columns where table_schema = 'core'
  and table_name = 'shareable_identity_scans' and column_name not in ('shareable_identity_id', 'day', 'scans')), 0,
  'scan counts are aggregate only: no person, address, device or referrer column');

-- Handle rules -----------------------------------------------------------------
select throws_ok(
  $$ insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id)
     values ('Handle-Co-B', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'COMPANY', gen_random_uuid()) $$,
  '23514', null, 'only lowercase is stored: case-insensitive by construction');
select throws_ok(
  $$ insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id)
     values ('ab', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'COMPANY', gen_random_uuid()) $$,
  '23514', null, 'a handle is at least 3 characters');
select throws_ok(
  $$ insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id)
     values ('bad--handle', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'COMPANY', gen_random_uuid()) $$,
  '23514', null, 'no double hyphens');
select throws_ok(
  $$ insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id)
     values ('-edge', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'COMPANY', gen_random_uuid()) $$,
  '23514', null, 'no hyphen at either end');
select throws_ok(
  $$ insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id)
     values ('support', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'COMPANY', gen_random_uuid()) $$,
  '23514', 'that handle is reserved', 'a reserved handle cannot be inserted');
select throws_ok(
  $$ insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id)
     values ('handle-co-a', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'COMPANY', gen_random_uuid()) $$,
  '23505', null, 'a live handle is globally unique, across tenants');
select throws_ok(
  $$ insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id)
     values ('handle-co-a2', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'COMPANY', '00000000-0000-4000-8000-0000000002c1') $$,
  '23505', null, 'one active handle per subject');
select throws_ok(
  $$ delete from core.handles where id = '00000000-0000-4000-8000-0000000002a1' $$,
  '23514', null, 'handles are history: never deleted');
select throws_ok(
  $$ update core.handles set handle = 'renamed-in-place' where id = '00000000-0000-4000-8000-0000000002a1' $$,
  '23514', null, 'a handle never changes spelling in place');
select throws_ok(
  $$ update core.handles set subject_id = gen_random_uuid() where id = '00000000-0000-4000-8000-0000000002a1' $$,
  '23514', null, 'a handle never changes owner in place');
select throws_ok(
  $$ update core.handles set status = 'HELD' where id = '00000000-0000-4000-8000-0000000002a1' $$,
  '23514', null, 'a HELD handle carries its hold end');

-- A rename: the old handle is held; while held nobody else may take it.
update core.handles set status = 'HELD', released_at = now(), hold_until = now() + interval '90 days'
 where id = '00000000-0000-4000-8000-0000000002a1';
insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id) values
  ('handle-co-a-new', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'COMPANY', '00000000-0000-4000-8000-0000000002c1');
select throws_ok(
  $$ insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id)
     values ('handle-co-a', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'COMPANY', gen_random_uuid()) $$,
  '23505', null, 'a held handle cannot be claimed by anyone else');

-- Retired is final.
update core.handles set status = 'RETIRED', hold_until = null
 where id = '00000000-0000-4000-8000-0000000002a1';
select throws_ok(
  $$ update core.handles set status = 'RELEASED' where id = '00000000-0000-4000-8000-0000000002a1' $$,
  '23514', 'a retired handle is never recycled', 'a retired handle is never released');

-- Card scopes ------------------------------------------------------------------
select throws_ok(
  $$ update core.shareable_identities set field_scopes = '{"canonicalName":"founder_private"}'
      where id = '00000000-0000-4000-8000-0000000002b1' $$,
  '23514', null, 'a card cannot name founder_private');
select throws_ok(
  $$ update core.shareable_identities set field_scopes = '{"canonicalName":"organisation_private"}'
      where id = '00000000-0000-4000-8000-0000000002b1' $$,
  '23514', null, 'a card cannot name organisation_private');
select throws_ok(
  $$ update core.shareable_identities set public_code = 'short'
      where id = '00000000-0000-4000-8000-0000000002b1' $$,
  '23514', null, 'the short code has a fixed opaque shape');
select is((select indexable from core.shareable_identities where id = '00000000-0000-4000-8000-0000000002b1'), false,
  'a card is noindex unless the owner opts in');

-- Browser principals -------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from core.handles $$, '42501', null,
  'user A cannot read handles, even their own organisation''s');
select throws_ok($$ select count(*) from core.shareable_identities $$, '42501', null,
  'user A cannot read cards directly');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from core.shareable_identity_scans $$, '42501', null,
  'an anonymous visitor cannot read scan counts');

select * from finish();
rollback;
