-- CQ-GATE-002 · gateq.applications and the guest sessions that carry them:
-- a stranger's application to an organisation's front door, without a
-- Capital Q account (doc 11, doc 13; GateQ supplementary spec).
--
--   application ≠ canonical Company
--   applicant said it ≠ verified fact
--   draft ≠ submitted;  submission is the disclosure boundary
--   guest session ≠ membership ≠ capability
--
-- A person who follows a GateQ link has no account, no organisation and no
-- membership, and must not be given a fake one. They get a session bound to
-- exactly one application at exactly one gateway, carrying no capability at
-- all, and everything they say is stored as what it is: a claim with a
-- provenance, not a fact about a company.
--
-- Nothing here creates a canonical Company. A stranger typing a company
-- name is not evidence that a company exists, and the canonical-identity
-- invariant is worth more than the convenience of pretending otherwise.

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------

create table gateq.applications (
  id                    uuid primary key default gen_random_uuid(),
  -- The receiving organisation's tenant. An application belongs to the
  -- gateway it was made to, which is how it is ever read at all.
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  gateway_id            uuid not null references gateq.gateways (id) on delete restrict,

  -- The published policy this application is judged under, frozen at
  -- creation (§15). An investor publishing a new policy halfway through
  -- somebody's interview must not silently change the rules under them,
  -- and a submitted application must stay attributable to what it was
  -- actually measured against.
  gateway_version_id    uuid not null references gateq.gateway_versions (id) on delete restrict,

  -- The applicant's own opaque handle. Like a gateway's, it is unguessable
  -- and grants nothing: the session credential is the authority.
  public_reference      text not null unique
                          check (public_reference ~ '^ga_[0-9a-hjkmnp-tv-z]{26}$'),

  status                text not null default 'IN_PROGRESS'
                          check (status in ('IN_PROGRESS', 'READY_TO_SUBMIT', 'SUBMITTED', 'WITHDRAWN', 'EXPIRED')),

  -- What the applicant calls themselves. Display only, and deliberately
  -- NOT a company id: see the table comment.
  declared_name         text check (declared_name is null or length(btrim(declared_name)) between 1 and 200),

  submitted_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  check ((status = 'SUBMITTED') = (submitted_at is not null))
);

comment on table gateq.applications is
  'A stranger''s application to a gateway. Never a canonical Company: a name typed by somebody with no account is not evidence that a company exists, and linking to one is a later, deliberate act.';
comment on column gateq.applications.gateway_version_id is
  'Frozen at creation. An investor publishing a new policy mid-interview must not change the rules under an applicant already answering them.';

create index applications_by_gateway_idx
  on gateq.applications (gateway_id, created_at desc);
create index applications_by_status_idx
  on gateq.applications (tenant_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Guest sessions
-- ---------------------------------------------------------------------------

create table gateq.application_sessions (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references gateq.applications (id) on delete cascade,
  tenant_id       uuid not null references identity.tenants (id) on delete restrict,

  -- Only the verifier. The raw credential exists in the applicant's browser
  -- and in one HTTP response, and nowhere else ever: a database copy of a
  -- bearer token is a database copy of the ability to impersonate them.
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),

  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),

  check (expires_at > created_at)
);

comment on table gateq.application_sessions is
  'Authority for one application at one gateway, and nothing else. No membership, no organisation, no capability, no other application. Carried as a bearer credential rather than a cookie so an embedded gateway still works when third-party cookies do not.';
comment on column gateq.application_sessions.token_hash is
  'sha256 of the credential. The raw value is never stored.';

create index application_sessions_by_application_idx
  on gateq.application_sessions (application_id, created_at desc);

-- ---------------------------------------------------------------------------
-- What the applicant has told us
-- ---------------------------------------------------------------------------

