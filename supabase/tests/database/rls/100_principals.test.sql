-- CQ-SEC-004 · principal simulation and the production RLS helper functions.
--
-- Proves the harness itself: who each principal is, that switching leaves
-- nothing behind, and that private.current_app_user_id / is_tenant_member /
-- is_organisation_member answer from real membership rows only.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(37);

-- Fixture sanity ------------------------------------------------------------

select isnt(pg_temp.rls_id('user_a'), pg_temp.rls_id('auth_a'), 'UserId A is not AuthUserId A');
select isnt(pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), 'UserId A is not OrganisationId A');
select isnt(pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'TenantId A is not OrganisationId A');
select is(
  (select count(*)::int from identity.organisation_memberships
    where user_id = pg_temp.rls_id('user_a') and organisation_id = pg_temp.rls_id('org_b')),
  0, 'no cross-membership exists by default');

-- Authentication simulation -------------------------------------------------

select pg_temp.act_as_user_a();
select is(current_user::text, 'authenticated', 'User A: database role is authenticated');
select is(auth.uid(), pg_temp.rls_id('auth_a'), 'User A: auth.uid() is auth user A');
select is(private.current_app_user_id(), pg_temp.rls_id('user_a'), 'User A: current_app_user_id() is application user A');

select pg_temp.act_as_user_b();
select is(auth.uid(), pg_temp.rls_id('auth_b'), 'User B: auth.uid() is auth user B, not A');
select is(private.current_app_user_id(), pg_temp.rls_id('user_b'), 'User B: current_app_user_id() is application user B');

select pg_temp.act_as_anonymous();
select is(current_user::text, 'anon', 'Anonymous: database role is anon');
select ok(auth.uid() is null, 'Anonymous: auth.uid() is null after acting as B');
select throws_ok($$ select private.current_app_user_id() $$, '42501', null,
  'Anonymous: cannot even call the app-user helper');

select pg_temp.act_as_user_a();
select is(auth.uid(), pg_temp.rls_id('auth_a'), 'Switching back to A restores exactly A');

select pg_temp.act_as_revoked_user();
select is(private.current_app_user_id(), pg_temp.rls_id('user_r'), 'Revoked user still has an application identity');

select pg_temp.reset_test_identity();
select is(current_user::text, 'postgres', 'reset_test_identity returns to the runner role');
select ok(auth.uid() is null, 'reset_test_identity clears JWT claims');

-- Claims are authentication only ---------------------------------------------

select pg_temp.act_as_user_a();
select is(
  (select current_setting('request.jwt.claims', true)::jsonb - 'sub' - 'role'),
  '{}'::jsonb,
  'the simulated JWT carries only sub and role; tenant/organisation authority is never a claim');

-- is_tenant_member ----------------------------------------------------------

select pg_temp.act_as_user_a();
select ok(private.is_tenant_member(pg_temp.rls_id('tenant_a')), 'A is a member of Tenant A');
select ok(not private.is_tenant_member(pg_temp.rls_id('tenant_b')), 'A is not a member of Tenant B');
select ok(not private.is_tenant_member(pg_temp.rls_id('tenant_r')), 'A is not a member of Tenant R');

select pg_temp.act_as_user_b();
select ok(private.is_tenant_member(pg_temp.rls_id('tenant_b')), 'B is a member of Tenant B');
select ok(not private.is_tenant_member(pg_temp.rls_id('tenant_a')), 'B is not a member of Tenant A');

select pg_temp.act_as_revoked_user();
select ok(not private.is_tenant_member(pg_temp.rls_id('tenant_r')), 'revoked user is no longer a member of the old tenant');

select pg_temp.act_as_anonymous();
select throws_ok($$ select private.is_tenant_member('00000000-0000-4000-8000-0000000000a3') $$, '42501', null,
  'anonymous cannot call is_tenant_member');

-- is_organisation_member ----------------------------------------------------

select pg_temp.act_as_user_a();
select ok(private.is_organisation_member(pg_temp.rls_id('org_a')), 'A is a member of Organisation A');
select ok(not private.is_organisation_member(pg_temp.rls_id('org_b')), 'A is not a member of Organisation B');

select pg_temp.act_as_user_b();
select ok(private.is_organisation_member(pg_temp.rls_id('org_b')), 'B is a member of Organisation B');
select ok(not private.is_organisation_member(pg_temp.rls_id('org_a')), 'B is not a member of Organisation A');

select pg_temp.act_as_revoked_user();
select ok(not private.is_organisation_member(pg_temp.rls_id('org_r')), 'revoked membership is not organisation membership');
select is(
  (select count(*)::int from identity.organisation_memberships where id = pg_temp.rls_id('membership_r')),
  1, 'the revoked membership row still exists as history');

select pg_temp.act_as_anonymous();
select throws_ok($$ select private.is_organisation_member('00000000-0000-4000-8000-0000000000a4') $$, '42501', null,
  'anonymous cannot call is_organisation_member');

-- The helpers take a target id, never a caller id ---------------------------

select pg_temp.act_as_privileged();
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('current_app_user_id', 'is_tenant_member', 'is_organisation_member')
      and pg_get_function_arguments(p.oid) ilike '%user%'),
  0, 'no RLS helper accepts a caller user id as a parameter; auth.uid() decides who is asking');

-- Privileged / service role sentinel ------------------------------------------
--
-- EXPECTED DB BEHAVIOR. APPLICATION AUTHORIZATION IS STILL REQUIRED.
-- The privileged server role bypasses RLS; that is how the server reads on
-- behalf of any tenant. It proves nothing about whether an action is
-- permitted -- ActorContext + AuthorizationService decide that, every time.

select pg_temp.act_as_privileged();
select is(
  (select count(*)::int from identity.tenants where id in (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('tenant_b'))),
  2, 'privileged server role bypasses RLS and sees both tenants (EXPECTED; not business authorization)');
select ok(
  (select rolbypassrls from pg_roles where rolname = current_user::text),
  'the privileged runner role is marked BYPASSRLS');

select pg_temp.act_as_service_role();
select is(current_user::text, 'service_role', 'service_role simulation switches the database role');
select ok((select rolbypassrls from pg_roles where rolname = 'service_role'), 'Supabase service_role is BYPASSRLS by design');
select throws_ok($$ select * from identity.tenants $$, '42501', null,
  'service_role holds no grants on Capital Q schemas: least privilege, RLS bypass never reached');

select pg_temp.reset_test_identity();

select * from finish();

rollback;
