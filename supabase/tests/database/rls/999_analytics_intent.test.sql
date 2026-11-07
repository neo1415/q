-- Q Workspace §8 A3 · analytics.company_intent_signals: saves, interest /
-- connection requests and data-room requests, for the company's founders, in
-- real time, with no floor, named per each investor's own level
-- (Product Specification §6.7.12-6.7.14).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(13);

insert into pg_temp.rls_fixture (label, id) values
  ('company_a', '00000000-0000-4000-8000-00000000fa01'),
  ('company_r', '00000000-0000-4000-8000-00000000fa02');
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  (pg_temp.rls_id('company_a'), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Company A', 'company-a'),
  (pg_temp.rls_id('company_r'), pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'Company R', 'company-r');

-- An investor firm with one person, a relationship with company A, and a
-- viewing level: inv<n>_user, inv<n>_org, inv<n>_io, inv<n>_tenant, inv<n>_rel.
create function pg_temp.investor(p_n integer, p_visibility text)
returns void language plpgsql as $f$
declare
  v_auth uuid := gen_random_uuid();
  v_tenant uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_io uuid := gen_random_uuid();
  v_rel uuid := gen_random_uuid();
  v_user uuid;
begin
  insert into auth.users (id, email) values (v_auth, 'intent' || p_n || '@example.invalid');
  select id into v_user from identity.user_profiles where auth_user_id = v_auth;
  insert into identity.tenants (id, name) values (v_tenant, 'Intent investor ' || p_n);
  insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
    values (v_org, v_tenant, 'investment_firm', 'Intent investor ' || p_n, 'intent-fixture-' || p_n);
  insert into identity.tenant_organisations (tenant_id, organisation_id) values (v_tenant, v_org);
  insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status, joined_at)
    values (v_tenant, v_org, v_user, 'active', now() - interval '30 days');
  insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
    values (v_io, v_tenant, v_org, 'VC', 'Intent investor ' || p_n);
  insert into network.relationships (id, tenant_id, company_id, investor_organisation_id)
    values (v_rel, pg_temp.rls_id('tenant_a'), pg_temp.rls_id('company_a'), v_io);
  if p_visibility is not null then
    insert into analytics.viewing_privacy_settings (user_id, visibility) values (v_user, p_visibility);
  end if;
  insert into pg_temp.rls_fixture (label, id) values
    ('inv' || p_n || '_user', v_user), ('inv' || p_n || '_org', v_org), ('inv' || p_n || '_io', v_io),
    ('inv' || p_n || '_tenant', v_tenant), ('inv' || p_n || '_rel', v_rel);
end;
$f$;

create function pg_temp.save(p_n integer, p_saved boolean) returns void language sql as $f$
  insert into recommendation.interaction_events
    (tenant_id, actor_user_id, investor_organisation_id, company_id, company_tenant_id,
     interaction_type, strength_class, interaction_version, surface, client_event_id, occurred_at)
  values (pg_temp.rls_id('inv' || p_n || '_tenant'), pg_temp.rls_id('inv' || p_n || '_user'),
          pg_temp.rls_id('inv' || p_n || '_io'), pg_temp.rls_id('company_a'), pg_temp.rls_id('tenant_a'),
          'SAVE', 'CONSIDERATION', 'interaction.v1', 'RECOMMENDATION_FEED', 'save-' || p_n || '-00001',
          now() - interval '1 hour');
  insert into recommendation.interaction_state
    (tenant_id, investor_organisation_id, company_id, company_tenant_id, saved, saved_at, last_interaction_at)
  values (pg_temp.rls_id('inv' || p_n || '_tenant'), pg_temp.rls_id('inv' || p_n || '_io'),
          pg_temp.rls_id('company_a'), pg_temp.rls_id('tenant_a'), p_saved,
          case when p_saved then now() end, now());
$f$;

create function pg_temp.interest(p_n integer, p_party text) returns void language sql as $f$
  insert into network.relationship_events
    (tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type,
     visibility_scope, payload, correlation_id)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('inv' || p_n || '_rel'), 1, 'interest_expressed',
          'HUMAN', case when p_party = 'COMPANY' then pg_temp.rls_id('user_a') else pg_temp.rls_id('inv' || p_n || '_user') end,
          'DISCOVER', 'relationship_shared',
          jsonb_build_object('interestId', gen_random_uuid(), 'expressedByParty', p_party),
          'cor_' || gen_random_uuid());
$f$;

