-- Capital rounds: the full lifecycle and history (plan P8, founder direction
-- 2026-10-06: "the different rounds of raising ... make sure the UX and the
-- database and schema support it fully"). Research:
-- docs/research/2026-10-06/funding-rounds.md.
--
-- 1. core.capital_rounds gains:
--    - lifecycle statuses: PLANNED -> OPEN -> FIRST_CLOSED -> CLOSED, or
--      CANCELLED; a closed round may be reopened (extension or second close)
--    - terms: priced valuation (pre/post), SAFE/note cap and discount, hard
--      cap, target close date, pro-rata rights. Every amount is exact numeric
--      in the round's own ISO currency. NULL means "not said", never zero.
--    - lead investor: the canonical company-investor relationship, or a
--      founder-typed name for a lead who isn't on Capital Q (never a
--      parallel CRM record)
--    - extends_round_id: a bridge or extension of an earlier round of the
--      same company
--    - reported_raised_amount: what a past round raised outside Capital Q,
--      as the founder says (USER_CLAIM); never mixed with RECEIVED money,
--      which stays derived from commitments
--    - revision: optimistic concurrency for edits
--    - the ASA instrument (UK Advance Subscription Agreement)
-- 2. core.capital_round_events: append-only history of every round change
--    (created, terms revised with previous values, closes, tranches, final
--    close, reopen, cancel). Corrections create history; nothing is
--    overwritten silently. Not audit (who acted under whose authority), not
--    outbox, not analytics.
--
-- Forward-only and additive: existing rows keep their meaning (OPEN,
-- PLANNED and CLOSED are unchanged) and get a CREATED (and FINAL_CLOSED)
-- history row.

-- ---------------------------------------------------------------------------
-- core.capital_rounds: status checks replaced, terms added
-- ---------------------------------------------------------------------------

do $$
declare
  found text[];
begin
  -- The four table checks that name the status: its vocabulary, "open has
  -- an opening date", "closed iff closed_on", "a closed round is not
  -- current". Replaced below with the widened lifecycle.
  select array_agg(conname order by conname) into found
    from pg_constraint
   where conrelid = 'core.capital_rounds'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%status%';
  if coalesce(array_length(found, 1), 0) <> 4 then
    raise exception 'expected four status checks on core.capital_rounds, found %', found;
  end if;
  for i in 1 .. array_length(found, 1) loop
    execute format('alter table core.capital_rounds drop constraint %I', found[i]);
  end loop;
end
$$;

alter table core.capital_rounds
  drop constraint capital_rounds_instrument_check,
  add constraint capital_rounds_instrument_check
    check (instrument in ('SAFE', 'EQUITY', 'CONVERTIBLE', 'ASA', 'OTHER')),
  add constraint capital_rounds_status_check
    check (status in ('PLANNED', 'OPEN', 'FIRST_CLOSED', 'CLOSED', 'CANCELLED')),
  add column first_closed_on        date,
  add column cancelled_on           date,
  add column cancelled_reason       text check (cancelled_reason is null or (length(btrim(cancelled_reason)) between 1 and 300 and cancelled_reason !~ '[[:cntrl:]]')),
  add column target_close_on        date,
  add column valuation_amount       numeric check (valuation_amount is null or (valuation_amount > 0 and valuation_amount < 1e15)),
  add column valuation_basis        text check (valuation_basis is null or valuation_basis in ('PRE_MONEY', 'POST_MONEY')),
  add column valuation_cap_amount   numeric check (valuation_cap_amount is null or (valuation_cap_amount > 0 and valuation_cap_amount < 1e15)),
  add column discount_percent       numeric(5, 2) check (discount_percent is null or (discount_percent > 0 and discount_percent < 100)),
  add column hard_cap_amount        numeric check (hard_cap_amount is null or hard_cap_amount < 1e15),
  add column pro_rata_rights        text check (pro_rata_rights is null or pro_rata_rights in ('NONE', 'MAJOR_INVESTORS', 'ALL')),
  add column lead_relationship_id   uuid references network.relationships (id) on delete restrict,
  add column lead_investor_name     text check (lead_investor_name is null or (length(btrim(lead_investor_name)) between 1 and 120 and lead_investor_name !~ '[[:cntrl:]]')),
  add column extends_round_id       uuid,
  add column reported_raised_amount numeric check (reported_raised_amount is null or (reported_raised_amount >= 0 and reported_raised_amount < 1e15)),
  add column revision               integer not null default 1 check (revision >= 1),
  add constraint capital_rounds_opened_check
    check (status in ('PLANNED', 'CANCELLED') or opened_on is not null),
  add constraint capital_rounds_closed_check
    check ((status = 'CLOSED') = (closed_on is not null)),
  add constraint capital_rounds_first_closed_check
    check (status <> 'FIRST_CLOSED' or first_closed_on is not null),
  add constraint capital_rounds_cancelled_check
    check ((status = 'CANCELLED') = (cancelled_on is not null)
           and (cancelled_reason is null or cancelled_on is not null)),
  -- A closed or cancelled round is history, never the current one.
  add constraint capital_rounds_not_current_when_done_check
    check (not (is_current and status in ('CLOSED', 'CANCELLED'))),
  add constraint capital_rounds_valuation_pair_check
    check ((valuation_amount is null) = (valuation_basis is null)),
  add constraint capital_rounds_hard_cap_check
    check (hard_cap_amount is null or hard_cap_amount >= target_amount),
  -- One lead: on Capital Q (the canonical relationship) or named off it.
  add constraint capital_rounds_one_lead_check
    check (lead_relationship_id is null or lead_investor_name is null),
  add constraint capital_rounds_not_self_extension_check
    check (extends_round_id is null or extends_round_id <> id),
  add constraint capital_rounds_first_close_order_check
    check (first_closed_on is null or opened_on is null or first_closed_on >= opened_on),
  add constraint capital_rounds_id_company_key unique (id, company_id);

