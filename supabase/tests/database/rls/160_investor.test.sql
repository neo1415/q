-- CQ-INV-001 · investor organisations and representatives.
--
-- One canonical investor organisation per organisation, readable by members
-- of that organisation and nobody else; a representative row is readable
-- only by its own person while they are still an active member. Nobody
-- writes from a browser role. A representative row grants nothing: once the
-- organisation membership is revoked (or never existed) the row remains as
-- history and access is gone. public_description is not public.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(33);

insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name, public_description, deployment_state) values
  ('00000000-0000-4000-8000-0000000000e1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'VC', 'Investor A', 'PRIVATE-INVESTOR-DESCRIPTION-DO-NOT-EMIT', 'ACTIVELY_INVESTING'),
  ('00000000-0000-4000-8000-0000000000e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'FAMILY_OFFICE', 'Investor B', 'B private description', null);
insert into core.investor_representatives (id, tenant_id, investor_organisation_id, organisation_id, user_id, membership_id, business_title) values
  ('00000000-0000-4000-8000-0000000000f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000e1', pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), pg_temp.rls_id('membership_a'), 'Partner'),
  ('00000000-0000-4000-8000-0000000000f2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000e2', pg_temp.rls_id('org_b'), pg_temp.rls_id('user_b'), pg_temp.rls_id('membership_b'), 'Principal');

-- Defaults and constraints -----------------------------------------------------
select is((select verification_state from core.investor_organisations where id = '00000000-0000-4000-8000-0000000000e1'), 'unverified',
  'a new investor organisation is unverified by default');
select is((select version from core.investor_organisations where id = '00000000-0000-4000-8000-0000000000e1'), 1,
  'a new investor organisation is version 1');
select is((select deployment_state from core.investor_organisations where id = '00000000-0000-4000-8000-0000000000e2'), null,
  'deployment state may be unknown (null), never coerced');
select throws_ok(
  $$ insert into core.investor_organisations (tenant_id, organisation_id, investor_type, display_name)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'ANGEL', 'Second Investor A') $$,
  '23505', null, 'one canonical investor organisation per organisation');
select throws_ok(
  $$ insert into core.investor_organisations (tenant_id, organisation_id, investor_type, display_name)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_r'), 'ANGEL', 'Wrong tenant') $$,
  '23503', null, 'an investor organisation cannot name an organisation under a tenant that does not own it');
select throws_ok(
  $$ insert into core.investor_organisations (tenant_id, organisation_id, investor_type, display_name)
     values (pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'HEDGE_FUND', 'Unknown type') $$,
  '23514', null, 'investor type is a bounded vocabulary');
select throws_ok(
  $$ update core.investor_organisations set deployment_state = 'OPEN' where id = '00000000-0000-4000-8000-0000000000e1' $$,
  '23514', null, 'deployment state is a bounded vocabulary (GateQ values are not deployment states)');
select throws_ok(
  $$ insert into core.investor_representatives (tenant_id, investor_organisation_id, organisation_id, user_id, membership_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000e1', pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), pg_temp.rls_id('membership_a')) $$,
  '23505', null, 'only one current representation per investor organisation and person');
select throws_ok(
  $$ insert into core.investor_representatives (tenant_id, investor_organisation_id, organisation_id, user_id, membership_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000e1', pg_temp.rls_id('org_a'), pg_temp.rls_id('user_b'), pg_temp.rls_id('membership_a')) $$,
  '23503', null, 'representative: a person cannot be paired with someone else''s membership');
select throws_ok(
  $$ insert into core.investor_representatives (tenant_id, investor_organisation_id, organisation_id, user_id, membership_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000e1', pg_temp.rls_id('org_a'), pg_temp.rls_id('user_b'), pg_temp.rls_id('membership_b')) $$,
  '23503', null, 'representative: a membership from another organisation cannot represent this investor');
select throws_ok(
  $$ update core.investor_representatives set tenant_id = pg_temp.rls_id('tenant_b')
      where id = '00000000-0000-4000-8000-0000000000f1' $$,
  '23503', null, 'representative: tenant cannot drift from the investor organisation and membership');

-- User A ------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.investor_organisations where id = '00000000-0000-4000-8000-0000000000e1'), 1, 'investors: A -> Investor A visible');
select is((select count(*)::int from core.investor_organisations where id = '00000000-0000-4000-8000-0000000000e2'), 0, 'investors: A -> Investor B invisible (valid id, wrong tenant)');
select is((select count(*)::int from core.investor_organisations), 1, 'investors: A sees exactly one investor organisation');
select is((select count(*)::int from core.investor_representatives where id = '00000000-0000-4000-8000-0000000000f1'), 1, 'representatives: A reads their own row');
select is((select count(*)::int from core.investor_representatives where id = '00000000-0000-4000-8000-0000000000f2'), 0, 'representatives: A cannot read B''s row');
select throws_ok(
  $$ insert into core.investor_organisations (tenant_id, organisation_id, investor_type, display_name)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'VC', 'Browser Capital') $$,
  '42501', null, 'investors: a browser principal cannot insert');