create table gateq.application_facts (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references gateq.applications (id) on delete cascade,
  tenant_id       uuid not null references identity.tenants (id) on delete restrict,

  -- The information dimension this is about. Bounded vocabulary, validated
  -- again by Zod at the service boundary; a model cannot introduce one.
  dimension       text not null check (dimension ~ '^[a-z][a-z0-9_.]{0,63}$'),

  -- The value, as a bounded discriminated payload. Never free JSON.
  value           jsonb not null
                    check (jsonb_typeof(value) = 'object'
                       and value ? 'kind'
                       and pg_column_size(value) <= 4096),

  -- Where it came from, and it is never upgraded by being useful (§17).
  -- "The founder said $80k MRR" is an applicant claim for as long as it is
  -- only that; it never quietly becomes canonical revenue.
  provenance      text not null check (provenance in (
                    'APPLICANT_PROVIDED', 'DOCUMENT_SUPPORTED', 'ESTIMATED', 'UNKNOWN')),

  -- Null while current. A correction supersedes rather than overwrites, so
  -- "I said Nigeria but the holding company is Kenyan" keeps both the
  -- correction and the thing corrected.
  superseded_at   timestamptz,
  superseded_by   uuid references gateq.application_facts (id) on delete restrict,

  recorded_at     timestamptz not null default now(),

  check ((superseded_at is null) = (superseded_by is null))
);

comment on table gateq.application_facts is
  'One thing the applicant told us, with where it came from. Append-oriented: a correction supersedes its predecessor so the history of what was said survives, and an applicant claim never becomes a verified fact by being stored.';

-- One current fact per dimension. History is everything superseded.
create unique index application_facts_one_current_idx
  on gateq.application_facts (application_id, dimension)
  where superseded_at is null;

create index application_facts_history_idx
  on gateq.application_facts (application_id, dimension, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Submission: the disclosure boundary
-- ---------------------------------------------------------------------------

create table gateq.application_submissions (
  id                  uuid primary key default gen_random_uuid(),
  application_id      uuid not null unique references gateq.applications (id) on delete restrict,
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  gateway_version_id  uuid not null references gateq.gateway_versions (id) on delete restrict,

  -- What was actually submitted, frozen. A later edit to the application
  -- must not silently rewrite what the organisation received (§33).
  snapshot            jsonb not null
                        check (jsonb_typeof(snapshot) = 'object'
                           and pg_column_size(snapshot) <= 262144),
  -- The deterministic engine's answer at submission time, under the frozen
  -- policy version. Never a model's opinion.
  qualification       jsonb not null
                        check (jsonb_typeof(qualification) = 'object'
                           and pg_column_size(qualification) <= 65536),

  -- The applicant's own idempotency key: a double-click or a retried
  -- request is one submission, not two.
  client_request_id   text not null check (length(client_request_id) between 8 and 128),

  submitted_at        timestamptz not null default now(),

  unique (application_id, client_request_id)
);

comment on table gateq.application_submissions is
  'The immutable record of what was submitted and what the deterministic engine made of it. Submission is the disclosure boundary: before it the organisation sees nothing, after it this snapshot is what they received.';

create or replace function gateq.protect_submission()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'a submitted application is what the organisation received and is never rewritten'
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function gateq.protect_submission() from public;

create trigger application_submissions_immutable
  before update or delete on gateq.application_submissions
  for each row execute function gateq.protect_submission();

-- ---------------------------------------------------------------------------
-- Documents the applicant attached
-- ---------------------------------------------------------------------------

create table gateq.application_documents (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references gateq.applications (id) on delete cascade,
  tenant_id       uuid not null references identity.tenants (id) on delete restrict,
  -- The Evidence context owns the document, its processing and its
  -- extraction. This is an association, not a second document store.
  document_id     uuid not null,
  attached_at     timestamptz not null default now(),

  unique (application_id, document_id)
);

comment on table gateq.application_documents is
  'An association to a document the Evidence context owns. GateQ stores no bytes, no storage key and no extracted text: a second document store would be a second set of safety controls to keep correct.';

-- ---------------------------------------------------------------------------
-- Server-only: RLS on, no policy, no browser grant.
--
-- A guest session is verified in the application layer against
-- `token_hash`, and every read is scoped to the one application it names.
-- The browser never reaches a table: a public applicant holds a bearer
-- credential for an API, not a database role.
-- ---------------------------------------------------------------------------

alter table gateq.applications enable row level security;
alter table gateq.application_sessions enable row level security;
alter table gateq.application_facts enable row level security;
alter table gateq.application_submissions enable row level security;
alter table gateq.application_documents enable row level security;
