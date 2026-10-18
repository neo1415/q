-- Scoped delegation on a standing instruction (founder 2026-10-07: "the
-- agents don't need approval for everything").
--
-- CLAUDE.md Authority: consequential actions follow Prepare -> Recommend ->
-- Human Approval -> Execute "unless explicit scoped delegation exists".
-- A row here is that explicit scope: the person switched routine
-- relationship moves on for one of their own instructions. It is
-- revocable at once (revoked_at; never deleted), and a revoked row is
-- never switched back on -- switching on again is a new row with its own
-- id, so every step done under a delegation names exactly which one.
--
-- What the scope covers is fixed in code (DELEGATED_ROUTINE_ACTIONS); the
-- row only says that the person switched it on. Additive: one new table
-- and one nullable column on instruction_steps.

create table q_runtime.instruction_delegations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identity.tenants (id) on delete restrict,
  user_id         uuid not null references identity.user_profiles (id) on delete restrict,
  instruction_id  uuid not null references q_runtime.standing_instructions (id) on delete restrict,
  scope           text not null check (scope in ('RELATIONSHIP_ROUTINE')),
  enabled_at      timestamptz not null default clock_timestamp(),
  revoked_at      timestamptz,
  check (revoked_at is null or revoked_at >= enabled_at)
);

comment on table q_runtime.instruction_delegations is
  'Scoped delegation (CLAUDE.md Authority): the person let Q take routine relationship moves under one standing instruction without a card each. Revoked, never deleted; what the scope covers is fixed in code.';

-- One live delegation per instruction.
create unique index instruction_delegations_live_idx
  on q_runtime.instruction_delegations (instruction_id)
  where revoked_at is null;

create function private.q_runtime_instruction_delegations_revoke_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Revoking is the one allowed change, once.
  if tg_op = 'UPDATE'
     and old.revoked_at is null
     and new.revoked_at is not null
     and (old.id, old.tenant_id, old.user_id, old.instruction_id, old.scope, old.enabled_at)
         is not distinct from
         (new.id, new.tenant_id, new.user_id, new.instruction_id, new.scope, new.enabled_at)
  then
    return new;
  end if;
  raise exception 'q_runtime.instruction_delegations is revoke-only' using errcode = '42501';
end;
$$;

revoke all on function private.q_runtime_instruction_delegations_revoke_only() from public, anon, authenticated;

create trigger instruction_delegations_revoke_only
  before update or delete on q_runtime.instruction_delegations
  for each row execute function private.q_runtime_instruction_delegations_revoke_only();

-- The message Q sent on its own under a delegation, so Work can offer the
-- chat's own unsend for a short while. Null for every other step.
alter table q_runtime.instruction_steps
  add column message_id uuid;

alter table q_runtime.instruction_delegations enable row level security;

create policy instruction_delegations_select_own on q_runtime.instruction_delegations for select to authenticated
  using (user_id = (select private.current_app_user_id()) and (select private.is_tenant_member(tenant_id)));

grant select on q_runtime.instruction_delegations to authenticated;
