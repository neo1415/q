-- CQ-DATA-002 · identity / permissions structure, privileges and RLS.
--
-- Synthetic fixtures only, created inside this transaction and rolled back.
-- Auth users are inserted directly so the profile trigger is exercised for
-- real; no email, password or provider data is involved.
--
-- Fixture identifiers (obviously synthetic, version-4 shaped):
--   auth A  aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1   auth B  ...aaa2
--   tenant  bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/2
--   org     cccccccc-cccc-4ccc-8ccc-ccccccccccc1/2
--   member  dddddddd-dddd-4ddd-8ddd-ddddddddddd1/2

begin;

create extension if not exists pgtap with schema extensions;

select plan(76);

-- ===========================================================================
-- Structure
-- ===========================================================================

select has_schema('identity', 'identity schema exists');
select has_schema('permissions', 'permissions schema exists');
select has_schema('private', 'private schema exists');

select has_table('identity', 'tenants', 'identity.tenants');
select has_table('identity', 'user_profiles', 'identity.user_profiles');
select has_table('identity', 'organisations', 'identity.organisations');
select has_table('identity', 'tenant_organisations', 'identity.tenant_organisations');
select has_table('identity', 'organisation_memberships', 'identity.organisation_memberships');
select has_table('identity', 'user_active_contexts', 'identity.user_active_contexts');
select has_table('identity', 'membership_roles', 'identity.membership_roles');
select has_table('permissions', 'capabilities', 'permissions.capabilities');
select has_table('permissions', 'roles', 'permissions.roles');
select has_table('permissions', 'role_capabilities', 'permissions.role_capabilities');
select has_table('permissions', 'grants', 'permissions.grants');

select hasnt_table('identity', 'persons', 'no duplicate persons table');
select hasnt_table('public', 'users', 'no duplicate users table');

select is(
  (select count(*)::int from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('identity', 'permissions') and c.relkind = 'r'
      and not c.relrowsecurity),
  0, 'RLS is enabled on every identity/permissions table');

-- ===========================================================================
-- SECURITY DEFINER discipline and function privileges
-- ===========================================================================

select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and not (coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""'])),
  0, 'every private function pins search_path to empty');
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prosecdef),
  4, 'exactly the four reviewed SECURITY DEFINER helpers exist in private');

select ok(not has_function_privilege('anon', 'private.current_app_user_id()', 'execute'),
  'anon cannot execute private.current_app_user_id');
select ok(not has_function_privilege('anon', 'private.is_tenant_member(uuid)', 'execute'),
  'anon cannot execute private.is_tenant_member');
select ok(not has_function_privilege('anon', 'private.is_organisation_member(uuid)', 'execute'),
  'anon cannot execute private.is_organisation_member');
select ok(not has_function_privilege('anon', 'private.handle_new_auth_user()', 'execute'),
  'anon cannot execute the auth profile trigger function');
select ok(not has_function_privilege('authenticated', 'private.handle_new_auth_user()', 'execute'),
  'authenticated cannot execute the auth profile trigger function');
select ok(not has_function_privilege('authenticated', 'private.set_updated_at()', 'execute'),
  'authenticated cannot execute the updated_at trigger function');
select ok(has_function_privilege('authenticated', 'private.is_organisation_member(uuid)', 'execute'),
  'authenticated may execute the policy helper it needs');

-- ===========================================================================
-- Schema / table privileges
-- ===========================================================================

select ok(not has_schema_privilege('anon', 'identity', 'usage'), 'anon has no usage on identity');
select ok(not has_schema_privilege('anon', 'permissions', 'usage'), 'anon has no usage on permissions');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon has no usage on private');
select ok(not has_table_privilege('authenticated', 'permissions.grants', 'select'),
  'authenticated has no direct read of permissions.grants');
select ok(not has_table_privilege('authenticated', 'identity.tenant_organisations', 'select'),
  'authenticated has no direct read of tenant_organisations');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema in ('identity', 'permissions')
      and privilege_type <> 'SELECT'),
  0, 'authenticated holds no INSERT/UPDATE/DELETE on any identity/permissions table');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'anon' and table_schema in ('identity', 'permissions')),
  0, 'anon holds no table privilege on identity/permissions');

-- ===========================================================================
-- Seed reference data
-- ===========================================================================

select results_eq(
  $$ select code from permissions.capabilities order by code $$,
  $$ values ('company.financials.edit'), ('company.financials.view'),
            ('data_room.share'), ('organisation.admin'), ('q.action.approve') $$,
  'seeded capability codes match the known reference set');
