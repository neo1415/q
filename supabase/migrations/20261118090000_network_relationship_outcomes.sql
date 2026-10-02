-- Post-meeting outcomes (founder request 2026-10-02; Product Specification
-- 6.6.10, 6.6.12, 6.6.14; doc 13 §28; doc 19 §67).
--
-- The journey no longer stops at "meeting held". The relationship history
-- gains relationship_passed, relationship_paused, relationship_resumed,
-- diligence_started and relationship_progressed (registered in Network's
-- event registry, not here), and the deterministic projector
-- relationship-state.v2 folds them into MEETING_HELD, IN_DILIGENCE, PAUSED,
-- PASSED and INVESTED. current_state is already bounded text, so no state
-- migration is needed: v1 projections stay readable.
--
-- This migration adds what the history must not carry:
--
--   network.relationship_pass_reasons   reference data (6.6.10), not an enum
--   network.relationship_passes         the investor's pass and its reason
--
-- Founder decision (a), 2026-10-02: the reason is the investor's private
-- note and a learning signal. The founder learns only THAT the investor
-- passed (a relationship_shared event that carries no reason) unless the
-- investor ticks "share this reason with the founder". The reason therefore
-- lives here, never in the shared event payload, and RLS shows a pass row
-- to the company side only when it was shared.
--
-- Founder decision (b): re-approach after a pass only on a material change
-- (doc 19 §67). The mandate the pass was made under is recorded so a
-- mandate change can be proven; there is no timer.
--
-- Messaging belongs to the match, and every v2 state after CONNECTED is
-- still the same match: the chat party predicate now accepts them all.

-- ---------------------------------------------------------------------------
-- Reference data: why an investor passed (Product Specification 6.6.10)
-- ---------------------------------------------------------------------------

create table network.relationship_pass_reasons (
  code        text primary key check (code ~ '^[A-Z][A-Z_]{1,31}$'),
  label       text not null check (length(label) between 1 and 60),
  sort_order  smallint not null check (sort_order between 0 and 999),
  active      boolean not null default true
);

comment on table network.relationship_pass_reasons is
  'Reference data: the reason categories an investor may give for passing after engagement (Product Specification 6.6.10). Rows, never an enum: a new reason is an insert.';

insert into network.relationship_pass_reasons (code, label, sort_order) values
  ('STAGE', 'Stage', 10),
  ('SECTOR', 'Sector', 20),
  ('GEOGRAPHY', 'Geography', 30),
  ('TRACTION', 'Traction', 40),
  ('TEAM', 'Team', 50),
  ('VALUATION', 'Valuation', 60),
  ('BUSINESS_MODEL', 'Business model', 70),
  ('MARKET', 'Market', 80),
  ('TIMING', 'Timing', 90),
  ('ROUND', 'Round', 100),
  ('OTHER', 'Other', 110);

alter table network.relationship_pass_reasons enable row level security;

create policy relationship_pass_reasons_select_authenticated
  on network.relationship_pass_reasons for select to authenticated
  using (true);

grant select on network.relationship_pass_reasons to authenticated;

-- ---------------------------------------------------------------------------
-- network.relationship_passes
-- ---------------------------------------------------------------------------

create table network.relationship_passes (
  id                      uuid primary key default gen_random_uuid(),
  -- The investor organisation's tenant: a pass is the investor's record.
  tenant_id               uuid not null references identity.tenants (id) on delete restrict,
  relationship_id         uuid not null references network.relationships (id) on delete restrict,
  investor_organisation_id uuid not null,
  passed_by_user_id       uuid not null references identity.user_profiles (id) on delete restrict,
  -- Optional: a pass never demands a reason.
  reason_code             text references network.relationship_pass_reasons (code) on delete restrict,
  note                    text check (note is null or length(note) between 1 and 1000),
  -- Founder decision (a): nothing reaches the founder unless this is true.
  share_with_founder      boolean not null default false,
  -- The mandate it was made under (doc 19 §67: a changed mandate reopens).
  mandate_id              uuid,
  mandate_version         integer check (mandate_version is null or mandate_version > 0),
  idempotency_key         text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at              timestamptz not null default clock_timestamp(),
  unique (passed_by_user_id, idempotency_key),
  foreign key (investor_organisation_id, tenant_id)
    references core.investor_organisations (id, tenant_id) on delete restrict,
  -- Sharing nothing would tell the founder nothing.
  check (not share_with_founder or reason_code is not null or note is not null),
  check ((mandate_id is null) = (mandate_version is null))
);

