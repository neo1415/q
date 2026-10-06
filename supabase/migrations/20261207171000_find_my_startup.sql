-- F3 · "Find my startup" (2026-10-06).
--
--   a claim request ≠ a membership;  only Capital Q's decision makes one
--   a saved search ≠ a mandate;  observed interest never rewrites the declared mandate
--
-- Founders find their company on Capital Q and ask to claim it (or to join
-- it, when it already has members); investors describe what they want and
-- save it as an alert. Both are server-only: RLS on, no policy, no browser
-- grant. The API authorises every read and write.

-- ---------------------------------------------------------------------------
-- A person asking to be recognised as part of a canonical company
-- ---------------------------------------------------------------------------

create table core.company_claim_requests (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  company_id          uuid not null references core.companies (id) on delete restrict,
  requester_user_id   uuid not null references identity.user_profiles (id) on delete restrict,
  -- How they will show it is theirs. A request, never proof by itself.
  method              text not null check (method in ('WORK_EMAIL', 'REGISTRY_DOCUMENT', 'ASK_MEMBERS')),
  -- Only for WORK_EMAIL: where the code goes. Lower case; checked against
  -- the company's own website domain by the application before insert.
  work_email          text check (work_email is null or
                        (length(work_email) between 3 and 254 and work_email = lower(work_email)
                         and work_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  -- PENDING until Capital Q (or the company's members) decide; the
  -- decision is a new state, never a deleted row.
  status              text not null default 'PENDING'
                        check (status in ('PENDING', 'APPROVED', 'DECLINED', 'WITHDRAWN')),
  client_request_id   text not null check (client_request_id ~ '^[A-Za-z0-9:_-]{8,128}$'),
  created_at          timestamptz not null default now(),
  decided_at          timestamptz,
  check ((method = 'WORK_EMAIL') = (work_email is not null)),
  check ((status = 'PENDING') = (decided_at is null)),
  unique (requester_user_id, client_request_id)
);

-- One open request per person per company.
create unique index company_claim_requests_one_open_idx
  on core.company_claim_requests (company_id, requester_user_id)
  where status = 'PENDING';

comment on table core.company_claim_requests is
  'F3: a person asking to claim (or join) a canonical company. A request is not a membership: verification (verification_claims) or the company''s members decide, and a decision is recorded as a new status.';

create or replace function core.company_claim_tenant_matches()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from core.companies c
     where c.id = new.company_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'a claim request belongs to its company''s tenant'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function core.company_claim_tenant_matches() from public;

create trigger company_claim_requests_tenant before insert on core.company_claim_requests
  for each row execute function core.company_claim_tenant_matches();

alter table core.company_claim_requests enable row level security;
revoke all on core.company_claim_requests from anon, authenticated;

-- ---------------------------------------------------------------------------
-- An investor's saved "Find a startup" search
-- ---------------------------------------------------------------------------

create table gateq.startup_alerts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  organisation_id     uuid not null,
  user_id             uuid not null references identity.user_profiles (id) on delete restrict,
  -- Their words, and what Q understood from them (bounded, deterministic).
  description         text not null check (length(btrim(description)) between 3 and 500),
  filters             jsonb not null
                        check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 4096),
  client_request_id   text not null check (client_request_id ~ '^[A-Za-z0-9:_-]{8,128}$'),
  created_at          timestamptz not null default now(),
  -- A person turns an alert off; it is history, not deleted.
  stopped_at          timestamptz,
  unique (user_id, client_request_id),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

comment on table gateq.startup_alerts is
  'F3: an investor''s saved description of the companies they want. A search, not a mandate: it never rewrites the declared mandate, and matching uses only what the investor may already see.';

create index startup_alerts_by_user_idx on gateq.startup_alerts (user_id) where stopped_at is null;

alter table gateq.startup_alerts enable row level security;
revoke all on gateq.startup_alerts from anon, authenticated;
