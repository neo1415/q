-- Commitments (Product Specification 6.6.14-6.6.15; founder direction
-- 2026-09-29: "bookkeeping... how much was given... we take a commission
-- for facilitation of capital").
--
-- A commitment is money one side of a relationship states (soft, firm or
-- invested); it counts as confirmed only when the OTHER side confirms it
-- on Capital Q. Capital Q never adds money said in a call or typed by one
-- side to committed capital on its own (6.6.14). Every statement and every
-- confirmation is timestamped and attributable, which is the facilitation
-- record.
--
-- Append-oriented: a new statement supersedes the relationship's previous
-- open one (status SUPERSEDED), never edits it; each relationship has at
-- most one current commitment, so nothing is counted twice (6.6.15).
-- Relationship State is untouched: commitment is outcome, not state; the
-- history carries `commitment_*` activity events.
--
-- Server-written only; both parties to the relationship read its rows.

create table network.commitments (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references identity.tenants (id) on delete restrict,
  relationship_id            uuid not null references network.relationships (id) on delete restrict,
  -- Exact money: numeric plus ISO currency, never float.
  amount                     numeric not null check (amount > 0 and amount < 1e15),
  currency_code              text not null check (currency_code ~ '^[A-Z]{3}$'),
  level                      text not null check (level in ('SOFT', 'FIRM', 'INVESTED')),
  status                     text not null default 'STATED'
                               check (status in ('STATED', 'CONFIRMED', 'SUPERSEDED', 'WITHDRAWN')),
  stated_by_side             text not null check (stated_by_side in ('COMPANY', 'INVESTOR')),
  stated_by_user_id          uuid not null references identity.user_profiles (id) on delete restrict,
  confirmed_by_user_id       uuid references identity.user_profiles (id) on delete restrict,
  confirmed_at               timestamptz,
  withdrawn_by_user_id       uuid references identity.user_profiles (id) on delete restrict,
  withdrawn_at               timestamptz,
  note                       text check (note is null or length(note) between 1 and 500),
  -- The call it was said in, when recorded from Q's meeting record.
  meeting_id                 uuid references communication.meetings (id) on delete restrict,
  idempotency_key            text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at                 timestamptz not null default clock_timestamp(),
  updated_at                 timestamptz not null default clock_timestamp(),
  unique (stated_by_user_id, idempotency_key),
  check ((status = 'CONFIRMED') = (confirmed_at is not null)),
  check ((confirmed_at is null) = (confirmed_by_user_id is null)),
  check ((status = 'WITHDRAWN') = (withdrawn_at is not null))
);

comment on table network.commitments is
  'Money one side of a relationship stated (soft, firm, invested), confirmed only by the other side. At most one current (STATED or CONFIRMED) per relationship; earlier ones are SUPERSEDED, never edited.';

-- One current commitment per relationship: nothing is counted twice.
create unique index commitments_one_current_idx
  on network.commitments (relationship_id)
  where status in ('STATED', 'CONFIRMED');

create index commitments_relationship_idx
  on network.commitments (relationship_id, created_at desc);

alter table network.commitments enable row level security;

-- A party reads its relationship's commitments: a member of the company's
-- or the investor organisation's organisation.
create policy commitments_select_party
  on network.commitments for select to authenticated
  using (
    exists (
      select 1
        from network.relationships r
        join core.companies c on c.id = r.company_id
        join core.investor_organisations io on io.id = r.investor_organisation_id
        join identity.organisation_memberships m
          on m.organisation_id in (c.organisation_id, io.organisation_id)
         and m.membership_status = 'active'
       where r.id = commitments.relationship_id
         and m.user_id = (select private.current_app_user_id())
    )
  );

grant select on network.commitments to authenticated;
