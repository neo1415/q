-- CQ-REC-008 · recommendation.interaction_events and interaction_state:
-- what an investor did with a recommendation, append-only, readable by no
-- browser principal and by no founder at all.
--
--   observed behaviour ≠ declared mandate ≠ Q inference ≠ GateQ rules
--   viewing ≠ interest;  save ≠ interest;  pass ≠ poor company
--   interaction ≠ relationship state;  exposure ≠ popularity
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(30);

-- Fixtures ------------------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, current_stage_code, headquarters_country, marketplace_visibility) values
  ('00000000-0000-4000-8000-00000000aac1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Interaction Co A', 'interaction-co-a', 'seed', 'NG', 'network_visible');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000aab1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Interaction Capital B');
insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000aaa1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000aab1', 'Seed Africa', 'ACTIVE', now(), pg_temp.rls_id('user_b'));
insert into recommendation.slates
  (id, tenant_id, investor_organisation_id, mandate_id, mandate_version, mode,
   eligibility_policy_version, structured_generator_version, feature_schema_version, ranker_version, ranking_config_version)
values
  ('00000000-0000-4000-8000-00000000aae1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000aab1', '00000000-0000-4000-8000-00000000aaa1', 1,
   'INVESTOR_DISCOVER', 'eligibility.v2', 'structured-mandate.v2', 'recommendation-features.v1', 'deterministic-ranker.v1', 'ranking-config.v1');

-- Shape ------------------------------------------------------------------------------
select has_table('recommendation', 'interaction_events', 'the interaction history exists');
select has_table('recommendation', 'interaction_state', 'and its derived projection');
select is((select bool_and(relrowsecurity) from pg_class where oid in ('recommendation.interaction_events'::regclass, 'recommendation.interaction_state'::regclass)), true,
  'row level security is on for both');
select is((select count(*)::int from pg_policies where schemaname = 'recommendation' and tablename in ('interaction_events', 'interaction_state')), 0,
  'and there is no policy: server-only, who looked at whom is confidential');

-- No popularity anywhere on the company ---------------------------------------------
select is((select count(*)::int from information_schema.columns
            where table_schema = 'core' and table_name = 'companies'
              and column_name in ('impression_count', 'view_count', 'popularity_score', 'save_count')), 0,
  'exposure never becomes a counter on the company: no feedback loop by construction');

-- Recording ---------------------------------------------------------------------------
select lives_ok($$
  insert into recommendation.interaction_events
    (id, tenant_id, actor_user_id, investor_organisation_id, company_id, company_tenant_id,
     interaction_type, strength_class, interaction_version, surface,
     slate_id, slate_item_id, position, ranker_version, ranking_config_version,
     client_event_id, session_id, occurred_at)
  values
    ('00000000-0000-4000-8000-00000000ae01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),
     '00000000-0000-4000-8000-00000000aab1', '00000000-0000-4000-8000-00000000aac1', pg_temp.rls_id('tenant_a'),
     'IMPRESSION', 'ATTENTION', 'recommendation-interaction.v1', 'RECOMMENDATION_FEED',
     '00000000-0000-4000-8000-00000000aae1', '00000000-0000-4000-8000-00000000ad01', 3,
     'deterministic-ranker.v1', 'ranking-config.v1', 'evt-first-000001', 'sess-000000000001', now())
$$, 'an impression records its slate, position and ranking versions (doc 19 §69)');

select throws_ok($$
  insert into recommendation.interaction_events
    (tenant_id, actor_user_id, investor_organisation_id, company_id, company_tenant_id,
     interaction_type, strength_class, interaction_version, surface, client_event_id, occurred_at)
  values
    (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000aab1',
     '00000000-0000-4000-8000-00000000aac1', pg_temp.rls_id('tenant_a'),
     'IMPRESSION', 'ATTENTION', 'recommendation-interaction.v1', 'RECOMMENDATION_FEED', 'evt-first-000001', now())
$$, '23505', null, 'the same client event id from the same actor is refused: a retry cannot inflate exposure');

