-- P3 Documents page (lead 2026-10-04): cursor pages over a person's
-- documents, uploaded and made by Q. Additive only; no data changes.
-- Rename and delete of an uploaded document reuse evidence.documents'
-- title and status (ARCHIVED, which can be undone).

-- Uploaded documents, newest change first, one page at a time: keyset
-- (updated_at, id) under the owner, active only.
create index documents_owner_active_updated_idx
  on evidence.documents (tenant_id, owner_organisation_id, updated_at desc, id desc)
  where status = 'ACTIVE';

-- Q's documents: the same keyset with id as the tie-break, so two
-- documents updated in the same instant never fall between pages.
create index artifacts_owner_updated_id_idx
  on artifacts.artifacts (tenant_id, organisation_id, updated_at desc, id desc)
  where archived_at is null;

-- Notices, older pages by the same kind of keyset (P3 pagination audit).
create index notifications_user_created_id_idx
  on communication.notifications (user_id, created_at desc, id desc);
