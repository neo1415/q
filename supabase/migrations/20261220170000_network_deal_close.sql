-- Deal close (founder, 2026-10-08): "After a meeting, how do we close deals?
-- ... end the user journey ... cleanly, and have reports generated at every
-- point that can be used as audit or reports."
--
-- No deal record. The ONE canonical relationship carries the journey; its
-- stage strip is the deterministic deal-stage.v1 reading of
-- network.relationship_events. These tables hold only what the history
-- references and cannot carry in a bounded payload:
--
-- 1. network.deal_terms: the terms both sides see (SAFE, convertible note,
--    priced equity), versioned. A revision is a new version that
--    supersedes the previous one; a signature is recorded once against the
--    signed document. Money is numeric plus ISO currency, never float.
--    Doc 13 §54 (outcome type `term_sheet`).
-- 2. network.deal_closes: the clean end, one per relationship, append-only.
-- 3. network.deal_close_checklist: post-close onboarding ticks per side.
-- 4. network.relationship_reports: audit-grade reports compiled from the
--    record at a stage (meeting summary, diligence, investment memo,
--    closing, pass). Versioned and append-only, each with an explicit
--    visibility: investor_private (owner = investor side), founder_private
--    (owner = company side) or relationship_shared (both parties).
--
-- Server-written only (the API composes each write with its event, audit
-- and outbox row in one transaction). Parties read through RLS as defence
-- in depth; the network schema itself is not granted to clients.

-- ---------------------------------------------------------------------------
-- network.deal_terms
-- ---------------------------------------------------------------------------

create table network.deal_terms (
  id                     uuid primary key default gen_random_uuid(),
  -- The relationship's tenant (the company's, ADR 0003), like the history.
  tenant_id              uuid not null references identity.tenants (id) on delete restrict,
  relationship_id        uuid not null,
  version                integer not null check (version >= 1),
  instrument             text not null check (instrument in ('SAFE', 'CONVERTIBLE_NOTE', 'PRICED_EQUITY', 'OTHER')),
  -- Exact money: numeric plus ISO currency, never float.
  amount                 numeric not null check (amount > 0 and amount < 1e15),
  currency_code          text not null check (currency_code ~ '^[A-Z]{3}$'),
  valuation_cap          numeric check (valuation_cap is null or (valuation_cap > 0 and valuation_cap < 1e15)),
  pre_money_valuation    numeric check (pre_money_valuation is null or (pre_money_valuation > 0 and pre_money_valuation < 1e15)),
  valuation_basis        text check (valuation_basis is null or valuation_basis in ('PRE_MONEY', 'POST_MONEY')),
  discount_percent       numeric check (discount_percent is null or (discount_percent >= 0 and discount_percent < 100)),
  -- Unknown stays unknown: null is "not stated", never "no".
  pro_rata               boolean,
  other_terms            text check (other_terms is null or (length(btrim(other_terms)) between 1 and 2000)),
  -- A company document shared with this relationship (data room); the
  -- service checks the share on the history before recording.
  terms_document_id      uuid,
  status                 text not null default 'RECORDED' check (status in ('RECORDED', 'SIGNED', 'SUPERSEDED')),
  recorded_by_side       text not null check (recorded_by_side in ('INVESTOR', 'COMPANY')),
  recorded_by_user_id    uuid not null references identity.user_profiles (id) on delete restrict,
  signed_document_id     uuid,
  signed_by_user_id      uuid references identity.user_profiles (id) on delete restrict,
  signed_at              timestamptz,
  idempotency_key        text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at             timestamptz not null default clock_timestamp(),
  unique (relationship_id, version),
  unique (recorded_by_user_id, idempotency_key),
  check ((status = 'SIGNED') = (signed_at is not null)),
  check ((signed_at is null) = (signed_by_user_id is null)),
  check ((signed_at is null) = (signed_document_id is null)),
  check (valuation_cap is null or pre_money_valuation is null),
  check ((valuation_cap is null and pre_money_valuation is null) or valuation_basis is not null or pre_money_valuation is not null),
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict
);

