-- ADR 0067: application authority is not an organisation membership.
-- Canonical Evidence remains the only file/version/extraction store.
alter table evidence.documents
  add column owner_kind text not null default 'ORGANISATION'
    check (owner_kind in ('ORGANISATION', 'GATEQ_APPLICATION')),
  add column application_id uuid references gateq.applications(id) on delete restrict,
  alter column owner_organisation_id drop not null,
  alter column created_by_user_id drop not null,
  add constraint documents_owner_scope_check check (
    (owner_kind = 'ORGANISATION' and owner_organisation_id is not null and created_by_user_id is not null and application_id is null)
    or (owner_kind = 'GATEQ_APPLICATION' and owner_organisation_id is null and created_by_user_id is null
      and application_id is not null and company_id is null and visibility_scope = 'founder_private'
      and download_audience = 'ORGANISATION'));
create index documents_application_idx on evidence.documents(application_id, id)
  where owner_kind = 'GATEQ_APPLICATION';

create function evidence.enforce_document_owner_scope() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.owner_kind is distinct from old.owner_kind or new.application_id is distinct from old.application_id
    or new.owner_organisation_id is distinct from old.owner_organisation_id or new.created_by_user_id is distinct from old.created_by_user_id) then
    raise exception 'document owner is immutable' using errcode = 'check_violation';
  end if;
  if new.owner_kind = 'GATEQ_APPLICATION' and not exists
    (select 1 from gateq.applications a where a.id = new.application_id and a.tenant_id = new.tenant_id) then
    raise exception 'application ownership must match tenant' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger documents_owner_scope before insert or update on evidence.documents
 for each row execute function evidence.enforce_document_owner_scope();

alter table evidence.document_versions alter column uploaded_by_user_id drop not null;
alter table evidence.document_extractions alter column owner_organisation_id drop not null;
alter table evidence.document_pages alter column owner_organisation_id drop not null;
alter table evidence.document_upload_sessions
  alter column owner_organisation_id drop not null,
  alter column created_by_user_id drop not null,
  add column application_id uuid references gateq.applications(id) on delete restrict,
  add column application_session_id uuid references gateq.application_sessions(id) on delete restrict,
  add column client_request_id uuid,
  add column request_hash text check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$');
alter table evidence.document_upload_sessions drop constraint document_upload_sessions_authorising_capability_check;
alter table evidence.document_upload_sessions add constraint document_upload_sessions_authorising_capability_check
 check (authorising_capability in ('document.create', 'document.manage', 'gateq.application.upload'));
alter table evidence.document_upload_sessions add constraint document_upload_sessions_owner_scope_check check (
 (application_id is null and application_session_id is null and client_request_id is null and request_hash is null
  and owner_organisation_id is not null and created_by_user_id is not null and authorising_capability in ('document.create','document.manage'))
 or (application_id is not null and application_session_id is not null and client_request_id is not null and request_hash is not null
  and owner_organisation_id is null and created_by_user_id is null and authorising_capability = 'gateq.application.upload'));
create unique index upload_sessions_application_request_key
 on evidence.document_upload_sessions(application_id, client_request_id) where application_id is not null;

-- Derived records cannot claim a different owner/version than their canonical document.
create function evidence.enforce_application_derived_scope() returns trigger
language plpgsql set search_path = '' as $$
declare d record; v record;
begin
 select * into d from evidence.documents where id = new.document_id and tenant_id = new.tenant_id;
 if not found then raise exception 'missing scoped document' using errcode = 'foreign_key_violation'; end if;
 if tg_table_name = 'document_versions' then
   if (d.owner_kind = 'GATEQ_APPLICATION') is distinct from (new.uploaded_by_user_id is null) then
     raise exception 'version uploader must match document scope' using errcode = 'check_violation';
   end if;
 else
   if new.owner_organisation_id is distinct from d.owner_organisation_id then
     raise exception 'derived owner must match document' using errcode = 'check_violation';
   end if;
   if tg_table_name = 'document_upload_sessions' then
     if new.application_id is distinct from d.application_id then
       raise exception 'upload application must match document' using errcode = 'check_violation';
     end if;
     if new.application_id is not null and not exists (
       select 1 from gateq.application_sessions s where s.id = new.application_session_id
       and s.application_id = new.application_id and s.tenant_id = new.tenant_id
     ) then raise exception 'upload session must match application' using errcode = 'check_violation'; end if;
     if tg_op = 'UPDATE' and (new.application_id is distinct from old.application_id
       or new.application_session_id is distinct from old.application_session_id
       or new.client_request_id is distinct from old.client_request_id or new.request_hash is distinct from old.request_hash) then
       raise exception 'upload authority is immutable' using errcode = 'check_violation';
     end if;
   else
     select * into v from evidence.document_versions where id = new.document_version_id and tenant_id = new.tenant_id;
     if not found or v.document_id is distinct from new.document_id then
       raise exception 'extraction must match version document' using errcode = 'check_violation'; end if;
     if new.visibility_scope is distinct from d.visibility_scope or new.sensitivity_class is distinct from d.sensitivity_class then
       raise exception 'extraction scope must match document' using errcode = 'check_violation'; end if;
   end if;
 end if;
 return new;
end $$;
create trigger document_versions_owner_scope before insert on evidence.document_versions
 for each row execute function evidence.enforce_application_derived_scope();
create trigger document_extractions_owner_scope before insert on evidence.document_extractions
 for each row execute function evidence.enforce_application_derived_scope();
create trigger document_pages_owner_scope before insert on evidence.document_pages
 for each row execute function evidence.enforce_application_derived_scope();
create trigger document_upload_sessions_owner_scope before insert or update on evidence.document_upload_sessions
 for each row execute function evidence.enforce_application_derived_scope();

-- Null owner is a real application scope: NULL comparisons must not bypass page lineage.
create or replace function evidence.document_pages_match_extraction() returns trigger
language plpgsql set search_path = '' as $$
declare e record;
begin
 select * into e from evidence.document_extractions x where x.id = new.extraction_id and x.tenant_id = new.tenant_id;
 if not found then raise exception 'missing scoped extraction' using errcode = 'foreign_key_violation'; end if;
 if e.document_id is distinct from new.document_id or e.document_version_id is distinct from new.document_version_id
 or e.owner_organisation_id is distinct from new.owner_organisation_id or e.visibility_scope is distinct from new.visibility_scope
 or e.sensitivity_class is distinct from new.sensitivity_class then
  raise exception 'page must match extraction lineage' using errcode = 'check_violation'; end if;
 return new;
end $$;
revoke all on function evidence.enforce_document_owner_scope(), evidence.enforce_application_derived_scope(),
 evidence.document_pages_match_extraction() from public, anon, authenticated;
-- Existing Evidence tables retain RLS and no browser grants. No new table or membership.
