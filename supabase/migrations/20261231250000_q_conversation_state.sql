-- Q intelligence plan step 2 · q_runtime.conversation_states,
-- q_runtime.conversation_summary_revisions
--
-- Q-IQ baseline (5 Nov 2026): the bare model, given the raw conversation,
-- beat Q's machinery on pronouns, ordinals, follow-ups and corrections. The
-- turn reader saw 6 messages at 400 characters and the reference rules saw
-- at most 4 card lists, so "her CFO" or "the second one" eight turns later
-- had nothing to bind to. This is the durable per-conversation state every
-- model step reads instead:
--
--   conversation_states            one row per conversation: the entity
--                                  ledger (companies, investors, people,
--                                  documents, plans and figures with their
--                                  ids, how and when each appeared, and
--                                  list positions) and the open threads
--                                  (corrections, unresolved references,
--                                  pending approvals). Built DETERMINISTICALLY
--                                  by code from stored turns, blocks and
--                                  tool results, folded forward from the
--                                  last message it covers, so it survives
--                                  restarts and outlives the 64-message
--                                  history window. Optimistic version.
--   conversation_summary_revisions the running summary, append-only: each
--                                  compaction is the next revision, never
--                                  an edit, so a corrected summary keeps
--                                  the one it corrected. Model-written
--                                  through the Model Gateway; a revision is
--                                  stored only after Capital Q's
--                                  deterministic summary gate passed it.
--
-- personal_private, like the conversation: readable by its owner in its
-- tenant and nobody else. Interaction state, never Q Knowledge, never Q
-- Memory, never a source of fact: what was said is in the messages.
-- Binding a word to a ledger entry grants nothing: every tool still
-- authorises its own read.
--
-- Additive only: two new tables, no change to an existing one.

create table q_runtime.conversation_states (
  conversation_id     uuid primary key,
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  -- The conversation's owner, checked against q_runtime.conversations by
  -- the guard below: a state is never filed under another person.
  user_id             uuid not null references identity.user_profiles (id) on delete restrict,
  -- { entities: [...], lists: [...] }, validated by the application
  -- (QConversationLedgerSchema) on the way in and out. Bounded here so a
  -- malformed writer cannot store a document under its name.
  ledger              jsonb not null default '{"entities": [], "lists": []}'::jsonb
                        check (jsonb_typeof(ledger) = 'object'
                           and length(ledger::text) <= 200000),
  open_threads        jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(open_threads) = 'array'
                           and jsonb_array_length(open_threads) <= 50
                           and length(open_threads::text) <= 20000),
  -- The newest message folded in: the next fold starts after it.
  through_message_at  timestamptz,
  through_message_id  uuid,
  -- How many messages have been folded in over the conversation's life.
  messages_folded     integer not null default 0 check (messages_folded >= 0),
  -- The deterministic builder that wrote it; a new builder rebuilds.
  builder_version     text not null
                        check (builder_version ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  version             integer not null default 1 check (version >= 1),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint conversation_states_through_check
    check ((through_message_at is null) = (through_message_id is null)),
  foreign key (conversation_id, tenant_id)
    references q_runtime.conversations (id, tenant_id) on delete restrict
);

create index conversation_states_owner_idx
  on q_runtime.conversation_states (tenant_id, user_id, updated_at desc);

