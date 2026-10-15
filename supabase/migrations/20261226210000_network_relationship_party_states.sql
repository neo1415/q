-- CRM pipeline read model (owner directive 2026-10-15 §D; lane C, slice 3b).
--
-- One row per canonical relationship and party (INVESTOR, COMPANY): that
-- party's own fold of the relationship history -- the same visibility
-- filter, deterministic projector and next-step rule as the per-party read
-- -- so the CRM pipeline filters, sorts and pages in the database instead
-- of re-folding every relationship in memory (the bounded 1,000-row scan).
--
--   a party state ≠ a relationship, a match or a deal record
--
-- Derived and disposable: written only by the relationship projector (and
-- the read path's repair of a row that is behind), never by a person or a
-- model, and rebuildable from relationship_events at any time. It holds no
-- counterpart name (read fresh at query time), no event payloads, notes or
-- documents. Investor-side visibility of the company is still decided at
-- read time by the disclosure rules; nothing here grants sight of anything.
-- Server-only: RLS on as a second layer, no policies, no client grants.
--
-- Backfill after applying (operator, worker identity; safe to repeat):
--   cd apps/workers && node --import ../../scripts/dev-env.mjs \
--     src/dev/rebuild-relationship-states.ts --all
-- Until then the API folds a party's missing rows on read (up to 200 per
-- request) and keeps the existing bounded path beyond that.

create table network.relationship_party_states (
  relationship_id           uuid not null
    references network.relationships (id) on delete cascade,
  party                     text not null check (party in ('INVESTOR', 'COMPANY')),
  tenant_id                 uuid not null,
  company_id                uuid not null,
  investor_organisation_id  uuid not null,
  -- False: nothing on record this party may see (an investor's private
  -- discovery, seen from the company). Such a row is never listed.
  visible                   boolean not null,
  state                     text check (state is null or state ~ '^[A-Z][A-Z_]{1,39}$'),
  -- Millisecond precision, the same instant the per-party read reports.
  state_since               timestamptz,
  next_step                 text check (next_step is null or next_step ~ '^[A-Z][A-Z_]{1,39}$'),
  -- How far into the relationship's own history this fold read
  -- (network.relationships.last_event_sequence at the time): the
  -- compare-and-set that keeps a late fold from overwriting a newer one.
  source_sequence           bigint not null check (source_sequence >= 0),
  projector_version         text not null check (length(projector_version) between 1 and 64),
  projected_at              timestamptz not null default now(),
  primary key (relationship_id, party),
  check (visible = (state is not null)),
  check ((state is null) = (state_since is null)),
  check ((state is null) = (next_step is null))
);

comment on table network.relationship_party_states is
  'CRM pipeline read model (2026-10-15): each party''s deterministic fold of one canonical relationship, for database-side filter, sort and keyset pagination. Derived from relationship_events by the projector; rebuildable; no names, payloads or notes. Server-only.';

-- The pipeline read, per side: state filter plus "recent"/"oldest" keyset.
create index relationship_party_states_investor_idx
  on network.relationship_party_states (investor_organisation_id, state_since, relationship_id)
  where party = 'INVESTOR' and visible;
create index relationship_party_states_company_idx
  on network.relationship_party_states (company_id, state_since, relationship_id)
  where party = 'COMPANY' and visible;

alter table network.relationship_party_states enable row level security;
revoke all on network.relationship_party_states from public, anon, authenticated;
