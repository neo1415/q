-- CQ-COMP-002 · company members, founder profiles and team facts.
--
-- Company relationships and team facts are readable by members of the
-- owning organisation; a founder profile only by its own person. Nobody
-- writes from a browser role. A company-member row grants nothing by
-- itself: once the organisation membership is revoked, the row is still
-- there (history) and the person can no longer read it.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(22);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Company A', 'company-a'),
  ('00000000-0000-4000-8000-0000000000c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Company B', 'company-b');
insert into core.company_members (id, tenant_id, company_id, user_id, is_founder, business_title) values
  ('00000000-0000-4000-8000-0000000000d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('user_a'), true, 'CEO'),
  ('00000000-0000-4000-8000-0000000000d2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000c2', pg_temp.rls_id('user_b'), true, 'CEO');
insert into core.founder_profiles (id, tenant_id, user_id, primary_company_id, background_summary) values
  ('00000000-0000-4000-8000-0000000000f1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-0000000000c1', 'A private background'),
  ('00000000-0000-4000-8000-0000000000f2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-0000000000c2', 'B private background');
insert into core.company_team_facts (tenant_id, company_id, founder_count, full_time_founder_count, team_size) values
  (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c1', 3, 2, 11),
  (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000c2', 1, 1, 4);

-- Defaults and constraints -----------------------------------------------------
select is((select visibility_scope from core.founder_profiles where id = '00000000-0000-4000-8000-0000000000f1'), 'founder_private',
  'a founder profile is founder_private by default');
select throws_ok(
  $$ insert into core.company_members (tenant_id, company_id, user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('user_a')) $$,
  '23505', null, 'only one current relationship per company and person');
select throws_ok(
  $$ insert into core.company_members (tenant_id, company_id, user_id)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('user_b')) $$,
  '23503', null, 'a member row cannot name a company under another tenant');
select throws_ok(
  $$ update core.company_team_facts set full_time_founder_count = 4
      where company_id = '00000000-0000-4000-8000-0000000000c1' $$,
  '23514', null, 'team facts: full-time founders cannot exceed founders');

-- User A ------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.company_members where company_id = '00000000-0000-4000-8000-0000000000c1'), 1, 'members: A -> Company A rows visible');
select is((select count(*)::int from core.company_members where company_id = '00000000-0000-4000-8000-0000000000c2'), 0, 'members: A -> Company B rows invisible');
select is((select count(*)::int from core.company_team_facts where company_id = '00000000-0000-4000-8000-0000000000c1'), 1, 'team facts: A -> Company A visible');
select is((select count(*)::int from core.company_team_facts where company_id = '00000000-0000-4000-8000-0000000000c2'), 0, 'team facts: A -> Company B invisible');
select results_eq(
  $$ select id from core.founder_profiles $$,
  $$ values ('00000000-0000-4000-8000-0000000000f1'::uuid) $$,
  'founder profiles: A reads only their own');
select throws_ok(
  $$ update core.company_members set is_founder = false where id = '00000000-0000-4000-8000-0000000000d1' $$,
  '42501', null, 'members: a browser principal cannot write');
select throws_ok(
  $$ update core.founder_profiles set visibility_scope = 'public_external' where id = '00000000-0000-4000-8000-0000000000f1' $$,
  '42501', null, 'founder profiles: a browser principal cannot change visibility');
select throws_ok(
  $$ update core.company_team_facts set team_size = 99 where company_id = '00000000-0000-4000-8000-0000000000c1' $$,
  '42501', null, 'team facts: a browser principal cannot write');

-- User B ------------------------------------------------------------------------
select pg_temp.act_as_user_b();
select is((select count(*)::int from core.company_members where company_id = '00000000-0000-4000-8000-0000000000c2'), 1, 'members: B -> Company B visible');
select is((select count(*)::int from core.company_members where company_id = '00000000-0000-4000-8000-0000000000c1'), 0, 'members: B -> Company A invisible');
select is((select count(*)::int from core.founder_profiles where user_id = pg_temp.rls_id('user_a')), 0, 'founder profiles: B cannot read A''s profile');

-- Revoked organisation membership: the company-member row remains, access does not.
select pg_temp.act_as_privileged();
update identity.organisation_memberships
   set membership_status = 'revoked', left_at = now()
 where id = pg_temp.rls_id('membership_a');
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.company_members where company_id = '00000000-0000-4000-8000-0000000000c1'), 0,
  'members: after organisation revocation A no longer reads Company A members');
select is((select count(*)::int from core.company_team_facts), 0,
  'team facts: after organisation revocation A no longer reads them');
select pg_temp.act_as_privileged();
select is((select is_current from core.company_members where id = '00000000-0000-4000-8000-0000000000d1'), true,
  'members: the company-member row itself is untouched history (not authorisation)');

-- Anonymous and service role ---------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from core.company_members $$, '42501', null, 'members: anonymous denied');
select throws_ok($$ select * from core.founder_profiles $$, '42501', null, 'founder profiles: anonymous denied');
select throws_ok($$ select * from core.company_team_facts $$, '42501', null, 'team facts: anonymous denied');
select pg_temp.act_as_service_role();
select throws_ok($$ select * from core.founder_profiles $$, '42501', null, 'service_role: no grant on founder profiles');

select * from finish();

rollback;
