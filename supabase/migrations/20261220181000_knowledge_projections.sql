-- RECOVERY-2026-10 · workstream K (Tier B, prepared business knowledge),
-- owned by D. Fix-forward; local first; the lead applies it to hosted.
--
-- Q should never re-discover stable business facts. Three read models in
-- the existing Postgres, kept current from the canonical tables in the
-- same transaction as every change (triggers), with a reconciliation
-- function for anything missed, and a monotonic version per row that the
-- Tier A working snapshot compares before reusing a cached fact:
--
--   knowledge.company_profiles   one row per company ever listed to the
--                                network. Only what Discover may show.
--   knowledge.mandate_summaries  one row per investor mandate (the
--                                investor's own, investor_private).
--   knowledge.fit_summaries      one row per mandate: its current slate and
--                                eligible count (the investor's own).
--
-- Visibility (ADR-001; the Context Firewall invariant): a company row is
-- LISTED only while the company's marketplace_visibility is
-- network_visible or public_external. It holds only the network projection's
-- declared fields (packages/companies network-projection.ts) and DECLARED
-- taxonomy (user-selected, admin-curated or confirmed -- never an
-- unconfirmed Q inference, which may come from founder-private material).
-- The capital objective is organisation-internal (discovery features:
-- "no discovery-safe raise projection exists"), so the raise is NOT here.
-- A company that stops being listed keeps a tombstone (id, version,
-- listed = false, every content column null) so a cached fact is known to
-- be stale; nobody but the server reads tombstones.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the package port checks the viewer).

create schema if not exists knowledge;
revoke all on schema knowledge from public, anon;
grant usage on schema knowledge to authenticated, service_role, postgres;

-- One version source: every change anywhere gets a larger number.
create sequence knowledge.version_seq;
revoke all on sequence knowledge.version_seq from public, anon, authenticated;

-- Any active member of any tenant: a Capital Q participant (network_visible
-- is for authenticated participants, ADR-001). Revoked members are not.
create function private.is_network_participant() returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from identity.organisation_memberships m
     where m.membership_status = 'active'
       and m.user_id = (select private.current_app_user_id())
  )
$$;
revoke all on function private.is_network_participant() from public, anon;
grant execute on function private.is_network_participant() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Company profiles
-- ---------------------------------------------------------------------------

create table knowledge.company_profiles (
  company_id            uuid primary key references core.companies (id) on delete cascade,
  company_tenant_id     uuid not null,
  -- Listed to the network now. False: a tombstone, every field below null.
  listed                boolean not null,
  visibility            text check (visibility is null or visibility in ('network_visible', 'public_external')),
  canonical_name        text,
  short_description     text,
  primary_description   text check (primary_description is null or length(primary_description) <= 4000),
  website_url           text,
  country_code          text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  city                  text,
  -- Taxonomy canonical codes. Sector: declared industry nodes and their
  -- ancestors; subsector: the declared nodes below the top level.
  sector_codes          text[] not null default '{}',
  subsector_codes       text[] not null default '{}',
  -- The country's geography node and its ancestors (west_africa, africa).
  geography_codes       text[] not null default '{}',
  business_model_codes  text[] not null default '{}',
  stage_code            text,
  company_status        text,
  -- Global discovery eligibility (listed and active). Per-viewer rules --
  -- disclosure, relationships, passes, mandate exclusions -- stay the
  -- discovery engine's.
  discovery_eligible    boolean not null default false,
  pitch_media_present   boolean not null default false,
  -- Separate axes (ADR-001): verification is the organisation claim's
  -- workflow; every profile fact is self-reported until evidence says more.
  verification_status   text not null default 'UNVERIFIED'
                          check (verification_status in ('VERIFIED', 'UNVERIFIED')),
  evidence_status       text not null default 'SELF_REPORTED'
                          check (evidence_status in ('NO_EVIDENCE', 'SELF_REPORTED')),
  source_version        integer,
  source                text not null default 'core.companies+taxonomy.entity_assignments+media.media_assets+evidence.verification_claims',
  fingerprint           text not null,
  version               bigint not null,
  updated_at            timestamptz not null default clock_timestamp(),
  constraint company_profiles_tombstone_check
    check (listed or (canonical_name is null and short_description is null
                      and primary_description is null and website_url is null
                      and country_code is null and city is null and stage_code is null
                      and visibility is null and cardinality(sector_codes) = 0
                      and cardinality(subsector_codes) = 0
                      and cardinality(geography_codes) = 0
                      and cardinality(business_model_codes) = 0
                      and not discovery_eligible and not pitch_media_present)),
  constraint company_profiles_listed_check
    check (not listed or (visibility is not null and canonical_name is not null))
);