comment on table network.deal_terms is
  'Terms on a canonical relationship (SAFE, note, priced), versioned: a revision supersedes, a signature is recorded once with the signed document. Never a parallel deal record; the history carries deal_terms_* events.';

-- One current version (RECORDED or SIGNED) per relationship.
create unique index deal_terms_one_current_idx
  on network.deal_terms (relationship_id)
  where status in ('RECORDED', 'SIGNED');

-- Corrections create history: only RECORDED -> SIGNED | SUPERSEDED, and only
-- the signing columns may change. Nothing is deleted.
create function private.network_deal_terms_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'network.deal_terms is never deleted' using errcode = '55000';
  end if;
  if old.status <> 'RECORDED' or new.status not in ('SIGNED', 'SUPERSEDED') then
    raise exception 'deal terms move only from RECORDED to SIGNED or SUPERSEDED' using errcode = '55000';
  end if;
  if (new.id, new.tenant_id, new.relationship_id, new.version, new.instrument, new.amount,
      new.currency_code, new.valuation_cap, new.pre_money_valuation, new.valuation_basis,
      new.discount_percent, new.pro_rata, new.other_terms, new.terms_document_id,
      new.recorded_by_side, new.recorded_by_user_id, new.idempotency_key, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.relationship_id, old.version, old.instrument, old.amount,
      old.currency_code, old.valuation_cap, old.pre_money_valuation, old.valuation_basis,
      old.discount_percent, old.pro_rata, old.other_terms, old.terms_document_id,
      old.recorded_by_side, old.recorded_by_user_id, old.idempotency_key, old.created_at) then
    raise exception 'recorded terms are never edited: record a new version' using errcode = '55000';
  end if;
  return new;
end
$$;

revoke all on function private.network_deal_terms_guard() from public, anon, authenticated;

create trigger deal_terms_guard
  before update or delete on network.deal_terms
  for each row execute function private.network_deal_terms_guard();

alter table network.deal_terms enable row level security;

-- Both parties read the terms: they are the subject of both.
create policy deal_terms_select_party
  on network.deal_terms for select to authenticated
  using (
    (select private.is_relationship_side_member(relationship_id, 'INVESTOR'))
    or (select private.is_relationship_side_member(relationship_id, 'COMPANY'))
  );

grant select on network.deal_terms to authenticated;

-- ---------------------------------------------------------------------------
-- network.deal_closes
-- ---------------------------------------------------------------------------

create table network.deal_closes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  -- One clean end per relationship.
  relationship_id     uuid not null unique,
  terms_id            uuid not null references network.deal_terms (id) on delete restrict,
  commitment_id       uuid not null references network.commitments (id) on delete restrict,
  closed_by_side      text not null check (closed_by_side in ('INVESTOR', 'COMPANY')),
  closed_by_user_id   uuid not null references identity.user_profiles (id) on delete restrict,
  closed_on           date not null,
  note                text check (note is null or length(btrim(note)) between 1 and 1000),
  idempotency_key     text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at          timestamptz not null default clock_timestamp(),
  unique (closed_by_user_id, idempotency_key),
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict
);

comment on table network.deal_closes is
  'The clean end of an investment on a canonical relationship: signed terms and received money, closed once. Append-only; the history carries deal_closed.';

-- ---------------------------------------------------------------------------
-- network.deal_close_checklist
-- ---------------------------------------------------------------------------

create table network.deal_close_checklist (
  relationship_id     uuid not null,
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  side                text not null check (side in ('INVESTOR', 'COMPANY')),
  item_code           text not null check (item_code ~ '^[A-Z][A-Z_]{2,47}$'),
  done_by_user_id     uuid not null references identity.user_profiles (id) on delete restrict,
  done_at             timestamptz not null default clock_timestamp(),
  primary key (relationship_id, side, item_code),
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict
);

comment on table network.deal_close_checklist is
  'Post-close onboarding ticks, one per side and item (founder: investor onboarded; investor: portfolio entry). Ticked once; append-only.';

