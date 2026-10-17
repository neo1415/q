-- Separate provisional heuristic, not Investability or Suitability. Server-only:
-- every API/Q/filter reader reauthorizes visibility and premium entitlement.
create table core.company_unicorn_potential_assessments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references identity.tenants(id) on delete restrict,
  organisation_id uuid not null references identity.organisations(id) on delete restrict,
  company_id uuid not null,
  method_version text not null check (length(method_version) between 1 and 100),
  revision integer not null check (revision > 0),
  basis_hash text not null check (basis_hash ~ '^[0-9a-f]{64}$'),
  cohort_key text not null check (length(cohort_key) between 1 and 2048),
  status text not null check (status in ('SCORED', 'INSUFFICIENT_EVIDENCE')),
  score smallint check (score between 0 and 100),
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 262144),
  observations jsonb not null check (jsonb_typeof(observations) in ('object', 'array') and octet_length(observations::text) <= 524288),
  assessed_at timestamptz not null default clock_timestamp(),
  unique (company_id, method_version, revision),
  foreign key (company_id, tenant_id) references core.companies(id, tenant_id) on delete restrict,
  check ((status = 'SCORED') = (score is not null)),
  check (summary ? 'methodVersion' and summary->>'methodVersion' = method_version),
  check (summary ? 'status' and summary->>'status' = status),
  check (summary ? 'overallScore' and (summary->>'overallScore')::integer is not distinct from score)
);
create index company_unicorn_potential_current_idx on core.company_unicorn_potential_assessments(company_id, method_version, revision desc);
comment on table core.company_unicorn_potential_assessments is 'Append-only Unicorn Potential v1 evidence indicator. Not a valuation probability. Premium server-authorized readers only; inputs must be investor-eligible.';

-- Company/tenant composite FK plus organisation honesty prevents a false
-- company owner even from privileged accidental writes.
create function private.company_unicorn_potential_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Unicorn Potential history is append-only' using errcode = '42501';
  end if;
  if not exists (select 1 from core.companies c where c.id = new.company_id and c.tenant_id = new.tenant_id and c.organisation_id = new.organisation_id) then
    raise exception 'Unicorn Potential subject mismatch' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function private.company_unicorn_potential_guard() from public, anon, authenticated;
create trigger company_unicorn_potential_guard before insert or update or delete on core.company_unicorn_potential_assessments for each row execute function private.company_unicorn_potential_guard();
alter table core.company_unicorn_potential_assessments enable row level security;
revoke all on core.company_unicorn_potential_assessments from public, anon, authenticated;
grant select, insert on core.company_unicorn_potential_assessments to service_role;

insert into billing.features(key, name, description, kind, unit_singular, unit_plural)
values ('intelligence.unicorn_potential', 'Unicorn Potential', 'Evidence-backed provisional growth-characteristics score and explanations; not a probability.', 'ACCESS', 'assessment', 'assessments');
-- Explicitly off for every existing default/free plan. No plan reassignment.
insert into billing.plan_features(plan_id, feature_key, included, limit_value)
select id, 'intelligence.unicorn_potential', key in ('founder_pro', 'investor_pro', 'fund'), null from billing.plans;

-- Invoker-only batch source reauthorization, never a browser score oracle.
create function private.unicorn_potential_eligible_revisions(p_candidates jsonb)
returns table(company_id uuid, revision integer)
language sql stable set search_path = '' as $eligibility$
    with candidates as (select * from jsonb_to_recordset(p_candidates)
      as r(company_id uuid, revision integer, assessed_at timestamptz, observations jsonb))
    select r.company_id, r.revision from candidates r
    join core.companies c on c.id = r.company_id and c.company_status = 'active'
    join knowledge.company_profiles p on p.company_id = c.id and p.listed
    where p.updated_at <= r.assessed_at
      and jsonb_typeof(r.observations) = 'array'
      and not exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(r.observations) = 'array' then r.observations else '[]'::jsonb end) o
        where not coalesce(case o->'source'->>'kind'
          when 'CLAIM' then exists (
            select 1 from evidence.claims q where q.id::text = o->'source'->>'id'
              and q.tenant_id = c.tenant_id and q.subject_type = 'COMPANY' and q.subject_id = c.id
              and q.visibility_scope in ('network_visible', 'public_external')
              and q.lifecycle_status <> 'SUPERSEDED'
              and q.statement = o->'source'->>'label'
              and q.truth_class = o->'source'->>'truthClass'
              and q.evidence_status = o->'source'->>'evidenceStatus'
              and q.lifecycle_status = o->'source'->>'lifecycleStatus'
              and q.asserted_at = (o->'source'->>'revision')::timestamptz)
          when 'FOUNDER_BACKGROUND' then exists (
            select 1 from core.founder_background_entries b
            join core.company_members m on m.user_id = b.user_id and m.tenant_id = b.tenant_id
            where b.id::text = o->'source'->>'id' and m.company_id = c.id and m.is_founder and m.is_current
              and b.visibility_scope = 'network_visible'
              and concat('Founder ', b.title, ' ', coalesce(b.detail, '')) = o->'source'->>'label'
              and (case when b.supporting_document_id is null then 'SELF_REPORTED' else 'DOCUMENT_SUPPORTED' end) = o->'source'->>'evidenceStatus')
          when 'DECK_SECTION' then exists (
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
              and not exists (select 1 from evidence.deck_extraction_confirmations v where v.extraction_id = x.id and v.created_at > r.assessed_at))
          else false end, false))
$eligibility$;
revoke all on function private.unicorn_potential_eligible_revisions(jsonb) from public, anon, authenticated;
grant execute on function private.unicorn_potential_eligible_revisions(jsonb) to service_role;
