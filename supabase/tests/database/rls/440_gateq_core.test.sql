-- CQ-GATE-001 · gateq.gateways, gateway_versions and gateway_criteria: an
-- investor organisation's published inbound policy, readable by no browser
-- principal and never rewritten once published.
--
--   gateway mode ≠ qualification outcome ≠ access decision
--   GateQ published policy ≠ investor mandate
--   qualified ≠ good company ≠ investment-ready ≠ recommended
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(28);

-- Fixtures ------------------------------------------------------------------------
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000bb01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Gateway Capital B');

insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000bb11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000bb01', pg_temp.rls_id('org_b'),
   'gq_0123456789abcdefghjkmnpqrs', 'Seed programme', pg_temp.rls_id('user_b'));

insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version, created_by_user_id)
values
  ('00000000-0000-4000-8000-00000000bb21', '00000000-0000-4000-8000-00000000bb11', pg_temp.rls_id('tenant_b'), 1,
   'DRAFT', 'QUALIFIED', 'Seed-stage fintech', 'gateq-qualification.v1', pg_temp.rls_id('user_b'));

insert into gateq.gateway_criteria (id, version_id, tenant_id, position, requiredness, criterion_type, label, config) values
  ('00000000-0000-4000-8000-00000000bb31', '00000000-0000-4000-8000-00000000bb21', pg_temp.rls_id('tenant_b'), 1,
   'REQUIRED', 'GEOGRAPHY', 'Where you are', '{"type":"GEOGRAPHY","allowedCountries":["NG"]}'::jsonb);

-- Shape ------------------------------------------------------------------------------
select has_table('gateq', 'gateways', 'the gateway exists');
select has_table('gateq', 'gateway_versions', 'and its versions');
select has_table('gateq', 'gateway_criteria', 'and their criteria');

select is((select bool_and(relrowsecurity) from pg_class
            where oid in ('gateq.gateways'::regclass, 'gateq.gateway_versions'::regclass, 'gateq.gateway_criteria'::regclass)), true,
  'row level security is on for all three');
select is((select count(*)::int from pg_policies where schemaname = 'gateq'), 0,
  'and there is no policy: which sectors an investor will look at is commercially sensitive');

-- No browser principal reaches the tables; the public sees one controlled
-- projection through the API instead.
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'gateq' and grantee in ('anon', 'authenticated')), 0,
  'neither anon nor authenticated holds any grant on a gateq table');

-- Public identifiers -----------------------------------------------------------------
select col_is_unique('gateq', 'gateways', 'public_id', 'the public handle is unique');
select throws_ok($$
  insert into gateq.gateways (tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000bb01', pg_temp.rls_id('org_b'), 'gateway-1', 'Guessable', pg_temp.rls_id('user_b'))
$$, '23514', null, 'a structured or guessable public id is refused');

-- One published version at a time -----------------------------------------------------
select lives_ok($$
  update gateq.gateway_versions
     set status = 'PUBLISHED', published_at = now(), published_by_user_id = pg_temp.rls_id('user_b')
   where id = '00000000-0000-4000-8000-00000000bb21'
$$, 'a draft can be published');

insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version, created_by_user_id)
values
  ('00000000-0000-4000-8000-00000000bb22', '00000000-0000-4000-8000-00000000bb11', pg_temp.rls_id('tenant_b'), 2,
   'DRAFT', 'OPEN', 'Now open', 'gateq-qualification.v1', pg_temp.rls_id('user_b'));

select throws_ok($$
  update gateq.gateway_versions
     set status = 'PUBLISHED', published_at = now(), published_by_user_id = pg_temp.rls_id('user_b')
   where id = '00000000-0000-4000-8000-00000000bb22'
$$, '23505', null, 'a second published version is refused by the database, not by whoever writes the publish path next');

select is((select count(*)::int from gateq.gateway_versions
            where gateway_id = '00000000-0000-4000-8000-00000000bb11' and status = 'PUBLISHED'), 1,
  'exactly one version is published');

-- A published version is history -----------------------------------------------------
select throws_ok($$
  update gateq.gateway_versions set inbound_mode = 'OPEN'
   where id = '00000000-0000-4000-8000-00000000bb21'
$$, '23001', null, 'the policy a published version carried cannot be changed');

select throws_ok($$
  update gateq.gateway_versions set public_title = 'Rewritten'
   where id = '00000000-0000-4000-8000-00000000bb21'
$$, '23001', null, 'nor its public wording');

select throws_ok($$
  delete from gateq.gateway_versions where id = '00000000-0000-4000-8000-00000000bb21'
$$, '23001', null, 'and a published version is never deleted');

select lives_ok($$
  update gateq.gateway_versions set status = 'ARCHIVED' where id = '00000000-0000-4000-8000-00000000bb21'
$$, 'but its lifecycle may still move forward, keeping the publication time a stored result names');

