-- CQ-NET-012 · the relationship state projection's bookkeeping.
--
-- current_state is a cache of a deterministic fold over the history. The
-- cache records how far it folded and under which projector version, can
-- never claim history that does not exist, and no browser principal may
-- write it -- from either side of the relationship.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can write the cache.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(11);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000003c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Projection Co A', 'projection-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000003e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Projection Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, last_event_sequence) values
  ('00000000-0000-4000-8000-000000003b01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000003c1', '00000000-0000-4000-8000-0000000003e2', 2);

select is((select projected_sequence from network.relationships where id = '00000000-0000-4000-8000-000000003b01'), 0::bigint,
  'a new relationship has folded nothing yet');
select is((select projector_version from network.relationships where id = '00000000-0000-4000-8000-000000003b01'), 'none',
  'and names no projector');
select ok((select projected_at is null from network.relationships where id = '00000000-0000-4000-8000-000000003b01'),
  'and has no projection time');

select lives_ok(
  $$ update network.relationships
        set current_state = 'INTEREST_EXPRESSED', projected_sequence = 2,
            projector_version = 'relationship-state.v1', projected_at = now()
      where id = '00000000-0000-4000-8000-000000003b01' $$,
  'the server may cache a fold of the history it has');
select throws_ok(
  $$ update network.relationships set projected_sequence = 3 where id = '00000000-0000-4000-8000-000000003b01' $$,
  '23514', null, 'a fold can never claim history that does not exist');
select throws_ok(
  $$ update network.relationships set projected_sequence = -1 where id = '00000000-0000-4000-8000-000000003b01' $$,
  '23514', null, 'a fold cannot reach a negative sequence');
select throws_ok(
  $$ update network.relationships set projector_version = 'Relationship State v1!' where id = '00000000-0000-4000-8000-000000003b01' $$,
  '23514', null, 'projector versions are bounded identifiers');

select pg_temp.act_as_user_a();
select throws_ok(
  $$ update network.relationships set current_state = 'CONNECTED' where id = '00000000-0000-4000-8000-000000003b01' $$,
  '42501', null, 'the company side cannot set a state');
select pg_temp.act_as_user_b();
select throws_ok(
  $$ update network.relationships set projected_sequence = 0 where id = '00000000-0000-4000-8000-000000003b01' $$,
  '42501', null, 'the investor side cannot rewind a projection');
select pg_temp.act_as_service_role();
select throws_ok(
  $$ select current_state from network.relationships $$,
  '42501', null, 'service_role: no grant on the projection');

select pg_temp.act_as_privileged();
select is((select current_state from network.relationships where id = '00000000-0000-4000-8000-000000003b01'), 'INTEREST_EXPRESSED',
  'privileged: the cached state is what the server wrote');

select * from finish();

rollback;
