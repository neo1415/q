-- Q Workspace §8 A1 + A2 · analytics.engagement_events, viewing privacy,
-- the admin settings and the founder projection (Product Specification
-- §6.7.12-6.7.14; owner decisions 6 Nov 2026, DECISIONS 72/74).
--
-- Positive: an entitled founder sees each viewer at the level they chose; a
-- free founder sees aggregates; a viewer reads their own events. Negative:
-- Anonymous is never revealed unless the admin explicitly allows the
-- override; floors withhold small counts; complementary suppression; the
-- current week is not shown; the own team is never counted; other tenants
-- and revoked members read nothing; browsers cannot write; history is
-- append-only.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(60);

-- ---------------------------------------------------------------- fixture
insert into pg_temp.rls_fixture (label, id) values
  ('company_a', '00000000-0000-4000-8000-00000000ea01'),
  ('company_r', '00000000-0000-4000-8000-00000000ea02'),
  ('deck_a', '00000000-0000-4000-8000-00000000ea03'),
  ('doc_b', '00000000-0000-4000-8000-00000000ea04');

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  (pg_temp.rls_id('company_a'), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Company A', 'company-a'),
  (pg_temp.rls_id('company_r'), pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'Company R', 'company-r');
insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id) values
  (pg_temp.rls_id('deck_a'), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('company_a'), pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Deck', pg_temp.rls_id('user_a')),
  (pg_temp.rls_id('doc_b'), pg_temp.rls_id('tenant_b'), null, pg_temp.rls_id('org_b'), 'OTHER', 'B doc', pg_temp.rls_id('user_b'));

-- An investor firm with one person: inv<n>_user, inv<n>_org, inv<n>_tenant.
create function pg_temp.investor(p_n integer, p_type text, p_country text, p_visibility text)
returns void language plpgsql as $f$
declare
  v_auth uuid := gen_random_uuid();
  v_tenant uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_user uuid;
begin
  insert into auth.users (id, email) values (v_auth, 'inv' || p_n || '@example.invalid');
  select id into v_user from identity.user_profiles where auth_user_id = v_auth;
  insert into identity.tenants (id, name) values (v_tenant, 'Investor ' || p_n);
  insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
    values (v_org, v_tenant, 'investment_firm', 'Investor ' || p_n, 'inv-fixture-' || p_n);
  insert into identity.tenant_organisations (tenant_id, organisation_id) values (v_tenant, v_org);
  insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status, joined_at)
    values (v_tenant, v_org, v_user, 'active', now() - interval '30 days');
  insert into core.investor_organisations (tenant_id, organisation_id, investor_type, display_name, hq_country)
    values (v_tenant, v_org, p_type, 'Investor ' || p_n, p_country);
  if p_visibility is not null then
    insert into analytics.viewing_privacy_settings (user_id, visibility) values (v_user, p_visibility);
  end if;
  insert into pg_temp.rls_fixture (label, id) values
    ('inv' || p_n || '_user', v_user), ('inv' || p_n || '_org', v_org), ('inv' || p_n || '_tenant', v_tenant);
end;
$f$;

-- A view in LAST week (a completed batch), unless p_at says otherwise.
create function pg_temp.view_as(p_user uuid, p_org uuid, p_tenant uuid, p_company text, p_type text,
                                p_client text, p_slide integer default null, p_ms integer default null,
                                p_at timestamptz default null)
returns void language sql as $f$
  insert into analytics.engagement_events
    (tenant_id, viewer_user_id, viewer_organisation_id, company_id, company_tenant_id,
     engagement_type, engagement_version, document_id, slide_number, duration_ms,
     visibility_at_view, client_event_id, occurred_at)
  select p_tenant, p_user, p_org, c.id, c.tenant_id, p_type, 'engagement.v1',
         case when p_type in ('DECK_OPEN', 'DECK_SLIDE_DWELL') then pg_temp.rls_id('deck_a') end,
         p_slide, p_ms,
         -- A forged level: the trigger must replace it.
         'FULL_IDENTITY', p_client,
         coalesce(p_at, date_trunc('week', now()) - interval '3 days')
  from core.companies c where c.id = pg_temp.rls_id(p_company)
