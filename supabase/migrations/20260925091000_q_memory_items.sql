-- Q memory (doc 13 §40; doc 14 §55-§61, §130-§131; ADR 0012).
--
-- What Capital Q remembers about a person from their own words: how they
-- want to be addressed, how a name is said, what they corrected, what
-- they stated about themselves and their company. One row per remembered
-- thing, owned by a context (a user, an organisation, a company...), in a
-- tenant, with a status lifecycle and a write mode that says how it got
-- here.
--
-- Three rules this table holds on its own:
--
--   Q Memory ≠ Audit History ≠ Q Knowledge. A memory is what a person
--   told Q about themselves, kept so Q behaves as told; it is never
--   evidence about a company (that is q_knowledge.objects, through the
--   Write Gate) and never a record of who did what (that is audit).
--
--   Models do not insert active memories without policy (§40.2). Every
--   row records its write mode; the memory service is the only writer,
--   and it verifies each quote against the person's recorded turns,
--   dedupes by content hash and supersedes by key before anything lands.
--
--   One live value per key per owner. "Call me Dan" after "call me
--   Daniel" supersedes; it does not accumulate. The partial unique index
--   below is what makes that a database fact rather than a service habit.
--
-- Server-internal: RLS on, no grants. Nothing here is reachable through
-- Supabase's API roles; the memory service reads and writes it under the
-- application's own connection with an explicit actor.
create table q_knowledge.memory_items (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  -- Who this memory belongs to. `user` + the person's own id for almost
  -- everything today; the other contexts are the ones doc 14 names, so
  -- a company- or organisation-owned memory has a home when it arrives.
  owner_context_type    text not null check (owner_context_type in (
                          'user', 'organisation', 'company', 'investor',
                          'relationship', 'capital_objective', 'meeting')),
  owner_context_id      uuid not null,
  -- What the memory is about, when that is a canonical entity other than
  -- the owner (a fact the founder stated about their company).
  subject_type          text check (subject_type is null or subject_type in (
                          'PERSON', 'COMPANY', 'INVESTOR_ORGANISATION')),
  subject_id            uuid,
  memory_type           text not null check (memory_type in (
                          'preference', 'pronunciation', 'correction', 'fact', 'episodic')),
  -- A stable name for the thing remembered, so a later value replaces an
  -- earlier one: preference.address_as, pronunciation.nem_salvage.
  memory_key            text not null
                          check (memory_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9][a-z0-9_-]*){0,3}$'
                             and length(memory_key) <= 96),
  -- The memory as one plain sentence Q can act on.
  content               text not null check (length(content) between 1 and 1000),
  structured_value      jsonb not null default '{}'::jsonb
                          check (jsonb_typeof(structured_value) = 'object'
                             and length(structured_value::text) <= 8192),
  -- The person's own words this rests on, verbatim, verified against a
  -- recorded USER turn by the service before the row is written.
  quote                 text check (quote is null or length(quote) <= 400),
  content_sha256        text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- Where it came from: the conversation and run whose turns carry the
  -- quote, or an evidence source when one exists. Never both required.
  source_id             uuid references evidence.sources (id) on delete set null,
  source_conversation_id uuid references q_runtime.conversations (id) on delete set null,
  source_run_id         uuid references q_runtime.runs (id) on delete set null,
  knowledge_object_id   uuid references q_knowledge.objects (id) on delete set null,
  -- How it got here (doc 14 §57). AUTOMATIC_SYSTEM is a deterministic
  -- platform write; USER_CONFIRMED the person said yes to it;
  -- Q_PROPOSED a model read it from their words and the gate verified the
  -- quote; ADMIN_VERIFIED and DERIVED are reserved for their writers.
  write_mode            text not null check (write_mode in (
                          'AUTOMATIC_SYSTEM', 'USER_CONFIRMED', 'Q_PROPOSED',
                          'ADMIN_VERIFIED', 'DERIVED')),
  visibility_scope      text not null default 'personal_private'
                          check (visibility_scope in (
                            'personal_private', 'organisation_private', 'founder_private',
                            'investor_private', 'relationship_shared', 'specifically_shared',
                            'network_visible', 'public_external')),
  sensitivity_class     text not null default 'CONFIDENTIAL'
                          check (sensitivity_class in (
                            'PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL',
                            'HIGHLY_CONFIDENTIAL', 'RESTRICTED')),
  valid_from            timestamptz not null default now(),
  valid_to              timestamptz,
  status                text not null check (status in (
                          'candidate', 'confirmed', 'active', 'superseded',
                          'forgotten', 'revoked', 'archived')),
  superseded_by         uuid references q_knowledge.memory_items (id) on delete set null,
  -- Retrieval bookkeeping, so a memory that is never useful can age out
  -- and one that keeps being used is kept close.
  last_used_at          timestamptz,
  use_count             integer not null default 0 check (use_count >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint memory_items_subject_check
    check ((subject_type is null) = (subject_id is null)),
  constraint memory_items_superseded_check
    check (status <> 'superseded' or superseded_by is not null)
);

comment on table q_knowledge.memory_items is
  'What Q remembers about a person from their own words (doc 13 §40). Server-internal; written only by the memory service after quote verification. Q Memory is not audit history and not company evidence.';

-- The owner's live memory, which is what every recall reads.
create index memory_items_owner_live_idx
  on q_knowledge.memory_items (tenant_id, owner_context_type, owner_context_id, memory_type)
  where status in ('active', 'confirmed');

-- One live value per key per owner.
create unique index memory_items_live_key_idx
  on q_knowledge.memory_items (tenant_id, owner_context_type, owner_context_id, memory_type, memory_key)
  where status in ('candidate', 'confirmed', 'active');

-- The same content is never remembered twice for the same owner.
create unique index memory_items_live_content_idx
  on q_knowledge.memory_items (tenant_id, owner_context_type, owner_context_id, content_sha256)
  where status in ('candidate', 'confirmed', 'active');

create index memory_items_source_conversation_idx
  on q_knowledge.memory_items (tenant_id, source_conversation_id)
  where source_conversation_id is not null;

alter table q_knowledge.memory_items enable row level security;
alter table q_knowledge.memory_items force row level security;
