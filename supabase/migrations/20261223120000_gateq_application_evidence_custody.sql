-- ADR 0067: application custody extends canonical Evidence, never membership.
-- No new bucket, parser, browser grants or organisation disclosure.
alter table gateq.applications add constraint applications_custody_key unique (id,tenant_id);
alter table gateq.application_sessions add constraint application_sessions_application_tenant foreign key (application_id,tenant_id) references gateq.applications(id,tenant_id) on delete cascade;
alter table gateq.application_sessions add constraint application_sessions_custody_key unique (id, application_id, tenant_id);
alter table evidence.documents
  alter column owner_organisation_id drop not null,
  alter column created_by_user_id drop not null,
  add column custody_cleanup_started_at timestamptz,
  add column custody_deleted_at timestamptz,
  add column owner_kind text not null default 'ORGANISATION',
  add column gateq_application_id uuid,
  add column gateq_session_id uuid,
  add constraint documents_custody_shape check (
    (owner_kind='ORGANISATION' and owner_organisation_id is not null and created_by_user_id is not null and gateq_application_id is null and gateq_session_id is null and custody_cleanup_started_at is null and custody_deleted_at is null)
    or (owner_kind='GATEQ_APPLICATION' and owner_organisation_id is null and created_by_user_id is null and gateq_application_id is not null and gateq_session_id is not null
      and company_id is null and visibility_scope='personal_private' and download_audience='ORGANISATION')
  ),
  add constraint documents_cleanup_shape check (custody_deleted_at is null or (custody_cleanup_started_at is not null and status='ARCHIVED')),
  add constraint documents_application_custody foreign key (gateq_session_id,gateq_application_id,tenant_id)
    references gateq.application_sessions (id,application_id,tenant_id) on delete restrict;
create index documents_application_custody_idx on evidence.documents (tenant_id,gateq_application_id,created_at,id) where owner_kind='GATEQ_APPLICATION';

alter table evidence.document_upload_sessions
  alter column owner_organisation_id drop not null,
  alter column created_by_user_id drop not null,
  add column gateq_application_id uuid,
  add column gateq_session_id uuid,
  add column guest_idempotency_hash text check (guest_idempotency_hash ~ '^[0-9a-f]{64}$'),
  add column guest_request_hash text check (guest_request_hash ~ '^[0-9a-f]{64}$'),
  drop constraint document_upload_sessions_authorising_capability_check,
  add constraint document_upload_sessions_authorising_capability_check check (authorising_capability in ('document.create','document.manage','gateq.application.upload')),
  add constraint upload_application_custody foreign key (gateq_session_id,gateq_application_id,tenant_id)
    references gateq.application_sessions (id,application_id,tenant_id) on delete restrict,
  add constraint upload_custody_shape check (
    (owner_organisation_id is not null and created_by_user_id is not null and gateq_application_id is null and gateq_session_id is null and guest_idempotency_hash is null and guest_request_hash is null and authorising_capability in ('document.create','document.manage'))
    or (owner_organisation_id is null and created_by_user_id is null and gateq_application_id is not null and gateq_session_id is not null and guest_idempotency_hash is not null and guest_request_hash is not null and authorising_capability='gateq.application.upload')
  );
create unique index upload_application_request_key on evidence.document_upload_sessions (tenant_id,gateq_application_id,gateq_session_id,guest_idempotency_hash) where gateq_application_id is not null;
create unique index upload_application_document_key on evidence.document_upload_sessions (document_id) where gateq_application_id is not null;
alter table evidence.document_versions alter column uploaded_by_user_id drop not null, add column gateq_session_id uuid references gateq.application_sessions(id) on delete restrict;
alter table evidence.document_extractions alter column owner_organisation_id drop not null;
alter table evidence.document_pages alter column owner_organisation_id drop not null;

-- Ownership cannot migrate between the organisation and application worlds.
create function evidence.protect_document_custody() returns trigger language plpgsql
set search_path=pg_catalog as $$
begin
  if new.owner_kind is distinct from old.owner_kind or new.owner_organisation_id is distinct from old.owner_organisation_id
    or new.tenant_id is distinct from old.tenant_id or new.gateq_application_id is distinct from old.gateq_application_id
    or new.gateq_session_id is distinct from old.gateq_session_id or new.created_by_user_id is distinct from old.created_by_user_id then
    raise exception 'document custody is immutable' using errcode='check_violation';
  end if;
  if (old.custody_cleanup_started_at is not null and new.custody_cleanup_started_at is distinct from old.custody_cleanup_started_at)
    or (old.custody_deleted_at is not null and new.custody_deleted_at is distinct from old.custody_deleted_at) then
    raise exception 'custody deletion record is immutable' using errcode='check_violation';
  end if;
  return new;
end $$;
revoke all on function evidence.protect_document_custody() from public,anon,authenticated;
create trigger documents_custody_immutable before update on evidence.documents for each row execute function evidence.protect_document_custody();