$f$;
create function pg_temp.inv_view(p_n integer, p_type text, p_client text, p_slide integer default null,
                                 p_ms integer default null, p_at timestamptz default null)
returns void language sql as $f$
  select pg_temp.view_as(pg_temp.rls_id('inv' || p_n || '_user'), pg_temp.rls_id('inv' || p_n || '_org'),
                         pg_temp.rls_id('inv' || p_n || '_tenant'), 'company_a', p_type, p_client,
                         p_slide, p_ms, p_at)
$f$;

-- Eleven investor firms. inv1 Full, inv2 Organisation, inv3 and inv6
-- Anonymous, inv5 Full now (Anonymous later), the rest the default.
-- Types: five VC, five ANGEL, one FAMILY_OFFICE; all in NG.
select pg_temp.investor(1, 'VC', 'NG', 'FULL_IDENTITY');
select pg_temp.investor(2, 'VC', 'NG', 'ORGANISATION_ONLY');
select pg_temp.investor(3, 'VC', 'NG', 'ANONYMOUS');
select pg_temp.investor(4, 'VC', 'NG', null);
select pg_temp.investor(5, 'VC', 'NG', 'FULL_IDENTITY');
select pg_temp.investor(6, 'ANGEL', 'NG', 'ANONYMOUS');
select pg_temp.investor(7, 'ANGEL', 'NG', null);
select pg_temp.investor(8, 'ANGEL', 'NG', null);
select pg_temp.investor(9, 'ANGEL', 'NG', null);
select pg_temp.investor(10, 'ANGEL', 'NG', null);
select pg_temp.investor(11, 'FAMILY_OFFICE', 'NG', null);

-- Two firms only, at first.
select pg_temp.inv_view(1, 'PROFILE_VIEW', 'evt-1-0001');
select pg_temp.inv_view(1, 'DECK_SLIDE_DWELL', 'evt-1-0002', 1, 2000);
select pg_temp.inv_view(2, 'DECK_SLIDE_DWELL', 'evt-2-0001', 1, 4000);
select pg_temp.inv_view(2, 'DECK_SLIDE_DWELL', 'evt-2-0002', 2, 9000);
-- The founder looking at their own company: never counted.
select pg_temp.view_as(pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('tenant_a'),
                       'company_a', 'PROFILE_VIEW', 'evt-a-0001');

-- ---------------------------------------------------------------- integrity
select is(analytics.default_viewing_visibility(), 'ORGANISATION_ONLY', 'the default is Organisation only');
select is((select visibility_at_view from analytics.engagement_events where client_event_id = 'evt-1-0001'),
  'FULL_IDENTITY', 'the level in force at view time is stamped');
select is((select visibility_at_view from analytics.engagement_events where client_event_id = 'evt-2-0001'),
  'ORGANISATION_ONLY', 'a forged level is replaced by the viewer''s own setting');
select throws_ok($$ select pg_temp.view_as(pg_temp.rls_id('user_r'), pg_temp.rls_id('org_r'), pg_temp.rls_id('tenant_r'),
                                           'company_a', 'PROFILE_VIEW', 'evt-r-0001') $$,
  '23514', null, 'a revoked member cannot be recorded as a viewer');
select throws_ok($$ select pg_temp.view_as(pg_temp.rls_id('user_b'), pg_temp.rls_id('org_a'), pg_temp.rls_id('tenant_a'),
                                           'company_a', 'PROFILE_VIEW', 'evt-b-0099') $$,
  '23514', null, 'a viewer cannot be recorded under an organisation they do not belong to');
select throws_ok($$ select pg_temp.inv_view(1, 'PROFILE_VIEW', 'evt-1-0001') $$,
  '23505', null, 'the same client event is one row');
select throws_ok(
  $$ insert into analytics.engagement_events (tenant_id, viewer_user_id, viewer_organisation_id, company_id, company_tenant_id,
       engagement_type, engagement_version, document_id, visibility_at_view, client_event_id, occurred_at)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), pg_temp.rls_id('company_a'),
       pg_temp.rls_id('tenant_a'), 'DATA_ROOM_DOCUMENT_VIEW', 'engagement.v1', pg_temp.rls_id('doc_b'), 'ANONYMOUS', 'evt-b-0100', now()) $$,
  '23503', null, 'a document must belong to the subject company''s tenant');
