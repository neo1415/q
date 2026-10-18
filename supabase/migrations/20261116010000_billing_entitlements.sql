-- BILLING (docs/specs/2026-10/billing.md, ADR 0034): plans, entitlements,
-- metering, Stripe state and the facilitation-fee ledger, in the `billing`
-- schema doc 13 reserved for "future plans/entitlements".
--
-- Plans, features and limits are versioned reference data (rows, never
-- enums). A billing account is an organisation, or a person acting without
-- one. An account with no assignment in force is on the one ACTIVE launch
-- default plan, so every existing account is covered without a backfill.
--
-- Everything here is INTERNAL_SERVER_ONLY: RLS on, no policy for any client
-- role, no grant to anon or authenticated. People read their own plan and
-- usage through the API, which decides the account from the server-resolved
-- actor context; admins change plans through the audited operations console.
-- Metering and the quota check are one atomic step (billing.consume).

create schema if not exists billing;
comment on schema billing is
  'Plans, entitlements, usage meter, payment-provider state and the facilitation-fee ledger. Server-only.';

revoke all on schema billing from public, anon, authenticated;
grant usage on schema billing to postgres, service_role;

-- Shared guard: rows that are history are never rewritten or deleted.
create or replace function billing.append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'billing.% is append-only', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;
revoke all on function billing.append_only() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Catalogue: features, plans, what each plan includes.
-- ---------------------------------------------------------------------------

create table billing.features (
  key            text primary key
                   check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and length(key) <= 64),
  name           text not null check (length(btrim(name)) between 1 and 80),
  description    text not null check (length(btrim(description)) between 1 and 500),
  -- ACCESS: on or off. MONTHLY: units per UTC calendar month. COUNT: how
  -- many may exist at once (counted by the owning context, not metered).
  kind           text not null check (kind in ('ACCESS', 'MONTHLY', 'COUNT')),
  unit_singular  text not null check (length(btrim(unit_singular)) between 1 and 40),
  unit_plural    text not null check (length(btrim(unit_plural)) between 1 and 40),
  created_at     timestamptz not null default clock_timestamp()
);
comment on table billing.features is
  'Plan-controllable features (reference data). Never diagnosis, ranking, interest, chat or safety: those are never gated (PADL #85 Layer 1, #106, neutrality).';

create table billing.plans (
  id                 uuid primary key default gen_random_uuid(),
  key                text not null check (key ~ '^[a-z][a-z0-9_]*$' and length(key) <= 40),
  version            integer not null check (version >= 1),
  name               text not null check (length(btrim(name)) between 1 and 60),
  description        text not null check (length(btrim(description)) between 1 and 500),
  audience           text not null check (audience in ('ANY', 'FOUNDER', 'INVESTOR')),
  status             text not null default 'ACTIVE' check (status in ('ACTIVE', 'RETIRED')),
  is_launch_default  boolean not null default false,
  -- Offered for purchase through the payment provider.
  self_serve         boolean not null default false,
  -- The provider price's lookup key; the price id is resolved at checkout.
  stripe_lookup_key  text unique check (stripe_lookup_key is null or stripe_lookup_key ~ '^[a-z][a-z0-9_]{2,62}$'),
  created_at         timestamptz not null default clock_timestamp(),
  unique (key, version),
  check (not is_launch_default or status = 'ACTIVE'),
  check (not self_serve or stripe_lookup_key is not null)
);
comment on table billing.plans is
  'Versioned plans. A changed plan is a new version; assignments keep the version they were given.';

create unique index plans_one_launch_default_idx on billing.plans ((true)) where is_launch_default;
create unique index plans_one_active_version_idx on billing.plans (key) where status = 'ACTIVE';

-- A plan's identity and content never change once written; only its
-- status, launch-default and self-serve flags move.
create or replace function billing.plans_identity_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a plan is retired, never deleted' using errcode = 'restrict_violation';
  end if;
  if new.key is distinct from old.key or new.version is distinct from old.version
     or new.name is distinct from old.name or new.audience is distinct from old.audience
     or new.stripe_lookup_key is distinct from old.stripe_lookup_key then
    raise exception 'a plan version is immutable; add a new version' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke all on function billing.plans_identity_fixed() from public, anon, authenticated;
