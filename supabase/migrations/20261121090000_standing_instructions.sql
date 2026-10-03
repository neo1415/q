-- ADR 0043 (founder decision 2026-10-03): standing instructions. A person
-- gives Q a goal once and approves ONE grant; Q works toward it inside that
-- grant. Additive: three new tables, server-written, the person reads their
-- own rows. Triggers and firings arrive with the scheduler (S4).

-- ---------------------------------------------------------------------------
-- q_runtime.standing_instructions: the goal and where it stands
-- ---------------------------------------------------------------------------

create table q_runtime.standing_instructions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references identity.tenants (id) on delete restrict,
  user_id            uuid not null references identity.user_profiles (id) on delete restrict,
  organisation_id    uuid,
  goal_text          text not null check (length(goal_text) between 1 and 2000),
  -- The goal as Q read it, typed by the contracts; never a permission.
  goal               jsonb not null default '{}'::jsonb
                       check (jsonb_typeof(goal) = 'object' and length(goal::text) <= 8000),
  status             text not null default 'DRAFT'
                       check (status in ('DRAFT', 'ACTIVE', 'PAUSED', 'STOPPED', 'DONE', 'EXPIRED')),
  -- The approved grant version Q works under; null while DRAFT.
  grant_version      integer check (grant_version is null or grant_version >= 1),
  -- Money is numeric, never float.
  budget_usd_month   numeric(10, 2) not null default 5.00 check (budget_usd_month >= 0),
  spent_usd_month    numeric(12, 6) not null default 0 check (spent_usd_month >= 0),
  budget_month       date not null default date_trunc('month', now())::date,
  pause_reason       text check (pause_reason is null or pause_reason ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  expires_at         timestamptz,
  stopped_at         timestamptz,
  created_at         timestamptz not null default clock_timestamp(),
  updated_at         timestamptz not null default clock_timestamp(),
  check (status = 'DRAFT' or grant_version is not null),
  check (status <> 'STOPPED' or stopped_at is not null)
);

comment on table q_runtime.standing_instructions is
  'A standing instruction (ADR 0043): a goal the person gave Q once and the approved grant version Q works under. Not a CRM record; relationships stay the only truth.';

create index standing_instructions_user_idx
  on q_runtime.standing_instructions (user_id, created_at desc);
create index standing_instructions_active_idx
  on q_runtime.standing_instructions (status, updated_at) where status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- q_runtime.instruction_grants: append-only grant versions
-- ---------------------------------------------------------------------------

create table q_runtime.instruction_grants (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  instruction_id        uuid not null references q_runtime.standing_instructions (id) on delete restrict,
  version               integer not null check (version >= 1),
  grant_payload         jsonb not null
                          check (jsonb_typeof(grant_payload) = 'object' and length(grant_payload::text) <= 16000),
  -- The hash of exactly what was approved; a changed grant is a new version.
  payload_hash          text not null check (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  -- The Approval Engine action whose approval made this version current.
  approved_q_action_id  uuid,
  created_at            timestamptz not null default clock_timestamp(),
  unique (instruction_id, version)
);

comment on table q_runtime.instruction_grants is
  'What Q may do under a standing instruction, version by version (ADR 0043). Append-only: a change is a new version that needs its own approval.';

create function private.q_runtime_instruction_grants_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Recording the approval of a version is the one allowed change.
  if tg_op = 'UPDATE'
     and old.approved_q_action_id is null
     and new.approved_q_action_id is not null
     and (old.id, old.tenant_id, old.instruction_id, old.version, old.grant_payload, old.payload_hash, old.created_at)
         is not distinct from
         (new.id, new.tenant_id, new.instruction_id, new.version, new.grant_payload, new.payload_hash, new.created_at)
  then
    return new;
  end if;
  raise exception 'q_runtime.instruction_grants is append-only' using errcode = '42501';
end;
$$;

revoke all on function private.q_runtime_instruction_grants_append_only() from public, anon, authenticated;

create trigger instruction_grants_append_only
  before update or delete on q_runtime.instruction_grants
  for each row execute function private.q_runtime_instruction_grants_append_only();

-- ---------------------------------------------------------------------------
-- q_runtime.instruction_steps: what Q planned and did, step by step
-- ---------------------------------------------------------------------------

create table q_runtime.instruction_steps (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  user_id          uuid not null references identity.user_profiles (id) on delete restrict,
  instruction_id   uuid not null references q_runtime.standing_instructions (id) on delete restrict,
  grant_version    integer not null check (grant_version >= 1),
  -- The planner run this step belongs to (one per firing).
  run_key          text not null check (length(run_key) between 8 and 120),
  step_index       integer not null check (step_index between 0 and 200),
  action           text not null check (length(action) between 1 and 80),
  mode             text not null check (mode in ('AUTO', 'ASK')),
  status           text not null
                     check (status in ('DONE', 'ASKED', 'REFUSED', 'FAILED')),
  -- The relationship it concerns, when it concerns one.
  relationship_id  uuid,
  -- Plain words for the person; never a document's content.
  words            text not null check (length(words) between 1 and 500),
  reason_code      text check (reason_code is null or reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  q_action_id      uuid,
  idempotency_key  text not null unique check (length(idempotency_key) between 8 and 200),
  created_at       timestamptz not null default clock_timestamp()
);

comment on table q_runtime.instruction_steps is
  'What Q did under a standing instruction (ADR 0043): each planned step, whether it ran on its own (AUTO), was asked (ASK) or was refused, in plain words. Append-only; the commands keep their own audit.';

create index instruction_steps_instruction_idx
  on q_runtime.instruction_steps (instruction_id, created_at);
create index instruction_steps_messages_idx
  on q_runtime.instruction_steps (instruction_id, relationship_id)
  where action = 'chat.message.send' and status = 'DONE';

create function private.q_runtime_instruction_steps_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'q_runtime.instruction_steps is append-only' using errcode = '42501';
end;
$$;

revoke all on function private.q_runtime_instruction_steps_append_only() from public, anon, authenticated;

create trigger instruction_steps_append_only
  before update or delete on q_runtime.instruction_steps
  for each row execute function private.q_runtime_instruction_steps_append_only();

-- ---------------------------------------------------------------------------
-- RLS: the person reads their own rows; no client writes
-- ---------------------------------------------------------------------------

alter table q_runtime.standing_instructions enable row level security;
alter table q_runtime.instruction_grants enable row level security;
alter table q_runtime.instruction_steps enable row level security;

create policy standing_instructions_select_own on q_runtime.standing_instructions for select to authenticated
  using (user_id = (select private.current_app_user_id()) and (select private.is_tenant_member(tenant_id)));
create policy instruction_grants_select_own on q_runtime.instruction_grants for select to authenticated
  using (exists (
    select 1 from q_runtime.standing_instructions i
     where i.id = instruction_id
       and i.user_id = (select private.current_app_user_id())
       and (select private.is_tenant_member(i.tenant_id))));
create policy instruction_steps_select_own on q_runtime.instruction_steps for select to authenticated
  using (user_id = (select private.current_app_user_id()) and (select private.is_tenant_member(tenant_id)));

grant select on q_runtime.standing_instructions, q_runtime.instruction_grants,
  q_runtime.instruction_steps to authenticated;