select throws_ok($$ select pg_temp.inv_view(1, 'DECK_SLIDE_DWELL', 'evt-1-0101') $$,
  '23514', null, 'a slide dwell names its slide');
select throws_ok($$ update analytics.engagement_events set duration_ms = 1 where client_event_id = 'evt-1-0002' $$,
  '23001', null, 'events are never edited');
select throws_ok($$ delete from analytics.engagement_events where client_event_id = 'evt-1-0002' $$,
  '23001', null, 'events are never deleted');

-- ---------------------------------------------------------------- below the floor
select pg_temp.act_as_user_a();
select is((select count(*)::int from analytics.my_company_engagement_periods(pg_temp.rls_id('company_a'))), 0,
  'two viewing organisations: no passive total (floor 3)');
select is((select count(*)::int from analytics.my_company_deck_funnel(pg_temp.rls_id('company_a'))), 0,
  'and no deck funnel');
select is((select count(*)::int from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))), 0,
  'and no viewer row on a free plan');
select is((select count(*)::int from analytics.my_company_engagement_slices(pg_temp.rls_id('company_a'))), 0,
  'and no breakdown');

-- ---------------------------------------------------------------- eleven firms
select pg_temp.reset_test_identity();
select pg_temp.inv_view(3, 'DECK_SLIDE_DWELL', 'evt-3-0001', 1, 3000);
select pg_temp.inv_view(5, 'PROFILE_VIEW', 'evt-5-0001');
select pg_temp.inv_view(n, 'PROFILE_VIEW', 'evt-' || n || '-0001') from generate_series(4, 4) n;
select pg_temp.inv_view(n, 'PROFILE_VIEW', 'evt-' || n || '-0001') from generate_series(6, 11) n;
-- This week's view is not shown until the week is over.
select pg_temp.inv_view(1, 'Q_CARD_VIEW', 'evt-1-0003', null, null, now() - interval '1 minute');
-- Then inv5 turns anonymity on.
update analytics.viewing_privacy_settings set visibility = 'ANONYMOUS' where user_id = pg_temp.rls_id('inv5_user');

select pg_temp.act_as_user_a();
select is((select row(visibility, viewer_user_id, viewer_organisation_id, organisations, last_period_start)::text
           from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))),
  row('AGGREGATE', null::uuid, null::uuid, 11, null::date)::text,
  'a free plan sees one aggregate row: no names, no organisations, no time');
select is((select count(*)::int from analytics.my_company_engagement_periods(pg_temp.rls_id('company_a'))), 1,
  'one completed week of passive figures');
select ok((select bool_and(period_start < date_trunc('week', now())::date)
           from analytics.my_company_engagement_periods(pg_temp.rls_id('company_a'))),
  'the current week is not shown (weekly batches)');
select is((select q_card_views from analytics.my_company_engagement_periods(pg_temp.rls_id('company_a'))), 0,
  'so this week''s Q Card view is not counted yet');
select is((select array_agg(viewers_reached order by slide_number) from analytics.my_company_deck_funnel(pg_temp.rls_id('company_a'))),
  array[3, 1], 'the deck funnel counts who reached each slide');
select is((select sum(organisations)::int from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))), 11,
  'the company''s own team is never counted');
select is((select array_agg(slice || ':' || coalesce(organisations::text, '-') order by slice)
           from analytics.my_company_engagement_slices(pg_temp.rls_id('company_a')) where dimension = 'INVESTOR_TYPE'),
  array['OTHER:-', 'VC:5'],
  'slices below 5 are hidden, and the next-smallest with them (complementary suppression)');
select is((select array_agg(slice || ':' || organisations) from analytics.my_company_engagement_slices(pg_temp.rls_id('company_a'))
           where dimension = 'GEOGRAPHY'),
  array['NG:11'], 'a slice at or above the floor is shown');
select is((select count(*)::int from analytics.engagement_events), 1,
  'a founder reads only their own raw events, never their viewers''');
select throws_ok($$ select * from analytics.company_engagement_viewers(pg_temp.rls_id('user_a'), pg_temp.rls_id('company_a'), null) $$,
  '42501', null, 'the actor-parameter projection is server-only');

