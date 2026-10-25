-- Live e2e 25 Oct 2026 · onboarding.document_reviews
--
-- That Q's review of a founder's document has finished, and how many new
-- offers it made. A re-uploaded deck that added nothing new left no trace:
-- the review created no suggestion, so the screen could not tell "still
-- reading" from "read, nothing new", promised "I'll show you what I found"
-- and waited 180 s in silence. The session view now carries the documents
-- whose review finished, so Q can say plainly that one adds nothing new.
--
-- One row per (session, document version). A record that a reading ran,
-- not journey truth: nothing here is a response, a value or a suggestion.
-- Written by the worker's review and read by the API for the session's own
-- user only; the browser never touches the table.

create table onboarding.document_reviews (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references identity.tenants (id) on delete restrict,
  session_id           uuid not null references onboarding.sessions (id) on delete restrict,
  document_id          uuid not null,
  document_version_id  uuid not null,
  -- New offers the review made for this session from this version.
  suggestions_created  integer not null check (suggestions_created between 0 and 200),
  reviewed_at          timestamptz not null default clock_timestamp()
);

comment on table onboarding.document_reviews is
  'Append-only: a founder document version Q reviewed for an onboarding session, and how many new offers it made. A record that a reading ran; never a response or canonical value.';

-- Idempotency: a redelivered review of the same version writes nothing.
create unique index document_reviews_session_version_key
  on onboarding.document_reviews (session_id, document_version_id);

-- Tenant ownership is the session's: a row can never name another tenant.
create function onboarding.document_review_tenant_matches()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from onboarding.sessions s
     where s.id = new.session_id and s.tenant_id = new.tenant_id
  ) then
    raise exception 'onboarding.document_reviews tenant must be the session''s'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function onboarding.document_review_tenant_matches() from public;

create trigger document_reviews_tenant_matches
  before insert on onboarding.document_reviews
  for each row execute function onboarding.document_review_tenant_matches();

-- ---------------------------------------------------------------------------
-- Immutability: a review is recorded once and never rewritten.
-- ---------------------------------------------------------------------------

create function onboarding.protect_document_reviews()
returns trigger
language plpgsql
as $$
begin
  raise exception 'onboarding.document_reviews is append-only'
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function onboarding.protect_document_reviews() from public;

create trigger document_reviews_append_only
  before update or delete on onboarding.document_reviews
  for each row execute function onboarding.protect_document_reviews();

-- Exposure: INTERNAL_SERVER_ONLY, like every other journey-state table.
alter table onboarding.document_reviews enable row level security;
-- No policies, no anon/authenticated/service_role grants.
