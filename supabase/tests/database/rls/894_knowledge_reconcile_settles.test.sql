-- Cost pass 2026-11-20 · knowledge.reconcile settles.
--
-- A canonical version that moves without changing anything the projection
-- shows is recorded as reconciled (source_version) without a new projection
-- version; a real change still re-projects and moves the version; and a
-- reconciled company is no longer due, so the next reconcile run skips it.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(9);

-- The function keeps its security and grants.
select ok(
  (select prosecdef and proconfig = array['search_path=""']
     from pg_proc where oid = 'knowledge.refresh_company_profile(uuid)'::regprocedure),
  'refresh_company_profile is still security definer with an empty search_path');
select ok(
  not has_function_privilege('authenticated', 'knowledge.refresh_company_profile(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'knowledge.refresh_company_profile(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'knowledge.refresh_company_profile(uuid)', 'EXECUTE'),
  'and only the server may run it');

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, headquarters_country,
                            current_stage_code, short_description, marketplace_visibility)
values ('00000000-0000-4000-8000-00000000d201', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
        'Settle Co', 'settle-co-k', 'NG', 'seed', 'Settles.', 'network_visible');

create temporary table k_seen (label text primary key, version bigint, fingerprint text)
  on commit drop;
insert into k_seen select 'before', version, fingerprint from knowledge.company_profiles
 where company_id = '00000000-0000-4000-8000-00000000d201';

-- The production case: the canonical version moves, the projected content does not.
update core.companies set version = version + 1, slug = 'settle-co-k2'
 where id = '00000000-0000-4000-8000-00000000d201';
select is(
  (select source_version from knowledge.company_profiles
    where company_id = '00000000-0000-4000-8000-00000000d201'),
  (select version from core.companies where id = '00000000-0000-4000-8000-00000000d201'),
  'an unchanged fingerprint records the canonical version it was reconciled against');
select ok(
  (select p.version = s.version and p.fingerprint = s.fingerprint
     from knowledge.company_profiles p, k_seen s
    where p.company_id = '00000000-0000-4000-8000-00000000d201' and s.label = 'before'),
  'without taking a new projection version or changing its content');

-- A profile left behind (as production's 426 were), then reconciled directly.
update knowledge.company_profiles set source_version = source_version - 1
 where company_id = '00000000-0000-4000-8000-00000000d201';
select knowledge.refresh_company_profile('00000000-0000-4000-8000-00000000d201');
select ok(
  (select p.source_version = c.version and p.version = s.version
     from knowledge.company_profiles p
     join core.companies c on c.id = p.company_id, k_seen s
    where p.company_id = '00000000-0000-4000-8000-00000000d201' and s.label = 'before'),
  'a stale profile settles on refresh, its version unchanged');

-- A real change still re-projects and moves the version.
update core.companies set version = version + 1, short_description = 'Settles, and changes.'
 where id = '00000000-0000-4000-8000-00000000d201';
select ok(
  (select p.version > s.version and p.fingerprint <> s.fingerprint
          and p.short_description = 'Settles, and changes.' and p.source_version = c.version
     from knowledge.company_profiles p
     join core.companies c on c.id = p.company_id, k_seen s
    where p.company_id = '00000000-0000-4000-8000-00000000d201' and s.label = 'before'),
  'a changed fingerprint still re-projects and moves the version');

-- Reconcile: stale again, one run settles it, the next finds it not due.
update knowledge.company_profiles set source_version = source_version - 1
 where company_id = '00000000-0000-4000-8000-00000000d201';
insert into k_seen select 'stale', version, fingerprint from knowledge.company_profiles
 where company_id = '00000000-0000-4000-8000-00000000d201';
select cmp_ok(knowledge.reconcile(5000), '>=', 1, 'the first reconcile run refreshes the stale profile');
select is(knowledge.reconcile(5000), 0, 'a second run finds nothing due');
select ok(
  (select p.version = s.version
     from knowledge.company_profiles p, k_seen s
    where p.company_id = '00000000-0000-4000-8000-00000000d201' and s.label = 'stale'),
  'and reconciling an unchanged profile never moved its version');

select * from finish();
rollback;
