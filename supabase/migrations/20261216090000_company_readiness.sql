-- The founder's readiness (Q.03 / Q.04; packages/readiness).
--
-- Two append-only tables, both founder-private (ADR-001 scope
-- founder_private, enforced here as company-organisation membership):
--
--   core.company_readiness_assessments   one row per revision of the
--     deterministic pillar assessment; a new revision only when the basis
--     (rules version + the company's records) changed. History is kept so
--     a status change can always be explained.
--   core.company_readiness_action_events the founder ticking an action done
--     or reopening it. The latest event per action is its state; the
--     pillar statuses never move on a tick, only on evidence.
--
-- Context Firewall: members of the organisation that owns the company read
-- them; an investor (any other organisation, a relationship included) and
-- another tenant read nothing. Only the server writes. No discovery,
-- ranking or recommendation table references them.

create table core.company_readiness_assessments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references identity.tenants (id) on delete restrict,
  company_id     uuid not null,
  revision       integer not null check (revision >= 1),
  rules_version  text not null check (rules_version ~ '^[a-z][a-z0-9-]*/v[0-9]+$'),
  -- sha256 hex of the rules version and the inputs it read.
  basis_hash     text not null check (basis_hash ~ '^[0-9a-f]{64}$'),
  -- Pillars (status in words, evidence lines), blockers and uncertainty.
  -- No score, no percentage; bounded.
  assessment     jsonb not null check (jsonb_typeof(assessment) = 'object' and length(assessment::text) <= 131072),
  assessed_at    timestamptz not null default clock_timestamp(),
  unique (company_id, revision),
  foreign key (company_id, tenant_id) references core.companies (id, tenant_id) on delete restrict
);

comment on table core.company_readiness_assessments is
  'Founder-private readiness assessment revisions (rules over the company''s own records). Never read by discovery, ranking or any investor surface.';

create index company_readiness_assessments_company_idx
  on core.company_readiness_assessments (company_id, revision desc);
create index company_readiness_assessments_tenant_idx
  on core.company_readiness_assessments (tenant_id, company_id);

create table core.company_readiness_action_events (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references identity.tenants (id) on delete restrict,
  company_id     uuid not null,
  action_key     text not null check (action_key ~ '^[a-z0-9-]{1,40}$'),
  event          text not null check (event in ('MARKED_DONE', 'REOPENED')),
  actor_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  rules_version  text not null check (rules_version ~ '^[a-z][a-z0-9-]*/v[0-9]+$'),
  occurred_at    timestamptz not null default clock_timestamp(),
  foreign key (company_id, tenant_id) references core.companies (id, tenant_id) on delete restrict
);

comment on table core.company_readiness_action_events is
  'Founder-private action-plan history: who ticked or reopened which action. Append-only.';

create index company_readiness_action_events_company_idx
  on core.company_readiness_action_events (company_id, action_key, occurred_at desc);
create index company_readiness_action_events_tenant_idx
  on core.company_readiness_action_events (tenant_id, company_id);

create function private.company_readiness_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'readiness history is append-only; record a new revision or event instead'
    using errcode = '42501';
end
$$;

revoke all on function private.company_readiness_append_only() from public, anon, authenticated;

create trigger company_readiness_assessments_append_only
  before update or delete on core.company_readiness_assessments
  for each row execute function private.company_readiness_append_only();
create trigger company_readiness_action_events_append_only
  before update or delete on core.company_readiness_action_events
  for each row execute function private.company_readiness_append_only();

alter table core.company_readiness_assessments enable row level security;
alter table core.company_readiness_action_events enable row level security;

create policy company_readiness_assessments_member_select on core.company_readiness_assessments
  for select to authenticated
  using (exists (
    select 1 from core.companies c
     where c.id = core.company_readiness_assessments.company_id
       and c.tenant_id = core.company_readiness_assessments.tenant_id
       and private.is_organisation_member(c.organisation_id)));

create policy company_readiness_action_events_member_select on core.company_readiness_action_events
  for select to authenticated
  using (exists (
    select 1 from core.companies c
     where c.id = core.company_readiness_action_events.company_id
       and c.tenant_id = core.company_readiness_action_events.tenant_id
       and private.is_organisation_member(c.organisation_id)));

grant select on core.company_readiness_assessments to authenticated;
grant select on core.company_readiness_action_events to authenticated;
