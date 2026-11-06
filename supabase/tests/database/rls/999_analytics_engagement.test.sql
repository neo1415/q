-- Q Workspace §8 A1 + A2 · analytics.engagement_events, viewing privacy
-- and the founder projection (Product Specification §6.7.12-6.7.14).
--
-- Positive: a founder sees aggregates and each viewer at the level they
-- allowed; a viewer reads their own events. Negative: no identity beyond
-- the viewer's setting, the more private of then/now wins, the founder's
-- own team is never counted, other tenants and revoked members read
-- nothing, browsers cannot write, history is append-only.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(52);

-- Three more people at the investor organisation B.
insert into pg_temp.rls_fixture (label, id) values
  ('auth_b2', '00000000-0000-4000-8000-0000000000b6'),
  ('auth_b3', '00000000-0000-4000-8000-0000000000b7'),
  ('auth_b4', '00000000-0000-4000-8000-0000000000b8'),
  ('company_a', '00000000-0000-4000-8000-00000000ea01'),
  ('company_r', '00000000-0000-4000-8000-00000000ea02'),
  ('deck_a', '00000000-0000-4000-8000-00000000ea03'),
  ('doc_b', '00000000-0000-4000-8000-00000000ea04');
insert into auth.users (id, email) values
  (pg_temp.rls_id('auth_b2'), 'rls-user-b2@example.invalid'),
  (pg_temp.rls_id('auth_b3'), 'rls-user-b3@example.invalid'),
  (pg_temp.rls_id('auth_b4'), 'rls-user-b4@example.invalid');
insert into pg_temp.rls_fixture (label, id)
  select 'user_' || substr(f.label, 6), p.id
  from pg_temp.rls_fixture f join identity.user_profiles p on p.auth_user_id = f.id
  where f.label in ('auth_b2', 'auth_b3', 'auth_b4');
insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status, joined_at)
  select pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), pg_temp.rls_id(l), 'active', now() - interval '10 days'
  from unnest(array['user_b2', 'user_b3', 'user_b4']) l;

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  (pg_temp.rls_id('company_a'), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Company A', 'company-a'),
  (pg_temp.rls_id('company_r'), pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'Company R', 'company-r');
insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id) values
  (pg_temp.rls_id('deck_a'), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('company_a'), pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Deck', pg_temp.rls_id('user_a')),
  (pg_temp.rls_id('doc_b'), pg_temp.rls_id('tenant_b'), null, pg_temp.rls_id('org_b'), 'OTHER', 'B doc', pg_temp.rls_id('user_b'));

-- Settings: b none (default), b2 full, b3 anonymous, b4 full (changes later).
insert into analytics.viewing_privacy_settings (user_id, visibility) values
  (pg_temp.rls_id('user_b2'), 'FULL_IDENTITY'),
  (pg_temp.rls_id('user_b3'), 'ANONYMOUS'),
  (pg_temp.rls_id('user_b4'), 'FULL_IDENTITY');

create function pg_temp.view(p_user text, p_org text, p_tenant text, p_company text, p_type text,
                             p_client text, p_slide integer default null, p_ms integer default null)
returns void language sql as $$
  insert into analytics.engagement_events
    (tenant_id, viewer_user_id, viewer_organisation_id, company_id, company_tenant_id,
     engagement_type, engagement_version, document_id, slide_number, duration_ms,
     visibility_at_view, client_event_id, occurred_at)
  select pg_temp.rls_id(p_tenant), pg_temp.rls_id(p_user), pg_temp.rls_id(p_org),
         c.id, c.tenant_id, p_type, 'engagement.v1',
         case when p_type in ('DECK_OPEN', 'DECK_SLIDE_DWELL') then pg_temp.rls_id('deck_a') end,
         p_slide, p_ms,
         -- A forged level: the trigger must replace it.
         'FULL_IDENTITY', p_client, now() - interval '1 hour'
  from core.companies c where c.id = pg_temp.rls_id(p_company)
$$;

select pg_temp.view('user_b',  'org_b', 'tenant_b', 'company_a', 'PROFILE_VIEW', 'evt-b-0001');
select pg_temp.view('user_b',  'org_b', 'tenant_b', 'company_a', 'DECK_OPEN', 'evt-b-0002');
select pg_temp.view('user_b',  'org_b', 'tenant_b', 'company_a', 'DECK_SLIDE_DWELL', 'evt-b-0003', 1, 4000);
select pg_temp.view('user_b',  'org_b', 'tenant_b', 'company_a', 'DECK_SLIDE_DWELL', 'evt-b-0004', 2, 9000);
select pg_temp.view('user_b2', 'org_b', 'tenant_b', 'company_a', 'PROFILE_VIEW', 'evt-b2-0001');
select pg_temp.view('user_b2', 'org_b', 'tenant_b', 'company_a', 'DECK_SLIDE_DWELL', 'evt-b2-0002', 1, 2000);
select pg_temp.view('user_b3', 'org_b', 'tenant_b', 'company_a', 'Q_CARD_VIEW', 'evt-b3-0001');
select pg_temp.view('user_b4', 'org_b', 'tenant_b', 'company_a', 'PROFILE_VIEW', 'evt-b4-0001');
select pg_temp.view('user_b',  'org_b', 'tenant_b', 'company_r', 'PROFILE_VIEW', 'evt-b-r001');
-- The founder looking at their own company: never counted.
select pg_temp.view('user_a',  'org_a', 'tenant_a', 'company_a', 'PROFILE_VIEW', 'evt-a-0001');

-- Then b3 turns anonymity off and b4 turns it on.
update analytics.viewing_privacy_settings set visibility = 'FULL_IDENTITY' where user_id = pg_temp.rls_id('user_b3');
update analytics.viewing_privacy_settings set visibility = 'ANONYMOUS' where user_id = pg_temp.rls_id('user_b4');

-- ---------------------------------------------------------------- integrity
select is(analytics.default_viewing_visibility(), 'ORGANISATION_ONLY', 'the default is one config value: Organisation only');
select is((select visibility_at_view from analytics.engagement_events where client_event_id = 'evt-b-0001'),
  'ORGANISATION_ONLY', 'a forged level is replaced by the viewer''s setting (default)');
select is((select visibility_at_view from analytics.engagement_events where client_event_id = 'evt-b3-0001'),
  'ANONYMOUS', 'the level in force at view time is stamped');
select throws_ok($$ select pg_temp.view('user_r', 'org_r', 'tenant_r', 'company_a', 'PROFILE_VIEW', 'evt-r-0001') $$,
  '23514', null, 'a revoked member cannot be recorded as a viewer');
select throws_ok($$ select pg_temp.view('user_b', 'org_a', 'tenant_a', 'company_a', 'PROFILE_VIEW', 'evt-b-0099') $$,
  '23514', null, 'a viewer cannot be recorded under an organisation they do not belong to');
select throws_ok($$ select pg_temp.view('user_b', 'org_b', 'tenant_b', 'company_a', 'PROFILE_VIEW', 'evt-b-0001') $$,
  '23505', null, 'the same client event is one row');
select throws_ok(
  $$ insert into analytics.engagement_events (tenant_id, viewer_user_id, viewer_organisation_id, company_id, company_tenant_id,
       engagement_type, engagement_version, document_id, visibility_at_view, client_event_id, occurred_at)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), pg_temp.rls_id('company_a'),
       pg_temp.rls_id('tenant_a'), 'DATA_ROOM_DOCUMENT_VIEW', 'engagement.v1', pg_temp.rls_id('doc_b'), 'ANONYMOUS', 'evt-b-0100', now()) $$,
  '23503', null, 'a document must belong to the subject company''s tenant');
select throws_ok($$ select pg_temp.view('user_b', 'org_b', 'tenant_b', 'company_a', 'DECK_SLIDE_DWELL', 'evt-b-0101') $$,
  '23514', null, 'a slide dwell names its slide');
select throws_ok($$ update analytics.engagement_events set duration_ms = 1 where client_event_id = 'evt-b-0003' $$,
  '23001', null, 'events are never edited');
select throws_ok($$ delete from analytics.engagement_events where client_event_id = 'evt-b-0003' $$,
  '23001', null, 'events are never deleted');