comment on table network.relationship_passes is
  'An investor organisation''s pass on a connected relationship, with its optional reason. Private to the investor side unless share_with_founder. Append-only: a reset is a relationship_resumed event, never an edit.';
comment on column network.relationship_passes.share_with_founder is
  'Founder decision 2026-10-02: the reason (category and note) is shown to the company side only when the investor ticked this. Otherwise the founder learns only that the investor passed.';

create index relationship_passes_relationship_idx
  on network.relationship_passes (relationship_id, created_at desc);

-- The pass belongs to the relationship's own investor organisation.
create function private.network_relationship_passes_party_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from network.relationships r
     where r.id = new.relationship_id
       and r.investor_organisation_id = new.investor_organisation_id
  ) then
    raise exception 'a pass belongs to the relationship''s investor organisation'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger relationship_passes_party_guard
  before insert on network.relationship_passes
  for each row execute function private.network_relationship_passes_party_guard();

create function private.network_relationship_passes_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'network.relationship_passes is append-only'
    using errcode = '55000';
end
$$;

create trigger relationship_passes_append_only
  before update or delete on network.relationship_passes
  for each row execute function private.network_relationship_passes_append_only();

alter table network.relationship_passes enable row level security;

-- The investor side reads its own passes, reason and note included.
create policy relationship_passes_select_investor
  on network.relationship_passes for select to authenticated
  using (
    exists (
      select 1
        from core.investor_organisations io
        join identity.organisation_memberships m
          on m.organisation_id = io.organisation_id
         and m.membership_status = 'active'
       where io.id = relationship_passes.investor_organisation_id
         and m.user_id = (select private.current_app_user_id())
    )
  );

-- The company side reads a pass only when the investor shared its reason.
create policy relationship_passes_select_company_shared
  on network.relationship_passes for select to authenticated
  using (
    share_with_founder
    and exists (
      select 1
        from network.relationships r
        join core.companies c on c.id = r.company_id
        join identity.organisation_memberships m
          on m.organisation_id = c.organisation_id
         and m.membership_status = 'active'
       where r.id = relationship_passes.relationship_id
         and m.user_id = (select private.current_app_user_id())
    )
  );

-- Server-written only.
grant select on network.relationship_passes to authenticated;

-- ---------------------------------------------------------------------------
-- The match outlives CONNECTED (relationship-state.v2)
-- ---------------------------------------------------------------------------

create or replace function private.is_conversation_party(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from communication.conversations c
      join network.relationships r on r.id = c.relationship_id
      join core.companies co on co.id = r.company_id
      join core.investor_organisations io on io.id = r.investor_organisation_id
     where c.id = target_conversation_id
       -- Defence in depth: messaging belongs to the Match, which every
       -- relationship-state.v2 state after CONNECTED still is.
       and r.current_state in ('CONNECTED', 'MEETING_HELD', 'IN_DILIGENCE',
                               'PAUSED', 'PASSED', 'INVESTED')
       and (
         (select private.is_organisation_member(co.organisation_id))
         or (select private.is_organisation_member(io.organisation_id))
       )
  )
$$;

comment on column network.relationships.current_state is
  'Derived projection of the ordered history, written only by the deterministic relationship-state projector (CQ-NET-012). relationship-state.v1: DISCOVERED | INTEREST_EXPRESSED | CONNECTED | DECLINED. relationship-state.v2 adds MEETING_HELD | IN_DILIGENCE | PAUSED | PASSED | INVESTED. Never patched by a command.';
