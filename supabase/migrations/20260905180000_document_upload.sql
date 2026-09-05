-- CQ-EVD-002 · Secure direct document upload: the private bucket, the
-- durable upload session and its idempotency record (doc 15 §24–30, doc 16
-- TM-FILE-01…07, doc 22 §64).
--
--   transferred ≠ validated ≠ scanned ≠ parsed ≠ safe
--   storage key ≠ authorization        declared type ≠ actual content
--
-- The browser transfers bytes straight into private storage using a
-- server-issued, single-object, short-lived authorization. It never chooses
-- the bucket, the key, the tenant, the owner or any security state, and it
-- never holds a privileged storage credential. Bytes that land are
-- quarantined until the server has verified their size, signature and hash;
-- only then does an immutable DocumentVersion exist, and even then the
-- version is malware PENDING and extraction NOT_STARTED.
--
-- No parser, no scanner, no queue and no download route exists here.

-- ---------------------------------------------------------------------------
-- The private document bucket.
--
-- `public = false` is a release blocker (doc 16 TM-FILE-06): a public bucket
-- would make every private business document world-readable by object path.
-- The upsert re-asserts it, so an environment that drifted is corrected the
-- next time migrations run. `storage.objects` keeps RLS with no policy for
-- this bucket, so anonymous and authenticated browser credentials can
-- neither read, list, write nor delete; the signed upload token is the only
-- browser-reachable write path, and it is scoped to one object.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cq-documents-private',
  'cq-documents-private',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Upload sessions: one authorised transfer into one server-chosen object.
-- ---------------------------------------------------------------------------

create table evidence.document_upload_sessions (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references identity.tenants (id) on delete restrict,
  owner_organisation_id  uuid not null,
  created_by_user_id     uuid not null references identity.user_profiles (id) on delete restrict,
  document_id            uuid not null,
  storage_bucket         text not null check (storage_bucket ~ '^[a-z][a-z0-9-]{1,62}$'),
  -- Server-generated and random. Knowing it grants nothing.
  storage_key            text not null check (storage_key ~ '^[a-z0-9][a-z0-9/_.-]{0,254}$' and position('..' in storage_key) = 0),
  -- Display metadata only; never a path and never an object identity.
  original_filename      text not null check (length(original_filename) between 1 and 255 and original_filename !~ '[\\/]'),
  -- What the browser said. Provenance; the stored version records what the
  -- bytes actually were.
  declared_mime_type     text not null check (length(declared_mime_type) between 3 and 129 and declared_mime_type ~ '^[^/[:space:]]+/[^/[:space:]]+$'),
  declared_size_bytes    bigint not null check (declared_size_bytes >= 1),
  -- Re-checked at finalization, so a role removed in between is honoured.
  authorising_capability text not null check (authorising_capability in ('document.create', 'document.manage')),
  status                 text not null default 'PENDING_AUTHORIZATION' check (status in (
                           'PENDING_AUTHORIZATION', 'AUTHORIZED', 'FINALIZING',
                           'COMPLETED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  expires_at             timestamptz not null,
  finalized_at           timestamptz,
  document_version_id    uuid,
  failure_code           text check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  -- True when bytes refused at validation could not be deleted. Validity
  -- never depends on cleanup succeeding.
  cleanup_pending        boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                integer not null default 1 check (version >= 1),
  unique (id, tenant_id),
  -- One session per object identity: a key is never reused, so a completed
  -- upload's bytes can never be replaced through a second authorization.
  unique (storage_bucket, storage_key),
  foreign key (document_id, tenant_id)
    references evidence.documents (id, tenant_id) on delete restrict,
  foreign key (document_version_id, tenant_id)
    references evidence.document_versions (id, tenant_id) on delete restrict,
  foreign key (owner_organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict,
  -- COMPLETED means a version exists; nothing else may name one.
  check (status <> 'COMPLETED' or (document_version_id is not null and finalized_at is not null)),
  check (document_version_id is null or status = 'COMPLETED'),
  check (status not in ('REJECTED', 'EXPIRED') or failure_code is not null),
  check (failure_code is null or status in ('REJECTED', 'EXPIRED'))
);

comment on table evidence.document_upload_sessions is
  'One authorised transfer into one server-chosen private object. COMPLETED means the bytes arrived, passed the upload boundary and became an immutable version; it never means scanned, parsed or safe.';
comment on column evidence.document_upload_sessions.storage_key is
  'Server-generated random object identity. Never derived from the filename, the title or any business id, and never an authorization.';
comment on column evidence.document_upload_sessions.declared_mime_type is
  'The browser''s claim, kept as provenance. The version''s mime_type is what the stored bytes were detected to be.';
comment on column evidence.document_upload_sessions.cleanup_pending is
  'Refused bytes that could not be deleted. The object stays private and unattachable; the debt is recorded rather than hidden.';

create index document_upload_sessions_open_idx
  on evidence.document_upload_sessions (tenant_id, owner_organisation_id, expires_at)
  where status in ('PENDING_AUTHORIZATION', 'AUTHORIZED', 'FINALIZING');
create index document_upload_sessions_document_idx
  on evidence.document_upload_sessions (document_id, created_at desc);

create trigger set_updated_at
  before update on evidence.document_upload_sessions
  for each row execute function private.set_updated_at();

-- The object identity a session was authorised for never changes: a
-- session cannot be pointed at someone else's bytes after the fact.
create or replace function evidence.protect_upload_session_identity() returns trigger
language plpgsql as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.owner_organisation_id is distinct from old.owner_organisation_id
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.document_id is distinct from old.document_id
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_key is distinct from old.storage_key
     or new.original_filename is distinct from old.original_filename
     or new.declared_mime_type is distinct from old.declared_mime_type
     or new.declared_size_bytes is distinct from old.declared_size_bytes
     or new.authorising_capability is distinct from old.authorising_capability
     or new.expires_at is distinct from old.expires_at then
    raise exception 'upload session identity is immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function evidence.protect_upload_session_identity() from public;

create trigger document_upload_sessions_identity_immutable
  before update on evidence.document_upload_sessions
  for each row execute function evidence.protect_upload_session_identity();

alter table evidence.document_upload_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- Idempotency: one key, one session, one document.
--
-- A retried request returns the session it already created rather than a
-- second document over a second storage object; the same key with different
-- content is a conflict.
-- ---------------------------------------------------------------------------

create table evidence.document_upload_requests (
  user_id              uuid not null references identity.user_profiles (id) on delete restrict,
  organisation_id      uuid not null,
  tenant_id            uuid not null,
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_hash         text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  upload_session_id    uuid not null,
  created_at           timestamptz not null default now(),
  primary key (user_id, organisation_id, idempotency_key_hash),
  foreign key (upload_session_id, tenant_id)
    references evidence.document_upload_sessions (id, tenant_id) on delete restrict,
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

comment on table evidence.document_upload_requests is
  'Durable idempotency for upload-session creation. Stores hashes only: never the key, never the request body, never a signed target.';

create index document_upload_requests_session_idx
  on evidence.document_upload_requests (upload_session_id);

alter table evidence.document_upload_requests enable row level security;
