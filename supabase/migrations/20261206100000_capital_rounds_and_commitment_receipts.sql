-- Capital rounds and the money's last two steps (founder direction
-- 2026-10-04: "is capital divided into different rounds? ... how does one
-- now confirm they've gotten the money").
--
-- 1. core.capital_rounds: the company's financing rounds (Pre-seed, Seed,
--    ...), each with a target (exact numeric plus ISO currency), an
--    instrument, its dates and status. At most one is the current round;
--    the service makes a newly opened round current. Raised amounts are
--    never stored here: they are derived from RECEIVED commitments.
--    A round is not the capital objective (doc 13 §14): the objective is
--    the goal Q, Discover and Blueprint read; a round is one financing
--    instrument's book of money. They may agree; neither overwrites the
--    other.
-- 2. network.commitments gains the round it counts toward and two
--    statuses after CONFIRMED: TRANSFER_SENT (the investor's side marks the
--    money sent, optionally with a reference) and RECEIVED (the company's
--    side confirms it arrived). Each step stays a timestamped, attributable
--    fact on the row and a `commitment_*` relationship event; nothing is
--    deleted or rewritten.
-- 3. A notice kind for the other side at each step.
--
-- Additive: one table, nullable columns, widened checks.

-- ---------------------------------------------------------------------------
-- core.capital_rounds
-- ---------------------------------------------------------------------------

create table core.capital_rounds (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  company_id          uuid not null,
  name                text not null check (length(btrim(name)) between 1 and 80 and name !~ '[[:cntrl:]]'),
  -- Exact money: numeric plus ISO currency, never float.
  target_amount       numeric not null check (target_amount > 0 and target_amount < 1e15),
  currency_code       text not null check (currency_code ~ '^[A-Z]{3}$'),
  instrument          text not null check (instrument in ('SAFE', 'EQUITY', 'CONVERTIBLE', 'OTHER')),
  status              text not null default 'OPEN' check (status in ('PLANNED', 'OPEN', 'CLOSED')),
  is_current          boolean not null default false,
  opened_on           date,
  closed_on           date,
  created_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  closed_by_user_id   uuid references identity.user_profiles (id) on delete restrict,
  idempotency_key     text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at          timestamptz not null default clock_timestamp(),
  updated_at          timestamptz not null default clock_timestamp(),
  unique (created_by_user_id, idempotency_key),
  unique (id, tenant_id),
  check (status = 'PLANNED' or opened_on is not null),
  check ((status = 'CLOSED') = (closed_on is not null)),
  check ((closed_on is null) = (closed_by_user_id is null)),
  check (closed_on is null or opened_on is null or closed_on >= opened_on),
  -- A closed round is history, never the current one.
  check (not (is_current and status = 'CLOSED')),
  -- Tenant coherence: a round names a company only under its tenant.
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict
);

comment on table core.capital_rounds is
  'A company''s financing rounds: name, target (numeric + ISO currency), instrument, dates, PLANNED/OPEN/CLOSED. At most one current. Raised amounts are derived from RECEIVED commitments, never stored.';

-- At most one current round per company.
create unique index capital_rounds_one_current_idx
  on core.capital_rounds (company_id)
  where is_current;

create index capital_rounds_company_idx
  on core.capital_rounds (company_id, created_at desc);

alter table core.capital_rounds enable row level security;

-- Members of the organisation that owns the company read its rounds; the
-- server writes them. Investors see money through their commitments only.
create policy capital_rounds_member_select on core.capital_rounds
  for select to authenticated
  using (exists (
    select 1 from core.companies c
     where c.id = core.capital_rounds.company_id
       and c.tenant_id = core.capital_rounds.tenant_id
       and private.is_organisation_member(c.organisation_id)));

grant select on core.capital_rounds to authenticated;

-- ---------------------------------------------------------------------------
-- network.commitments: the round, the transfer and the receipt
-- ---------------------------------------------------------------------------

