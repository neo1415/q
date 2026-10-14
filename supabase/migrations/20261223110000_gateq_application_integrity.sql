-- Preserve the recovered intake implementation: serialize mutation against
-- finalization and fence model results without keeping a transaction open
-- while the model runs. Expired claims may be retried; stale owners cannot
-- complete or clear a newer claim.
alter table gateq.applications
  add column interview_claim_id uuid,
  add column interview_claim_expires_at timestamptz,
  add constraint application_interview_claim_pair
    check ((interview_claim_id is null) = (interview_claim_expires_at is null));

alter table gateq.application_contacts add column code_issued_at timestamptz;
update gateq.application_contacts
   set code_issued_at = code_expires_at - interval '30 minutes'
 where code_expires_at is not null;
comment on column gateq.application_contacts.code_issued_at is
  'Last attempted code delivery; retained even if delivery fails so retries cannot bypass the durable resend window.';


alter table gateq.application_facts
  alter constraint application_facts_superseded_by_fkey deferrable initially deferred;

create or replace function gateq.require_mutable_application()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  application_status text;
  application_tenant uuid;
begin
  select status, tenant_id into application_status, application_tenant
    from gateq.applications where id = new.application_id for update;
  if application_status is null or application_tenant <> new.tenant_id then
    raise exception 'application ownership mismatch' using errcode = 'check_violation';
  end if;
  if application_status = 'SUBMITTED' then
    raise exception 'submitted application evidence is frozen' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke all on function gateq.require_mutable_application() from public;

create trigger application_facts_mutable
  before insert or update on gateq.application_facts
  for each row execute function gateq.require_mutable_application();
create trigger application_documents_mutable
  before insert on gateq.application_documents
  for each row execute function gateq.require_mutable_application();
create trigger application_turns_mutable
  before insert on gateq.application_turns
  for each row execute function gateq.require_mutable_application();
create trigger application_contacts_mutable
  before insert or update on gateq.application_contacts
  for each row execute function gateq.require_mutable_application();

comment on column gateq.applications.interview_claim_id is
  'Server-only short-lived exchange ownership token. Not applicant authority. Fences concurrent model calls and stale completion.';
