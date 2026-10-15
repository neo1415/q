-- One durable document identity per approved workforce step, on the
-- canonical artifact itself. No new document registry or browser write.
alter table artifacts.artifacts
  add column workforce_job_id uuid,
  add column workforce_step_key text,
  add column workforce_intent_sha256 text,
  add constraint artifacts_workforce_binding_complete check (
    num_nonnulls(workforce_job_id, workforce_step_key, workforce_intent_sha256) in (0, 3)),
  add constraint artifacts_workforce_step_key_check check (
    workforce_step_key is null or length(btrim(workforce_step_key)) between 1 and 80),
  add constraint artifacts_workforce_intent_check check (
    workforce_intent_sha256 is null or workforce_intent_sha256 ~ '^[a-f0-9]{64}$'),
  add constraint artifacts_workforce_owner_fk
    foreign key (workforce_job_id, tenant_id, created_by_user_id)
    references q_runtime.workforce_jobs (id, tenant_id, user_id) on delete restrict;

create unique index artifacts_workforce_step_idx
  on artifacts.artifacts (workforce_job_id, workforce_step_key)
  where workforce_job_id is not null;

create function artifacts.workforce_binding_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.workforce_job_id, new.workforce_step_key, new.workforce_intent_sha256)
     is distinct from
     (old.workforce_job_id, old.workforce_step_key, old.workforce_intent_sha256)
     or (old.workforce_job_id is not null and
       (new.tenant_id, new.organisation_id, new.created_by_user_id, new.type,
        new.company_id, new.investor_organisation_id)
       is distinct from
       (old.tenant_id, old.organisation_id, old.created_by_user_id, old.type,
        old.company_id, old.investor_organisation_id)) then
    raise exception 'a workforce document binding is immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function artifacts.workforce_binding_guard() from public;
create trigger artifacts_workforce_binding_guard before update on artifacts.artifacts
  for each row execute function artifacts.workforce_binding_guard();

comment on column artifacts.artifacts.workforce_intent_sha256 is
  'Server-derived SHA-256 of the immutable approved document intent. Replay conflicts fail closed; generated content is not the replay key.';
-- Existing artifact RLS and grants remain in force, including no browser writes.