select throws_ok($$
  insert into recommendation.interaction_events
    (tenant_id, actor_user_id, investor_organisation_id, company_id, company_tenant_id,
     interaction_type, strength_class, interaction_version, surface,
     slate_id, company_tenant_id, client_event_id, session_id, occurred_at)
  values
    (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000aab1',
     '00000000-0000-4000-8000-00000000aac1', pg_temp.rls_id('tenant_a'),
     'IMPRESSION', 'ATTENTION', 'recommendation-interaction.v1', 'RECOMMENDATION_FEED',
     '00000000-0000-4000-8000-00000000aae1', pg_temp.rls_id('tenant_a'), 'evt-second-00001', 'sess-000000000001', now())
$$, '42701', null, 'a malformed insert is refused rather than half-recorded');

-- Shape constraints --------------------------------------------------------------------
select throws_ok($$
  insert into recommendation.interaction_events
    (tenant_id, actor_user_id, investor_organisation_id, company_id, company_tenant_id,
     interaction_type, strength_class, interaction_version, surface, client_event_id, occurred_at)
  values
    (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000aab1',
     '00000000-0000-4000-8000-00000000aac1', pg_temp.rls_id('tenant_a'),
     'WATCH_MILESTONE', 'ATTENTION', 'recommendation-interaction.v1', 'RECOMMENDATION_FEED', 'evt-nomile-00001', now())
$$, '23514', null, 'a watch interaction without a milestone is not a watch');

select throws_ok($$
  insert into recommendation.interaction_events
    (tenant_id, actor_user_id, investor_organisation_id, company_id, company_tenant_id,
     interaction_type, strength_class, interaction_version, surface,
     pass_reason, client_event_id, occurred_at)
  values
    (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000aab1',
     '00000000-0000-4000-8000-00000000aac1', pg_temp.rls_id('tenant_a'),
     'IMPRESSION', 'ATTENTION', 'recommendation-interaction.v1', 'RECOMMENDATION_FEED',
     'STAGE', 'evt-badreason-01', now())
$$, '23514', null, 'a pass reason belongs only to a pass');

select throws_ok($$
  insert into recommendation.interaction_events
    (tenant_id, actor_user_id, investor_organisation_id, company_id, company_tenant_id,
     interaction_type, strength_class, interaction_version, surface,
     position, client_event_id, occurred_at)
  values
    (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000aab1',
     '00000000-0000-4000-8000-00000000aac1', pg_temp.rls_id('tenant_a'),
     'PROFILE_OPEN', 'ATTENTION', 'recommendation-interaction.v1', 'COMPANY_PROFILE',
     4, 'evt-rankless-0001', now())
$$, '23514', null, 'a rank without a slate is a number nobody can interpret');

select throws_ok($$
  insert into recommendation.interaction_events
    (tenant_id, actor_user_id, investor_organisation_id, company_id, company_tenant_id,
     interaction_type, strength_class, interaction_version, surface, client_event_id, occurred_at)
  values
    (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000aab1',
     '00000000-0000-4000-8000-00000000aac1', pg_temp.rls_id('tenant_a'),
     'EXPRESS_INTEREST', 'INTENT', 'recommendation-interaction.v1', 'RECOMMENDATION_FEED', 'evt-interest-001', now())
$$, '23514', null, 'the taxonomy is closed: an invented interaction type is refused');

select throws_ok($$
  insert into recommendation.interaction_events
    (tenant_id, actor_user_id, investor_organisation_id, company_id, company_tenant_id,
     interaction_type, strength_class, interaction_version, surface, client_event_id, occurred_at)
  values
    (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000aab1',
     '00000000-0000-4000-8000-00000000aac1', pg_temp.rls_id('tenant_a'),
     'IMPRESSION', 'ATTENTION', 'recommendation-interaction.v1', 'MY_OWN_SURFACE', 'evt-surface-0001', now())
$$, '23514', null, 'and so is the surface vocabulary');

