-- Investability and Suitability (owner request 2026-10-16; packages/readiness
-- src/investability, @capital-q/contracts company-scores.ts).
--
-- Two derived projections, kept apart (Readiness ≠ Business Quality ≠ Fit):
--
--   core.company_investability_assessments  FDN InvestIQ v1 over the
--     company's INVESTOR-ELIGIBLE information only (listed profile,
--     network-visible claims and founder lines, confirmed deck sections
--     offered to all investors, verification). One value per company, the
--     same for every investor. Append-only revisions: a new row only when
--     the basis (method + input rules + observations) changes.
--   core.investor_company_suitability  the fit with ONE investor's mandate
--     as a 0-100 score, written by the slate build (the ranking input it
--     used). Investor-private: only that investor organisation's members.
--
-- Context Firewall: neither table holds founder-private material. The
-- founder's readiness diagnosis (core.company_readiness_assessments) is
-- never read by either. RLS:
--   investability  members of the company's own organisation, and any
--                  active Capital Q participant for a company listed to
--                  the network now (the same visibility as its listed
--                  profile, knowledge.company_profiles)
--   suitability    members of the investor organisation it belongs to
-- Only the server writes; no client write grant or policy.

create table core.company_investability_assessments (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references identity.tenants (id) on delete restrict,
  company_id           uuid not null,
  -- The company's own organisation, for the owner's read.
  organisation_id      uuid not null,
  method_version       text not null check (method_version ~ '^[a-z][a-z0-9-]*/v[0-9]+(\+[a-z][a-z0-9.-]*)?$' and length(method_version) <= 80),
  revision             integer not null check (revision >= 1),
  basis_hash           text not null check (basis_hash ~ '^[0-9a-f]{64}$'),
  -- NO_MATERIAL (ADR 0075): nothing investor-visible to read yet.
  status               text not null check (status in ('SCORED', 'INSUFFICIENT_EVIDENCE', 'NO_MATERIAL')),
  -- 0-100 integer (InvestIQ 0-4 × 25); only when scored. Never a default.
  score                smallint check (score between 0 and 100),
  band                 text check (band in ('STRONG', 'INVESTABLE', 'DEVELOPING', 'EARLY')),
  confidence           text check (confidence in ('HIGH', 'MODERATE', 'LOW')),
  areas_scored         smallint not null check (areas_scored >= 0),
  areas_total          smallint not null check (areas_total >= 0 and areas_scored <= areas_total),
  criteria_scored      smallint not null check (criteria_scored >= 0),
  criteria_applicable  smallint not null check (criteria_applicable >= 0 and criteria_scored <= criteria_applicable),
  -- The investor's view (contracts InvestabilityDto without its timestamp).
  summary              jsonb not null check (jsonb_typeof(summary) = 'object' and length(summary::text) <= 16384),
  -- The full InvestIQ v1 assessment and observations: reproducible, traced.
  assessment           jsonb not null check (jsonb_typeof(assessment) = 'object' and length(assessment::text) <= 262144),
  assessed_at          timestamptz not null default clock_timestamp(),
  unique (company_id, method_version, revision),
  check ((status = 'SCORED') = (score is not null)),
  check ((status = 'SCORED') = (band is not null)),
  check ((status = 'SCORED') = (confidence is not null)),
  foreign key (company_id, tenant_id) references core.companies (id, tenant_id) on delete restrict
);

comment on table core.company_investability_assessments is
  'Investor-facing Investability (FDN InvestIQ v1) revisions, computed only from investor-eligible information. Append-only; derived; never founder-private.';

create index company_investability_current_idx
  on core.company_investability_assessments (company_id, method_version, revision desc);
create index company_investability_tenant_idx
  on core.company_investability_assessments (tenant_id, company_id);

create function private.company_investability_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'investability history is append-only; record a new revision instead'
    using errcode = '42501';
end
$$;

revoke all on function private.company_investability_append_only() from public, anon, authenticated;

create trigger company_investability_assessments_append_only
  before update or delete on core.company_investability_assessments
  for each row execute function private.company_investability_append_only();

create table core.investor_company_suitability (
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  investor_organisation_id  uuid not null references core.investor_organisations (id) on delete cascade,
  -- The investor's identity organisation, for the members' read.
  organisation_id           uuid not null,
  mandate_id                uuid not null references core.investor_mandates (id) on delete cascade,
  company_id                uuid not null references core.companies (id) on delete cascade,
  fit_config_version        text not null check (length(fit_config_version) between 1 and 64),
  status                    text not null check (status in ('SCORED', 'NOT_ENOUGH_INFORMATION', 'OUTSIDE_MANDATE')),
  score                     smallint check (score between 0 and 100),
  known                     smallint not null check (known >= 0),
  applicable                smallint not null check (applicable >= 0 and known <= applicable),
  -- The investor's view (contracts SuitabilityDto).
  summary                   jsonb not null check (jsonb_typeof(summary) = 'object' and length(summary::text) <= 16384),
  computed_at               timestamptz not null,
  primary key (investor_organisation_id, mandate_id, company_id),
  check ((status = 'SCORED') = (score is not null))
);

comment on table core.investor_company_suitability is
  'Investor-private Suitability (fit with this investor''s mandate, 0-100) as used by the latest slate build. Derived, rebuildable; the slate keeps the history.';

create index investor_company_suitability_org_idx
  on core.investor_company_suitability (organisation_id, company_id);

alter table core.company_investability_assessments enable row level security;
alter table core.investor_company_suitability enable row level security;

-- The owner's members, or any active participant while the company is
-- listed (knowledge.company_profiles enforces "listed" for participants).
create policy company_investability_select on core.company_investability_assessments
  for select to authenticated
  using (
    (select private.is_organisation_member(organisation_id))
    or ((select private.is_network_participant())
        and exists (
          select 1 from knowledge.company_profiles p
           where p.company_id = core.company_investability_assessments.company_id
             and p.listed))
  );

create policy investor_company_suitability_own_select on core.investor_company_suitability
  for select to authenticated
  using ((select private.is_organisation_member(organisation_id)));

revoke all on core.company_investability_assessments, core.investor_company_suitability
  from public, anon, authenticated;
grant select on core.company_investability_assessments, core.investor_company_suitability
  to authenticated;
