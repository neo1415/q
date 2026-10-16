-- A run that has ended can no longer be approved, so its open proposals are
-- withdrawn with it (live 2026-10-16).
--
-- The approve path refused a card whose run had been cancelled and tried to
-- revoke it, but the revocation rolled back with the refusal: the approval
-- stayed PENDING forever. It could be neither approved nor declined, yet the
-- pending list (and Q's "something like this is already waiting") counted
-- it, so the person could not ask for the same work again.
--
-- From now on, when a run reaches a terminal state (COMPLETED, FAILED,
-- CANCELLED, EXPIRED), every PENDING approval of its actions is REVOKED by
-- the system (revoked_by_user_id null) and every action still
-- AWAITING_APPROVAL is WITHDRAWN -- the q-actions lifecycle's own terminal
-- states, versions advanced, nothing deleted. The rows already stranded
-- are repaired the same way below (one row on production when checked,
-- read-only, on 2026-10-16). Idempotent: a second run changes nothing.

create or replace function q_runtime.withdraw_proposals_of_ended_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED')
     and old.status is distinct from new.status then
    update q_runtime.approvals ap
       set status = 'REVOKED',
           revoked_at = now(),
           revoked_by_user_id = null,
           version = ap.version + 1
      from q_runtime.actions a
     where a.id = ap.action_id
       and a.tenant_id = ap.tenant_id
       and a.run_id = new.id
       and a.tenant_id = new.tenant_id
       and ap.status = 'PENDING';
    update q_runtime.actions a
       set status = 'WITHDRAWN',
           version = a.version + 1
     where a.run_id = new.id
       and a.tenant_id = new.tenant_id
       and a.status = 'AWAITING_APPROVAL';
  end if;
  return new;
end;
$$;

comment on function q_runtime.withdraw_proposals_of_ended_run() is
  'When a Q run ends, its open proposals end with it: PENDING approvals REVOKED by the system and AWAITING_APPROVAL actions WITHDRAWN, so a card that can no longer be approved is never counted as waiting.';

revoke all on function q_runtime.withdraw_proposals_of_ended_run() from public;

create trigger runs_withdraw_proposals_when_ended
  after update of status on q_runtime.runs
  for each row
  execute function q_runtime.withdraw_proposals_of_ended_run();

-- Repair: proposals stranded on runs that had already ended.
update q_runtime.approvals ap
   set status = 'REVOKED',
       revoked_at = now(),
       revoked_by_user_id = null,
       version = ap.version + 1
  from q_runtime.actions a
  join q_runtime.runs r on r.id = a.run_id and r.tenant_id = a.tenant_id
 where a.id = ap.action_id
   and a.tenant_id = ap.tenant_id
   and ap.status = 'PENDING'
   and r.status in ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

update q_runtime.actions a
   set status = 'WITHDRAWN',
       version = a.version + 1
  from q_runtime.runs r
 where r.id = a.run_id
   and r.tenant_id = a.tenant_id
   and a.status = 'AWAITING_APPROVAL'
   and r.status in ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');
