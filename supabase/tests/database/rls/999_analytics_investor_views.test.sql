-- Q Workspace §8 · who viewed an investor (migration 20261231480000;
-- docs/specs/q-workspace/ANALYTICS_INVESTOR_VIEWERS.md).
--
-- Positive: the investor's own team reads weekly aggregates once at least
-- 3 founder organisations viewed; slices by stage and country with the
-- slice floor and complementary suppression. Negative: below the floor
-- nothing; the current week is not shown; the investor's own team is never
-- counted; the viewer's level is stamped, never the caller's; history is
-- append-only; another tenant, a revoked member and anonymous read
-- nothing; browsers cannot write; the actor-parameter layer is server-only.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(22);

-- ---------------------------------------------------------------- fixture
-- The investor firm being viewed: org_a's tenant, with user_a as its member.
insert into pg_temp.rls_fixture (label, id) values
  ('investor_a', '00000000-0000-4000-8000-00000000eb01');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name, hq_country)
  values (pg_temp.rls_id('investor_a'), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'VC', 'Investor A', 'NG');

-- A founder with a company: f<n>_user, f<n>_org, f<n>_tenant.
create function pg_temp.founder(p_n integer, p_stage text, p_country text, p_visibility text)
returns void language plpgsql as $f$
declare
  v_auth uuid := gen_random_uuid();
  v_tenant uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_company uuid := gen_random_uuid();
  v_user uuid;
begin
  insert into auth.users (id, email) values (v_auth, 'f' || p_n || '@example.invalid');
  select id into v_user from identity.user_profiles where auth_user_id = v_auth;
  insert into identity.tenants (id, name) values (v_tenant, 'Founder ' || p_n);
  insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
    values (v_org, v_tenant, 'company', 'Founder ' || p_n, 'f-fixture-' || p_n);
  insert into identity.tenant_organisations (tenant_id, organisation_id) values (v_tenant, v_org);
  insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status, joined_at)
    values (v_tenant, v_org, v_user, 'active', now() - interval '30 days');
  insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, headquarters_country)
    values (v_company, v_tenant, v_org, 'Company ' || p_n, 'company-f-' || p_n, p_country);
  insert into knowledge.company_profiles
    (company_id, company_tenant_id, listed, visibility, canonical_name, stage_code, fingerprint, version)
    values (v_company, v_tenant, true, 'network_visible', 'Company ' || p_n, p_stage,
            'fixture-' || p_n, nextval('knowledge.version_seq'));
  if p_visibility is not null then
    insert into analytics.viewing_privacy_settings (user_id, visibility) values (v_user, p_visibility);
  end if;
  insert into pg_temp.rls_fixture (label, id) values
    ('f' || p_n || '_user', v_user), ('f' || p_n || '_org', v_org), ('f' || p_n || '_tenant', v_tenant);
end;
$f$;

-- A view of investor_a LAST week (a completed batch), unless p_at says otherwise.
create function pg_temp.view_as(p_user uuid, p_org uuid, p_tenant uuid, p_client text, p_at timestamptz default null)
returns void language sql as $f$
  insert into analytics.investor_profile_views
    (tenant_id, viewer_user_id, viewer_organisation_id, investor_organisation_id, investor_tenant_id,
     view_type, engagement_version, visibility_at_view, client_event_id, occurred_at)
  values (p_tenant, p_user, p_org, pg_temp.rls_id('investor_a'), pg_temp.rls_id('tenant_a'),
          'INVESTOR_PROFILE_VIEW', 'engagement.v1',
          -- A forged level: the trigger must replace it.
          'FULL_IDENTITY', p_client,
          coalesce(p_at, date_trunc('week', now()) - interval '3 days'))
$f$;
create function pg_temp.f_view(p_n integer, p_client text, p_at timestamptz default null)
returns void language sql as $f$
  select pg_temp.view_as(pg_temp.rls_id('f' || p_n || '_user'), pg_temp.rls_id('f' || p_n || '_org'),
                         pg_temp.rls_id('f' || p_n || '_tenant'), p_client, p_at)
$f$;

-- Seven founders: five seed (four NG, one KE), two pre-seed in KE.
select pg_temp.founder(1, 'seed', 'NG', 'ANONYMOUS');
select pg_temp.founder(2, 'seed', 'NG', null);
select pg_temp.founder(3, 'seed', 'NG', null);
select pg_temp.founder(4, 'seed', 'NG', null);
select pg_temp.founder(5, 'seed', 'KE', null);
select pg_temp.founder(6, 'pre_seed', 'KE', null);
select pg_temp.founder(7, 'pre_seed', 'KE', null);

select pg_temp.f_view(1, 'ivw-1-0001');
select pg_temp.f_view(2, 'ivw-2-0001');
-- The investor looking at their own profile: never counted.
select pg_temp.view_as(pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('tenant_a'), 'ivw-a-0001');

-- ---------------------------------------------------------------- integrity
select is((select visibility_at_view from analytics.investor_profile_views where client_event_id = 'ivw-1-0001'),
  'ANONYMOUS', 'the viewer''s own level is stamped, never the caller''s');
select is((select visibility_at_view from analytics.investor_profile_views where client_event_id = 'ivw-2-0001'),
  'ORGANISATION_ONLY', 'with no choice, the platform default');