select results_eq(
  $$ select code from permissions.roles order by code $$,
  $$ values ('organisation_admin'), ('organisation_member') $$,
  'only the two baseline role templates are seeded');
select results_eq(
  $$ select c.code from permissions.role_capabilities rc
       join permissions.roles r on r.id = rc.role_id
       join permissions.capabilities c on c.id = rc.capability_id
      where r.code = 'organisation_admin' and rc.effect = 'ALLOW' $$,
  $$ values ('organisation.admin') $$,
  'organisation_admin maps to organisation.admin only');
select is(
  (select count(*)::int from permissions.role_capabilities rc
     join permissions.roles r on r.id = rc.role_id where r.code = 'organisation_member'),
  0, 'organisation_member carries no capabilities by default');

-- ===========================================================================
-- Fixtures (as the migration owner; RLS bypassed)
-- ===========================================================================

insert into auth.users (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');

select is(
  (select count(*)::int from identity.user_profiles
    where auth_user_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')),
  2, 'auth trigger creates exactly one profile per auth user');
select isnt(
  (select id from identity.user_profiles where auth_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
  'UserId is generated independently of AuthUserId');
select throws_ok(
  $$ delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' $$,
  '23503', null, 'deleting an auth user with a profile is restricted');

insert into identity.tenants (id, name) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Synthetic Tenant A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'Synthetic Tenant B');

insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug) values
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'company', 'Synthetic Org A', 'org-a'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'investment_firm', 'Synthetic Org B', 'org-b');

insert into identity.tenant_organisations (tenant_id, organisation_id) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2');

select throws_ok(
  $$ insert into identity.tenant_organisations (tenant_id, organisation_id)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1') $$,
  '23503', null, 'tenant_organisations cannot claim an organisation owned by another tenant');

insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id, primary_business_title) values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
     (select id from identity.user_profiles where auth_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 'CEO'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
     (select id from identity.user_profiles where auth_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'), 'Partner');

select throws_ok(
  $$ insert into identity.organisation_memberships (tenant_id, organisation_id, user_id)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
       (select id from identity.user_profiles where auth_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')) $$,
  '23503', null, 'membership cannot place an organisation under a different tenant');
select throws_ok(
  $$ insert into identity.organisation_memberships (tenant_id, organisation_id, user_id)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
       (select id from identity.user_profiles where auth_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')) $$,
  '23505', null, 'a second active membership for the same person and organisation is rejected');

insert into identity.membership_roles (membership_id, role_id)
select m.id, r.id from identity.organisation_memberships m, permissions.roles r
 where r.code = 'organisation_admin';

select throws_ok(
  $$ insert into identity.membership_roles (membership_id, role_id)
     select 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', id from permissions.roles where code = 'organisation_admin' $$,
  '23P01', null, 'overlapping current assignment of the same role is rejected');

insert into identity.user_active_contexts (user_id, membership_id) values
  ((select id from identity.user_profiles where auth_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  ((select id from identity.user_profiles where auth_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'), 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2');

select throws_ok(
  $$ update identity.user_active_contexts set membership_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'
      where user_id = (select id from identity.user_profiles where auth_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') $$,
  '23503', null, 'an active context cannot reference another person''s membership');

insert into permissions.grants (tenant_id, principal_type, principal_id, capability_id, effect, scope)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'user',
       (select id from identity.user_profiles where auth_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
       c.id, 'ALLOW',
       '{"kind":"ORGANISATION","tenantId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","organisationId":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1"}'::jsonb
  from permissions.capabilities c where c.code = 'data_room.share';

select throws_ok(
  $$ insert into permissions.grants (tenant_id, principal_type, principal_id, capability_id, effect, scope)
     select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'user', gen_random_uuid(), c.id, 'ALLOW',
            '{"kind":"TENANT","tenantId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"}'::jsonb
       from permissions.capabilities c where c.code = 'data_room.share' $$,
  '23514', null, 'a grant cannot scope itself into a different tenant');

-- ===========================================================================
-- As authenticated User A
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}', true);

select results_eq(
  $$ select auth_user_id from identity.user_profiles $$,
  $$ values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid) $$,
  'A sees own profile and no other');
select results_eq(
  $$ select id from identity.tenants $$,
  $$ values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid) $$,
  'A sees Tenant A, not Tenant B');
select results_eq(
  $$ select id from identity.organisations $$,
  $$ values ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid) $$,
  'A sees Organisation A, not Organisation B');
select results_eq(
  $$ select id from identity.organisation_memberships $$,
  $$ values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid) $$,
  'A sees own membership, not B''s');
select results_eq(
  $$ select membership_id from identity.membership_roles $$,
  $$ values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid) $$,
  'A sees own role assignment, not B''s');
select results_eq(
  $$ select membership_id from identity.user_active_contexts $$,
  $$ values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid) $$,
  'A sees own active context, not B''s');

select ok((select count(*) from permissions.capabilities) >= 5,
  'authenticated may read capability reference data');
select ok((select count(*) from permissions.roles) >= 2,
  'authenticated may read role reference data');
select throws_ok($$ select * from permissions.grants $$, '42501', null,
  'authenticated cannot read permissions.grants even with a grant of their own');
select throws_ok($$ select * from identity.tenant_organisations $$, '42501', null,
  'authenticated cannot read tenant_organisations directly');

-- Direct client writes are denied by privilege, not merely filtered by policy.
select throws_ok($$ insert into identity.tenants (name) values ('rogue') $$, '42501', null,
  'authenticated cannot create a tenant');
select throws_ok(
  $$ insert into identity.organisations (tenant_id, organisation_type, display_name, slug)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'company', 'Rogue', 'rogue') $$,
  '42501', null, 'authenticated cannot create an organisation');
select throws_ok(
  $$ insert into identity.organisation_memberships (tenant_id, organisation_id, user_id)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
       (select id from identity.user_profiles limit 1)) $$,
  '42501', null, 'authenticated cannot create a membership');
