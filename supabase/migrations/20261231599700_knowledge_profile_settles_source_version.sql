-- Cost pass 2026-11-20 (docs/ai-handoff/audits/2026-11-20-cost-pass.md, item 3):
-- knowledge.reconcile never settled. A company whose canonical version moved
-- without changing anything the projection shows (fingerprint unchanged) kept
-- its old source_version, because the upsert below updates only on a new
-- fingerprint. It stayed "due" for ever: in production 426 of 585 companies
-- were rebuilt by every 10-minute reconcile run, each writing nothing.
--
-- The one change from 20261220181000_knowledge_projections.sql: when the
-- content is unchanged, the profile records the canonical version it was
-- reconciled against (source_version) without taking a new version and
-- without rewriting content, so readers keyed on `version` see no change.
-- Security definer, the empty search_path, the owner and the grants are as
-- before (create or replace keeps owner and ACL; the grants are restated).

create or replace function knowledge.refresh_company_profile(target_company_id uuid) returns void
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

  -- Same content, newer canonical version: reconciled, not re-projected.
  update knowledge.company_profiles
     set source_version = c.version
   where company_id = c.id and listed and fingerprint = print
     and source_version is distinct from c.version;
end;
$$;
revoke all on function knowledge.refresh_company_profile(uuid) from public, anon, authenticated;
grant execute on function knowledge.refresh_company_profile(uuid) to service_role, postgres;