select throws_ok($$
  update gateq.gateway_versions set status = 'PUBLISHED' where id = '00000000-0000-4000-8000-00000000bb21'
$$, '23001', null, 'an archived version is never republished');

-- Criteria belong to the version they were published with -----------------------------
select lives_ok($$
  update gateq.gateway_versions
     set status = 'PUBLISHED', published_at = now(), published_by_user_id = pg_temp.rls_id('user_b')
   where id = '00000000-0000-4000-8000-00000000bb22'
$$, 'the second draft can now be published');

select throws_ok($$
  update gateq.gateway_criteria set label = 'Rewritten' where id = '00000000-0000-4000-8000-00000000bb31'
$$, '23001', null, 'a criterion of a published version cannot be edited: somebody was already judged against it');

select throws_ok($$
  delete from gateq.gateway_criteria where id = '00000000-0000-4000-8000-00000000bb31'
$$, '23001', null, 'nor deleted');

-- A fresh draft, so the payload rules are exercised where writing is allowed.
insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version, created_by_user_id)
values
  ('00000000-0000-4000-8000-00000000bb23', '00000000-0000-4000-8000-00000000bb11', pg_temp.rls_id('tenant_b'), 3,
   'DRAFT', 'QUALIFIED', 'Next draft', 'gateq-qualification.v1', pg_temp.rls_id('user_b'));

select lives_ok($$
  insert into gateq.gateway_criteria (version_id, tenant_id, position, requiredness, criterion_type, label, config)
  values ('00000000-0000-4000-8000-00000000bb23', pg_temp.rls_id('tenant_b'), 1, 'PREFERRED', 'STAGE', 'Stage',
          '{"type":"STAGE","allowedStageCodes":["seed"]}'::jsonb)
$$, 'a draft criterion is writable while its version is a draft');

-- The payload is bounded and discriminated --------------------------------------------
select throws_ok($$
  insert into gateq.gateway_criteria (version_id, tenant_id, position, requiredness, criterion_type, label, config)
  values ('00000000-0000-4000-8000-00000000bb23', pg_temp.rls_id('tenant_b'), 9, 'REQUIRED', 'GEOGRAPHY', 'Mismatched',
          '{"type":"STAGE","allowedStageCodes":["seed"]}'::jsonb)
$$, '23514', null, 'a row cannot claim to be one kind of rule and hold another');

select throws_ok($$
  insert into gateq.gateway_criteria (version_id, tenant_id, position, requiredness, criterion_type, label, config)
  values ('00000000-0000-4000-8000-00000000bb23', pg_temp.rls_id('tenant_b'), 10, 'REQUIRED', 'GEOGRAPHY', 'Untyped',
          '[]'::jsonb)
$$, '23514', null, 'and arbitrary JSON is not a criterion');

select throws_ok($$
  insert into gateq.gateway_criteria (version_id, tenant_id, position, requiredness, criterion_type, label, config)
  values ('00000000-0000-4000-8000-00000000bb23', pg_temp.rls_id('tenant_b'), 11, 'REQUIRED', 'REVENUE', 'Revenue',
          '{"type":"REVENUE"}'::jsonb)
$$, '23514', null, 'a dimension Capital Q cannot evaluate is not configurable at all');

-- Capabilities --------------------------------------------------------------------------
select is((select count(*)::int from permissions.capabilities
            where code in ('investor.gateway.create', 'investor.gateway.view',
                           'investor.gateway.edit', 'investor.gateway.publish')), 4,
  'the four gateway capabilities exist');

select is((select count(*)::int
             from permissions.role_capabilities rc
             join permissions.roles r on r.id = rc.role_id
             join permissions.capabilities c on c.id = rc.capability_id
            where r.code = 'organisation_member' and c.code = 'investor.gateway.publish'), 0,
  'an ordinary member cannot publish: publishing changes who may approach the organisation');

select is((select count(*)::int
             from permissions.role_capabilities rc
             join permissions.roles r on r.id = rc.role_id
             join permissions.capabilities c on c.id = rc.capability_id
            where r.code = 'organisation_member' and c.code = 'investor.gateway.view'), 1,
  'but may read the policy');

-- GateQ owns no other context's data ------------------------------------------------
select is((select count(*)::int from information_schema.columns
            where table_schema = 'gateq'
              and column_name in ('mandate_id', 'min_cheque', 'max_cheque', 'revenue', 'readiness_score', 'rank_score')), 0,
  'no mandate column, no score column: GateQ policy is not the investor mandate and is not a ranker');

select is((select count(*)::int from information_schema.tables where table_schema = 'gateq'
            and table_name in ('gateways', 'gateway_versions', 'gateway_criteria')), 3,
  'the gateway is three tables: identity, versions, criteria');

select * from finish();
rollback;
