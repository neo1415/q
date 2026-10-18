-- BIZ-007 · Integrations foundation + Google (Gmail send, reply tracking).
--
-- integrations.google_accounts   one connected Google mailbox per person
-- integrations.oauth_states      one-time OAuth state + PKCE verifier
-- integrations.email_messages    outbound (approved sends) and inbound
--                                (matched replies) mail, tied to the one
--                                canonical relationship
--
-- Credentials: the refresh token is stored only as AES-256-GCM ciphertext
-- under GOOGLE_TOKEN_ENCRYPTION_KEY (application-side; the database never
-- sees the key or the plaintext). No access token is ever stored. The PKCE
-- verifier is encrypted the same way. No client role can read either
-- ciphertext column.
--
-- Access: every mutation is server-side (the privileged server role). A
-- signed-in person may read their OWN connection status and their OWN
-- mailbox's message metadata, and only while they hold an active
-- membership in the row's tenant; nothing else, never the token.
--
-- Mail content: an outbound message keeps the subject and body the person
-- approved (their own sent mail). An inbound reply keeps metadata only:
-- the Gmail scope is gmail.metadata, so no body is ever fetched.
--
-- Additive only.

create schema if not exists integrations;
revoke all on schema integrations from public;
grant usage on schema integrations to authenticated;

-- ---------------------------------------------------------------------------
-- integrations.google_accounts
-- ---------------------------------------------------------------------------