-- The original "(status = 'CONFIRMED') = (confirmed_at is not null)" check
-- also forbade withdrawing or superseding a confirmed commitment (its
-- confirmation is kept). Replaced: every status past confirmation keeps
-- the confirmation; earlier ones may still carry it as history.
do $$
declare
  found text[];
begin
  select array_agg(conname) into found
    from pg_constraint
   where conrelid = 'network.commitments'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%status = ''CONFIRMED''::text) = (confirmed_at IS NOT NULL)%';
  if coalesce(array_length(found, 1), 0) <> 1 then
    raise exception 'expected one confirmed_at status check on network.commitments, found %', found;
  end if;
  execute format('alter table network.commitments drop constraint %I', found[1]);
end
$$;

alter table network.commitments
  add column round_id                 uuid references core.capital_rounds (id) on delete restrict,
  add column transfer_sent_by_user_id uuid references identity.user_profiles (id) on delete restrict,
  add column transfer_sent_at         timestamptz,
  add column transfer_reference       text check (transfer_reference is null or (length(btrim(transfer_reference)) between 1 and 120 and transfer_reference !~ '[[:cntrl:]]')),
  add column received_by_user_id      uuid references identity.user_profiles (id) on delete restrict,
  add column received_at              timestamptz,
  drop constraint commitments_status_check,
  add constraint commitments_status_check
    check (status in ('STATED', 'CONFIRMED', 'SUPERSEDED', 'WITHDRAWN', 'DETECTED', 'ADOPTED',
                      'DISPUTED', 'TRANSFER_SENT', 'RECEIVED')),
  add constraint commitments_confirmed_check
    check (status not in ('CONFIRMED', 'TRANSFER_SENT', 'RECEIVED') or confirmed_at is not null),
  add constraint commitments_transfer_sent_check
    check ((transfer_sent_at is null) = (transfer_sent_by_user_id is null)
           and (status <> 'TRANSFER_SENT' or transfer_sent_at is not null)
           and (transfer_reference is null or transfer_sent_at is not null)),
  add constraint commitments_received_check
    check ((received_at is null) = (received_by_user_id is null)
           and ((status = 'RECEIVED') = (received_at is not null)));

comment on column network.commitments.round_id is
  'The company round this money counts toward (the current round when it was confirmed, by default). Must be the relationship''s company''s round.';
comment on column network.commitments.transfer_reference is
  'What the investor''s side gave as the transfer reference when marking it sent. Free text, not a verified payment.';

create index commitments_round_idx
  on network.commitments (round_id)
  where round_id is not null;

-- A commitment counts only toward its own company's round.
create function private.network_commitment_round_matches_company()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.round_id is not null and not exists (
    select 1
      from core.capital_rounds cr
      join network.relationships r on r.company_id = cr.company_id
     where cr.id = new.round_id
       and r.id = new.relationship_id
  ) then
    raise exception 'a commitment counts only toward its own company''s round'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function private.network_commitment_round_matches_company() from public;

create trigger commitments_round_matches_company
  before insert or update of round_id, relationship_id on network.commitments
  for each row execute function private.network_commitment_round_matches_company();

-- ---------------------------------------------------------------------------
-- communication.notifications: the other side hears each step
-- ---------------------------------------------------------------------------

alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
                    'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
                    'COMMITMENT_DETECTED', 'ACCOUNT_PAUSED', 'Q_WORK', 'Q_STAND_IN',
                    'INTEREST_RECEIVED', 'CONNECTION_REQUESTED', 'Q_MESSAGE', 'TIME_PROPOSED',
                    'HUMAN_REVIEW', 'VERIFICATION_DECIDED', 'VERIFICATION_REQUESTED',
                    'RELATIONSHIP_OUTCOME', 'DILIGENCE', 'EMAIL_RECEIVED', 'CHAT_MESSAGE',
                    'COMMITMENT'));
