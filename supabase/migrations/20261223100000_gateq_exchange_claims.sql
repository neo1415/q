-- One durable applicant exchange owns model spend and finalization.
-- No transaction remains open while a provider is called.
alter table gateq.applications
  add column interview_claim_id uuid,
  add column interview_claim_turn_id text,
  add column interview_claim_expires_at timestamptz,
  add column interview_outcome jsonb,
  add constraint application_interview_claim_shape check (
    (interview_claim_id is null and interview_claim_expires_at is null)
    or (interview_claim_id is not null and interview_claim_expires_at is not null and interview_claim_turn_id is not null)
  ),
  add constraint application_interview_turn_shape check (
    interview_claim_turn_id is null or length(interview_claim_turn_id) between 1 and 128
  ),
  add constraint application_interview_outcome_shape check (
    interview_outcome is null or (interview_claim_turn_id is not null and jsonb_typeof(interview_outcome) = 'object' and octet_length(interview_outcome::text) <= 65536)
  ),
  add constraint submitted_application_has_no_pending_exchange check (
    status <> 'SUBMITTED' or (interview_claim_id is null and interview_claim_turn_id is null and interview_outcome is null)
  );

-- The same application lock serializes facts, documents, contact, turns and
-- submission. A concurrent mutation cannot slip into a frozen dossier.
create function gateq.guard_open_application_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare application_status text;
begin
  select a.status into application_status from gateq.applications a
    where a.id = new.application_id and a.tenant_id = new.tenant_id for update;
  if application_status is null then
    raise exception 'application not found' using errcode = 'check_violation';
  end if;
  if application_status = 'SUBMITTED' then
    raise exception 'submitted application is immutable' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke all on function gateq.guard_open_application_write() from public;
create trigger application_facts_open_guard before insert or update on gateq.application_facts
  for each row execute function gateq.guard_open_application_write();
create trigger application_documents_open_guard before insert or update on gateq.application_documents
  for each row execute function gateq.guard_open_application_write();
create trigger application_contacts_open_guard before insert or update on gateq.application_contacts
  for each row execute function gateq.guard_open_application_write();
create trigger application_turns_open_guard before insert on gateq.application_turns
  for each row execute function gateq.guard_open_application_write();
