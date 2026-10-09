-- RECOVERY K Part 11: Tier B projections (workstream D) never hold
-- founder-private content. A projection is read to answer investors fast;
-- anything founder-private in it is one missing filter away from an
-- investor (CLAUDE.md: founder-private information must never silently
-- shape investor-facing output).
--
-- Contract for D (docs/recovery/specs/K-security.md §4): every Tier B
-- projection table carries `[K Tier B]` in its table comment. This suite
-- finds them all through the catalog, so a new projection is covered the
-- moment it exists, and fails if any of them
--   * has a column for founder-private financials or notes, or
--   * holds a row whose visibility is narrower than investor-visible.
-- Until D's tables land it checks the detector itself against a planted
-- projection, so it is never vacuous.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

create function pg_temp.k_projection_violations()
returns setof text
language plpgsql
as $$
declare
  t record;
  bad bigint;
  vis text;
begin
  for t in
    select n.nspname as s, c.relname as r
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p', 'm', 'v')
       and coalesce(obj_description(c.oid, 'pg_class'), '') like '%[K Tier B]%'
  loop
    -- Columns that could only carry founder-private material.
    return query
      select format('%I.%I has a founder-private column %I', t.s, t.r, a.attname)
        from pg_attribute a
       where a.attrelid = format('%I.%I', t.s, t.r)::regclass
         and a.attnum > 0 and not a.attisdropped
         and a.attname ~* '(cash|burn|runway|payroll|salary|bank_|private_note|founder_private)';
    -- Rows narrower than investor-visible.
    foreach vis in array array['visibility_scope', 'source_visibility', 'visibility'] loop
      if exists (select 1 from pg_attribute a
                  where a.attrelid = format('%I.%I', t.s, t.r)::regclass
                    and a.attname = vis and not a.attisdropped) then
        execute format(
          'select count(*) from %I.%I where %I in (''founder_private'', ''personal_private'', ''organisation_private'', ''investor_private'')',
          t.s, t.r, vis) into bad;
        if bad > 0 then
          return next format('%I.%I holds %s founder- or owner-private row(s) by %I', t.s, t.r, bad, vis);
        end if;
      end if;
    end loop;
  end loop;
end;
$$;

-- The real projections ---------------------------------------------------------------
select is(
  (select coalesce(array_agg(v order by v), '{}') from pg_temp.k_projection_violations() v),
  '{}'::text[],
  'no Tier B projection has a founder-private column or row');

-- How many real projections were checked, for the record.
select diag('Tier B projections found: ' || (select count(*) from pg_class c
  where coalesce(obj_description(c.oid, 'pg_class'), '') like '%[K Tier B]%'));

-- The detector has teeth -----------------------------------------------------------------
create table pg_temp.k_planted_projection (
  company_id uuid,
  summary text,
  runway_months numeric,
  visibility_scope text
);
comment on table pg_temp.k_planted_projection is 'Planted for 905 [K Tier B]';
insert into pg_temp.k_planted_projection values
  (gen_random_uuid(), 'Network-visible summary', null, 'network_visible'),
  (gen_random_uuid(), 'Seven months of runway', 7, 'founder_private');

select ok(
  exists (select 1 from pg_temp.k_projection_violations() v
           where v like '%has a founder-private column runway_months'),
  'a planted runway column is caught');
select ok(
  exists (select 1 from pg_temp.k_projection_violations() v where v like '%holds 1 founder- or owner-private row%'),
  'a planted founder_private row is caught');

delete from pg_temp.k_planted_projection where visibility_scope = 'founder_private';
alter table pg_temp.k_planted_projection drop column runway_months;
select is(
  (select coalesce(array_agg(v), '{}') from pg_temp.k_projection_violations() v),
  '{}'::text[],
  'a clean projection passes');

select * from finish();
rollback;