select throws_ok($$
  insert into recommendation.interaction_events
    (tenant_id, actor_user_id, investor_organisation_id, company_id, company_tenant_id,
     interaction_type, strength_class, interaction_version, surface, client_event_id, occurred_at)
  values
    (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000aab1',
     '00000000-0000-4000-8000-00000000aac1', pg_temp.rls_id('tenant_a'),
     'IMPRESSION', 'ATTENTION', 'recommendation-interaction.v1', 'RECOMMENDATION_FEED', 'short', now())
$$, '23514', null, 'a client event id is bounded: it is an identity, not a payload');

-- History is append-only -----------------------------------------------------------------
select throws_ok($$
  update recommendation.interaction_events set surface = 'SEARCH'
   where id = '00000000-0000-4000-8000-00000000ae01'
$$, '23001', null, 'an interaction is never edited');
select throws_ok($$
  delete from recommendation.interaction_events
   where id = '00000000-0000-4000-8000-00000000ae01'
$$, '23001', null, 'and never deleted: exposure keeps its sequence');

-- A slate being superseded must not erase what happened while it was current --
select throws_ok($$
  delete from recommendation.slates where id = '00000000-0000-4000-8000-00000000aae1'
$$, '23503', null, 'a slate with recorded exposure cannot be removed from under it');

-- The projection --------------------------------------------------------------------------
select lives_ok($$
  insert into recommendation.interaction_state
    (tenant_id, investor_organisation_id, company_id, company_tenant_id, saved, saved_at, last_interaction_at)
  values
    (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000aab1',
     '00000000-0000-4000-8000-00000000aac1', pg_temp.rls_id('tenant_a'), true, now(), now())
$$, 'state records that this investor saved this company');
select is((select saved from recommendation.interaction_state
            where investor_organisation_id = '00000000-0000-4000-8000-00000000aab1'), true,
  'saved means "I want to revisit this" (doc 17 §100)');
select is((select passed from recommendation.interaction_state
            where investor_organisation_id = '00000000-0000-4000-8000-00000000aab1'), false,
  'and says nothing about a pass that never happened');
select throws_ok($$
  insert into recommendation.interaction_state
    (tenant_id, investor_organisation_id, company_id, company_tenant_id, last_pass_reason)
  values
    (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000aab1',
     '00000000-0000-4000-8000-00000000aac1', pg_temp.rls_id('tenant_a'), 'BAD_COMPANY')
$$, '23514', null, 'a pass reason is bounded: no free text about somebody''s company');
select throws_ok($$
  insert into recommendation.interaction_state
    (tenant_id, investor_organisation_id, company_id, company_tenant_id, impression_count)
  values
    (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000aab1',
     '00000000-0000-4000-8000-00000000aac1', pg_temp.rls_id('tenant_a'), -1)
$$, '23514', null, 'exposure never goes negative');

-- Interaction history outlives a company row's removal -----------------------------------
select throws_ok($$
  delete from core.companies where id = '00000000-0000-4000-8000-00000000aac1'
$$, '23503', null, 'a company with interaction history is not silently removed from under it');

-- Exposure ---------------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from recommendation.interaction_events $$, '42501', null,
  'anonymous reads no interaction history');
select throws_ok($$ select * from recommendation.interaction_state $$, '42501', null,
  'nor the projection');

select pg_temp.act_as_user_b();
select throws_ok($$ select * from recommendation.interaction_events $$, '42501', null,
  'not even the investor''s own member reads their history through the database');
select throws_ok($$ select * from recommendation.interaction_state $$, '42501', null,
  'nor their own saved and passed state');

select pg_temp.act_as_user_a();
select throws_ok($$
  select * from recommendation.interaction_events
   where company_id = '00000000-0000-4000-8000-00000000aac1'
$$, '42501', null, 'and a founder of the watched company reads nothing at all: no surveillance');
select throws_ok($$
  select company_id, saved from recommendation.interaction_state
$$, '42501', null, 'not who saved them, not who passed, not when');

select pg_temp.act_as_revoked_user();
select throws_ok($$ select * from recommendation.interaction_events $$, '42501', null,
  'a revoked member reads nothing');

select * from finish();
rollback;
