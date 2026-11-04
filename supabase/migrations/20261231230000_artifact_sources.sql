-- SEC-01 (last residual) · artifacts.artifact_sources: which source
-- documents an artifact was composed from.
--
--   derived intelligence inherits the sensitivity of what it was built from
--
-- An artifact is re-checked against its subject (the company or investor
-- organisation it is about) on every read since 2776fc5. That is not enough:
-- a brief composed from a data-room document an investor was granted stays
-- readable and exportable by them after the founder revokes the grant,
-- because nothing recorded that the brief was built from that document.
-- This table records it, at creation and at every revision that read new
-- material, so the server can re-ask the document's own current access for
-- the reader on every read path and hide the artifact when any one of them
-- is no longer open to them.
--
-- Provenance, append-only, and never a disclosure: holding a row here is not
-- permission to read the document, and a source that is no longer readable
-- closes the artifact rather than being dropped from this list. Rows are
-- never rewritten; an artifact with no rows (every artifact composed before
-- this migration) keeps the subject-only rule, and no existing row is
-- touched or back-filled here.
--
-- The source id is deliberately not a foreign key into evidence: Artifacts
-- owns no other context's data (ADR 0013), and a document that has gone
-- (archived, deleted) must close the artifact on the next read, which a
-- cascading or restricting key would instead turn into a lost row or a
-- blocked deletion. The application resolves it through Evidence's and the
-- data room's own reads.

-- The composite key below needs (id, tenant_id) to be a key of the artifact.
-- Additive: id is already the primary key, so this holds for every row.
alter table artifacts.artifacts
  add constraint artifacts_id_tenant_key unique (id, tenant_id);

create table artifacts.artifact_sources (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references identity.tenants (id) on delete restrict,
  artifact_id   uuid not null,

  -- What kind of source, as reference data (doc 13), not a Postgres enum:
  --   retrieved_document   a company document whose passages the run's
  --                        authorised retrieval read, or that a finding cited
  --   data_room_document   a company document read through the data room's
  --                        own view, as the person
  source_kind   text not null
                  check (source_kind ~ '^[a-z][a-z0-9_]{2,47}$'),
  source_id     uuid not null,

  created_at    timestamptz not null default now(),

  -- The artifact's own tenant, so a source can never be filed against an
  -- artifact of another tenant, and goes with the artifact if it ever goes.
  foreign key (artifact_id, tenant_id)
    references artifacts.artifacts (id, tenant_id) on delete cascade,

  -- Recording the same source twice (a revision re-reading it) is one row.
  constraint artifact_sources_once unique (artifact_id, source_kind, source_id)
);

comment on table artifacts.artifact_sources is
  'Which source documents an artifact was composed from (SEC-01). Server-only provenance: re-checked against the reader''s current access on every read, so an artifact closes when any source does. Never a grant, never a disclosure, never rewritten.';
comment on column artifacts.artifact_sources.source_kind is
  'Reference data, not an enum: retrieved_document or data_room_document today; the set may grow.';
comment on column artifacts.artifact_sources.source_id is
  'The source''s identifier in its owning context (an Evidence document id). Deliberately not a foreign key: a source that disappears must close the artifact, not vanish from its provenance.';

-- The unique key above already serves lookups by artifact; this one serves
-- "which artifacts were built from this document" for future revocation
-- sweeps without a scan.
create index artifact_sources_source_idx
  on artifacts.artifact_sources (tenant_id, source_kind, source_id);

-- Server-only: RLS on, no policy, no browser grant -- the same posture as
-- artifacts.artifacts and artifact_versions. Read only by the Q API under an
-- explicit access context.
alter table artifacts.artifact_sources enable row level security;
revoke all on artifacts.artifact_sources from anon, authenticated;
