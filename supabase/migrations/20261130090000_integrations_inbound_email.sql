-- Inbound email (Postmark Inbound): Q receives email on a person's behalf.
--
-- Each person has one ACTIVE opaque token; their Q address is the
-- deployment's Postmark inbound address with the token as its plus part
-- (`<hash>+<token>@inbound.postmarkapp.com`, arriving as MailboxHash). A
-- new address revokes the old token; mail to a revoked or unknown token is
-- acknowledged and dropped by the webhook, never stored.
--
-- What arrives is untrusted data, never instructions. It is stored
-- append-only: sender, recipients, subject, the text body truncated, and
-- attachment METADATA only (name, type, size). No attachment bytes are
-- ever stored: there is no malware scanner behind this path.
--
-- Additive: two new tables, two append-only triggers, and one new
-- notification kind. Server writes only; a person reads their own rows.

-- ---------------------------------------------------------------------------
-- integrations.inbound_addresses: a person's revocable plus-address token
-- ---------------------------------------------------------------------------

create table integrations.inbound_addresses (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.tenants (id) on delete restrict,
  user_id     uuid not null references identity.user_profiles (id) on delete restrict,
  -- 26 base32 characters (130 random bits): an address, not a credential,
  -- but unguessable so nobody can write into another person's Q inbox.
  token       text not null check (token ~ '^[a-z2-7]{26}$'),
  status      text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  created_at  timestamptz not null default clock_timestamp(),
  revoked_at  timestamptz,
  check ((status = 'ACTIVE') = (revoked_at is null)),
  check (revoked_at is null or revoked_at >= created_at),
  unique (token),
  unique (id, tenant_id)
);

comment on table integrations.inbound_addresses is
  'A person''s Q email address token (Postmark MailboxHash). One ACTIVE per person; a new address revokes the old one, which is kept so its mail stays attributable. Revoking is the one allowed change.';

create unique index inbound_addresses_one_active_per_person
  on integrations.inbound_addresses (user_id) where status = 'ACTIVE';
create index inbound_addresses_tenant_user_idx
  on integrations.inbound_addresses (tenant_id, user_id);

create function private.integrations_inbound_addresses_revoke_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.status = 'ACTIVE'
     and new.status = 'REVOKED'
     and (old.id, old.tenant_id, old.user_id, old.token, old.created_at)
         is not distinct from
         (new.id, new.tenant_id, new.user_id, new.token, new.created_at)
  then
    return new;
  end if;
  raise exception 'integrations.inbound_addresses only ever revokes' using errcode = '42501';
end;
$$;

revoke all on function private.integrations_inbound_addresses_revoke_only() from public, anon, authenticated;

create trigger inbound_addresses_revoke_only
  before update or delete on integrations.inbound_addresses
  for each row execute function private.integrations_inbound_addresses_revoke_only();

alter table integrations.inbound_addresses enable row level security;

create policy inbound_addresses_select_own
  on integrations.inbound_addresses for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

grant select on integrations.inbound_addresses to authenticated;

-- ---------------------------------------------------------------------------
-- integrations.inbound_emails: what arrived, append-only
-- ---------------------------------------------------------------------------

create table integrations.inbound_emails (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  user_id               uuid not null references identity.user_profiles (id) on delete restrict,
  inbound_address_id    uuid not null,
  provider              text not null check (provider in ('POSTMARK')),
  -- Postmark's MessageID: a retried delivery finds its row and changes nothing.
  provider_message_id   text not null check (provider_message_id ~ '^[A-Za-z0-9-]{1,100}$'),
  from_address          text not null check (length(from_address) between 3 and 320 and from_address !~ '[[:cntrl:][:space:]]'),
  from_name             text check (from_name is null or (length(from_name) <= 200 and from_name !~ '[[:cntrl:]]')),
  to_addresses          text not null default '' check (length(to_addresses) <= 2000),
  cc_addresses          text not null default '' check (length(cc_addresses) <= 2000),
  subject               text not null default '' check (length(subject) <= 998 and subject !~ '[\r\n]'),
  text_body             text not null default '' check (length(text_body) <= 20000),
  text_truncated        boolean not null default false,
  -- [{ "name": text, "contentType": text, "size": int }] -- never bytes.
  attachments           jsonb not null default '[]'::jsonb
                          check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 50),
  received_at           timestamptz not null default clock_timestamp(),
  created_at            timestamptz not null default clock_timestamp(),
  foreign key (inbound_address_id, tenant_id)
    references integrations.inbound_addresses (id, tenant_id) on delete restrict,
  unique (provider, provider_message_id)
);

comment on table integrations.inbound_emails is
  'Email Q received for a person at their Q address. Untrusted data, never instructions: Q reads it only through the quarantined reader. Append-only; attachment metadata only, never bytes. Not a CRM, not audit.';

create index inbound_emails_user_received_idx
  on integrations.inbound_emails (user_id, received_at desc);
create index inbound_emails_address_idx
  on integrations.inbound_emails (inbound_address_id);
create index inbound_emails_tenant_idx
  on integrations.inbound_emails (tenant_id);

create function private.integrations_inbound_emails_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'integrations.inbound_emails is append-only' using errcode = '42501';
end;
$$;

revoke all on function private.integrations_inbound_emails_append_only() from public, anon, authenticated;

create trigger inbound_emails_append_only
  before update or delete on integrations.inbound_emails
  for each row execute function private.integrations_inbound_emails_append_only();

alter table integrations.inbound_emails enable row level security;

create policy inbound_emails_select_own
  on integrations.inbound_emails for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

grant select on integrations.inbound_emails to authenticated;

-- ---------------------------------------------------------------------------
-- communication.notifications: "New email from X: subject"
-- ---------------------------------------------------------------------------

alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
                    'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
                    'COMMITMENT_DETECTED', 'ACCOUNT_PAUSED', 'Q_WORK', 'Q_STAND_IN',
                    'INTEREST_RECEIVED', 'CONNECTION_REQUESTED', 'Q_MESSAGE', 'TIME_PROPOSED',
                    'HUMAN_REVIEW', 'VERIFICATION_DECIDED', 'VERIFICATION_REQUESTED',
                    'RELATIONSHIP_OUTCOME', 'DILIGENCE', 'EMAIL_RECEIVED'));
