-- Diligence, the requester's side (founder critique 2026-10-04): a request
-- shows Requested → Shared → Viewed, and the requester reads Q's one-line
-- summary of what was shared.
--
--   network.diligence_document_views      the first time a person on the
--                                         investor's side opened a shared
--                                         document (append-only; one row
--                                         per relationship, document, person)
--   network.diligence_document_summaries  Q's short summary of one shared
--                                         document version, written by the
--                                         worker from that version's own
--                                         extracted text and nothing else
--                                         (append-only; one per version)
--
-- A summary is never shown on its own authority: the server shows it only
-- beside a share the reader can already open, labelled as Q's summary.
-- Server-only like the rest of network: RLS on, no policies, no grants.

create table network.diligence_document_views (
  relationship_id    uuid not null,
  -- The relationship's tenant (the company's, ADR 0003).
  tenant_id          uuid not null references identity.tenants (id) on delete restrict,
  document_id        uuid not null,
  viewed_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  created_at         timestamptz not null default clock_timestamp(),
  primary key (relationship_id, document_id, viewed_by_user_id),
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict
);

comment on table network.diligence_document_views is
  'The first time a person opened a document shared in a relationship''s diligence. Append-only.';

create table network.diligence_document_summaries (
  document_version_id  uuid primary key,
  tenant_id            uuid not null references identity.tenants (id) on delete restrict,
  document_id          uuid not null,
  -- One line, Q's words: figures in it are the document's own claims.
  summary              text not null check (length(summary) between 1 and 240 and summary !~ '[[:cntrl:]]'),
  prompt_version       integer not null check (prompt_version > 0),
  created_at           timestamptz not null default clock_timestamp(),
  foreign key (document_version_id, tenant_id)
    references evidence.document_versions (id, tenant_id) on delete restrict
);

comment on table network.diligence_document_summaries is
  'Q''s one-line summary of a document version shared in diligence, from that version''s own text. Append-only; shown only beside a share the reader can open.';

create index diligence_document_summaries_document_idx
  on network.diligence_document_summaries (document_id, created_at desc);

-- Same rule as requests and fulfilments: history is the rows.
create trigger diligence_document_views_append_only
  before update or delete on network.diligence_document_views
  for each row execute function private.network_diligence_append_only();

create trigger diligence_document_summaries_append_only
  before update or delete on network.diligence_document_summaries
  for each row execute function private.network_diligence_append_only();

alter table network.diligence_document_views enable row level security;
alter table network.diligence_document_summaries enable row level security;