-- ---------------------------------------------------------------- founder A
-- Below the floor: every viewer so far is from organisation B.
select pg_temp.act_as_user_a();
select is((select count(*)::int from analytics.my_company_engagement_daily(pg_temp.rls_id('company_a'))), 0,
  'with one viewing organisation, passive aggregates are withheld (floor of 3)');
select is((select count(*)::int from analytics.my_company_deck_funnel(pg_temp.rls_id('company_a'))), 0,
  'and so is the deck funnel');
select is((select count(*)::int from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))
           where visibility = 'ANONYMOUS'), 0,
  'an anonymous bucket from one organisation is withheld');
select is((select count(*)::int from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))
           where viewer_user_id is not null), 0,
  'spec default: no passive viewer is named, not even one who chose Full identity');
select is((select row(viewer_user_id, viewer_organisation_id, people)::text
           from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a')) where visibility = 'ORGANISATION_ONLY'),
  row(null::uuid, pg_temp.rls_id('org_b'), 2)::text,
  'Full identity and Organisation only viewers appear as their organisation, people merged');

-- Two more anonymous investors, from two more organisations.
select pg_temp.reset_test_identity();
insert into pg_temp.rls_fixture (label, id) values
  ('auth_c', '00000000-0000-4000-8000-0000000000d1'), ('tenant_c', '00000000-0000-4000-8000-0000000000d3'),
  ('org_c', '00000000-0000-4000-8000-0000000000d4'),
  ('auth_d', '00000000-0000-4000-8000-0000000000e1'), ('tenant_d', '00000000-0000-4000-8000-0000000000e3'),
  ('org_d', '00000000-0000-4000-8000-0000000000e4');
insert into identity.tenants (id, name) values
  (pg_temp.rls_id('tenant_c'), 'RLS Fixture Tenant C'), (pg_temp.rls_id('tenant_d'), 'RLS Fixture Tenant D');
insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug) values
  (pg_temp.rls_id('org_c'), pg_temp.rls_id('tenant_c'), 'investment_firm', 'RLS Fixture Org C', 'rls-org-c'),
  (pg_temp.rls_id('org_d'), pg_temp.rls_id('tenant_d'), 'investment_firm', 'RLS Fixture Org D', 'rls-org-d');
insert into identity.tenant_organisations (tenant_id, organisation_id) values
  (pg_temp.rls_id('tenant_c'), pg_temp.rls_id('org_c')), (pg_temp.rls_id('tenant_d'), pg_temp.rls_id('org_d'));
insert into auth.users (id, email) values
  (pg_temp.rls_id('auth_c'), 'rls-user-c@example.invalid'), (pg_temp.rls_id('auth_d'), 'rls-user-d@example.invalid');
insert into pg_temp.rls_fixture (label, id)
  select 'user_' || substr(f.label, 6), p.id
  from pg_temp.rls_fixture f join identity.user_profiles p on p.auth_user_id = f.id
  where f.label in ('auth_c', 'auth_d');
insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status, joined_at) values
  (pg_temp.rls_id('tenant_c'), pg_temp.rls_id('org_c'), pg_temp.rls_id('user_c'), 'active', now() - interval '10 days'),
  (pg_temp.rls_id('tenant_d'), pg_temp.rls_id('org_d'), pg_temp.rls_id('user_d'), 'active', now() - interval '10 days');
insert into analytics.viewing_privacy_settings (user_id, visibility) values
  (pg_temp.rls_id('user_c'), 'ANONYMOUS'), (pg_temp.rls_id('user_d'), 'ANONYMOUS');
select pg_temp.view('user_c', 'org_c', 'tenant_c', 'company_a', 'DECK_SLIDE_DWELL', 'evt-c-0001', 1, 3000);
select pg_temp.view('user_d', 'org_d', 'tenant_d', 'company_a', 'PROFILE_VIEW', 'evt-d-0001');

