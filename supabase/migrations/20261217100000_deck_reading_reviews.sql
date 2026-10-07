-- F26 (seed findings, 2026-10-07): a founder reviews Q's deck reading one
-- section at a time, and may ask Q to read the deck again.
--
--   reading_number     a deck version may now hold several readings under
--                      one prompt version: Q's first (1), each "Read again",
--                      and a copy the deterministic figure check corrected.
--                      Every one is appended; none is rewritten.
--   set_aside          the figures the check found Q citing that the deck's
--                      text never states (owner-facing explanation only).
--   deck_section_reviews       CONFIRM / DISMISS / CORRECT, per section,
--                              append-only; the newest per section counts.
--   deck_read_again_requests   the founder's "Read again" (budget: two per
--   deck_read_again_outcomes   deck version), and what the worker did.
--
-- Server-only, like the readings themselves: RLS on, no policies, no
-- client grants. Application authorisation decides the owner.

alter table evidence.deck_extractions
  add column reading_number integer not null default 1
    check (reading_number between 1 and 20),
  add column reading_origin text not null default 'FIRST_READ'
    check (reading_origin in ('FIRST_READ', 'READ_AGAIN', 'FIGURE_CHECK')),
  add column set_aside jsonb
    check (set_aside is null or jsonb_typeof(set_aside) = 'array');

alter table evidence.deck_extractions
  drop constraint deck_extractions_document_version_id_prompt_version_key;
alter table evidence.deck_extractions
  add constraint deck_extractions_version_reading_key
    unique (document_version_id, prompt_version, reading_number);

comment on column evidence.deck_extractions.reading_number is
  'F26: which reading of this version under this prompt version (1 = first). A new reading is appended, never an overwrite.';

create table evidence.deck_section_reviews (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  extraction_id         uuid not null,
  section               text not null check (section ~ '^[A-Z_]{2,32}$'),
  action                text not null check (action in ('CONFIRM', 'DISMISS', 'CORRECT')),
  correction            text check (correction is null or length(correction) between 1 and 600),
  reviewed_by_user_id   uuid not null references identity.user_profiles (id) on delete restrict,
  created_at            timestamptz not null default clock_timestamp(),
  check ((action = 'CORRECT') = (correction is not null)),
  foreign key (extraction_id, tenant_id)
    references evidence.deck_extractions (id, tenant_id) on delete restrict
);

comment on table evidence.deck_section_reviews is
  'F26: the founder''s review of one section of Q''s deck reading (the Write Gate, per section). CORRECT carries their own words (USER_CLAIM). Append-only; the newest per (extraction, section) counts.';

create index deck_section_reviews_extraction_idx
  on evidence.deck_section_reviews (extraction_id, section, created_at desc);

create table evidence.deck_read_again_requests (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  extraction_id         uuid not null,
  document_version_id   uuid not null,
  requested_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  created_at            timestamptz not null default clock_timestamp(),
  foreign key (extraction_id, tenant_id)
    references evidence.deck_extractions (id, tenant_id) on delete restrict,
  foreign key (document_version_id, tenant_id)
    references evidence.document_versions (id, tenant_id) on delete restrict
);

create index deck_read_again_requests_version_idx
  on evidence.deck_read_again_requests (document_version_id, created_at);

create table evidence.deck_read_again_outcomes (
  request_id            uuid primary key references evidence.deck_read_again_requests (id) on delete restrict,
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  outcome               text not null check (outcome in ('READ', 'EMPTY', 'NO_TEXT', 'NOT_ELIGIBLE', 'FAILED')),
  created_at            timestamptz not null default clock_timestamp()
);

comment on table evidence.deck_read_again_requests is
  'F26: a founder asked Q to read the current deck version again. At most two per version (enforced by the service, budget). Append-only.';

-- At most two "Read again" per deck version, held by the database too, so
-- a raced pair of presses cannot spend a third model reading.
create function private.deck_read_again_budget()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.document_version_id::text, 26));
  if (select count(*) from evidence.deck_read_again_requests r
       where r.document_version_id = new.document_version_id) >= 2 then
    raise exception 'read again is limited to two per deck version'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function private.deck_read_again_budget() from public, anon, authenticated;

create trigger deck_read_again_requests_budget
  before insert on evidence.deck_read_again_requests
  for each row execute function private.deck_read_again_budget();

create trigger deck_section_reviews_append_only
  before update or delete on evidence.deck_section_reviews
  for each row execute function private.evidence_data_room_append_only();
create trigger deck_read_again_requests_append_only
  before update or delete on evidence.deck_read_again_requests
  for each row execute function private.evidence_data_room_append_only();
create trigger deck_read_again_outcomes_append_only
  before update or delete on evidence.deck_read_again_outcomes
  for each row execute function private.evidence_data_room_append_only();

alter table evidence.deck_section_reviews enable row level security;
alter table evidence.deck_read_again_requests enable row level security;
alter table evidence.deck_read_again_outcomes enable row level security;
revoke all on evidence.deck_section_reviews, evidence.deck_read_again_requests,
  evidence.deck_read_again_outcomes
  from anon, authenticated;