create table integrations.google_accounts (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  user_id                   uuid not null references identity.user_profiles (id) on delete restrict,
  -- The Google OIDC subject: stable across an address change.
  google_subject            text not null check (google_subject ~ '^[0-9A-Za-z_-]{1,255}$'),
  email                     text not null check (length(email) <= 320 and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  scopes                    text[] not null check (cardinality(scopes) between 1 and 16),
  -- iv(12) || tag(16) || ciphertext. Null once disconnected: a disconnected
  -- account keeps no credential at all.
  refresh_token_ciphertext  bytea check (refresh_token_ciphertext is null or octet_length(refresh_token_ciphertext) between 29 and 4096),
  key_version               smallint not null default 1 check (key_version >= 1),
  status                    text not null default 'CONNECTED'
                              check (status in ('CONNECTED', 'DISCONNECTED', 'REVOKED_BY_PROVIDER')),
  -- Gmail history cursor for reply tracking (push and poll share it).
  history_id                text check (history_id is null or history_id ~ '^[0-9]{1,30}$'),
  watch_expires_at          timestamptz,
  last_synced_at            timestamptz,
  connected_at              timestamptz not null default clock_timestamp(),
  disconnected_at           timestamptz,
  created_at                timestamptz not null default clock_timestamp(),
  updated_at                timestamptz not null default clock_timestamp(),
  check ((status = 'CONNECTED') = (refresh_token_ciphertext is not null)),
  check ((status = 'CONNECTED') = (disconnected_at is null)),
  unique (id, tenant_id)
);

comment on table integrations.google_accounts is
  'A person''s connected Google mailbox (BIZ-007). The refresh token is AES-256-GCM ciphertext under GOOGLE_TOKEN_ENCRYPTION_KEY; no access token is stored. Disconnected rows keep no credential.';

-- One live connection per person; history rows stay.
create unique index google_accounts_one_live_per_person
  on integrations.google_accounts (user_id) where status = 'CONNECTED';
-- Pub/Sub names the mailbox by address.
create index google_accounts_live_email_idx
  on integrations.google_accounts (lower(email)) where status = 'CONNECTED';
create index google_accounts_tenant_user_idx
  on integrations.google_accounts (tenant_id, user_id);

create trigger set_updated_at
  before update on integrations.google_accounts
  for each row execute function private.set_updated_at();

alter table integrations.google_accounts enable row level security;

create policy google_accounts_select_own
  on integrations.google_accounts for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

-- Status columns only. The ciphertext column is never granted to a client.
grant select (id, tenant_id, user_id, email, scopes, status, connected_at, disconnected_at, last_synced_at)
  on integrations.google_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- integrations.oauth_states
-- ---------------------------------------------------------------------------

create table integrations.oauth_states (
  -- sha256(state) hex; the state itself only ever lives in the redirect.
  state_hash                 text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  tenant_id                  uuid not null references identity.tenants (id) on delete restrict,
  user_id                    uuid not null references identity.user_profiles (id) on delete restrict,
  provider                   text not null check (provider in ('google')),
  code_verifier_ciphertext   bytea not null check (octet_length(code_verifier_ciphertext) between 29 and 512),
  -- Same-origin path only: never an absolute URL (no open redirect).
  return_to                  text not null default '/settings'
                               check (return_to ~ '^/[A-Za-z0-9/_-]{0,200}$'),
  created_at                 timestamptz not null default clock_timestamp(),
  expires_at                 timestamptz not null,
  consumed_at                timestamptz,
  check (expires_at > created_at)
);

comment on table integrations.oauth_states is
  'One-time OAuth state with its encrypted PKCE verifier. Consumed once; expires in minutes. Server-internal.';

create index oauth_states_expiry_idx on integrations.oauth_states (expires_at);

alter table integrations.oauth_states enable row level security;
-- No policies and no client grants: server-internal.

-- ---------------------------------------------------------------------------
-- integrations.email_messages
-- ---------------------------------------------------------------------------

create table integrations.email_messages (
  id                         uuid primary key default gen_random_uuid(),
  -- The mailbox owner's tenant.
  tenant_id                  uuid not null,
  google_account_id          uuid not null,
  -- The one canonical relationship this mail belongs to. Mail is never a
  -- parallel relationship record: it is attached to the canonical row.
  relationship_id            uuid not null references network.relationships (id) on delete restrict,
  direction                  text not null check (direction in ('OUTBOUND', 'INBOUND')),
  status                     text not null check (status in ('SENDING', 'SENT', 'FAILED', 'RECEIVED')),
  -- Outbound: the approved Q action and its execution identity.
  q_action_id                uuid,
  idempotency_key            text check (idempotency_key is null or (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]')),
  -- RFC 5322 Message-ID (ours for outbound, the sender's for inbound).
  rfc822_message_id          text not null check (length(rfc822_message_id) between 3 and 998 and rfc822_message_id !~ '[[:cntrl:]]'),
  provider_message_id        text check (provider_message_id is null or provider_message_id ~ '^[0-9A-Za-z]{1,64}$'),
  provider_thread_id         text check (provider_thread_id is null or provider_thread_id ~ '^[0-9A-Za-z]{1,64}$'),
  -- Inbound: the outbound message this is a reply to.
  reply_to_email_id          uuid references integrations.email_messages (id) on delete restrict,
  from_address               text not null check (length(from_address) <= 320),
  to_address                 text not null check (length(to_address) <= 320),
  subject                    text not null default '' check (length(subject) <= 998),
  -- Outbound only: what the person approved. Inbound never has a body.
  body_text                  text check (body_text is null or length(body_text) <= 20000),
  occurred_at                timestamptz not null default clock_timestamp(),
  created_at                 timestamptz not null default clock_timestamp(),
  updated_at                 timestamptz not null default clock_timestamp(),
  foreign key (google_account_id, tenant_id)
    references integrations.google_accounts (id, tenant_id) on delete restrict,
  check (direction = 'OUTBOUND' or (body_text is null and q_action_id is null and idempotency_key is null)),
  check (direction = 'INBOUND' or (q_action_id is not null and idempotency_key is not null)),
  check ((direction = 'INBOUND') = (status = 'RECEIVED')),
  check (direction = 'OUTBOUND' or reply_to_email_id is not null)
);

comment on table integrations.email_messages is
  'Mail on a canonical relationship (BIZ-007): approved outbound sends and matched inbound replies (metadata only). Relationship history is network.relationship_events (outreach_sent / reply_received); this table is not history, not audit, not a CRM.';

-- One send per approved action and per execution identity.
create unique index email_messages_one_send_per_action
  on integrations.email_messages (q_action_id) where q_action_id is not null;
create unique index email_messages_idempotency_key
  on integrations.email_messages (idempotency_key) where idempotency_key is not null;
-- A provider message is recorded once per mailbox (push and poll race).
create unique index email_messages_provider_message
  on integrations.email_messages (google_account_id, provider_message_id)
  where provider_message_id is not null;
create index email_messages_thread_idx
  on integrations.email_messages (google_account_id, provider_thread_id)
  where provider_thread_id is not null;
create index email_messages_rfc822_idx
  on integrations.email_messages (google_account_id, rfc822_message_id);
create index email_messages_relationship_idx
  on integrations.email_messages (relationship_id, occurred_at);

create trigger set_updated_at
  before update on integrations.email_messages
  for each row execute function private.set_updated_at();

alter table integrations.email_messages enable row level security;

create policy email_messages_select_own_mailbox
  on integrations.email_messages for select to authenticated
  using (
    (select private.is_tenant_member(tenant_id))
    and exists (
      select 1 from integrations.google_accounts a
       where a.id = google_account_id
         and a.user_id = (select private.current_app_user_id())
    )
  );

grant select on integrations.email_messages to authenticated;