create trigger plans_identity_fixed before update or delete on billing.plans
  for each row execute function billing.plans_identity_fixed();

create table billing.plan_features (
  plan_id      uuid not null references billing.plans (id) on delete restrict,
  feature_key  text not null references billing.features (key) on delete restrict,
  included     boolean not null,
  -- MONTHLY: units per month; COUNT: how many at once; null = unlimited.
  limit_value  integer check (limit_value is null or limit_value between 0 and 1000000),
  primary key (plan_id, feature_key),
  check (included or limit_value is null)
);
create trigger plan_features_append_only before update or delete on billing.plan_features
  for each row execute function billing.append_only();

-- ---------------------------------------------------------------------------
-- Accounts: plan assignments and limit overrides.
-- ---------------------------------------------------------------------------

create table billing.plan_assignments (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid references identity.organisations (id) on delete restrict,
  user_id                   uuid references identity.user_profiles (id) on delete restrict,
  account_key               text generated always as (
                              case when organisation_id is not null
                                   then 'o:' || organisation_id::text
                                   else 'p:' || user_id::text end) stored,
  plan_id                   uuid not null references billing.plans (id) on delete restrict,
  source                    text not null check (source in ('ADMIN', 'TRIAL', 'STRIPE')),
  starts_at                 timestamptz not null default clock_timestamp(),
  ends_at                   timestamptz check (ends_at is null or ends_at > starts_at),
  assigned_by_user_id       uuid references identity.user_profiles (id) on delete restrict,
  reason                    text check (reason is null or length(btrim(reason)) between 3 and 500),
  provider_subscription_id  text check (provider_subscription_id is null or length(provider_subscription_id) between 3 and 255),
  superseded_at             timestamptz,
  created_at                timestamptz not null default clock_timestamp(),
  check (num_nonnulls(organisation_id, user_id) = 1),
  check ((source = 'STRIPE') = (provider_subscription_id is not null)),
  check (source = 'STRIPE' or (assigned_by_user_id is not null and reason is not null)),
  check (source <> 'TRIAL' or ends_at is not null)
);
comment on table billing.plan_assignments is
  'Which plan an account is on, by whom and why. The current one is the unsuperseded row whose window covers now; otherwise the launch default applies.';

create unique index plan_assignments_one_current_idx
  on billing.plan_assignments (account_key) where superseded_at is null;
create index plan_assignments_account_idx
  on billing.plan_assignments (account_key, created_at desc);

-- History: only `superseded_at` is set (once), and a provider subscription's
-- end date may move (cancellation scheduled or undone).
create or replace function billing.plan_assignments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'plan assignments are history' using errcode = 'restrict_violation';
  end if;
  if old.superseded_at is not null then
    raise exception 'a superseded assignment is final' using errcode = 'restrict_violation';
  end if;
  if new.plan_id is distinct from old.plan_id or new.source is distinct from old.source
     or new.organisation_id is distinct from old.organisation_id or new.user_id is distinct from old.user_id
     or new.starts_at is distinct from old.starts_at or new.assigned_by_user_id is distinct from old.assigned_by_user_id
     or new.reason is distinct from old.reason
     or new.provider_subscription_id is distinct from old.provider_subscription_id
     or (new.ends_at is distinct from old.ends_at and old.source <> 'STRIPE') then
    raise exception 'an assignment is replaced, never rewritten' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke all on function billing.plan_assignments_guard() from public, anon, authenticated;
create trigger plan_assignments_guard before update or delete on billing.plan_assignments
  for each row execute function billing.plan_assignments_guard();

create table billing.limit_overrides (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid references identity.organisations (id) on delete restrict,
  user_id             uuid references identity.user_profiles (id) on delete restrict,
  account_key         text generated always as (
                        case when organisation_id is not null
                             then 'o:' || organisation_id::text
                             else 'p:' || user_id::text end) stored,
  feature_key         text not null references billing.features (key) on delete restrict,
  -- null: unlimited for this account.
  limit_value         integer check (limit_value is null or limit_value between 0 and 1000000),
  expires_at          timestamptz,
  granted_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  reason              text not null check (length(btrim(reason)) between 3 and 500),
  revoked_at          timestamptz,
  revoked_by_user_id  uuid references identity.user_profiles (id) on delete restrict,
  created_at          timestamptz not null default clock_timestamp(),
  check (num_nonnulls(organisation_id, user_id) = 1),
  check ((revoked_at is null) = (revoked_by_user_id is null))
);
create unique index limit_overrides_one_active_idx
  on billing.limit_overrides (account_key, feature_key) where revoked_at is null;