-- DISCOVER_COMPANIES: sector X, geography Y, stage, eligible, N rows.
create index company_profiles_sectors_gin
  on knowledge.company_profiles using gin (sector_codes) where listed and discovery_eligible;
create index company_profiles_geography_gin
  on knowledge.company_profiles using gin (geography_codes) where listed and discovery_eligible;
create index company_profiles_stage_idx
  on knowledge.company_profiles (stage_code, canonical_name) where listed and discovery_eligible;
create index company_profiles_country_idx
  on knowledge.company_profiles (country_code, canonical_name) where listed and discovery_eligible;
create index company_profiles_version_idx
  on knowledge.company_profiles (version);

-- The projection of one company, from the canonical tables. Upserts the
-- row only when its content changed (fingerprint), so versions move only
-- on a real change; a company no longer listed becomes a tombstone.
create function knowledge.refresh_company_profile(target_company_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  is_listed boolean;
  sectors text[];
  subsectors text[];
  geos text[];
  models text[];
  pitch boolean;
  verified boolean;
  print text;
begin
  select * into c from core.companies where id = target_company_id;
  if not found then
    delete from knowledge.company_profiles where company_id = target_company_id;
    return;
  end if;
  is_listed := c.marketplace_visibility in ('network_visible', 'public_external');
  if not is_listed then
    if exists (select 1 from knowledge.company_profiles where company_id = c.id and listed) then
      update knowledge.company_profiles
         set listed = false, visibility = null, canonical_name = null,
             short_description = null, primary_description = null, website_url = null,
             country_code = null, city = null, sector_codes = '{}', subsector_codes = '{}',
             geography_codes = '{}', business_model_codes = '{}', stage_code = null,
             company_status = null, discovery_eligible = false, pitch_media_present = false,
             verification_status = 'UNVERIFIED', source_version = c.version,
             fingerprint = 'unlisted', version = nextval('knowledge.version_seq'),
             updated_at = clock_timestamp()
       where company_id = c.id;
    end if;
    return;
  end if;

  -- Declared taxonomy only (never an unconfirmed Q inference).
  with recursive declared as (
    select n.id, n.parent_node_id, n.canonical_code, n.depth, v.code as vocab
      from taxonomy.entity_assignments a
      join taxonomy.nodes n on n.id = a.node_id
      join taxonomy.vocabularies v on v.id = n.vocabulary_id
     where a.entity_type = 'COMPANY' and a.entity_id = c.id and a.tenant_id = c.tenant_id
       and a.status = 'ACTIVE' and a.valid_to is null
       and (a.assignment_source in ('user_selected', 'admin_curated') or a.confirmed_at is not null)
  ), lineage as (
    select id, parent_node_id, canonical_code, vocab from declared where vocab = 'industry'
    union
    select p.id, p.parent_node_id, p.canonical_code, l.vocab
      from lineage l join taxonomy.nodes p on p.id = l.parent_node_id
  )
  select coalesce((select array_agg(distinct canonical_code order by canonical_code) from lineage), '{}'),
         coalesce((select array_agg(distinct canonical_code order by canonical_code)
                     from declared where vocab = 'industry' and depth > 0), '{}'),
         coalesce((select array_agg(distinct canonical_code order by canonical_code)
                     from declared where vocab = 'business_model'), '{}')
    into sectors, subsectors, models;

  -- The declared country's geography node and its ancestors.
  with recursive country as (
    select n.id, n.parent_node_id, n.canonical_code
      from taxonomy.nodes n
      join taxonomy.vocabularies v on v.id = n.vocabulary_id
     where v.code = 'geography' and n.metadata ->> 'iso3166Alpha2' = c.headquarters_country
  ), up as (
    select id, parent_node_id, canonical_code from country
    union
    select p.id, p.parent_node_id, p.canonical_code from up u join taxonomy.nodes p on p.id = u.parent_node_id
  )
  select coalesce(array_agg(distinct canonical_code order by canonical_code), '{}') into geos from up;

  -- A pitch video investors may watch: ready, not removed, not blocked.
  select exists (
    select 1 from media.media_assets m
     where m.owner_type = 'COMPANY' and m.owner_id = c.id and m.tenant_id = c.tenant_id
       and m.purpose = 'FOUNDER_PITCH' and m.status = 'READY'
       and m.deleted_at is null and m.superseded_at is null
       and m.moderation_status <> 'BLOCKED'
  ) into pitch;

  -- The organisation claim's latest decision is VERIFIED.
  select coalesce((
    select v.status = 'VERIFIED'
      from evidence.verification_claims v
     where v.claim_type = 'ORGANISATION' and v.subject_type = 'ORGANISATION'
       and v.subject_id = c.organisation_id and v.status <> 'PENDING'
     order by v.decided_at desc nulls last, v.revision desc
     limit 1), false) into verified;

  print := md5(concat_ws('|', c.marketplace_visibility, c.canonical_name, c.short_description,
                         left(c.primary_description, 4000), c.website_url, c.headquarters_country,
                         c.headquarters_city, c.current_stage_code, c.company_status,
                         array_to_string(sectors, ','), array_to_string(subsectors, ','),
                         array_to_string(geos, ','), array_to_string(models, ','),
                         pitch::text, verified::text));

  insert into knowledge.company_profiles as p
    (company_id, company_tenant_id, listed, visibility, canonical_name, short_description,
     primary_description, website_url, country_code, city, sector_codes, subsector_codes,
     geography_codes, business_model_codes, stage_code, company_status, discovery_eligible,
     pitch_media_present, verification_status, evidence_status, source_version, fingerprint,
     version, updated_at)
  values
    (c.id, c.tenant_id, true, c.marketplace_visibility, c.canonical_name, c.short_description,
     left(c.primary_description, 4000), c.website_url, c.headquarters_country, c.headquarters_city,
     sectors, subsectors, geos, models, c.current_stage_code, c.company_status,
     c.company_status = 'active', pitch, case when verified then 'VERIFIED' else 'UNVERIFIED' end,
     'SELF_REPORTED', c.version, print, nextval('knowledge.version_seq'), clock_timestamp())
  on conflict (company_id) do update
    set company_tenant_id = excluded.company_tenant_id, listed = true,
        visibility = excluded.visibility, canonical_name = excluded.canonical_name,
        short_description = excluded.short_description,
        primary_description = excluded.primary_description, website_url = excluded.website_url,
        country_code = excluded.country_code, city = excluded.city,
        sector_codes = excluded.sector_codes, subsector_codes = excluded.subsector_codes,
        geography_codes = excluded.geography_codes,
        business_model_codes = excluded.business_model_codes, stage_code = excluded.stage_code,
        company_status = excluded.company_status, discovery_eligible = excluded.discovery_eligible,
        pitch_media_present = excluded.pitch_media_present,
        verification_status = excluded.verification_status,
        source_version = excluded.source_version, fingerprint = excluded.fingerprint,
        version = excluded.version, updated_at = excluded.updated_at
    where p.fingerprint is distinct from excluded.fingerprint;
end;
$$;
revoke all on function knowledge.refresh_company_profile(uuid) from public, anon, authenticated;
grant execute on function knowledge.refresh_company_profile(uuid) to service_role, postgres;

-- ---------------------------------------------------------------------------
-- Mandate and fit summaries (the investor's own)
-- ---------------------------------------------------------------------------

create table knowledge.mandate_summaries (
  mandate_id               uuid primary key references core.investor_mandates (id) on delete cascade,
  tenant_id                uuid not null,
  investor_organisation_id uuid not null,
  name                     text not null,
  status                   text not null,
  discovery_mode           text,
  -- The canonical mandate's own version: "mandate v7".
  mandate_version          integer not null,
  sector_codes             text[] not null default '{}',
  excluded_sector_codes    text[] not null default '{}',
  geography_codes          text[] not null default '{}',
  min_stage_code           text,
  max_stage_code           text,
  -- Money: numeric plus ISO currency, never float.
  min_cheque               numeric,
  max_cheque               numeric,
  currency_code            text,
  hard_exclusions          integer not null default 0,
  fingerprint              text not null,
  version                  bigint not null,
  updated_at               timestamptz not null default clock_timestamp()
);
create index mandate_summaries_owner_idx
  on knowledge.mandate_summaries (tenant_id, investor_organisation_id, status);

create table knowledge.fit_summaries (
  mandate_id               uuid primary key references core.investor_mandates (id) on delete cascade,
  tenant_id                uuid not null,
  investor_organisation_id uuid not null,
  mandate_version          integer not null,
  -- The current published slate for this mandate version, when there is one.
  slate_id                 uuid,
  slate_generated_at       timestamptz,
  slate_item_count         integer not null default 0,
  -- Ranked company ids of that slate (at most 25), in rank order.
  top_company_ids          uuid[] not null default '{}',
  -- CURRENT feature snapshots for this mandate version marked ELIGIBLE.
  eligible_count           integer not null default 0,
  fingerprint              text not null,
  version                  bigint not null,
  updated_at               timestamptz not null default clock_timestamp()
);
create index fit_summaries_owner_idx
  on knowledge.fit_summaries (tenant_id, investor_organisation_id);

create function knowledge.refresh_mandate_summary(target_mandate_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  sectors text[];
  excluded text[];
  geos text[];
  hard integer;
  print text;
begin
  select * into m from core.investor_mandates where id = target_mandate_id;
  if not found then
    delete from knowledge.mandate_summaries where mandate_id = target_mandate_id;
    return;
  end if;
  select coalesce(array_agg(distinct n.canonical_code order by n.canonical_code)
                    filter (where v.code = 'industry' and not p.is_exclusion), '{}'),
         coalesce(array_agg(distinct n.canonical_code order by n.canonical_code)
                    filter (where v.code = 'industry' and p.is_exclusion), '{}'),
         coalesce(array_agg(distinct n.canonical_code order by n.canonical_code)
                    filter (where v.code = 'geography' and not p.is_exclusion), '{}')
    into sectors, excluded, geos
    from taxonomy.mandate_preferences p
    join taxonomy.nodes n on n.id = p.node_id
    join taxonomy.vocabularies v on v.id = n.vocabulary_id
   where p.mandate_id = m.id and p.tenant_id = m.tenant_id;
  select count(*)::int into hard from core.investor_mandate_constraints k
   where k.mandate_id = m.id and k.tenant_id = m.tenant_id and k.is_hard_exclusion;
  print := md5(concat_ws('|', m.name, m.status, m.discovery_mode, m.version::text,
                         array_to_string(sectors, ','), array_to_string(excluded, ','),
                         array_to_string(geos, ','), m.min_stage_code, m.max_stage_code,
                         m.min_cheque::text, m.max_cheque::text, m.currency_code, hard::text));
  insert into knowledge.mandate_summaries as s
    (mandate_id, tenant_id, investor_organisation_id, name, status, discovery_mode,
     mandate_version, sector_codes, excluded_sector_codes, geography_codes, min_stage_code,
     max_stage_code, min_cheque, max_cheque, currency_code, hard_exclusions, fingerprint,
     version, updated_at)
  values
    (m.id, m.tenant_id, m.investor_organisation_id, m.name, m.status, m.discovery_mode,
     m.version, sectors, excluded, geos, m.min_stage_code, m.max_stage_code, m.min_cheque,
     m.max_cheque, m.currency_code, hard, print, nextval('knowledge.version_seq'),
     clock_timestamp())
  on conflict (mandate_id) do update
    set name = excluded.name, status = excluded.status,
        discovery_mode = excluded.discovery_mode, mandate_version = excluded.mandate_version,
        sector_codes = excluded.sector_codes, excluded_sector_codes = excluded.excluded_sector_codes,
        geography_codes = excluded.geography_codes, min_stage_code = excluded.min_stage_code,
        max_stage_code = excluded.max_stage_code, min_cheque = excluded.min_cheque,
        max_cheque = excluded.max_cheque, currency_code = excluded.currency_code,
        hard_exclusions = excluded.hard_exclusions, fingerprint = excluded.fingerprint,
        version = excluded.version, updated_at = excluded.updated_at
    where s.fingerprint is distinct from excluded.fingerprint;
  perform knowledge.refresh_fit_summary(m.id);
end;
$$;

create function knowledge.refresh_fit_summary(target_mandate_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  slate record;
  top uuid[];
  eligible integer;
  print text;
begin
  select id, tenant_id, investor_organisation_id, version into m
    from core.investor_mandates where id = target_mandate_id;
  if not found then
    delete from knowledge.fit_summaries where mandate_id = target_mandate_id;
    return;
  end if;
  select s.id, s.generated_at, s.item_count into slate
    from recommendation.slates s
   where s.mandate_id = m.id and s.tenant_id = m.tenant_id and s.mandate_version = m.version
     and s.status = 'CURRENT'
   order by s.generated_at desc
   limit 1;
  if slate.id is not null then
    select coalesce(array_agg(i.company_id order by i.rank), '{}') into top
      from (select company_id, rank from recommendation.slate_items
             where slate_id = slate.id and tenant_id = m.tenant_id
             order by rank limit 25) i;
  else
    top := '{}';
  end if;
  select count(*)::int into eligible from recommendation.feature_snapshots f
   where f.mandate_id = m.id and f.tenant_id = m.tenant_id and f.mandate_version = m.version
     and f.status = 'CURRENT' and f.eligibility_decision = 'ELIGIBLE';
  print := md5(concat_ws('|', m.version::text, slate.id::text, coalesce(slate.item_count, 0)::text,
                         array_to_string(top, ','), eligible::text));
  insert into knowledge.fit_summaries as f
    (mandate_id, tenant_id, investor_organisation_id, mandate_version, slate_id,
     slate_generated_at, slate_item_count, top_company_ids, eligible_count, fingerprint,
     version, updated_at)
  values
    (m.id, m.tenant_id, m.investor_organisation_id, m.version, slate.id, slate.generated_at,
     coalesce(slate.item_count, 0), top, eligible, print, nextval('knowledge.version_seq'),
     clock_timestamp())
  on conflict (mandate_id) do update
    set mandate_version = excluded.mandate_version, slate_id = excluded.slate_id,
        slate_generated_at = excluded.slate_generated_at,
        slate_item_count = excluded.slate_item_count, top_company_ids = excluded.top_company_ids,
        eligible_count = excluded.eligible_count, fingerprint = excluded.fingerprint,
        version = excluded.version, updated_at = excluded.updated_at
    where f.fingerprint is distinct from excluded.fingerprint;
end;
$$;
revoke all on function knowledge.refresh_mandate_summary(uuid) from public, anon, authenticated;
revoke all on function knowledge.refresh_fit_summary(uuid) from public, anon, authenticated;
grant execute on function knowledge.refresh_mandate_summary(uuid) to service_role, postgres;
grant execute on function knowledge.refresh_fit_summary(uuid) to service_role, postgres;

-- ---------------------------------------------------------------------------
-- Change propagation: every change to a source refreshes in its own
-- transaction (no window in which a stale fact is served).
-- ---------------------------------------------------------------------------

create function knowledge.on_company_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform knowledge.refresh_company_profile(coalesce(new.id, old.id));
  return null;
end;
$$;
create trigger knowledge_company_profile
  after insert or update or delete on core.companies
  for each row execute function knowledge.on_company_change();

create function knowledge.on_company_assignment_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row_entity_type text := coalesce(new.entity_type, old.entity_type);
begin
  if row_entity_type = 'COMPANY' then
    perform knowledge.refresh_company_profile(coalesce(new.entity_id, old.entity_id));
  end if;
  return null;
end;
$$;
create trigger knowledge_company_assignment
  after insert or update or delete on taxonomy.entity_assignments
  for each row execute function knowledge.on_company_assignment_change();

create function knowledge.on_company_media_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform knowledge.refresh_company_profile(coalesce(new.owner_id, old.owner_id));
  return null;
end;
$$;
create trigger knowledge_company_media
  after insert or update or delete on media.media_assets
  for each row execute function knowledge.on_company_media_change();

create function knowledge.on_verification_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  subject uuid := coalesce(new.subject_id, old.subject_id);
  company uuid;
begin
  if coalesce(new.claim_type, old.claim_type) = 'ORGANISATION' and subject is not null then
    for company in select id from core.companies where organisation_id = subject loop
      perform knowledge.refresh_company_profile(company);
    end loop;
  end if;
  return null;
end;
$$;
create trigger knowledge_company_verification
  after insert or update or delete on evidence.verification_claims
  for each row execute function knowledge.on_verification_change();

create function knowledge.on_mandate_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform knowledge.refresh_mandate_summary(coalesce(new.id, old.id));
  return null;
end;
$$;
create trigger knowledge_mandate
  after insert or update or delete on core.investor_mandates
  for each row execute function knowledge.on_mandate_change();

create function knowledge.on_mandate_part_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform knowledge.refresh_mandate_summary(coalesce(new.mandate_id, old.mandate_id));
  return null;
end;
$$;
create trigger knowledge_mandate_preferences
  after insert or update or delete on taxonomy.mandate_preferences
  for each row execute function knowledge.on_mandate_part_change();
create trigger knowledge_mandate_constraints
  after insert or update or delete on core.investor_mandate_constraints
  for each row execute function knowledge.on_mandate_part_change();

-- Slates and snapshots arrive in batches: once per statement, per mandate.
create function knowledge.on_slate_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target uuid;
begin
  for target in select distinct mandate_id from changed loop
    perform knowledge.refresh_fit_summary(target);
  end loop;
  return null;
end;
$$;
create trigger knowledge_fit_slates_insert
  after insert on recommendation.slates
  referencing new table as changed
  for each statement execute function knowledge.on_slate_change();
create trigger knowledge_fit_slates_update
  after update on recommendation.slates
  referencing new table as changed
  for each statement execute function knowledge.on_slate_change();
create trigger knowledge_fit_snapshots_insert
  after insert on recommendation.feature_snapshots
  referencing new table as changed
  for each statement execute function knowledge.on_slate_change();
create trigger knowledge_fit_snapshots_update
  after update on recommendation.feature_snapshots
  referencing new table as changed
  for each statement execute function knowledge.on_slate_change();

revoke all on function knowledge.on_company_change() from public, anon, authenticated;
revoke all on function knowledge.on_company_assignment_change() from public, anon, authenticated;
revoke all on function knowledge.on_company_media_change() from public, anon, authenticated;
revoke all on function knowledge.on_verification_change() from public, anon, authenticated;
revoke all on function knowledge.on_mandate_change() from public, anon, authenticated;
revoke all on function knowledge.on_mandate_part_change() from public, anon, authenticated;
revoke all on function knowledge.on_slate_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reconciliation (missed changes, a projection rule that changed): refresh
-- what is missing, stale or out of step. Idempotent; versions move only on
-- a real change. Returns how many subjects were refreshed.
-- ---------------------------------------------------------------------------

create function knowledge.reconcile(batch integer default 500) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  touched integer := 0;
begin
  -- Companies: listed but missing, or whose canonical row moved on.
  for target in
    select c.id from core.companies c
      left join knowledge.company_profiles p on p.company_id = c.id
     where (c.marketplace_visibility in ('network_visible', 'public_external')
            and (p.company_id is null or not p.listed or p.source_version is distinct from c.version))
        or (p.listed and c.marketplace_visibility not in ('network_visible', 'public_external'))
     limit batch
  loop
    perform knowledge.refresh_company_profile(target);
    touched := touched + 1;
  end loop;
  -- Mandates: missing, or whose canonical version moved on.
  for target in
    select m.id from core.investor_mandates m
      left join knowledge.mandate_summaries s on s.mandate_id = m.id
      left join knowledge.fit_summaries f on f.mandate_id = m.id
     where s.mandate_id is null or s.mandate_version <> m.version
        or f.mandate_id is null or f.mandate_version <> m.version
     limit batch
  loop
    perform knowledge.refresh_mandate_summary(target);
    touched := touched + 1;
  end loop;
  return touched;
end;
$$;
revoke all on function knowledge.reconcile(integer) from public, anon, authenticated;
grant execute on function knowledge.reconcile(integer) to service_role, postgres;

-- Backfill.
do $$
begin
  perform knowledge.refresh_company_profile(id) from core.companies;
  perform knowledge.refresh_mandate_summary(id) from core.investor_mandates;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table knowledge.company_profiles enable row level security;
alter table knowledge.company_profiles force row level security;
alter table knowledge.mandate_summaries enable row level security;
alter table knowledge.mandate_summaries force row level security;
alter table knowledge.fit_summaries enable row level security;
alter table knowledge.fit_summaries force row level security;

-- Any active participant reads the listed companies; tombstones are the
-- server's only.
create policy company_profiles_select_listed on knowledge.company_profiles
  for select to authenticated
  using (listed and (select private.is_network_participant()));
-- The investor's own mandate and fit summaries only.
create policy mandate_summaries_select_own on knowledge.mandate_summaries
  for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));
create policy fit_summaries_select_own on knowledge.fit_summaries
  for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));

revoke all on knowledge.company_profiles, knowledge.mandate_summaries, knowledge.fit_summaries
  from public, anon, authenticated;
grant select on knowledge.company_profiles, knowledge.mandate_summaries, knowledge.fit_summaries
  to authenticated;
-- Writes only through the refresh functions (and the server role).
grant select, insert, update, delete
  on knowledge.company_profiles, knowledge.mandate_summaries, knowledge.fit_summaries
  to postgres, service_role;
grant usage on sequence knowledge.version_seq to postgres, service_role;

comment on table knowledge.company_profiles is
  'Recovery K (Tier B): the network-visible knowledge of each listed company, versioned; never founder-private fields, never the capital objective.';
comment on table knowledge.mandate_summaries is
  'Recovery K (Tier B): each investor mandate, summarised and versioned; investor_private.';
comment on table knowledge.fit_summaries is
  'Recovery K (Tier B): each mandate''s current slate and eligible count, versioned; investor_private.';
