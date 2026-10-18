-- CQ-NET-010 · network.interests and network.interest_requests: an investor
-- organisation's Express Interest in a company (doc 13 §29.1, §92; doc 19
-- §2.5; doc 22 §42-§45).
--
--   Interest ≠ Match ≠ Save ≠ Viewing ≠ Relationship State ≠ Outcome
--
-- An interest is unilateral: the investor organisation telling the company
-- it would like to explore it. It is not a match (CQ-NET-011), not a
-- commitment and not a state; `network.relationships.current_state` is
-- untouched here and stays the projector's (CQ-NET-012). Every interest
-- hangs off the ONE canonical relationship row for the pair and names the
-- `interest_expressed` history event it was recorded with, so the history
-- stays the authority and this table is the command's own record.
--
-- Save and Pass live in recommendation.interaction_events and never write
-- here; nothing in this migration reads them.
--
-- Server-internal like the rest of the network schema: RLS enabled, no
-- policies, no browser grants. Party access arrives through the API.

-- ---------------------------------------------------------------------------
-- network.interests
-- ---------------------------------------------------------------------------

create table network.interests (
  id                            uuid primary key default gen_random_uuid(),
  -- The relationship's (company's) tenant anchor, ADR 0003.
  tenant_id                     uuid not null references identity.tenants (id) on delete restrict,
  relationship_id               uuid not null,
  -- Investor pull only. A founder's push is GateQ, which is not an interest.
  expressed_by_party            text not null check (expressed_by_party in ('INVESTOR')),
  status                        text not null default 'EXPRESSED'
                                  check (status in ('EXPRESSED', 'WITHDRAWN')),
  -- Attribution: the person, and the organisation they acted for.
  expressed_by_user_id          uuid not null references identity.user_profiles (id) on delete restrict,
  expressed_in_organisation_id  uuid not null references identity.organisations (id) on delete restrict,
  -- The history row this interest was recorded with. One each way.
  relationship_event_id         uuid not null unique
                                  references network.relationship_events (id) on delete restrict,
  created_at                    timestamptz not null default clock_timestamp(),
  withdrawn_at                  timestamptz,

  check ((status = 'WITHDRAWN') = (withdrawn_at is not null)),
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict
);

comment on table network.interests is
  'Unilateral Express Interest by an investor organisation, on the one canonical relationship. Not a match, not a state; the interest_expressed history event is the authority.';

-- Expressing interest twice is one interest: at most one open interest per
-- party per relationship. Withdrawal (a later packet) frees the slot.
create unique index interests_one_open_per_party_idx
  on network.interests (relationship_id, expressed_by_party)
  where status = 'EXPRESSED';
create index interests_relationship_created_idx
  on network.interests (relationship_id, created_at desc);

alter table network.interests enable row level security;
-- No policies and no client grants: server-internal.

-- ---------------------------------------------------------------------------
-- network.interest_requests  (server-only idempotency record, doc 22 §43)
-- ---------------------------------------------------------------------------

create table network.interest_requests (
  user_id               uuid not null references identity.user_profiles (id) on delete restrict,
  organisation_id       uuid not null,
  tenant_id             uuid not null,
  idempotency_key_hash  text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_hash          text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  interest_id           uuid not null references network.interests (id) on delete restrict,
  created_at            timestamptz not null default clock_timestamp(),
  primary key (user_id, organisation_id, idempotency_key_hash),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

comment on table network.interest_requests is
  'Idempotency record for Express Interest: (person, organisation, key hash) -> the interest the command resolved to. Hashes only; written in the command transaction; server-only.';

create index interest_requests_interest_idx
  on network.interest_requests (interest_id);

alter table network.interest_requests enable row level security;
-- No policies and no client grants: server-internal.

-- ---------------------------------------------------------------------------
-- Reference data (production, idempotent; mirrored in the local seed)
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('investor.interest.express', 'Express the investor organisation''s interest in a company, telling its founders the organisation would like to explore it.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'investor.interest.express'),
      ('organisation_member', 'investor.interest.express')
    )
on conflict (role_id, capability_id) do nothing;
