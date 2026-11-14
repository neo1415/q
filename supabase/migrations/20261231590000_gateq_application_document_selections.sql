-- GateQ: a signed-in founder's draft document selection (live defect
-- 2026-11-14: two documents ticked, resumed in a new browser, sent with 0).
--
--   draft selection ≠ disclosure;  Send (ADR 0067 §5) is still the boundary
--
-- The ticks on the apply form used to live only in the browser. This row
-- holds them on the server so they survive a resume on another browser or
-- device. It shares nothing: no investor read path touches it, and the
-- documents reach the investor only through gateq.application_documents,
-- written when the founder reviews the list and presses Send.
--
--   * one row per application, the whole current list (writing the same
--     list again is a no-op, so a retried tick is harmless); revision counts
--     the founder's changes;
--   * selected_by_user_id is the founder who ticked; the server reads and
--     writes it only as that founder, and proves each document is their
--     organisation's own (Evidence's scoped read) before writing;
--   * frozen at Send by the same open-application guard as facts, documents,
--     contact and turns.
--
-- Server-only, like every gateq table: RLS on, no policy, no browser grant.

create table gateq.application_document_selections (
  application_id       uuid primary key,
  tenant_id            uuid not null,
  selected_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  document_ids         uuid[] not null default '{}'
                         check (cardinality(document_ids) <= 10 and array_position(document_ids, null) is null),
  revision             integer not null default 1 check (revision >= 1),
  updated_at           timestamptz not null default now(),
  foreign key (application_id, tenant_id)
    references gateq.applications (id, tenant_id) on delete cascade
);

comment on table gateq.application_document_selections is
  'A signed-in founder''s draft tick list for one application. Shares nothing: disclosure is the Send step, which writes gateq.application_documents. Server-only.';

-- Draft only: once the application is submitted the selection is frozen.
create trigger application_document_selections_open_guard
  before insert or update on gateq.application_document_selections
  for each row execute function gateq.guard_open_application_write();

alter table gateq.application_document_selections enable row level security;
revoke all on gateq.application_document_selections from public, anon, authenticated;