-- At the floor.
select pg_temp.act_as_user_a();
select is((select row(viewer_user_id, viewer_organisation_id, people, last_viewed_at)::text
           from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a')) where visibility = 'ANONYMOUS'),
  row(null::uuid, null::uuid, 4, null::timestamptz)::text,
  'at 3 organisations, anonymous viewers appear as one row with no identity and no time');
select is((select count(*)::int from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))
           where viewer_user_id = pg_temp.rls_id('user_b3')), 0,
  'turning anonymity off later never reveals an anonymous view');
select is((select count(*)::int from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))
           where viewer_user_id = pg_temp.rls_id('user_b4')), 0,
  'turning anonymity on hides earlier named views');
select is((select sum(people)::int from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))), 6,
  'the company''s own team is never counted');
select is((select sum(viewers)::int from analytics.my_company_engagement_daily(pg_temp.rls_id('company_a'))), 6,
  'daily aggregates count outside viewers once the floor is met');
select is((select array_agg(viewers_reached order by slide_number) from analytics.my_company_deck_funnel(pg_temp.rls_id('company_a'))),
  array[3, 1], 'the deck funnel shows how many reached each slide');
select is((select count(*)::int from analytics.engagement_events), 1,
  'a founder reads only their own raw events, never their viewers''');
select throws_ok($$ select * from analytics.company_engagement_viewers(pg_temp.rls_id('user_a'), pg_temp.rls_id('company_a'), null) $$,
  '42501', null, 'the actor-parameter projection is server-only');
select throws_ok($$ insert into analytics.viewing_privacy_settings (user_id, visibility) values (pg_temp.rls_id('user_a'), 'ANONYMOUS') $$,
  '42501', null, 'settings are written by the server only');

-- ---------------------------------------------------------------- admin settings
-- Each combination, as the founder sees it. Settings change only as the
-- server (privileged); the founder reads through the projection.
create function pg_temp.set(p_sql text) returns void language plpgsql as $f$
begin
  perform pg_temp.reset_test_identity();
  execute 'update analytics.platform_settings set ' || p_sql
       || ', updated_by = pg_temp.rls_id(''user_a''), reason = ''pgTAP combination''';
end;
$f$;
create function pg_temp.shown(p_user text) returns text language sql as $f$
  select string_agg(visibility || '/' || basis, ',')
    from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))
   where viewer_user_id = pg_temp.rls_id(p_user)
$f$;
create function pg_temp.dwell_of(p_user text) returns bigint language sql as $f$
  select total_dwell_ms from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))
   where viewer_user_id = pg_temp.rls_id(p_user)
$f$;

select pg_temp.set('named_passive_viewers = true');
select pg_temp.act_as_user_a();
select is(pg_temp.shown('user_b2'), 'FULL_IDENTITY/VIEWER_CHOICE',
  'named passive viewers ON: a Full identity viewer is named, by their own choice');
select is(pg_temp.shown('user_b'), null, 'named passive viewers ON: an Organisation only viewer is still not named');
select is(pg_temp.dwell_of('user_b2'), null::bigint, 'per-person time stays off by default');
select pg_temp.reset_test_identity();
select is((select count(*)::int from analytics.company_viewer_deck_detail(pg_temp.rls_id('user_a'), pg_temp.rls_id('company_a'), null)), 0,
  'and per-person slide detail (server-side) is empty');

select pg_temp.set('per_person_passive_analytics = true');
select pg_temp.act_as_user_a();
select is(pg_temp.dwell_of('user_b2'), 2000::bigint, 'granular ON: slide dwell per named viewer');
select pg_temp.reset_test_identity();
select is((select array_agg(slide_number) from analytics.company_viewer_deck_detail(pg_temp.rls_id('user_a'), pg_temp.rls_id('company_a'), null)), array[1],
  'granular ON: per-slide detail only for the named viewer');
select pg_temp.act_as_user_a();
select is((select total_dwell_ms from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))
           where visibility = 'ORGANISATION_ONLY'), null::bigint,
  'granular ON: never time for an organisation row');

select pg_temp.set('per_person_passive_analytics = false, named_passive_viewers = false, paid_identity_reveal = true');
select pg_temp.act_as_user_a();
select is(pg_temp.shown('user_b'), null, 'paid reveal ON but the company is not entitled: nobody is revealed');