-- ---------------------------------------------------------------------------
-- network.relationship_reports
-- ---------------------------------------------------------------------------

create table network.relationship_reports (
  id                    uuid primary key default gen_random_uuid(),
  -- The owner's tenant: the investor's for investor_private, the
  -- relationship's (company's) otherwise.
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  relationship_id       uuid not null references network.relationships (id) on delete restrict,
  kind                  text not null check (kind in ('MEETING_SUMMARY', 'DILIGENCE', 'INVESTMENT_MEMO', 'CLOSING', 'PASS')),
  -- The side that generated it; a private report is that side's own.
  owner_side            text not null check (owner_side in ('INVESTOR', 'COMPANY')),
  visibility_scope      text not null check (visibility_scope in ('investor_private', 'founder_private', 'relationship_shared')),
  version               integer not null check (version >= 1),
  title                 text not null check (length(btrim(title)) between 1 and 160),
  -- Deterministic compilation of the record (sections, rows, gaps).
  content               jsonb not null check (jsonb_typeof(content) = 'object' and length(content::text) <= 200000),
  content_sha256        text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- The last history sequence it was compiled through.
  through_sequence      bigint not null check (through_sequence >= 0),
  compiler_version      text not null check (compiler_version ~ '^[a-z][a-z0-9_.-]{2,40}$'),
  generated_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  idempotency_key       text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at            timestamptz not null default clock_timestamp(),
  unique (relationship_id, kind, owner_side, version),
  unique (generated_by_user_id, idempotency_key),
  -- A private report is private to the side that owns it.
  check (visibility_scope = 'relationship_shared'
         or (visibility_scope = 'investor_private' and owner_side = 'INVESTOR')
         or (visibility_scope = 'founder_private' and owner_side = 'COMPANY')),
  -- The memo and the pass report are the investor's own judgement.
  check (kind not in ('INVESTMENT_MEMO', 'PASS') or visibility_scope = 'investor_private')
);

comment on table network.relationship_reports is
  'Audit-grade reports compiled deterministically from a relationship''s record at a stage. Versioned and append-only; visibility investor_private, founder_private or relationship_shared.';

create index relationship_reports_relationship_idx
  on network.relationship_reports (relationship_id, created_at desc);

create function private.network_deal_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end
$$;

revoke all on function private.network_deal_append_only() from public, anon, authenticated;

create trigger relationship_reports_append_only
  before update or delete on network.relationship_reports
  for each row execute function private.network_deal_append_only();
create trigger deal_closes_append_only
  before update or delete on network.deal_closes
  for each row execute function private.network_deal_append_only();
create trigger deal_close_checklist_append_only
  before update or delete on network.deal_close_checklist
  for each row execute function private.network_deal_append_only();

alter table network.deal_closes enable row level security;
alter table network.deal_close_checklist enable row level security;
alter table network.relationship_reports enable row level security;

create policy deal_closes_select_party
  on network.deal_closes for select to authenticated
  using (
    (select private.is_relationship_side_member(relationship_id, 'INVESTOR'))
    or (select private.is_relationship_side_member(relationship_id, 'COMPANY'))
  );

-- A side's checklist is its own.
create policy deal_close_checklist_select_own_side
  on network.deal_close_checklist for select to authenticated
  using ((select private.is_relationship_side_member(relationship_id, side)));

-- Shared reports: both parties. Private reports: the owning side only.
create policy relationship_reports_select_shared
  on network.relationship_reports for select to authenticated
  using (
    visibility_scope = 'relationship_shared'
    and ((select private.is_relationship_side_member(relationship_id, 'INVESTOR'))
         or (select private.is_relationship_side_member(relationship_id, 'COMPANY')))
  );
create policy relationship_reports_select_own_private
  on network.relationship_reports for select to authenticated
  using (
    visibility_scope in ('investor_private', 'founder_private')
    and (select private.is_relationship_side_member(relationship_id, owner_side))
  );

grant select on network.deal_closes to authenticated;
grant select on network.deal_close_checklist to authenticated;
grant select on network.relationship_reports to authenticated;