select throws_ok(
  $$ insert into identity.membership_roles (membership_id, role_id)
     select 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', id from permissions.roles where code = 'organisation_member' $$,
  '42501', null, 'authenticated cannot assign a role');
select throws_ok(
  $$ insert into permissions.grants (tenant_id, principal_type, principal_id, capability_id, effect, scope)
     select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'user', gen_random_uuid(), id, 'ALLOW',
            '{"kind":"TENANT","tenantId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"}'::jsonb
       from permissions.capabilities limit 1 $$,
  '42501', null, 'authenticated cannot create a permission grant');
select throws_ok(
  $$ update identity.organisation_memberships set primary_business_title = 'Owner' $$,
  '42501', null, 'authenticated cannot update memberships');
select throws_ok(
  $$ update identity.user_active_contexts set membership_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1' $$,
  '42501', null, 'authenticated cannot update active context directly');
select throws_ok(
  $$ update identity.user_profiles set display_name = 'x' $$,
  '42501', null, 'authenticated cannot update profiles directly');
select throws_ok(
  $$ delete from identity.organisation_memberships $$,
  '42501', null, 'authenticated cannot delete memberships');

-- ===========================================================================
-- Revocation removes membership-derived access but keeps history
-- ===========================================================================

reset role;
update identity.organisation_memberships
   set membership_status = 'revoked', left_at = now()
 where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

set local role authenticated;
select is((select count(*)::int from identity.tenants), 0,
  'revoked membership: Tenant A is no longer visible');
select is((select count(*)::int from identity.organisations), 0,
  'revoked membership: Organisation A is no longer visible');
select is((select count(*)::int from identity.organisation_memberships), 1,
  'revoked membership row remains visible to its owner as history');
select ok(not private.is_organisation_member('cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  'helper reports no active membership after revocation');

-- ===========================================================================
-- As User B: B sees only B
-- ===========================================================================

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2","role":"authenticated"}', true);
select results_eq(
  $$ select id from identity.organisations $$,
  $$ values ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2'::uuid) $$,
  'B sees Organisation B only');
select results_eq(
  $$ select auth_user_id from identity.user_profiles $$,
  $$ values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid) $$,
  'B sees own profile only');

-- ===========================================================================
-- Anonymous: no access at all
-- ===========================================================================

reset role;
set local role anon;
select throws_ok($$ select * from identity.user_profiles $$, '42501', null, 'anon cannot read profiles');
select throws_ok($$ select * from identity.organisations $$, '42501', null, 'anon cannot read organisations');
select throws_ok($$ select * from identity.organisation_memberships $$, '42501', null, 'anon cannot read memberships');
select throws_ok($$ select * from permissions.capabilities $$, '42501', null, 'anon cannot read capabilities');
select throws_ok($$ select private.current_app_user_id() $$, '42501', null, 'anon cannot call private helpers');

reset role;

select * from finish();

rollback;
