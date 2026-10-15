-- CRM saved views (migration 20261226200000): server-only presentation
-- preferences for one canonical party of the owner's own organisation.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(22);

select ok((select relrowsecurity from pg_class where oid = 'network.relationship_views'::regclass), 'saved views have RLS on');
select is((select count(*)::int from pg_policies where schemaname = 'network' and tablename = 'relationship_views'), 0, 'no client policies: server-only');
select ok(not has_table_privilege('anon', 'network.relationship_views', 'SELECT'), 'anonymous cannot read views');
select ok(not has_table_privilege('authenticated', 'network.relationship_views', 'SELECT'), 'members read only through the scoped API');
select ok(not has_table_privilege('authenticated', 'network.relationship_views', 'INSERT'), 'members cannot bypass the team-writer check');
select ok(not has_table_privilege('authenticated', 'network.relationship_views', 'UPDATE'), 'members cannot bypass compare-and-swap');
select ok(not has_table_privilege('authenticated', 'network.relationship_views', 'DELETE'), 'members cannot bypass delete scope');

-- Synthetic canonical companies: one in org A, one in org B (tenant B).
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000000d1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'RLS View Fixture A', 'rls-view-fixture-a'),
  ('00000000-0000-4000-8000-0000000000d2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'RLS View Fixture B', 'rls-view-fixture-b');

create function pg_temp.insert_view(
  p_definition jsonb,
  p_owner uuid default null,
  p_company uuid default '00000000-0000-4000-8000-0000000000d1',
  p_name text default 'View',
  p_investor uuid default null
) returns void language sql as $$
  insert into network.relationship_views
    (id, tenant_id, organisation_id, company_id, investor_organisation_id, owner_user_id, owner_membership_id, name, scope, definition)
  values
    (gen_random_uuid(), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), p_company, p_investor,
     coalesce(p_owner, pg_temp.rls_id('user_a')), pg_temp.rls_id('membership_a'), p_name, 'PERSONAL', p_definition);
$$;

select lives_ok($$select pg_temp.insert_view('{"query":{"state":"CONNECTED"},"layout":"table","columns":["state"]}')$$, 'a party-owned preference is accepted');
select throws_ok($$select pg_temp.insert_view('{"query":{},"layout":"table","columns":[]}', null, '00000000-0000-4000-8000-0000000000d2')$$, '23503', null, 'another organisation''s company cannot be a view''s party');
select throws_ok($$select pg_temp.insert_view('{"query":{},"layout":"table","columns":[]}', pg_temp.rls_id('user_b'))$$, '23503', null, 'the owner must hold this exact membership');
select throws_ok($$select pg_temp.insert_view('{"query":{},"layout":"table","columns":[]}', null, null)$$, '23514', null, 'a view needs one canonical party');
select throws_ok($$select pg_temp.insert_view('{"query":{},"layout":"table","columns":[]}', null, '00000000-0000-4000-8000-0000000000d1', 'View', '00000000-0000-4000-8000-0000000000d3')$$, '23514', null, 'a view cannot name two parties');
select throws_ok($$select pg_temp.insert_view('{"query":{"cursor":"stale"},"layout":"table","columns":[]}')$$, '23514', null, 'a cursor never becomes stored scope');
select throws_ok($$select pg_temp.insert_view('{"query":{},"layout":"table","columns":[],"selected":["x"]}')$$, '23514', null, 'a selection never enters a view');
select throws_ok($$select pg_temp.insert_view('{"query":{},"layout":"table","columns":[],"notes":"private"}')$$, '23514', null, 'notes never enter preference storage');
select throws_ok($$select pg_temp.insert_view('{"query":{},"layout":null,"columns":[]}')$$, '23514', null, 'a null layout fails rather than passing as unknown');
select throws_ok($$select pg_temp.insert_view('{"query":{},"layout":"table","columns":[1,2,3,4,5,6,7,8,9]}')$$, '23514', null, 'columns are bounded');
select throws_ok($$select pg_temp.insert_view('{"query":{},"layout":"table","columns":[]}', null, '00000000-0000-4000-8000-0000000000d1', '   ')$$, '23514', null, 'a blank name is refused');

select pg_temp.act_as_user_a();
select throws_ok('select * from network.relationship_views', '42501', null, 'the owner too reads only through the API');
select pg_temp.act_as_user_b();
select throws_ok('select * from network.relationship_views', '42501', null, 'another tenant cannot read views');
select pg_temp.act_as_revoked_user();
select throws_ok('select * from network.relationship_views', '42501', null, 'a revoked member cannot read views');
reset role;
select pg_temp.reset_test_identity();
select is((select count(*)::int from network.relationship_views), 1, 'only the valid view was stored');

select * from finish();
rollback;
