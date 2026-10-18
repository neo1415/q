-- CQ-NET-011 · network.interest_responses, network.matches and their
-- idempotency record: a company answering an investor's interest (doc 13
-- §29.2, doc 17 §85, doc 25 §119).
--
--   Interest ≠ Response ≠ Match ≠ Relationship State ≠ Meeting ≠ Deal
--
-- One response per interest, from the company's side: ACCEPTED or
-- DECLINED, recorded with the history event it was written with. An
-- acceptance also opens the formal bilateral connection -- the match -- on
-- the SAME canonical relationship; a decline opens nothing. A match is not
-- an investment and carries no score, no percentage and no celebration.
--
-- `network.relationships.current_state` is untouched: the projector
-- (CQ-NET-012) derives state from the history. Nothing here is a message
-- thread (CQ-COMM-001).
--
-- Server-internal like the rest of the network schema: RLS enabled, no
-- policies, no browser grants. Each party reads through the API.

-- A response names its interest AND that interest's relationship, so the
-- two can never disagree.
alter table network.interests
  add constraint interests_id_relationship_key unique (id, relationship_id);

-- ---------------------------------------------------------------------------
-- network.interest_responses
-- ---------------------------------------------------------------------------

create table network.interest_responses (
  id                            uuid primary key default gen_random_uuid(),
  -- The relationship's (company's) tenant anchor, ADR 0003.
  tenant_id                     uuid not null references identity.tenants (id) on delete restrict,
  relationship_id               uuid not null,
  -- One answer per interest. A second, different answer is a conflict,
  -- never a silent overwrite.
  interest_id                   uuid not null unique,
  decision                      text not null check (decision in ('ACCEPTED', 'DECLINED')),
  -- Attribution: the person, and the company organisation they acted for.
  responded_by_user_id          uuid not null references identity.user_profiles (id) on delete restrict,
  responded_in_organisation_id  uuid not null references identity.organisations (id) on delete restrict,
  -- The history row this answer was recorded with. One each way.
  relationship_event_id         uuid not null unique
                                  references network.relationship_events (id) on delete restrict,
  created_at                    timestamptz not null default clock_timestamp(),

  foreign key (interest_id, relationship_id)
    references network.interests (id, relationship_id) on delete restrict,
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict
);

comment on table network.interest_responses is
  'The company''s one answer to an investor interest: ACCEPTED (opens a match) or DECLINED (opens nothing). Carries no reason: a decline is recorded honestly and says nothing harsh or private.';

create index interest_responses_relationship_idx
  on network.interest_responses (relationship_id, created_at desc);

alter table network.interest_responses enable row level security;
-- No policies and no client grants: server-internal.

-- ---------------------------------------------------------------------------
-- network.matches  (doc 13 §29.2: bilateral)
-- ---------------------------------------------------------------------------

create table network.matches (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  relationship_id       uuid not null,
  -- How both sides came to agree. V1 has one route: the company accepted
  -- the investor's interest. Bounded text, extended by later packets.
  match_source          text not null check (match_source in ('INTEREST_ACCEPTED')),
  -- The acceptance that made it bilateral.
  interest_response_id  uuid not null unique
                          references network.interest_responses (id) on delete restrict,
  status                text not null default 'ACTIVE' check (status in ('ACTIVE', 'ENDED')),
  matched_at            timestamptz not null default clock_timestamp(),
  ended_at              timestamptz,
  created_at            timestamptz not null default clock_timestamp(),

  check ((status = 'ENDED') = (ended_at is not null)),
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict
);

comment on table network.matches is
  'The formal bilateral connection on the one canonical relationship: both sides have agreed to connect. Not an investment, not a state; the connection_accepted history event is the authority.';

-- At most one active connection per relationship.
create unique index matches_one_active_per_relationship_idx
  on network.matches (relationship_id)
  where status = 'ACTIVE';

alter table network.matches enable row level security;
-- No policies and no client grants: server-internal.

-- ---------------------------------------------------------------------------
-- network.interest_response_requests  (server-only idempotency record)
-- ---------------------------------------------------------------------------

create table network.interest_response_requests (
  user_id               uuid not null references identity.user_profiles (id) on delete restrict,
  organisation_id       uuid not null,
  tenant_id             uuid not null,
  idempotency_key_hash  text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_hash          text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  interest_response_id  uuid not null references network.interest_responses (id) on delete restrict,
  created_at            timestamptz not null default clock_timestamp(),
  primary key (user_id, organisation_id, idempotency_key_hash),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

comment on table network.interest_response_requests is
  'Idempotency record for accepting or declining an interest: (person, organisation, key hash) -> the response. Hashes only; written in the command transaction; server-only.';

create index interest_response_requests_response_idx
  on network.interest_response_requests (interest_response_id);

alter table network.interest_response_requests enable row level security;
-- No policies and no client grants: server-internal.

-- ---------------------------------------------------------------------------
-- Reference data (production, idempotent; mirrored in the local seed)
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('company.interest.view',    'See which investor organisations have expressed interest in the company, and how the company answered.'),
  ('company.interest.respond', 'Accept or decline an investor organisation''s interest in the company on the company''s behalf.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'company.interest.view'),
      ('organisation_admin',  'company.interest.respond'),
      ('organisation_member', 'company.interest.view'),
      ('organisation_member', 'company.interest.respond')
    )
on conflict (role_id, capability_id) do nothing;
