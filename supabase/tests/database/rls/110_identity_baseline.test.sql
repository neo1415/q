-- CQ-SEC-004 · cross-tenant baseline for the CQ-DATA-002 identity and
-- permission tables, expressed through the reusable harness.
--
-- Every table gets the same shape of test: A sees A, A cannot see B (a
-- real, valid B id -- the guessed-UUID case), B the reverse, anonymous
-- nothing, and revocation removes access while the history row remains.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(43);

-- identity.user_profiles ----------------------------------------------------

select pg_temp.act_as_user_a();
select results_eq(
  $$ select id from identity.user_profiles $$,
  $$ select pg_temp.rls_id('user_a') $$,
  'profiles: A sees only A');
select is((select count(*)::int from identity.user_profiles where id = pg_temp.rls_id('user_b')), 0,
  'profiles: A cannot see B by id');

select pg_temp.act_as_user_b();
select results_eq(
  $$ select id from identity.user_profiles $$,
  $$ select pg_temp.rls_id('user_b') $$,
  'profiles: B sees only B');
select is((select count(*)::int from identity.user_profiles where id = pg_temp.rls_id('user_a')), 0,
  'profiles: B cannot see A by id');

-- identity.tenants ----------------------------------------------------------

select pg_temp.act_as_user_a();
select is((select count(*)::int from identity.tenants where id = pg_temp.rls_id('tenant_a')), 1, 'tenants: A → Tenant A visible');
select is((select count(*)::int from identity.tenants where id = pg_temp.rls_id('tenant_b')), 0, 'tenants: A → Tenant B invisible (valid id, wrong tenant)');
select is((select count(*)::int from identity.tenants), 1, 'tenants: A sees exactly one tenant overall');

select pg_temp.act_as_user_b();
select is((select count(*)::int from identity.tenants where id = pg_temp.rls_id('tenant_b')), 1, 'tenants: B → Tenant B visible');
select is((select count(*)::int from identity.tenants where id = pg_temp.rls_id('tenant_a')), 0, 'tenants: B → Tenant A invisible');

-- identity.organisations ----------------------------------------------------

select pg_temp.act_as_user_a();
select is((select count(*)::int from identity.organisations where id = pg_temp.rls_id('org_a')), 1, 'organisations: A → Org A visible');
select is((select count(*)::int from identity.organisations where id = pg_temp.rls_id('org_b')), 0, 'organisations: A → Org B invisible (valid id, wrong tenant)');
select is((select count(*)::int from identity.organisations where slug = 'rls-org-b'), 0, 'organisations: A cannot find Org B by slug either');

select pg_temp.act_as_user_b();
select is((select count(*)::int from identity.organisations where id = pg_temp.rls_id('org_b')), 1, 'organisations: B → Org B visible');
select is((select count(*)::int from identity.organisations where id = pg_temp.rls_id('org_a')), 0, 'organisations: B → Org A invisible');

-- identity.organisation_memberships -------------------------------------------

select pg_temp.act_as_user_a();
select results_eq(
  $$ select id from identity.organisation_memberships $$,
  $$ select pg_temp.rls_id('membership_a') $$,
  'memberships: A sees own membership only');
select is((select count(*)::int from identity.organisation_memberships where id = pg_temp.rls_id('membership_b')), 0,
  'memberships: A cannot see membership B by id');

select pg_temp.act_as_user_b();
select is((select count(*)::int from identity.organisation_memberships where id = pg_temp.rls_id('membership_a')), 0,
  'memberships: B cannot see membership A by id');

-- identity.membership_roles ----------------------------------------------------

select pg_temp.act_as_user_a();
select is((select count(*)::int from identity.membership_roles where membership_id = pg_temp.rls_id('membership_a')), 1,
  'membership_roles: A sees own role assignment');

select pg_temp.act_as_user_b();
select is((select count(*)::int from identity.membership_roles), 0,
  'membership_roles: B sees none of A''s assignments');

-- identity.user_active_contexts ----------------------------------------------

select pg_temp.act_as_user_a();
select results_eq(
  $$ select membership_id from identity.user_active_contexts $$,
  $$ select pg_temp.rls_id('membership_a') $$,
  'active contexts: A sees own context only');