select throws_ok(
  $$ update core.investor_organisations set verification_state = 'platform_verified' where id = '00000000-0000-4000-8000-0000000000e1' $$,
  '42501', null, 'investors: a browser principal cannot self-verify');
select throws_ok(
  $$ update core.investor_organisations set deployment_state = 'PAUSED' where id = '00000000-0000-4000-8000-0000000000e1' $$,
  '42501', null, 'investors: a browser principal cannot change deployment state');
select throws_ok(
  $$ delete from core.investor_organisations where id = '00000000-0000-4000-8000-0000000000e1' $$,
  '42501', null, 'investors: a browser principal cannot delete');
select throws_ok(
  $$ update core.investor_representatives set business_title = 'Managing Partner' where id = '00000000-0000-4000-8000-0000000000f1' $$,
  '42501', null, 'representatives: a browser principal cannot write');

-- User B ------------------------------------------------------------------------
select pg_temp.act_as_user_b();
select is((select count(*)::int from core.investor_organisations where id = '00000000-0000-4000-8000-0000000000e2'), 1, 'investors: B -> Investor B visible');
select is((select count(*)::int from core.investor_organisations where id = '00000000-0000-4000-8000-0000000000e1'), 0, 'investors: B -> Investor A invisible');
select is((select count(*)::int from core.investor_organisations where public_description like '%DO-NOT-EMIT%'), 0,
  'investors: public_description is not readable across tenants (not public)');

-- Representative without membership: the stronger guarantee is that such a
-- row cannot even exist. Access is proven separately below through the
-- revoked-membership case, where the row exists but the membership is gone.
select pg_temp.act_as_privileged();
select throws_ok(
  $$ insert into core.investor_representatives (tenant_id, investor_organisation_id, organisation_id, user_id, membership_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000e1', pg_temp.rls_id('org_a'), pg_temp.rls_id('user_r'), '00000000-0000-4000-8000-0000000000f9') $$,
  '23503', null, 'representatives: a row cannot exist without a real membership of the investor''s organisation');

-- Revoked organisation membership: representation remains history, access does not.
update identity.organisation_memberships
   set membership_status = 'revoked', left_at = now()
 where id = pg_temp.rls_id('membership_a');
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.investor_organisations), 0,
  'investors: after organisation revocation A no longer reads Investor A');
select is((select count(*)::int from core.investor_representatives), 0,
  'representatives: after organisation revocation A no longer reads their own row');
select pg_temp.act_as_privileged();
select is((select is_current from core.investor_representatives where id = '00000000-0000-4000-8000-0000000000f1'), true,
  'representatives: the row itself is untouched history (not authorisation)');

-- Anonymous and service role ---------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from core.investor_organisations $$, '42501', null, 'investors: anonymous denied');
select throws_ok($$ select * from core.investor_representatives $$, '42501', null, 'representatives: anonymous denied');
select throws_ok($$ select * from core.investor_creation_requests $$, '42501', null, 'creation idempotency: anonymous denied');
select pg_temp.act_as_user_b();
select throws_ok($$ select * from core.investor_creation_requests $$, '42501', null, 'creation idempotency: authenticated denied');
select pg_temp.act_as_service_role();
select throws_ok($$ select * from core.investor_organisations $$, '42501', null, 'service_role: no grant on investor organisations');

select * from finish();

rollback;