create or replace function billing.limit_overrides_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.revoked_at is not null
     or new.limit_value is distinct from old.limit_value or new.feature_key is distinct from old.feature_key
     or new.organisation_id is distinct from old.organisation_id or new.user_id is distinct from old.user_id
     or new.expires_at is distinct from old.expires_at or new.reason is distinct from old.reason
     or new.granted_by_user_id is distinct from old.granted_by_user_id then
    raise exception 'an override is revoked and replaced, never rewritten' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke all on function billing.limit_overrides_guard() from public, anon, authenticated;
create trigger limit_overrides_guard before update or delete on billing.limit_overrides
  for each row execute function billing.limit_overrides_guard();

-- ---------------------------------------------------------------------------
-- The meter.
-- ---------------------------------------------------------------------------

create table billing.usage_events (
  id               bigint generated by default as identity primary key,
  organisation_id  uuid references identity.organisations (id) on delete restrict,
  user_id          uuid references identity.user_profiles (id) on delete restrict,
  account_key      text generated always as (
                     case when organisation_id is not null
                          then 'o:' || organisation_id::text
                          else 'p:' || user_id::text end) stored,
  feature_key      text not null references billing.features (key) on delete restrict,
  period_start     date not null check (extract(day from period_start) = 1),
  quantity         integer not null check (quantity between 1 and 1000),
  idempotency_key  text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  actor_user_id    uuid not null references identity.user_profiles (id) on delete restrict,
  surface          text not null check (surface in ('API', 'Q_API', 'Q_TOOL', 'Q_ACTION', 'WORKER')),
  occurred_at      timestamptz not null default clock_timestamp(),
  -- The metered work failed after the unit was taken: given back, kept as history.
  voided_at        timestamptz,
  void_reason      text check (void_reason is null or length(void_reason) between 3 and 200),
  check (num_nonnulls(organisation_id, user_id) = 1),
  check ((voided_at is null) = (void_reason is null)),
  unique (account_key, feature_key, idempotency_key)
);
comment on table billing.usage_events is
  'Append-only usage meter. One row per metered unit batch, idempotent per account+feature+key; a failed unit is voided, never deleted.';

create index usage_events_period_idx
  on billing.usage_events (account_key, feature_key, period_start) where voided_at is null;

create or replace function billing.usage_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.voided_at is not null
     -- account_key is generated after BEFORE triggers run, so it is left out.
     or (to_jsonb(new) - 'voided_at' - 'void_reason' - 'account_key')
        is distinct from (to_jsonb(old) - 'voided_at' - 'void_reason' - 'account_key') then
    raise exception 'usage is history; a failed unit is voided once' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke all on function billing.usage_events_guard() from public, anon, authenticated;
create trigger usage_events_guard before update or delete on billing.usage_events
  for each row execute function billing.usage_events_guard();

-- The one way usage is recorded: lock the account+feature, replay a key
-- already used, refuse past the limit, otherwise record. The limit is the
-- caller's resolution of plan + override (packages/billing); null means
-- unlimited. A concurrent second request waits on the lock and then sees
-- the first one's unit, so the last unit is never taken twice.
create or replace function billing.consume(
  p_organisation_id  uuid,
  p_user_id          uuid,
  p_feature_key      text,
  p_limit            integer,
  p_quantity         integer,
  p_idempotency_key  text,
  p_actor_user_id    uuid,
  p_surface          text,
  p_period_start     date
)
returns table (outcome text, used integer)
language plpgsql
set search_path = ''
as $$
declare
  v_account text := case when p_organisation_id is not null
                         then 'o:' || p_organisation_id::text
                         else 'p:' || p_user_id::text end;
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('billing.consume:' || v_account || ':' || p_feature_key, 0));

  select coalesce(sum(u.quantity), 0)::integer into v_used
    from billing.usage_events u
   where u.account_key = v_account and u.feature_key = p_feature_key
     and u.period_start = p_period_start and u.voided_at is null;

  if exists (select 1 from billing.usage_events u
              where u.account_key = v_account and u.feature_key = p_feature_key
                and u.idempotency_key = p_idempotency_key) then
    return query select 'REPLAYED'::text, v_used;
    return;
  end if;

  if p_limit is not null and v_used + p_quantity > p_limit then
    return query select 'LIMIT_REACHED'::text, v_used;
    return;
  end if;

  insert into billing.usage_events
    (organisation_id, user_id, feature_key, period_start, quantity, idempotency_key, actor_user_id, surface)
  values
    (p_organisation_id, case when p_organisation_id is null then p_user_id end, p_feature_key,
     p_period_start, p_quantity, p_idempotency_key, p_actor_user_id, p_surface);

  return query select 'CONSUMED'::text, v_used + p_quantity;
