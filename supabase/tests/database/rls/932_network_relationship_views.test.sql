begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(18);
select ok((select relrowsecurity from pg_class where oid='network.relationship_views'::regclass),'saved views require RLS');
select is((select count(*)::int from pg_policies where schemaname='network' and tablename='relationship_views'),0,'no direct client policies');
select ok(not has_table_privilege('anon','network.relationship_views','SELECT'),'anonymous cannot read views');
select ok(not has_table_privilege('authenticated','network.relationship_views','SELECT'),'members must use scoped API reads');
select ok(not has_table_privilege('authenticated','network.relationship_views','INSERT'),'members cannot bypass team writer authorization');
select ok(not has_table_privilege('authenticated','network.relationship_views','UPDATE'),'members cannot bypass ownership/version checks');
select ok(not has_table_privilege('authenticated','network.relationship_views','DELETE'),'members cannot bypass delete scope');
select ok(has_table_privilege('service_role','network.relationship_views','SELECT'),'server adapter may read');
-- A synthetic canonical company; no business records are duplicated by preferences.
insert into core.companies(id,tenant_id,organisation_id,canonical_name,slug)
values ('00000000-0000-4000-8000-0000000000d1',pg_temp.rls_id('tenant_a'),pg_temp.rls_id('org_a'),'RLS View Fixture','rls-view-fixture');
create function pg_temp.insert_view(definition jsonb, owner_user uuid default null, org uuid default null, company uuid default '00000000-0000-4000-8000-0000000000d1') returns void language sql as $$
  insert into network.relationship_views(id,tenant_id,organisation_id,company_id,owner_user_id,owner_membership_id,name,scope,definition)
  values(gen_random_uuid(),pg_temp.rls_id('tenant_a'),coalesce(org,pg_temp.rls_id('org_a')),company,coalesce(owner_user,pg_temp.rls_id('user_a')),pg_temp.rls_id('membership_a'),'View','PERSONAL',definition);
$$;
select lives_ok($$select pg_temp.insert_view('{"query":{},"layout":"table","columns":[]}')$$,'valid canonical-party preference is accepted');
select throws_ok($$select pg_temp.insert_view('{"query":{},"layout":"table","columns":[]}',null,pg_temp.rls_id('org_b'))$$,'23503',null,'foreign organization cannot pair with tenant');
select throws_ok($$select pg_temp.insert_view('{"query":{},"layout":"table","columns":[]}',pg_temp.rls_id('user_b'))$$,'23503',null,'owner must match the exact current membership');
select throws_ok($$select pg_temp.insert_view('{"query":{},"layout":"table","columns":[]}',null,null,null)$$,'23514',null,'view requires exactly one canonical party');
select throws_ok($$select pg_temp.insert_view('{"query":{"cursor":"stale"},"layout":"table","columns":[]}')$$,'23514',null,'cursor cannot become persisted scope');
select throws_ok($$select pg_temp.insert_view('{"query":{},"layout":"table","columns":[],"notes":"private"}')$$,'23514',null,'notes cannot enter preference storage');
select throws_ok($$select pg_temp.insert_view('{"query":{},"layout":null,"columns":[]}')$$,'23514',null,'null presentation cannot pass SQL unknown checks');
select pg_temp.act_as_user_a();
select throws_ok('select * from network.relationship_views','42501',null,'active member cannot bypass canonical scope');
select pg_temp.act_as_user_b();
select throws_ok('select * from network.relationship_views','42501',null,'foreign tenant cannot read saved views directly');
select pg_temp.act_as_revoked_user();
select throws_ok('select * from network.relationship_views','42501',null,'revoked member cannot read saved views');
reset role;
select * from finish();
rollback;