-- Child identities must bind to the actual parent custody, not a supplied tenant.
create function evidence.validate_document_custody_child() returns trigger language plpgsql
set search_path=pg_catalog,evidence as $$
declare d record;
begin
  select * into d from evidence.documents where id=new.document_id and tenant_id=new.tenant_id for share;
  if not found then raise exception 'document custody does not exist' using errcode='foreign_key_violation'; end if;
  if d.custody_cleanup_started_at is not null then raise exception 'document custody has expired' using errcode='check_violation'; end if;
  if tg_table_name='document_upload_sessions' then
    if new.owner_organisation_id is distinct from d.owner_organisation_id
      or new.gateq_application_id is distinct from d.gateq_application_id
      or new.gateq_session_id is distinct from d.gateq_session_id then
      raise exception 'upload custody must match document' using errcode='check_violation'; end if;
    if tg_op='UPDATE' and (new.gateq_application_id is distinct from old.gateq_application_id or new.gateq_session_id is distinct from old.gateq_session_id
      or new.guest_idempotency_hash is distinct from old.guest_idempotency_hash or new.guest_request_hash is distinct from old.guest_request_hash) then
      raise exception 'upload custody is immutable' using errcode='check_violation'; end if;
  elsif tg_table_name='document_versions' then
    if (d.owner_kind='ORGANISATION' and (new.uploaded_by_user_id is null or new.gateq_session_id is not null))
      or (d.owner_kind='GATEQ_APPLICATION' and (new.uploaded_by_user_id is not null or new.gateq_session_id is distinct from d.gateq_session_id)) then
      raise exception 'version custody must match document' using errcode='check_violation'; end if;
    if tg_op='UPDATE' and new.gateq_session_id is distinct from old.gateq_session_id then
      raise exception 'version custody is immutable' using errcode='check_violation'; end if;
  else
    if new.owner_organisation_id is distinct from d.owner_organisation_id or new.visibility_scope is distinct from d.visibility_scope or new.sensitivity_class is distinct from d.sensitivity_class then
      raise exception 'derived content must preserve document custody' using errcode='check_violation'; end if;
  end if;
  return new;
end $$;
revoke all on function evidence.validate_document_custody_child() from public,anon,authenticated;
create trigger upload_custody_match before insert or update on evidence.document_upload_sessions for each row execute function evidence.validate_document_custody_child();
create trigger version_custody_match before insert or update on evidence.document_versions for each row execute function evidence.validate_document_custody_child();
create trigger extraction_custody_match before insert on evidence.document_extractions for each row execute function evidence.validate_document_custody_child();
create trigger page_custody_match before insert on evidence.document_pages for each row execute function evidence.validate_document_custody_child();

-- Null-safe comparison preserves extraction/page lineage for guest custody too.
create or replace function evidence.document_pages_match_extraction() returns trigger language plpgsql
set search_path=pg_catalog,evidence as $$
declare e record;
begin
  select * into e from evidence.document_extractions where id=new.extraction_id and tenant_id=new.tenant_id;
  if not found then raise exception 'a page names an extraction that does not exist' using errcode='foreign_key_violation'; end if;
  if e.document_id is distinct from new.document_id or e.document_version_id is distinct from new.document_version_id
    or e.owner_organisation_id is distinct from new.owner_organisation_id or e.visibility_scope is distinct from new.visibility_scope
    or e.sensitivity_class is distinct from new.sensitivity_class then
    raise exception 'a page must match its extraction custody' using errcode='check_violation'; end if;
  return new;
end $$;
revoke all on function evidence.document_pages_match_extraction() from public,anon,authenticated;

-- Reassert the server boundary; signed single-object upload is the only browser write.
alter table evidence.documents enable row level security;
alter table evidence.document_versions enable row level security;
alter table evidence.document_upload_sessions enable row level security;
alter table evidence.document_extractions enable row level security;
alter table evidence.document_pages enable row level security;
revoke all on evidence.documents,evidence.document_versions,evidence.document_upload_sessions,evidence.document_extractions,evidence.document_pages from public,anon,authenticated;

-- Only the trusted retention primitive can erase expired, unsubmitted page
-- content after recording the custody tombstone. File/version identities remain.
create or replace function evidence.document_pages_are_immutable() returns trigger language plpgsql
set search_path=pg_catalog,evidence,gateq as $$
begin
  if tg_op='DELETE' and exists (
    select 1 from evidence.documents d join gateq.applications a on a.id=d.gateq_application_id and a.tenant_id=d.tenant_id
    where d.id=old.document_id and d.tenant_id=old.tenant_id and d.owner_kind='GATEQ_APPLICATION'
      and d.custody_deleted_at is not null and a.status <> 'SUBMITTED'
  ) then return old; end if;
  raise exception 'document pages are immutable; reprocess under a new pipeline version' using errcode='check_violation';
end $$;
revoke all on function evidence.document_pages_are_immutable() from public,anon,authenticated;
