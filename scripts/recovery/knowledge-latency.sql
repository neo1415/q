-- Recovery K: before/after latency of "three fintech companies" and
-- "mandate summary", on the LOCAL database only, inside a transaction that
-- is rolled back (nothing is left behind). Synthetic, obviously fictional
-- rows: 50,000 companies across sectors and countries.
--
--   psql "$LOCAL_DB_URL" -f scripts/recovery/knowledge-latency.sql
\timing off
begin;

insert into identity.tenants (id, name) values ('00000000-0000-4000-8000-00000000e001', 'K latency tenant');
insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
values ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000e001', 'company', 'K latency org', 'k-latency-org');
insert into identity.tenant_organisations (tenant_id, organisation_id)
values ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000e002');

-- 50,000 companies, a third listed; sectors and countries spread.
with sectors as (
  select array_agg(n.id order by n.canonical_code) as ids
    from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
   where v.code = 'industry' and n.depth = 1
), countries as (
  select array['NG', 'KE', 'GH', 'ZA', 'EG', 'GB', 'US', 'BR'] as codes
)
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, headquarters_country,
                            current_stage_code, short_description, marketplace_visibility)
select ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid,
       '00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000e002',
       'Synthetic ' || g, 'k-syn-' || g,
       (select codes[1 + g % 8] from countries),
       (array['pre_seed', 'seed', 'series_a', 'series_b'])[1 + g % 4],
       'Synthetic company ' || g,
       case when g % 3 = 0 then 'network_visible' else 'organisation_private' end
  from generate_series(1, 50000) g;

insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
select '00000000-0000-4000-8000-00000000e001', 'COMPANY',
       ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid,
       (select ids[1 + g % array_length(ids, 1)] from (
          select array_agg(n.id order by n.canonical_code) as ids
            from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
           where v.code = 'industry' and n.depth = 1) s),
       'user_selected'
  from generate_series(1, 50000) g;

analyze knowledge.company_profiles;
analyze core.companies;
analyze taxonomy.entity_assignments;

\echo '== BEFORE: three fintech companies in Nigeria, computed from the canonical tables per request'
explain (analyze, buffers, costs off, summary on)
with recursive fintech as (
  select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
   where v.code = 'industry' and n.canonical_code = 'fintech'
  union
  select c.id from taxonomy.nodes c join fintech f on c.parent_node_id = f.id
)
select c.id, c.canonical_name, c.short_description
  from core.companies c
 where c.marketplace_visibility in ('network_visible', 'public_external')
   and c.company_status = 'active'
   and c.headquarters_country = 'NG'
   and exists (select 1 from taxonomy.entity_assignments a
                where a.entity_type = 'COMPANY' and a.entity_id = c.id and a.tenant_id = c.tenant_id
                  and a.status = 'ACTIVE' and a.valid_to is null
                  and (a.assignment_source in ('user_selected', 'admin_curated') or a.confirmed_at is not null)
                  and a.node_id in (select id from fintech))
 order by c.canonical_name
 limit 3;

\echo '== AFTER: the same from knowledge.company_profiles'
explain (analyze, buffers, costs off, summary on)
select p.company_id, p.canonical_name, p.short_description
  from knowledge.company_profiles p
 where p.listed and p.discovery_eligible
   and p.sector_codes && array['fintech']
   and p.geography_codes && array['nigeria']
 order by p.canonical_name, p.company_id
 limit 3;

\echo '== BEFORE: mandate summary, assembled from the mandate, its preferences and constraints'
explain (analyze, buffers, costs off, summary on)
select m.id, m.name, m.version, m.min_cheque, m.max_cheque, m.currency_code,
       (select array_agg(n.canonical_code) from taxonomy.mandate_preferences p
          join taxonomy.nodes n on n.id = p.node_id
         where p.mandate_id = m.id and p.tenant_id = m.tenant_id) as sectors,
       (select count(*) from core.investor_mandate_constraints k
         where k.mandate_id = m.id and k.tenant_id = m.tenant_id and k.is_hard_exclusion) as hard
  from core.investor_mandates m
 where m.status = 'ACTIVE'
 order by m.updated_at desc
 limit 1;

\echo '== AFTER: mandate summary from knowledge.mandate_summaries'
explain (analyze, buffers, costs off, summary on)
select s.mandate_id, s.name, s.mandate_version, s.sector_codes, s.min_cheque, s.max_cheque, s.version
  from knowledge.mandate_summaries s
 where s.status = 'ACTIVE'
 order by s.updated_at desc
 limit 1;

\echo '== p50 over 25 runs each (ms): before, after'
do $$
declare
  t0 timestamptz;
  before_ms double precision[] := '{}';
  after_ms double precision[] := '{}';
  i int;
begin
  for i in 1..25 loop
    t0 := clock_timestamp();
    perform c.id from core.companies c
     where c.marketplace_visibility in ('network_visible', 'public_external')
       and c.company_status = 'active' and c.headquarters_country = 'NG'
       and exists (select 1 from taxonomy.entity_assignments a
                    where a.entity_type = 'COMPANY' and a.entity_id = c.id and a.tenant_id = c.tenant_id
                      and a.status = 'ACTIVE' and a.valid_to is null
                      and (a.assignment_source in ('user_selected', 'admin_curated') or a.confirmed_at is not null)
                      and a.node_id in (
                        with recursive f as (
                          select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
                           where v.code = 'industry' and n.canonical_code = 'fintech'
                          union select c2.id from taxonomy.nodes c2 join f on c2.parent_node_id = f.id)
                        select id from f))
     order by c.canonical_name limit 3;
    before_ms := before_ms || extract(epoch from clock_timestamp() - t0) * 1000;
    t0 := clock_timestamp();
    perform p.company_id from knowledge.company_profiles p
     where p.listed and p.discovery_eligible
       and p.sector_codes && array['fintech'] and p.geography_codes && array['nigeria']
     order by p.canonical_name, p.company_id limit 3;
    after_ms := after_ms || extract(epoch from clock_timestamp() - t0) * 1000;
  end loop;
  raise notice 'three fintech: before p50 % ms, after p50 % ms',
    round((select percentile_cont(0.5) within group (order by x) from unnest(before_ms) x)::numeric, 2),
    round((select percentile_cont(0.5) within group (order by x) from unnest(after_ms) x)::numeric, 2);
end;
$$;

rollback;