end;
$$;
revoke all on function billing.consume(uuid, uuid, text, integer, integer, text, uuid, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Payment provider state (Stripe). Off until the founder adds keys.
-- ---------------------------------------------------------------------------

create table billing.customers (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid references identity.organisations (id) on delete restrict,
  user_id               uuid references identity.user_profiles (id) on delete restrict,
  account_key           text generated always as (
                          case when organisation_id is not null
                               then 'o:' || organisation_id::text
                               else 'p:' || user_id::text end) stored,
  provider              text not null check (provider in ('STRIPE')),
  provider_customer_id  text not null check (length(provider_customer_id) between 3 and 255),
  created_at            timestamptz not null default clock_timestamp(),
  check (num_nonnulls(organisation_id, user_id) = 1),
  unique (provider, provider_customer_id),
  unique (provider, account_key)
);
create trigger customers_append_only before update or delete on billing.customers
  for each row execute function billing.append_only();

create table billing.subscriptions (
  provider                  text not null check (provider in ('STRIPE')),
  provider_subscription_id  text not null check (length(provider_subscription_id) between 3 and 255),
  account_key               text not null check (account_key ~ '^[op]:[0-9a-f-]{36}$'),
  plan_id                   uuid references billing.plans (id) on delete restrict,
  status                    text not null check (length(status) between 2 and 40),
  cancel_at                 timestamptz,
  -- Provider events can arrive out of order: only a newer event moves the row.
  last_event_created        timestamptz not null,
  updated_at                timestamptz not null default clock_timestamp(),
  primary key (provider, provider_subscription_id)
);
comment on table billing.subscriptions is
  'The provider subscription as last reported (current state, newest event wins). Plan access itself lives in plan_assignments.';

create table billing.provider_events (
  provider       text not null check (provider in ('STRIPE')),
  event_id       text not null check (length(event_id) between 3 and 255),
  event_type     text not null check (length(event_type) between 3 and 120),
  event_created  timestamptz not null,
  outcome        text not null check (outcome in ('APPLIED', 'IGNORED')),
  received_at    timestamptz not null default clock_timestamp(),
  primary key (provider, event_id)
);
comment on table billing.provider_events is
  'Every verified webhook event, once: a redelivery of the same id is acknowledged and not applied again.';
create trigger provider_events_append_only before update or delete on billing.provider_events
  for each row execute function billing.append_only();

-- ---------------------------------------------------------------------------
-- Facilitation-fee ledger (founder direction 2026-09-29; PADL amendment and
-- legal opinion pending). Computed by deterministic code from CONFIRMED
-- commitments only; Capital Q records and exports, it never moves money.
-- ---------------------------------------------------------------------------

create table billing.fee_schedules (
  id                uuid primary key default gen_random_uuid(),
  version           integer not null unique check (version >= 1),
  -- Basis points of the confirmed amount; null = the founder has not set a rate.
  rate_bps          integer check (rate_bps is null or rate_bps between 0 and 10000),
  accrue_levels     text[] not null default array['INVESTED']
                      check (cardinality(accrue_levels) between 1 and 3
                             and accrue_levels <@ array['SOFT', 'FIRM', 'INVESTED']),
  payer_side        text not null default 'COMPANY' check (payer_side in ('COMPANY', 'INVESTOR')),
  effective_from    timestamptz not null default clock_timestamp(),
  set_by_user_id    uuid references identity.user_profiles (id) on delete restrict,
  reason            text not null check (length(btrim(reason)) between 3 and 500),
  created_at        timestamptz not null default clock_timestamp()
);
create trigger fee_schedules_append_only before update or delete on billing.fee_schedules
  for each row execute function billing.append_only();

create table billing.fee_entries (
  id               uuid primary key default gen_random_uuid(),
  commitment_id    uuid not null unique references network.commitments (id) on delete restrict,
  relationship_id  uuid not null references network.relationships (id) on delete restrict,
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  amount           numeric not null check (amount > 0),
  currency_code    text not null check (currency_code ~ '^[A-Z]{3}$'),
  level            text not null check (level in ('SOFT', 'FIRM', 'INVESTED')),
  confirmed_at     timestamptz not null,
  schedule_id      uuid not null references billing.fee_schedules (id) on delete restrict,
  rate_bps         integer check (rate_bps is null or rate_bps between 0 and 10000),
  fee_amount       numeric check (fee_amount is null or fee_amount >= 0),
  payer_side       text not null check (payer_side in ('COMPANY', 'INVESTOR')),
  status           text not null check (status in ('RATE_NOT_SET', 'ACCRUED', 'INVOICED', 'VOID')),
  computed_at      timestamptz not null default clock_timestamp(),
  status_changed_at timestamptz not null default clock_timestamp(),
  void_reason      text check (void_reason is null or length(void_reason) between 3 and 200),
  check ((rate_bps is null) = (fee_amount is null)),
  check ((status = 'RATE_NOT_SET') = (rate_bps is null) or status = 'VOID'),
  check ((status = 'VOID') = (void_reason is not null))
);
comment on table billing.fee_entries is
  'One facilitation-fee entry per confirmed commitment at an accruing level. RATE_NOT_SET until the founder sets a rate; VOID when the commitment stops being current before invoicing.';
create index fee_entries_status_idx on billing.fee_entries (status, confirmed_at desc);

-- Moves: RATE_NOT_SET -> ACCRUED (rate set), RATE_NOT_SET|ACCRUED -> VOID,
-- ACCRUED -> INVOICED. The money basis never changes.
create or replace function billing.fee_entries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'fee entries are history' using errcode = 'restrict_violation';
  end if;
  if new.commitment_id is distinct from old.commitment_id or new.amount is distinct from old.amount
     or new.currency_code is distinct from old.currency_code or new.level is distinct from old.level
     or new.confirmed_at is distinct from old.confirmed_at or new.relationship_id is distinct from old.relationship_id
     or not ((old.status = new.status and old.status not in ('INVOICED', 'VOID')
              and new.rate_bps is not distinct from old.rate_bps)
          or (old.status = 'RATE_NOT_SET' and new.status = 'ACCRUED')
          or (old.status in ('RATE_NOT_SET', 'ACCRUED') and new.status = 'VOID')
          or (old.status = 'ACCRUED' and new.status = 'INVOICED')) then
    raise exception 'fee entry move % -> % is not allowed', old.status, new.status
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke all on function billing.fee_entries_guard() from public, anon, authenticated;
create trigger fee_entries_guard before update or delete on billing.fee_entries
  for each row execute function billing.fee_entries_guard();

-- ---------------------------------------------------------------------------
-- RLS on, no client access (server-only, like platform_ops).
-- ---------------------------------------------------------------------------

alter table billing.features         enable row level security;
alter table billing.plans            enable row level security;
alter table billing.plan_features    enable row level security;
alter table billing.plan_assignments enable row level security;
alter table billing.limit_overrides  enable row level security;
alter table billing.usage_events     enable row level security;
alter table billing.customers        enable row level security;
alter table billing.subscriptions    enable row level security;
alter table billing.provider_events  enable row level security;
alter table billing.fee_schedules    enable row level security;
alter table billing.fee_entries      enable row level security;

revoke all on all tables in schema billing from public, anon, authenticated;
grant select, insert, update on all tables in schema billing to service_role;
grant usage, select on all sequences in schema billing to service_role;
grant execute on function billing.consume(uuid, uuid, text, integer, integer, text, uuid, text, date) to service_role;

-- ---------------------------------------------------------------------------
-- Seed reference data. Limits are the founder's to change (each change is a
-- new plan version); prices live in the payment provider, never here.
-- ---------------------------------------------------------------------------

