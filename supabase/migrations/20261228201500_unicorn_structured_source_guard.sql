-- Fix forward: canonical structured claims use immutable revision UUIDs.
-- Historical authorization preserves the audit trail, never withdrawn visibility.
create function private.unicorn_potential_source_eligible_revisions(p_candidates jsonb, p_historical boolean)
returns table(company_id uuid, revision integer)
language sql stable set search_path = '' as $eligibility$
    with candidates as (select * from jsonb_to_recordset(p_candidates)
      as r(company_id uuid, revision integer, assessed_at timestamptz, observations jsonb))
    select r.company_id, r.revision from candidates r
    join core.companies c on c.id = r.company_id and c.company_status = 'active'
    join knowledge.company_profiles p on p.company_id = c.id and p.listed
    where (p_historical or p.updated_at <= r.assessed_at)
      and jsonb_typeof(r.observations) = 'array'
      and not exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(r.observations) = 'array' then r.observations else '[]'::jsonb end) o
        where not coalesce(case o->'source'->>'kind'
          when 'CLAIM' then exists (
            select 1 from evidence.claims q where q.id::text = o->'source'->>'id'
              and q.tenant_id = c.tenant_id and q.subject_type = 'COMPANY' and q.subject_id = c.id
              and q.visibility_scope in ('network_visible', 'public_external')
              and case when p_historical then exists (
                select 1 from evidence.claim_revisions old
                where old.claim_id = q.id and old.tenant_id = q.tenant_id
                  and old.statement = o->'source'->>'label'
                  and old.truth_class = o->'source'->>'truthClass'
                  and old.evidence_status = o->'source'->>'evidenceStatus'
                  and old.lifecycle_status = o->'source'->>'lifecycleStatus'
                  and case when (o->'source'->>'revision') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    then old.id::text = lower(o->'source'->>'revision')
                    else pg_catalog.pg_input_is_valid(o->'source'->>'revision', 'timestamp with time zone') end)
              else q.lifecycle_status <> 'SUPERSEDED'
                and (q.valid_from is null or q.valid_from <= pg_catalog.now())
                and (q.valid_to is null or q.valid_to > pg_catalog.now())
                and q.statement = o->'source'->>'label'
                and q.truth_class = o->'source'->>'truthClass'
                and q.evidence_status = o->'source'->>'evidenceStatus'
                and q.lifecycle_status = o->'source'->>'lifecycleStatus'
                and case when (o->'source'->>'revision') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then q.current_revision_id::text = lower(o->'source'->>'revision')
                  when pg_catalog.pg_input_is_valid(o->'source'->>'revision', 'timestamp with time zone')
                  then q.asserted_at = (o->'source'->>'revision')::timestamptz
                  else false end
              end)
          when 'FOUNDER_BACKGROUND' then exists (
            select 1 from core.founder_background_entries b
            join core.company_members m on m.user_id = b.user_id and m.tenant_id = b.tenant_id
            where b.id::text = o->'source'->>'id' and m.company_id = c.id and m.is_founder and (p_historical or m.is_current)
              and b.visibility_scope = 'network_visible'
              and (p_historical or concat('Founder ', b.title, ' ', coalesce(b.detail, '')) = o->'source'->>'label')
              and (p_historical or (case when b.supporting_document_id is null then 'SELF_REPORTED' else 'DOCUMENT_SUPPORTED' end) = o->'source'->>'evidenceStatus'))
          when 'DECK_SECTION' then case when p_historical then exists (
            select 1 from evidence.deck_extractions old
            join evidence.documents d on d.id = old.document_id and d.company_id = c.id and d.tenant_id = c.tenant_id
            join evidence.document_versions v on v.id = old.document_version_id and v.tenant_id = d.tenant_id
            join evidence.document_versions current_v on current_v.id = d.current_version_id and current_v.tenant_id = d.tenant_id
            left join evidence.data_room_entries e on e.document_id = d.id
            where old.id::text = split_part(o->'source'->>'id', ':', 1)
              and old.company_id = c.id and old.tenant_id = c.tenant_id
              and d.owner_kind = 'ORGANISATION' and d.document_type = 'PITCH_DECK' and d.status = 'ACTIVE'
              and v.malware_scan_status <> 'BLOCKED' and current_v.malware_scan_status <> 'BLOCKED'
              and (e.level = 'PUBLIC' or d.download_audience = 'INVESTORS'))
            else exists (
            select 1 from lateral (
              select d.id, d.current_version_id, d.download_audience, e.level
              from evidence.documents d
              join evidence.document_versions v on v.id = d.current_version_id and v.tenant_id = d.tenant_id
              left join evidence.data_room_entries e on e.document_id = d.id
              where d.company_id = c.id and d.tenant_id = c.tenant_id and d.owner_kind = 'ORGANISATION'
                and d.document_type = 'PITCH_DECK' and d.status = 'ACTIVE' and v.malware_scan_status <> 'BLOCKED'
              order by d.updated_at desc, d.id limit 1
            ) d
            join lateral (select x.id from evidence.deck_extractions x where x.document_version_id = d.current_version_id
              order by x.prompt_version desc, x.reading_number desc, x.created_at desc limit 1) x on true
            where x.id::text = split_part(o->'source'->>'id', ':', 1)
              and (d.level = 'PUBLIC' or d.download_audience = 'INVESTORS')
              and not exists (select 1 from evidence.deck_section_reviews v where v.extraction_id = x.id and v.created_at > r.assessed_at)
              and not exists (select 1 from evidence.deck_extraction_confirmations v where v.extraction_id = x.id and v.created_at > r.assessed_at)) end
          else false end, false))
$eligibility$;

revoke all on function private.unicorn_potential_source_eligible_revisions(jsonb, boolean) from public, anon, authenticated;
grant execute on function private.unicorn_potential_source_eligible_revisions(jsonb, boolean) to service_role;

create or replace function private.unicorn_potential_eligible_revisions(p_candidates jsonb)
returns table(company_id uuid, revision integer)
language sql stable set search_path = '' as $$
  select * from private.unicorn_potential_source_eligible_revisions(p_candidates, false)
$$;
revoke all on function private.unicorn_potential_eligible_revisions(jsonb) from public, anon, authenticated;
grant execute on function private.unicorn_potential_eligible_revisions(jsonb) to service_role;

create function private.unicorn_potential_historical_revisions(p_candidates jsonb)
returns table(company_id uuid, revision integer)
language sql stable set search_path = '' as $$
  select * from private.unicorn_potential_source_eligible_revisions(p_candidates, true)
$$;
revoke all on function private.unicorn_potential_historical_revisions(jsonb) from public, anon, authenticated;
grant execute on function private.unicorn_potential_historical_revisions(jsonb) to service_role;
