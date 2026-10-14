-- ADR 0067 §5: disclosure happens at submission and nowhere else.
-- The exact document versions frozen into a GateQ submission. Append-only:
-- a disclosure is never rewritten or withdrawn by an application write, and
-- later uploads cannot change what was submitted. Server-only, like every
-- other gateq/evidence custody table: RLS on, no policy, no browser grant.
create table evidence.gateq_application_document_disclosures (
  tenant_id           uuid not null,
  application_id      uuid not null,
  document_id         uuid not null,
  document_version_id uuid not null,
  sha256              text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  frozen_at           timestamptz not null default now(),
  primary key (application_id, document_id),
  foreign key (application_id, tenant_id) references gateq.applications (id, tenant_id) on delete restrict,
  foreign key (document_id, tenant_id) references evidence.documents (id, tenant_id) on delete restrict,
  foreign key (document_version_id, tenant_id) references evidence.document_versions (id, tenant_id) on delete restrict
);
create index gateq_application_document_disclosures_version_idx
  on evidence.gateq_application_document_disclosures (tenant_id, document_version_id);

-- A disclosure must name this application's own, current, processed version.
-- Ownership is re-derived from the parent rows, never from the inserted ids.
create function evidence.validate_gateq_document_disclosure() returns trigger language plpgsql
set search_path=pg_catalog,evidence as $$
declare d record; v record;
begin
  select * into d from evidence.documents where id=new.document_id and tenant_id=new.tenant_id for share;
  if not found or d.owner_kind <> 'GATEQ_APPLICATION' or d.gateq_application_id is distinct from new.application_id
    or d.status <> 'ACTIVE' or d.custody_cleanup_started_at is not null then
    raise exception 'disclosure must name an active document this application owns' using errcode='check_violation';
  end if;
  select * into v from evidence.document_versions where id=new.document_version_id and tenant_id=new.tenant_id;
  if not found or v.document_id <> new.document_id or d.current_version_id is distinct from new.document_version_id
    or v.sha256 <> new.sha256 or v.processing_status <> 'COMPLETED' or v.text_extraction_status <> 'COMPLETED'
    or v.malware_scan_status not in ('CLEAN','NOT_SCANNED') then
    raise exception 'disclosure must name the current, processed version' using errcode='check_violation';
  end if;
  return new;
end $$;
revoke all on function evidence.validate_gateq_document_disclosure() from public,anon,authenticated;
create trigger gateq_document_disclosure_valid before insert on evidence.gateq_application_document_disclosures
  for each row execute function evidence.validate_gateq_document_disclosure();

create function evidence.protect_gateq_document_disclosure() returns trigger language plpgsql
set search_path=pg_catalog as $$
begin
  raise exception 'submitted document disclosures are immutable' using errcode='check_violation';
end $$;
revoke all on function evidence.protect_gateq_document_disclosure() from public,anon,authenticated;
create trigger gateq_document_disclosure_immutable before update or delete on evidence.gateq_application_document_disclosures
  for each row execute function evidence.protect_gateq_document_disclosure();

-- A disclosed document cannot be archived out from under the submission.
create function evidence.protect_disclosed_application_document() returns trigger language plpgsql
set search_path=pg_catalog,evidence as $$
begin
  if new.status is distinct from old.status and exists (
    select 1 from evidence.gateq_application_document_disclosures x
    where x.document_id=old.id and x.tenant_id=old.tenant_id
  ) then
    raise exception 'a disclosed application document cannot be removed' using errcode='check_violation';
  end if;
  return new;
end $$;
revoke all on function evidence.protect_disclosed_application_document() from public,anon,authenticated;
create trigger documents_disclosure_retained before update on evidence.documents
  for each row when (old.owner_kind = 'GATEQ_APPLICATION')
  execute function evidence.protect_disclosed_application_document();

alter table evidence.gateq_application_document_disclosures enable row level security;
revoke all on evidence.gateq_application_document_disclosures from public,anon,authenticated;