select throws_ok($$ select pg_temp.view_as(pg_temp.rls_id('user_b'), pg_temp.rls_id('org_a'), pg_temp.rls_id('tenant_a'), 'ivw-b-0001') $$,
  '23514', null, 'a viewer cannot be recorded under an organisation they do not belong to');
select throws_ok($$ select pg_temp.f_view(1, 'ivw-1-0001') $$, '23505', null, 'the same client event is one row');
select throws_ok($$ update analytics.investor_profile_views set occurred_at = now() where client_event_id = 'ivw-1-0001' $$,
  '23001', null, 'views are never edited');
select throws_ok($$ delete from analytics.investor_profile_views where client_event_id = 'ivw-1-0001' $$,
  '23001', null, 'views are never deleted');

-- ---------------------------------------------------------------- below the floor
select pg_temp.act_as_user_a();
select is((select count(*)::int from analytics.my_investor_viewing_periods(pg_temp.rls_id('investor_a'))), 0,
  'two founder organisations: no total (floor 3)');
select is((select count(*)::int from analytics.my_investor_viewing_slices(pg_temp.rls_id('investor_a'))), 0,
  'and no breakdown');

-- ---------------------------------------------------------------- seven founders
select pg_temp.reset_test_identity();
select pg_temp.f_view(n, 'ivw-' || n || '-0001') from generate_series(3, 7) n;
select pg_temp.f_view(3, 'ivw-3-0002');
-- This week's view is not shown until the week is over.
select pg_temp.f_view(4, 'ivw-4-0002', now() - interval '1 minute');

select pg_temp.act_as_user_a();
select is((select row(organisations, viewers, profile_views)::text
             from analytics.my_investor_viewing_periods(pg_temp.rls_id('investor_a'))),
  row(7, 7, 8)::text, 'one completed week: 7 founder organisations, 8 views; the own team is not counted');
select ok((select bool_and(period_start < date_trunc('week', now())::date)
             from analytics.my_investor_viewing_periods(pg_temp.rls_id('investor_a'))),
  'the current week is not shown (weekly batches)');
select is((select array_agg(slice || ':' || coalesce(organisations::text, '-') order by slice)
             from analytics.my_investor_viewing_slices(pg_temp.rls_id('investor_a')) where dimension = 'STAGE'),
  array['OTHER:-', 'seed:5'], 'a stage slice at the floor is shown; the one below it is hidden');
select is((select array_agg(slice || ':' || coalesce(organisations::text, '-') order by slice)
             from analytics.my_investor_viewing_slices(pg_temp.rls_id('investor_a')) where dimension = 'GEOGRAPHY'),
  array['OTHER:-'], 'NG 4 and KE 3 are both below 5: one Other row, no count');
select is((select count(*)::int from analytics.investor_profile_views), 1,
  'the investor reads only their own raw views, never their viewers''');
select throws_ok($$ select * from analytics.investor_viewing_periods(pg_temp.rls_id('user_a'), pg_temp.rls_id('investor_a'), null) $$,
  '42501', null, 'the actor-parameter projection is server-only');
select throws_ok($$ select pg_temp.f_view(5, 'ivw-5-0099') $$, '42501', null, 'a browser cannot write views');

-- ---------------------------------------------------------------- complementary suppression
select pg_temp.reset_test_identity();
select pg_temp.founder(8, 'seed', 'NG', null);
select pg_temp.f_view(8, 'ivw-8-0001');
select pg_temp.act_as_user_a();
select is((select array_agg(slice || ':' || coalesce(organisations::text, '-') order by slice)
             from analytics.my_investor_viewing_slices(pg_temp.rls_id('investor_a')) where dimension = 'GEOGRAPHY'),
  array['NG:5', 'OTHER:-'], 'NG reaches 5 and is shown; KE stays hidden');
select is((select array_agg(slice || ':' || coalesce(organisations::text, '-') order by slice)
             from analytics.my_investor_viewing_slices(pg_temp.rls_id('investor_a')) where dimension = 'STAGE'),
  array['OTHER:-', 'seed:6'], 'pre-seed (2) is hidden, alone in its dimension');

-- ---------------------------------------------------------------- other principals
select pg_temp.act_as_user_b();
select is((select count(*)::int from analytics.my_investor_viewing_periods(pg_temp.rls_id('investor_a'))), 0,
  'another tenant reads nothing of an investor''s viewing');

select pg_temp.reset_test_identity();
insert into pg_temp.rls_fixture (label, id)
  select 'auth_f1', p.auth_user_id from identity.user_profiles p where p.id = pg_temp.rls_id('f1_user');
select pg_temp.act_as('auth_f1');
select is((select count(*)::int from analytics.investor_profile_views), 1, 'a founder reads their own views');
select is((select count(*)::int from analytics.my_investor_viewing_periods(pg_temp.rls_id('investor_a'))), 0,
  'and nothing of the investor''s aggregate');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from analytics.my_investor_viewing_periods(pg_temp.rls_id('investor_a'))), 0,
  'a revoked member reads nothing');

select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from analytics.investor_profile_views $$, '42501', null, 'anonymous reads nothing');

select * from finish();
rollback;