insert into billing.features (key, name, description, kind, unit_singular, unit_plural) values
  ('q.rehearsals', 'Rehearsals', 'Rehearse a meeting with Q playing the investor or founder, with a review.', 'MONTHLY', 'rehearsal', 'rehearsals'),
  ('q.delegations', 'Q handles it', 'Q carries out an approved plan for you: interest, messages, answers from your brief, booking.', 'MONTHLY', 'delegation', 'delegations'),
  ('documents.ai_images', 'AI images in documents', 'Pictures Q creates for your decks and documents.', 'MONTHLY', 'image', 'images'),
  ('q.research', 'Web research', 'Q researches the public web for you, with sources.', 'MONTHLY', 'research request', 'research requests'),
  ('q.daily_editions', 'The Q Daily', 'Your edition of the Q Daily: weekly, or every day.', 'MONTHLY', 'edition', 'editions'),
  ('gateq.gateways', 'GateQ gateways', 'Public gateways where companies apply to your organisation.', 'COUNT', 'gateway', 'gateways');

insert into billing.plans (key, version, name, description, audience, is_launch_default, self_serve, stripe_lookup_key) values
  ('launch', 1, 'Launch', 'Everyone''s plan while Capital Q launches: generous limits, free.', 'ANY', true, false, null),
  ('free', 1, 'Free', 'The full diagnosis and network, with a taste of Q''s execution features.', 'ANY', false, false, null),
  ('founder_pro', 1, 'Founder Pro', 'More rehearsals, delegations, images and research for a raise.', 'FOUNDER', false, true, 'founder_pro_monthly'),
  ('investor_pro', 1, 'Investor Pro', 'Q handling outreach and first conversations, more research and gateways.', 'INVESTOR', false, true, 'investor_pro_monthly'),
  ('fund', 1, 'Fund', 'For a fund team: high limits across Q''s execution features.', 'INVESTOR', false, true, 'fund_monthly');