select pg_temp.reset_test_identity();
insert into billing.limit_overrides (organisation_id, feature_key, granted_by_user_id, reason)
  values (pg_temp.rls_id('org_a'), 'analytics.identity_reveal', pg_temp.rls_id('user_a'), 'pgTAP entitlement');
select pg_temp.act_as_user_a();
select is(pg_temp.shown('user_b'), 'FULL_IDENTITY/PAID_REVEAL', 'paid reveal ON and entitled: an Organisation only viewer is named, marked as a paid reveal');
select is(pg_temp.shown('user_b2'), 'FULL_IDENTITY/VIEWER_CHOICE', 'a Full identity viewer stays their own choice');
select is(pg_temp.shown('user_b3'), null, 'paid reveal never reveals an Anonymous viewer by default');
select is(pg_temp.shown('user_c'), null, 'nor any other Anonymous viewer');

select pg_temp.set('paid_reveal_overrides_anonymous = true');
select pg_temp.act_as_user_a();
select is(pg_temp.shown('user_b3'), 'FULL_IDENTITY/PAID_REVEAL', 'only with the explicit admin override is Anonymous revealed');

select pg_temp.set('paid_identity_reveal = true, paid_reveal_overrides_anonymous = true');
select pg_temp.reset_test_identity();
update billing.limit_overrides set revoked_at = now(), revoked_by_user_id = pg_temp.rls_id('user_a')
 where organisation_id = pg_temp.rls_id('org_a') and feature_key = 'analytics.identity_reveal';
select pg_temp.act_as_user_a();
select is(pg_temp.shown('user_b3'), null, 'a revoked entitlement reveals nothing, whatever the settings');

select pg_temp.reset_test_identity();
select throws_ok($$ update analytics.platform_settings set paid_identity_reveal = false, paid_reveal_overrides_anonymous = true $$,
  '23514', null, 'the Anonymous override cannot exist without paid reveal');
select throws_ok($$ update analytics.platform_settings set allowed_visibilities = array['FULL_IDENTITY'], default_visibility = 'FULL_IDENTITY' $$,
  '23514', null, 'a person may always choose to be stricter than the default');
select throws_ok($$ delete from analytics.platform_settings $$, '23001', null, 'the settings row cannot be removed');
insert into analytics.platform_setting_changes (actor_user_id, reason, before, after)
  values (pg_temp.rls_id('user_a'), 'pgTAP history', '{}', '{}');
select throws_ok($$ update analytics.platform_setting_changes set reason = 'rewritten' $$, '23001', null, 'setting history is append-only');
update analytics.platform_settings set default_visibility = 'ANONYMOUS', paid_identity_reveal = false,
  paid_reveal_overrides_anonymous = false;
select is(analytics.default_viewing_visibility(), 'ANONYMOUS', 'the default is the admin setting, read in one place');
select pg_temp.act_as_user_a();
select throws_ok($$ select * from analytics.platform_settings $$, '42501', null, 'a browser cannot read the settings table');
select throws_ok($$ select analytics.settings() $$, '42501', null, 'nor call the resolver directly');

-- ---------------------------------------------------------------- investor B
select pg_temp.act_as_user_b();
select is((select count(*)::int from analytics.engagement_events), 5, 'a viewer reads their own events');
select is((select count(*)::int from analytics.engagement_events where viewer_user_id <> pg_temp.rls_id('user_b')), 0,
  'and nobody else''s, even in their own organisation');
select is((select count(*)::int from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_a'))), 0,
  'another tenant reads nothing of a company''s engagement');
select is((select count(*)::int from analytics.viewing_privacy_settings), 0, 'nobody reads another person''s setting');
select throws_ok($$ select pg_temp.view('user_b', 'org_b', 'tenant_b', 'company_a', 'PROFILE_VIEW', 'evt-b-0200') $$,
  '42501', null, 'a browser cannot write engagement');

-- ---------------------------------------------------------------- revoked R
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from analytics.my_company_engagement_viewers(pg_temp.rls_id('company_r'))), 0,
  'a revoked member reads nothing of their former company''s engagement');

-- ---------------------------------------------------------------- anonymous
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from analytics.engagement_events $$, '42501', null, 'anonymous reads nothing');

select * from finish();
rollback;
