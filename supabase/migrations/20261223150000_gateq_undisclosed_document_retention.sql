-- Explicit submission excludes private drafts, not their retention duty.
-- The exception stays narrowly limited to recorded, never-disclosed guest
-- custody with no live provider authorization. Organisation and disclosed
-- pages remain immutable.
create or replace function evidence.document_pages_are_immutable() returns trigger language plpgsql
set search_path=pg_catalog,evidence,gateq as $$
begin
  if tg_op='DELETE' and exists (
    select 1 from evidence.documents d
    where d.id=old.document_id and d.tenant_id=old.tenant_id and d.owner_kind='GATEQ_APPLICATION'
      and d.status='ARCHIVED' and d.custody_cleanup_started_at is not null and d.custody_deleted_at is not null
      and not exists(select 1 from evidence.gateq_application_document_disclosures g where g.document_id=d.id and g.tenant_id=d.tenant_id)
      and not exists(select 1 from gateq.application_sessions s where s.application_id=d.gateq_application_id and s.tenant_id=d.tenant_id and s.expires_at > now())
      and not exists(select 1 from evidence.document_processing_runs r join evidence.document_versions v on v.id=r.document_version_id where v.document_id=d.id and v.tenant_id=d.tenant_id and r.status in ('QUEUED','RUNNING'))
      and not exists(select 1 from evidence.document_upload_sessions u where u.document_id=d.id and u.tenant_id=d.tenant_id and not evidence.gateq_upload_authorization_retired(u))
  ) then return old; end if;
  raise exception 'document pages are immutable; reprocess under a new pipeline version' using errcode='check_violation';
end $$;
revoke all on function evidence.document_pages_are_immutable() from public,anon,authenticated;

-- Serialize processing admission with retention's document lock. The worker
-- holds no transaction across parsing/storage; its existing QUEUED/RUNNING
-- row keeps retention waiting until work terminates. After the tombstone,
-- no new run can revive application custody.
create function evidence.guard_application_processing_retention() returns trigger language plpgsql
set search_path=pg_catalog,evidence as $$
declare d record;
begin
  select x.owner_kind,x.custody_cleanup_started_at into d from evidence.documents x
    join evidence.document_versions v on v.document_id=x.id and v.tenant_id=x.tenant_id
    where v.id=new.document_version_id for share of x;
  if found and d.owner_kind='GATEQ_APPLICATION' and d.custody_cleanup_started_at is not null
    and (tg_op='INSERT' or new.status in ('QUEUED','RUNNING')) then
    raise exception 'application document custody has expired' using errcode='check_violation';
  end if;
  return new;
end $$;
revoke all on function evidence.guard_application_processing_retention() from public,anon,authenticated;
create trigger document_processing_application_retention before insert or update on evidence.document_processing_runs
for each row execute function evidence.guard_application_processing_retention();