-- inv1 Full, inv2 Organisation only, inv3 Anonymous, inv4 Full (unsaved
-- later), inv5 the founder reached out to them.
select pg_temp.investor(1, 'FULL_IDENTITY');
select pg_temp.investor(2, 'ORGANISATION_ONLY');
select pg_temp.investor(3, 'ANONYMOUS');
select pg_temp.investor(4, 'FULL_IDENTITY');
select pg_temp.investor(5, 'FULL_IDENTITY');

select pg_temp.save(1, true);
select pg_temp.save(2, true);
select pg_temp.save(3, true);
select pg_temp.save(4, false);
select pg_temp.interest(3, 'INVESTOR');
select pg_temp.interest(5, 'COMPANY');
-- inv1 asked, and the founder accepted: a connection, so a data-room request.
select pg_temp.interest(1, 'INVESTOR');
insert into network.relationship_events
  (tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type,
   visibility_scope, payload, correlation_id)
values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('inv1_rel'), 2, 'connection_accepted', 'HUMAN',
        pg_temp.rls_id('user_a'), 'DISCOVER', 'relationship_shared',
        jsonb_build_object('interestId', gen_random_uuid(), 'matchId', gen_random_uuid()),
        'cor_' || gen_random_uuid());
insert into evidence.data_room_access_requests
  (tenant_id, company_id, relationship_id, investor_organisation_id, requested_by_user_id, idempotency_key)
values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('company_a'), pg_temp.rls_id('inv1_rel'),
        pg_temp.rls_id('inv1_io'), pg_temp.rls_id('inv1_user'), 'intent-request-0001');

create function pg_temp.signal(p_type text, p_n integer) returns text language sql as $f$
  select coalesce(string_agg(
           visibility || '/' || case when viewer_user_id is null then 'no-person' else 'person' end
                      || '/' || case when viewer_organisation_id is null then 'no-org' else 'org' end, ','),
         'none')
    from analytics.my_company_intent_signals(pg_temp.rls_id('company_a'))
   where signal_type = p_type
     and (viewer_organisation_id = pg_temp.rls_id('inv' || p_n || '_org')
          or (viewer_organisation_id is null and p_n = 3))
$f$;

select pg_temp.act_as_user_a();
select is(pg_temp.signal('SAVE', 1), 'FULL_IDENTITY/person/org', 'a Full identity investor''s save names them');
select is(pg_temp.signal('SAVE', 2), 'ORGANISATION_ONLY/no-person/org', 'an Organisation only investor''s save shows their firm only');
select is(pg_temp.signal('SAVE', 3), 'ANONYMOUS/no-person/no-org', 'an Anonymous investor''s save is "an investor"');
select is(pg_temp.signal('INTEREST', 3), 'ORGANISATION_ONLY/no-person/org',
  'an Anonymous investor''s interest shows the firm the relationship already shows, never the person');
select is(pg_temp.signal('DATA_ROOM_REQUEST', 1), 'FULL_IDENTITY/person/org', 'a data-room request names a Full identity investor');
select is((select count(*)::int from analytics.my_company_intent_signals(pg_temp.rls_id('company_a'))
            where viewer_organisation_id = pg_temp.rls_id('inv4_org')), 0, 'a save that was undone is not a signal');
select is((select count(*)::int from analytics.my_company_intent_signals(pg_temp.rls_id('company_a'))
            where viewer_organisation_id = pg_temp.rls_id('inv5_org')), 0, 'the founder''s own request is not a signal about the investor');
select is((select count(*)::int from analytics.my_company_intent_signals(pg_temp.rls_id('company_a'))), 6,
  'intent has no floor: every signal from three firms is shown');
select ok((select bool_and(occurred_at > now() - interval '2 hours')
             from analytics.my_company_intent_signals(pg_temp.rls_id('company_a'))),
  'intent is real time: this week''s signals are shown with their time');
select throws_ok($$ select * from analytics.company_intent_signals(pg_temp.rls_id('user_a'), pg_temp.rls_id('company_a'), null) $$,
  '42501', null, 'the actor-parameter function is server-only');

select pg_temp.act_as_user_b();
select is((select count(*)::int from analytics.my_company_intent_signals(pg_temp.rls_id('company_a'))), 0,
  'another tenant reads no company''s intent');
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from analytics.my_company_intent_signals(pg_temp.rls_id('company_r'))), 0,
  'a revoked member reads nothing');
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from analytics.my_company_intent_signals(pg_temp.rls_id('company_a')) $$,
  '42501', null, 'anonymous reads nothing');

select * from finish();
rollback;
