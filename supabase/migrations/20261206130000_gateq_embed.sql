-- P7 · GateQ embed: the investor's mandate read into a DRAFT gate policy.
--
--   mandate text ≠ GateQ published policy
--   a proposal ≠ a rule;  confirmation is the investor publishing a version
--
-- When an investor pastes or uploads their mandate, Capital Q's deterministic
-- mandate reader (`gateq-mandate-reader.v1`) proposes criteria the investor
-- then confirms, edits or drops before a gateway version carrying them is
-- published through the existing draft → publish path. This table is the
-- provenance of that proposal: which reader, on which text (by digest),
-- proposed what, for whom, once.
--
-- It stores NO mandate text. A mandate is commercially sensitive (which
-- sectors an investor will not look at is exactly what a competitor would
-- like), and the draft only needs the digest to be attributable. The short
-- quotes inside `proposals` are the investor's own sentences, shown back to
-- the same organisation; they never reach the public projection, which
-- carries criterion labels only.
--
-- Server-only like every gateq table: RLS on, no policy, no browser grant.

create table gateq.policy_extractions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  gateway_id          uuid not null references gateq.gateways (id) on delete restrict,

  source_kind         text not null check (source_kind in ('PASTED_TEXT', 'UPLOADED_FILE')),
  -- SHA-256 of the text as read. The text itself is not kept.
  source_sha256       text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_chars        integer not null check (source_chars between 1 and 20000),

  reader_version      text not null check (reader_version ~ '^[a-z0-9.-]{1,64}$'),
  -- The proposed draft criteria, each with its label, configuration and
  -- quote. Bounded: never more criteria than a version may hold.
  proposals           jsonb not null
                        check (jsonb_typeof(proposals) = 'array' and jsonb_array_length(proposals) <= 64),
  not_found           text[] not null default '{}'
                        check (not_found <@ array['STAGE', 'GEOGRAPHY', 'SECTOR', 'CHEQUE']::text[]),

  -- Idempotency: a retried or double-clicked read is one row.
  client_request_id   text not null check (client_request_id ~ '^[A-Za-z0-9:_-]{8,128}$'),
  created_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  created_at          timestamptz not null default now(),

  unique (gateway_id, client_request_id)
);

comment on table gateq.policy_extractions is
  'Provenance of a mandate read into DRAFT gate criteria. Never a rule: nothing here is evaluated; the investor publishes a gateway version to make criteria active. Stores a digest of the mandate, never its text.';

create index policy_extractions_by_gateway_idx
  on gateq.policy_extractions (tenant_id, gateway_id, created_at desc);

-- The row's tenant is the gateway's tenant. Asserted by the database, so a
-- future writer cannot file one organisation's reading under another.
create or replace function gateq.policy_extraction_tenant_matches()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from gateq.gateways g
     where g.id = new.gateway_id and g.tenant_id = new.tenant_id
  ) then
    raise exception 'a policy extraction belongs to its gateway''s tenant'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.policy_extraction_tenant_matches() from public;

create trigger policy_extractions_tenant_matches
  before insert on gateq.policy_extractions
  for each row execute function gateq.policy_extraction_tenant_matches();

-- What was proposed is history: a correction is a new reading.
create or replace function gateq.protect_policy_extraction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'a policy extraction is a record of what was proposed and is never rewritten'
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function gateq.protect_policy_extraction() from public;

create trigger policy_extractions_immutable
  before update or delete on gateq.policy_extractions
  for each row execute function gateq.protect_policy_extraction();

-- Server-only: RLS on, no policy, no browser grant.
alter table gateq.policy_extractions enable row level security;
revoke all on gateq.policy_extractions from anon, authenticated;
