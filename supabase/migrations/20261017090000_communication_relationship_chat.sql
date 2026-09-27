-- R34 · Relationship chat (CQ-COMM-001; doc 13 §33; ADR 0019).
--
-- communication.conversations   one 1:1 thread per canonical relationship
-- communication.messages        append-only messages; an edit or an unsend
--                               is a new row that revises an original
-- communication.read_receipts   one read cursor per person per thread
--
-- Parties: the active members of the relationship's company organisation
-- and of its investor organisation, resolved from the canonical rows, never
-- from anything a client sends. Messaging opens only on a CONNECTED
-- relationship (Product Specification §6.6.6); that rule is the server's,
-- because it is business state. RLS here is the second wall: a person who
-- is not a member of either party organisation reads nothing.
--
-- Writes: server-side only (the privileged server role), after the
-- application has authorised the person as a party. No client role may
-- insert, update or delete anything here.
--
-- A message is never overwritten, not even by the server role: UPDATE and
-- DELETE are refused by trigger. History is the rows.
--
-- Additive only.

create schema if not exists communication;
revoke all on schema communication from public;
grant usage on schema communication to authenticated;

-- ---------------------------------------------------------------------------
-- communication.conversations
-- ---------------------------------------------------------------------------

create table communication.conversations (
  id               uuid primary key default gen_random_uuid(),
  -- The relationship's tenant (the company tenant, ADR 0003).
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  relationship_id  uuid not null,
  created_at       timestamptz not null default clock_timestamp(),
  -- 1:1: one thread per canonical relationship. Never a parallel record.
  unique (relationship_id),
  unique (id, tenant_id),
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict
);

comment on table communication.conversations is
  'The one chat thread on a canonical company-investor relationship (R34). Not a relationship, not a CRM record: the relationship row stays the only truth.';

alter table communication.conversations enable row level security;

-- ---------------------------------------------------------------------------
-- Party predicate (security definer: reads canonical rows the caller has no
-- grant on, and answers only yes or no).
-- ---------------------------------------------------------------------------

create function private.is_conversation_party(target_conversation_id uuid)
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
       and (
         (select private.is_organisation_member(co.organisation_id))
         or (select private.is_organisation_member(io.organisation_id))
       )
  )
$$;

revoke all on function private.is_conversation_party(uuid) from public;
grant execute on function private.is_conversation_party(uuid) to authenticated;

create policy conversations_select_party
  on communication.conversations for select to authenticated
  using ((select private.is_conversation_party(id)));

grant select on communication.conversations to authenticated;

-- ---------------------------------------------------------------------------
-- communication.messages
-- ---------------------------------------------------------------------------

create table communication.messages (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null,
  conversation_id         uuid not null,
  sender_user_id          uuid not null references identity.user_profiles (id) on delete restrict,
  -- Which party the sender spoke for, resolved by the server.
  sender_side             text not null check (sender_side in ('COMPANY', 'INVESTOR')),
  kind                    text not null check (kind in ('TEXT', 'ATTACHMENT', 'VOICE_NOTE', 'EDIT', 'TOMBSTONE')),
  body                    text check (body is null or (length(body) between 1 and 4000)),
  -- A document the sender's own organisation holds, uploaded through the
  -- document pipeline. The bytes stay in private storage.
  document_id             uuid references evidence.documents (id) on delete restrict,
  -- Snapshot of what the other side is shown. Never a storage key or URL.
  attachment_title        text check (attachment_title is null or length(attachment_title) between 1 and 300),
  attachment_mime_type    text check (attachment_mime_type is null or attachment_mime_type ~ '^[^/[:space:]]+/[^/[:space:]]+$'),
  attachment_size_bytes   bigint check (attachment_size_bytes is null or attachment_size_bytes >= 0),
  voice_duration_ms       integer check (voice_duration_ms is null or voice_duration_ms between 1 and 600000),
  -- EDIT / TOMBSTONE: the original this revises.
  revises_message_id      uuid references communication.messages (id) on delete restrict,
  -- Set when the message was sent as an approved Q action.
  q_action_id             uuid,
  idempotency_key         text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at              timestamptz not null default clock_timestamp(),
  foreign key (conversation_id, tenant_id)
    references communication.conversations (id, tenant_id) on delete restrict,
  check ((kind in ('EDIT', 'TOMBSTONE')) = (revises_message_id is not null)),
  check (kind <> 'TEXT' or (body is not null and document_id is null)),
  check (kind <> 'EDIT' or (body is not null and document_id is null)),
  check (kind <> 'TOMBSTONE' or (body is null and document_id is null)),
  check (kind not in ('ATTACHMENT', 'VOICE_NOTE')
         or (document_id is not null and attachment_title is not null and attachment_mime_type is not null)),
  check (kind = 'VOICE_NOTE' or voice_duration_ms is null),
  check ((document_id is null) = (attachment_title is null))
);

comment on table communication.messages is
  'Append-only 1:1 messages on a relationship thread (R34). An edit or an unsend is a new row revising the original; nothing is overwritten. Relationship history records message_sent as activity only.';

create unique index messages_sender_idempotency
  on communication.messages (sender_user_id, idempotency_key);
create unique index messages_one_per_q_action
  on communication.messages (q_action_id) where q_action_id is not null;
create index messages_conversation_created_idx
  on communication.messages (conversation_id, created_at, id);
create index messages_revises_idx
  on communication.messages (revises_message_id) where revises_message_id is not null;

-- History is the rows: nothing is ever updated or deleted.
create function private.communication_messages_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'communication.messages is append-only'
    using errcode = '55000';
end
$$;

create trigger messages_append_only
  before update or delete on communication.messages
  for each row execute function private.communication_messages_append_only();

-- A revision revises an original in the same thread, by its own sender.
create function private.communication_messages_revision_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  original communication.messages%rowtype;
begin
  if new.revises_message_id is null then
    return new;
  end if;
  select * into original from communication.messages where id = new.revises_message_id;
  if original.id is null
     or original.conversation_id <> new.conversation_id
     or original.sender_user_id <> new.sender_user_id
     or original.revises_message_id is not null then
    raise exception 'a revision must revise the sender''s own original in the same thread'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger messages_revision_guard
  before insert on communication.messages
  for each row execute function private.communication_messages_revision_guard();

alter table communication.messages enable row level security;

create policy messages_select_party
  on communication.messages for select to authenticated
  using ((select private.is_conversation_party(conversation_id)));

grant select on communication.messages to authenticated;

-- ---------------------------------------------------------------------------
-- communication.read_receipts
-- ---------------------------------------------------------------------------

create table communication.read_receipts (
  conversation_id        uuid not null,
  tenant_id              uuid not null,
  user_id                uuid not null references identity.user_profiles (id) on delete restrict,
  -- A cursor, not history: it only ever moves forward (server-enforced).
  last_read_message_id   uuid not null references communication.messages (id) on delete restrict,
  last_read_at           timestamptz not null default clock_timestamp(),
  primary key (conversation_id, user_id),
  foreign key (conversation_id, tenant_id)
    references communication.conversations (id, tenant_id) on delete restrict
);

comment on table communication.read_receipts is
  'How far each person has read a relationship thread (R34). A forward-only cursor.';

alter table communication.read_receipts enable row level security;

create policy read_receipts_select_party
  on communication.read_receipts for select to authenticated
  using ((select private.is_conversation_party(conversation_id)));

grant select on communication.read_receipts to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: published under RLS, so any future realtime subscriber sees only
-- threads it is a party to. The web polls today (ADR 0019).
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table communication.messages;
  end if;
end
$$;
