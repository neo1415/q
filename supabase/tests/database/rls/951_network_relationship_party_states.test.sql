-- CRM pipeline read model (migration 20261226210000): server-only, derived
-- per-party folds of one canonical relationship, removed with it.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(16);

select ok((select relrowsecurity from pg_class where oid = 'network.relationship_party_states'::regclass), 'party states have RLS on');
select is((select count(*)::int from pg_policies where schemaname = 'network' and tablename = 'relationship_party_states'), 0, 'no client policies: server-only');
select ok(not has_table_privilege('anon', 'network.relationship_party_states', 'SELECT'), 'anonymous cannot read party states');
select ok(not has_table_privilege('authenticated', 'network.relationship_party_states', 'SELECT'), 'members read the pipeline only through the API');
select ok(not has_table_privilege('authenticated', 'network.relationship_party_states', 'INSERT'), 'no client writes a fold');
select ok(not has_table_privilege('authenticated', 'network.relationship_party_states', 'UPDATE'), 'no client changes a fold');

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Company A', 'company-a-951');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000000e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Investor B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id) values
  ('00000000-0000-4000-8000-00000000ab01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2');

create function pg_temp.insert_state(
  p_party text, p_visible boolean, p_state text, p_since timestamptz, p_next text,
  p_relationship uuid default '00000000-0000-4000-8000-00000000ab01'
) returns void language sql as $$
  insert into network.relationship_party_states
    (relationship_id, party, tenant_id, company_id, investor_organisation_id,
     visible, state, state_since, next_step, source_sequence, projector_version)
  values
    (p_relationship, p_party, pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c1',
     '00000000-0000-4000-8000-0000000000e2', p_visible, p_state, p_since, p_next, 1, 'test.v1');
$$;

select lives_ok($$select pg_temp.insert_state('INVESTOR', true, 'DISCOVERED', now(), 'EXPRESS_INTEREST')$$, 'the investor''s fold is stored');
select lives_ok($$select pg_temp.insert_state('COMPANY', false, null, null, null)$$, 'a private discovery is stored as not visible to the company');
select throws_ok($$select pg_temp.insert_state('INVESTOR', true, 'CONNECTED', now(), 'SCHEDULE_MEETING')$$, '23505', null, 'one fold per relationship and party');
select throws_ok($$select pg_temp.insert_state('PUBLIC', true, 'CONNECTED', now(), 'NONE')$$, '23514', null, 'only the two parties exist');
select throws_ok($$select pg_temp.insert_state('COMPANY', true, null, null, null, '00000000-0000-4000-8000-00000000ab09')$$, '23514', null, 'a visible fold has a state');
select throws_ok($$select pg_temp.insert_state('COMPANY', false, 'CONNECTED', now(), 'NONE', '00000000-0000-4000-8000-00000000ab09')$$, '23514', null, 'an invisible fold carries no state');
select throws_ok($$select pg_temp.insert_state('COMPANY', true, 'connected; drop', now(), 'NONE', '00000000-0000-4000-8000-00000000ab09')$$, '23514', null, 'a state is a bounded code, never free text');
select throws_ok($$select pg_temp.insert_state('COMPANY', true, 'CONNECTED', now(), 'NONE', '00000000-0000-4000-8000-00000000ab09')$$, '23503', null, 'a fold belongs to a canonical relationship');

delete from network.relationships where id = '00000000-0000-4000-8000-00000000ab01';
select is((select count(*)::int from network.relationship_party_states), 0, 'a fold goes with its relationship');

select pg_temp.act_as_user_a();
select throws_ok('select * from network.relationship_party_states', '42501', null, 'a member cannot read folds directly');
reset role;

select * from finish();
rollback;