-- An extension extends a round of the same company (composite key; NULL
-- skips the check).
alter table core.capital_rounds
  add constraint capital_rounds_extends_same_company_fkey
    foreign key (extends_round_id, company_id)
    references core.capital_rounds (id, company_id) on delete restrict;

comment on column core.capital_rounds.reported_raised_amount is
  'What a round raised outside Capital Q, as the company says (USER_CLAIM, in the round currency). Never added to RECEIVED money, which is derived from commitments.';
comment on column core.capital_rounds.lead_relationship_id is
  'The lead investor, as the canonical company-investor relationship. Must be this company''s relationship.';
comment on column core.capital_rounds.lead_investor_name is
  'A lead not on Capital Q, as the company typed it. Not an investor organisation record.';
comment on column core.capital_rounds.revision is
  'Bumped on every change; edits carry the revision they read (optimistic concurrency).';

create index capital_rounds_lead_relationship_idx
  on core.capital_rounds (lead_relationship_id)
  where lead_relationship_id is not null;
create index capital_rounds_extends_idx
  on core.capital_rounds (extends_round_id)
  where extends_round_id is not null;

-- The lead is this company's own relationship.
create function private.capital_round_lead_matches_company()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lead_relationship_id is not null and not exists (
    select 1
      from network.relationships r
     where r.id = new.lead_relationship_id
       and r.company_id = new.company_id
  ) then
    raise exception 'a round''s lead is one of its own company''s relationships'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function private.capital_round_lead_matches_company() from public, anon, authenticated;

create trigger capital_rounds_lead_matches_company
  before insert or update of lead_relationship_id, company_id on core.capital_rounds
  for each row execute function private.capital_round_lead_matches_company();

-- ---------------------------------------------------------------------------
-- core.capital_round_events: append-only round history
-- ---------------------------------------------------------------------------

create table core.capital_round_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  company_id       uuid not null,
  round_id         uuid not null,
  -- The round's revision after this event.
  revision         integer not null check (revision >= 1),
  event_type       text not null check (event_type in (
                     'CREATED', 'TERMS_REVISED', 'OPENED', 'CLOSE_RECORDED', 'TRANCHE_RECORDED',
                     'FINAL_CLOSED', 'REOPENED', 'CANCELLED')),
  -- The date it happened, as the company says (may be in the past).
  occurred_on      date not null,
  -- A close or tranche amount, exact, in the round's currency; NULL: not said.
  amount           numeric check (amount is null or (amount > 0 and amount < 1e15)),
  currency_code    text check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  label            text check (label is null or (length(btrim(label)) between 1 and 120 and label !~ '[[:cntrl:]]')),
  note             text check (note is null or (length(btrim(note)) between 1 and 500 and note !~ '[[:cntrl:]]')),
  -- Typed, bounded canonical values: the fields a revision changed, with
  -- their previous and next values. Never Q text or documents.
  payload          jsonb not null default '{}'::jsonb
                     check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 8192),
  actor_user_id    uuid not null references identity.user_profiles (id) on delete restrict,
  idempotency_key  text check (idempotency_key is null or (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]')),
  -- clock_timestamp(): several rows can be appended in one transaction and
  -- their order must be real.
  created_at       timestamptz not null default clock_timestamp(),
  check ((amount is null) = (currency_code is null)),
  check (amount is null or event_type in ('CLOSE_RECORDED', 'TRANCHE_RECORDED', 'FINAL_CLOSED')),
  unique (round_id, revision),
  foreign key (round_id, tenant_id)
    references core.capital_rounds (id, tenant_id) on delete restrict,
  foreign key (round_id, company_id)
    references core.capital_rounds (id, company_id) on delete restrict,
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict
);

comment on table core.capital_round_events is
  'Append-only history of a capital round: created, terms revised (with previous values), closes, tranches, final close, reopen, cancel. Not audit, not outbox, not analytics.';

create unique index capital_round_events_idempotency_idx
  on core.capital_round_events (actor_user_id, idempotency_key)
  where idempotency_key is not null;
create index capital_round_events_company_idx
  on core.capital_round_events (company_id, created_at);

create function private.capital_round_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'round history is append-only; record a correction instead'
    using errcode = '42501';
end
$$;

revoke all on function private.capital_round_events_append_only() from public, anon, authenticated;

create trigger capital_round_events_append_only
  before update or delete on core.capital_round_events
  for each row execute function private.capital_round_events_append_only();

alter table core.capital_round_events enable row level security;

-- Members of the organisation that owns the company read its round history;
-- the server writes it.
create policy capital_round_events_member_select on core.capital_round_events
  for select to authenticated
  using (exists (
    select 1 from core.companies c
     where c.id = core.capital_round_events.company_id
       and c.tenant_id = core.capital_round_events.tenant_id
       and private.is_organisation_member(c.organisation_id)));

grant select on core.capital_round_events to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: every existing round starts its history
-- ---------------------------------------------------------------------------

insert into core.capital_round_events
  (tenant_id, company_id, round_id, revision, event_type, occurred_on, actor_user_id, created_at)
select tenant_id, company_id, id, 1, 'CREATED', coalesce(opened_on, created_at::date),
       created_by_user_id, created_at
  from core.capital_rounds;

insert into core.capital_round_events
  (tenant_id, company_id, round_id, revision, event_type, occurred_on, actor_user_id)
select tenant_id, company_id, id, 2, 'FINAL_CLOSED', closed_on, closed_by_user_id
  from core.capital_rounds
 where status = 'CLOSED';

update core.capital_rounds set revision = 2 where status = 'CLOSED';