insert into billing.plan_features (plan_id, feature_key, included, limit_value)
select p.id, v.feature_key, v.included, v.limit_value
  from (values
    ('launch',       'q.rehearsals',        true, 30),
    ('launch',       'q.delegations',       true, 30),
    ('launch',       'documents.ai_images', true, 150),
    ('launch',       'q.research',          true, 300),
    ('launch',       'q.daily_editions',    true, 31),
    ('launch',       'gateq.gateways',      true, 5),
    ('free',         'q.rehearsals',        true, 1),
    ('free',         'q.delegations',       true, 2),
    ('free',         'documents.ai_images', true, 10),
    ('free',         'q.research',          true, 20),
    ('free',         'q.daily_editions',    true, 5),
    ('free',         'gateq.gateways',      true, 1),
    ('founder_pro',  'q.rehearsals',        true, 20),
    ('founder_pro',  'q.delegations',       true, 20),
    ('founder_pro',  'documents.ai_images', true, 150),
    ('founder_pro',  'q.research',          true, 300),
    ('founder_pro',  'q.daily_editions',    true, 31),
    ('founder_pro',  'gateq.gateways',      true, 1),
    ('investor_pro', 'q.rehearsals',        true, 20),
    ('investor_pro', 'q.delegations',       true, 40),
    ('investor_pro', 'documents.ai_images', true, 100),
    ('investor_pro', 'q.research',          true, 500),
    ('investor_pro', 'q.daily_editions',    true, 31),
    ('investor_pro', 'gateq.gateways',      true, 3),
    ('fund',         'q.rehearsals',        true, 60),
    ('fund',         'q.delegations',       true, 200),
    ('fund',         'documents.ai_images', true, 500),
    ('fund',         'q.research',          true, 2000),
    ('fund',         'q.daily_editions',    true, 31),
    ('fund',         'gateq.gateways',      true, 10)
  ) as v (plan_key, feature_key, included, limit_value)
  join billing.plans p on p.key = v.plan_key and p.version = 1;

insert into billing.fee_schedules (version, rate_bps, accrue_levels, payer_side, reason)
values (1, null, array['INVESTED'], 'COMPANY',
        'Initial schedule: no rate until the founder sets one (legal opinion and PADL amendment pending).');