create table q_runtime.conversation_summary_revisions (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null,
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  user_id             uuid not null references identity.user_profiles (id) on delete restrict,
  -- 1, 2, 3 … per conversation, in order (guard below).
  revision            integer not null check (revision >= 1),
  summary             text not null check (length(summary) between 1 and 4000),
  -- The newest message this summary covers: it is never taken for more.
  covers_through_at   timestamptz not null,
  covered_messages    integer not null check (covered_messages >= 1),
  -- The deterministic gate that passed it, and the prompt that wrote it.
  gate_version        text not null
                        check (gate_version ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  prompt_version      text
                        check (prompt_version is null
                           or prompt_version ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'),
  -- The run whose learning wrote it, for attribution.
  q_run_id            uuid,
  created_at          timestamptz not null default now(),

  unique (conversation_id, revision),
  foreign key (conversation_id, tenant_id)
    references q_runtime.conversations (id, tenant_id) on delete restrict
);

create index conversation_summary_revisions_latest_idx
  on q_runtime.conversation_summary_revisions (tenant_id, conversation_id, revision desc);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- The state belongs to the conversation's owner; who and where never move;
-- the version moves by exactly one per write.
create function q_runtime.conversation_states_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from q_runtime.conversations c
     where c.id = new.conversation_id
       and c.tenant_id = new.tenant_id
       and c.user_id = new.user_id
  ) then
    raise exception 'a conversation state belongs to the conversation''s owner'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.version <> 1 then
      raise exception 'a conversation state starts at version 1' using errcode = '23514';
    end if;
  else
    if new.conversation_id <> old.conversation_id
       or new.tenant_id <> old.tenant_id
       or new.user_id <> old.user_id
       or new.created_at <> old.created_at then
      raise exception 'a conversation state''s owner and conversation never move'
        using errcode = '23514';
    end if;
    if new.version <> old.version + 1 then
      raise exception 'a conversation state''s version moves by one' using errcode = '23514';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function q_runtime.conversation_states_guard() from public;
create trigger conversation_states_guard
  before insert or update on q_runtime.conversation_states
  for each row execute function q_runtime.conversation_states_guard();

-- Revisions are the owner's, in order, and never rewritten.
create function q_runtime.conversation_summary_revisions_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_next integer;
begin
  if tg_op <> 'INSERT' then
    raise exception 'a summary revision is never rewritten' using errcode = '23514';
  end if;
  if not exists (
    select 1 from q_runtime.conversations c
     where c.id = new.conversation_id
       and c.tenant_id = new.tenant_id
       and c.user_id = new.user_id
  ) then
    raise exception 'a summary belongs to the conversation''s owner' using errcode = '23514';
  end if;
  -- Serialise revisions of one conversation: two writers cannot both take
  -- the same next number.
  perform 1 from q_runtime.conversations c
   where c.id = new.conversation_id and c.tenant_id = new.tenant_id
   for update;
  select coalesce(max(r.revision), 0) + 1 into v_next
    from q_runtime.conversation_summary_revisions r
   where r.conversation_id = new.conversation_id;
  if new.revision <> v_next then
    raise exception 'summary revisions come in order' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function q_runtime.conversation_summary_revisions_guard() from public;
create trigger conversation_summary_revisions_guard
  before insert or update on q_runtime.conversation_summary_revisions
  for each row execute function q_runtime.conversation_summary_revisions_guard();

-- ---------------------------------------------------------------------------
-- RLS and grants: the owner reads; the server writes
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['conversation_states', 'conversation_summary_revisions'] loop
    execute format('alter table q_runtime.%I enable row level security', t);
    execute format('alter table q_runtime.%I force row level security', t);
    execute format(
      'create policy %I on q_runtime.%I for select to authenticated using ('
      || 'user_id = (select private.current_app_user_id()) '
      || 'and (select private.is_tenant_member(tenant_id)))',
      t || '_select_own', t);
    execute format('revoke all on q_runtime.%I from public, anon, authenticated', t);
    execute format('grant select on q_runtime.%I to authenticated', t);
    execute format('grant select, insert on q_runtime.%I to postgres, service_role', t);
  end loop;
end;
$$;

-- Only the state head moves; revisions are append-only.
grant update on q_runtime.conversation_states to postgres, service_role;

comment on table q_runtime.conversation_states is
  'Q intelligence step 2: per-conversation state (entity ledger, open threads), built deterministically by code from stored turns, blocks and tool results. personal_private; interaction state, never knowledge, memory or fact. Binding grants nothing.';
comment on table q_runtime.conversation_summary_revisions is
  'Q intelligence step 2: the running conversation summary, append-only and sequential. Model-written through the Model Gateway, stored only after the deterministic summary gate; rendered as untrusted, never a source of fact.';
