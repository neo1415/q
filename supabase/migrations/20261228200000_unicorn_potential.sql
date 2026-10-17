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
select id, 'intelligence.unicorn_potential', key in ('investor_pro', 'fund'), null from billing.plans;