select is((select count(*)::int from identity.user_active_contexts where user_id = pg_temp.rls_id('user_b')), 0,
  'active contexts: A cannot see B''s context');

-- Revocation -------------------------------------------------------------------

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from identity.tenants where id = pg_temp.rls_id('tenant_r')), 0,
  'revoked: old tenant invisible');
select is((select count(*)::int from identity.organisations where id = pg_temp.rls_id('org_r')), 0,
  'revoked: old organisation invisible');
select is((select count(*)::int from identity.organisation_memberships where id = pg_temp.rls_id('membership_r')), 1,
  'revoked: own historical membership row remains visible to its owner');
select is((select count(*)::int from identity.user_active_contexts where membership_id = pg_temp.rls_id('membership_r')), 1,
  'revoked: the stale active-context row still exists ...');
select ok(not private.is_organisation_member(pg_temp.rls_id('org_r')),
  '... but it does not recreate organisation membership');

-- Live revocation within one session: access exists, then disappears.
select pg_temp.act_as_user_a();
select is((select count(*)::int from identity.organisations where id = pg_temp.rls_id('org_a')), 1, 'live revocation: A sees Org A before');
select pg_temp.act_as_privileged();
update identity.organisation_memberships
   set membership_status = 'revoked', left_at = now()
 where id = pg_temp.rls_id('membership_a');
select pg_temp.act_as_user_a();
select is((select count(*)::int from identity.organisations where id = pg_temp.rls_id('org_a')), 0, 'live revocation: A no longer sees Org A after');
select is((select count(*)::int from identity.tenants where id = pg_temp.rls_id('tenant_a')), 0, 'live revocation: A no longer sees Tenant A after');
select is((select count(*)::int from identity.membership_roles where membership_id = pg_temp.rls_id('membership_a')), 1,
  'live revocation: role assignment history remains visible to its owner');

-- Anonymous --------------------------------------------------------------------

select pg_temp.act_as_anonymous();
select throws_ok($$ select * from identity.user_profiles $$, '42501', null, 'anonymous: profiles denied');
select throws_ok($$ select * from identity.tenants $$, '42501', null, 'anonymous: tenants denied');
select throws_ok($$ select * from identity.organisations $$, '42501', null, 'anonymous: organisations denied');
select throws_ok($$ select * from identity.organisation_memberships $$, '42501', null, 'anonymous: memberships denied');
select throws_ok($$ select * from identity.user_active_contexts $$, '42501', null, 'anonymous: active contexts denied');
select throws_ok($$ select * from permissions.grants $$, '42501', null, 'anonymous: grants denied');

-- Permission state: reference readable, grants never -----------------------------

select pg_temp.act_as_user_b();
select ok((select count(*) from permissions.capabilities) >= 5, 'permission reference: capabilities readable');
select ok((select count(*) from permissions.roles) >= 2, 'permission reference: roles readable');
select ok((select count(*) from permissions.role_capabilities) >= 1, 'permission reference: role_capabilities readable');
select throws_ok($$ select * from permissions.grants $$, '42501', null, 'permission state: raw grants never readable by a browser principal');
select throws_ok(
  $$ insert into permissions.grants (tenant_id, principal_type, principal_id, capability_id, effect, scope)
     select pg_temp.rls_id('tenant_b'), 'user', pg_temp.rls_id('user_b'), id, 'ALLOW',
            json_build_object('kind', 'TENANT', 'tenantId', pg_temp.rls_id('tenant_b'))::jsonb
       from permissions.capabilities limit 1 $$,
  '42501', null, 'permission state: a browser principal cannot grant itself anything');

-- Wrong-tenant writes -----------------------------------------------------------

select pg_temp.act_as_user_a();
select throws_ok(
  $$ update identity.organisations set display_name = 'Taken over' where id = pg_temp.rls_id('org_b') $$,
  '42501', null, 'writes: A cannot update Org B');
select throws_ok(
  $$ delete from identity.organisation_memberships where id = pg_temp.rls_id('membership_b') $$,
  '42501', null, 'writes: A cannot delete membership B');

select pg_temp.reset_test_identity();

select * from finish();

rollback;