-- ---------------------------------------------------------------- Founder Pro
create function pg_temp.shown(p_n integer) returns text language sql as $f$
  select coalesce(string_agg(visibility || '/' || basis, ','), 'not shown')
    from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))
   where viewer_user_id = pg_temp.rls_id('inv' || p_n || '_user')
      or viewer_organisation_id = pg_temp.rls_id('inv' || p_n || '_org')
$f$;
create function pg_temp.set(p_sql text) returns void language plpgsql as $f$
begin
  perform pg_temp.reset_test_identity();
  execute 'update analytics.platform_settings set ' || p_sql
       || ', updated_by = pg_temp.rls_id(''user_a''), reason = ''pgTAP combination''';
end;
$f$;

select pg_temp.reset_test_identity();
insert into billing.plan_assignments (organisation_id, plan_id, source, assigned_by_user_id, reason)
  select pg_temp.rls_id('org_a'), p.id, 'ADMIN', pg_temp.rls_id('user_a'), 'pgTAP Founder Pro'
    from billing.plans p where p.key = 'founder_pro';
select pg_temp.act_as_user_a();
select is(pg_temp.shown(1), 'FULL_IDENTITY/VIEWER_CHOICE', 'Founder Pro: a Full identity viewer is named');
select is((select viewer_user_id from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))
            where viewer_organisation_id = pg_temp.rls_id('inv2_org')), null::uuid,
  'Founder Pro: an Organisation only viewer appears as their organisation, never their person');
select is(pg_temp.shown(3), 'not shown', 'Founder Pro: an Anonymous viewer is never named nor shown by organisation');
select is(pg_temp.shown(5), 'not shown', 'turning anonymity on later hides an earlier named view');
select is((select row(viewer_organisation_id, organisations, last_period_start)::text
           from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a')) where visibility = 'ANONYMOUS'),
  row(null::uuid, 3, null::date)::text,
  'Anonymous viewers appear only as "an investor", merged, once they span 3 organisations');
select is((select last_period_start from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))
            where viewer_user_id = pg_temp.rls_id('inv1_user')), date_trunc('week', now() - interval '7 days')::date,
  'a named row carries its week, never a view time');
select is((select total_dwell_ms from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))
            where viewer_user_id = pg_temp.rls_id('inv1_user')), null::bigint,
  'per-person time stays off by default');

select pg_temp.set('per_person_passive_analytics = true');
select pg_temp.act_as_user_a();
select is((select total_dwell_ms from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))
            where viewer_user_id = pg_temp.rls_id('inv1_user')), 2000::bigint,
  'granular ON: slide time for a named viewer');
select is((select total_dwell_ms from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))
            where viewer_organisation_id = pg_temp.rls_id('inv2_org')), null::bigint,
  'granular ON: never time for an organisation row');
select pg_temp.reset_test_identity();
select is((select array_agg(slide_number) from analytics.company_viewer_deck_detail(pg_temp.rls_id('user_a'), pg_temp.rls_id('company_a'), null)),
  array[1], 'granular ON: per-slide detail only for the named viewer');

select pg_temp.set('per_person_passive_analytics = false, paid_identity_reveal = false');
select pg_temp.act_as_user_a();
select is((select array_agg(visibility) from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))),
  array['AGGREGATE'], 'paid reveal OFF: even Founder Pro sees aggregates only');

select pg_temp.set('named_passive_viewers = true');
select pg_temp.act_as_user_a();
select is(pg_temp.shown(1), 'FULL_IDENTITY/VIEWER_CHOICE', 'named viewers ON: per-viewer display without the plan feature');
select is(pg_temp.shown(3), 'not shown', 'and still never an Anonymous viewer');

select pg_temp.set('named_passive_viewers = false, paid_identity_reveal = true, paid_reveal_overrides_anonymous = true');
select pg_temp.act_as_user_a();
select is(pg_temp.shown(3), 'FULL_IDENTITY/PAID_REVEAL', 'only the explicit admin override reveals an Anonymous viewer, marked as such');

select pg_temp.reset_test_identity();
update billing.plan_assignments set superseded_at = now()
 where organisation_id = pg_temp.rls_id('org_a') and superseded_at is null;
