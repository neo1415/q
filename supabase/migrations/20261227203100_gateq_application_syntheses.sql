-- Q's reading of a submitted GateQ application (lead decision 2026-10-15).
--
-- The dossier frozen with a submission is deterministic and never changes;
-- Q's nonbinding, cited reading of it is recorded here, AFTER submission,
-- by the API's synthesis job, at most once per application. A failed attempt
-- is recorded so the job backs off and stops after a few tries; a READY
-- reading is never rewritten.
--
-- Server-only, like every gateq table: RLS on, no policy, no browser grant.

create table gateq.application_syntheses (
  application_id  uuid primary key,
  tenant_id       uuid not null,
  status          text not null check (status in ('READY', 'FAILED')),
  attempts        integer not null default 1 check (attempts between 1 and 10),
  synthesis       jsonb check (synthesis is null or jsonb_typeof(synthesis) = 'object'),
  prompt_version  text check (length(prompt_version) <= 120),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (application_id, tenant_id)
    references gateq.applications (id, tenant_id) on delete restrict,
  check ((status = 'READY') = (synthesis is not null))
);

create index application_syntheses_retry_idx
  on gateq.application_syntheses (updated_at) where status = 'FAILED';

-- A READY reading is what the investor was shown: it never changes. A
-- FAILED attempt may be retried (more attempts) or completed (READY).
create or replace function gateq.protect_application_synthesis()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.application_id is distinct from old.application_id
    or new.tenant_id is distinct from old.tenant_id
    or new.created_at is distinct from old.created_at
    or old.status = 'READY'
    or new.attempts < old.attempts then
    raise exception 'a recorded GateQ synthesis is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function gateq.protect_application_synthesis() from public, anon, authenticated;
create trigger application_synthesis_immutable
  before update on gateq.application_syntheses
  for each row execute function gateq.protect_application_synthesis();

alter table gateq.application_syntheses enable row level security;
revoke all on gateq.application_syntheses from public, anon, authenticated;
grant select, insert, update on gateq.application_syntheses to postgres, service_role;