select pg_temp.act_as_user_a();
select is(pg_temp.shown(3), 'not shown', 'without the plan, the override reveals nothing');
select is(pg_temp.shown(1), 'not shown', 'without the plan, nobody is named');

-- ---------------------------------------------------------------- settings rules
select pg_temp.reset_test_identity();
select throws_ok($$ update analytics.platform_settings set paid_identity_reveal = false $$,
  '23514', null, 'the Anonymous override cannot exist without paid reveal');
update analytics.platform_settings set paid_reveal_overrides_anonymous = false;
select throws_ok($$ update analytics.platform_settings set headline_floor = 2 $$, '23514', null, 'the headline floor is never below 3');
select throws_ok($$ update analytics.platform_settings set slice_floor = 4 $$, '23514', null, 'the slice floor is never below 5');
select throws_ok($$ update analytics.platform_settings set allowed_visibilities = array['FULL_IDENTITY'], default_visibility = 'FULL_IDENTITY' $$,
  '23514', null, 'a person may always choose to be stricter than the default');
update analytics.platform_settings set headline_floor = 20;
select pg_temp.act_as_user_a();
select is((select count(*)::int from analytics.my_company_engagement_periods(pg_temp.rls_id('company_a'))), 0,
  'an admin may raise the floor, and it applies at once');
select pg_temp.reset_test_identity();
update analytics.platform_settings set headline_floor = 3;
select throws_ok($$ delete from analytics.platform_settings $$, '23001', null, 'the settings row cannot be removed');
insert into analytics.platform_setting_changes (actor_user_id, reason, before, after)
  values (pg_temp.rls_id('user_a'), 'pgTAP history', '{}', '{}');
select throws_ok($$ update analytics.platform_setting_changes set reason = 'rewritten' $$, '23001', null, 'setting history is append-only');
update analytics.platform_settings set default_visibility = 'ANONYMOUS';
select is(analytics.default_viewing_visibility(), 'ANONYMOUS', 'the default is the admin setting, read in one place');
select is((select count(*)::int from billing.plan_features pf join billing.plans p on p.id = pf.plan_id
            where pf.feature_key = 'analytics.identity_reveal' and pf.included and p.audience = 'INVESTOR'), 0,
  'investors never pay for visibility: no investor plan includes identity reveal');
select is((select array_agg(p.key) from billing.plan_features pf join billing.plans p on p.id = pf.plan_id
            where pf.feature_key = 'analytics.identity_reveal' and pf.included), array['founder_pro'],
  'identity reveal is a Founder Pro feature');

-- ---------------------------------------------------------------- other principals
select pg_temp.act_as_user_a();
select throws_ok($$ select * from analytics.platform_settings $$, '42501', null, 'a browser cannot read the settings table');
select throws_ok($$ select analytics.settings() $$, '42501', null, 'nor call the resolver directly');
select throws_ok($$ insert into analytics.viewing_privacy_settings (user_id, visibility) values (pg_temp.rls_id('user_a'), 'ANONYMOUS') $$,
  '42501', null, 'privacy settings are written by the server only');

select pg_temp.act_as_user_b();
select is((select count(*)::int from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))), 0,
  'another tenant reads nothing of a company''s engagement');
select is((select count(*)::int from analytics.viewing_privacy_settings), 0, 'nobody reads another person''s setting');
select throws_ok($$ select pg_temp.view_as(pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), pg_temp.rls_id('tenant_b'),
                                           'company_a', 'PROFILE_VIEW', 'evt-b-0200') $$,
  '42501', null, 'a browser cannot write engagement');

select pg_temp.reset_test_identity();
insert into pg_temp.rls_fixture (label, id)
  select 'auth_inv1', p.auth_user_id from identity.user_profiles p where p.id = pg_temp.rls_id('inv1_user');
select pg_temp.act_as('auth_inv1');
select is((select count(*)::int from analytics.engagement_events), 3, 'a viewer reads their own events');
select is((select count(*)::int from analytics.engagement_events where viewer_user_id <> pg_temp.rls_id('inv1_user')), 0,
  'and nobody else''s');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_r'))), 0,
  'a revoked member reads nothing of their former company''s engagement');

select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from analytics.engagement_events $$, '42501', null, 'anonymous reads nothing');

select * from finish();
rollback;
