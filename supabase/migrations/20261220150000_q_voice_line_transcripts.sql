-- VOICE-BRAIN (founder live 2026-10-08): the full-duplex voice line's
-- transcript, both sides, server-only.
--
-- On 2026-10-08 09:59-10:01 UTC a founder's duplex call ran one ask_q;
-- everything else he said was answered by the realtime voice model alone
-- ("I can't open files"), and none of it was stored anywhere. This table
-- holds every turn of a duplex line: what the person said (the provider's
-- transcript, or what they typed) and what the voice said, with when, and
-- who answered it: Q's pipeline (ask_q), small talk the voice may answer,
-- or the voice alone (model_only).
--
-- Founder- or investor-private: the owner is the person on the line; it
-- is never shared with their organisation, never read by a browser (no
-- grants, RLS on with no policies), and the Q API reads and writes it only
-- as that person. Interaction history, never canonical business truth,
-- never a prompt. Retention follows the conversation's messages: a turn
-- linked to a conversation goes when the conversation does (cascade); the
-- conversation_messages copy of a model-only turn is written by q-runtime.

create table q_runtime.voice_line_turns (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references identity.tenants (id) on delete restrict,
  user_id           uuid not null references identity.user_profiles (id) on delete restrict,
  -- The voice session (the line), as the Q API issued it: an opaque id.
  voice_session_id  text not null check (
                      voice_session_id ~ '^[A-Za-z0-9._:-]+$'
                      and length(voice_session_id) between 1 and 128),
  -- Null until the line's first answer from Q starts a conversation.
  conversation_id   uuid,
  role              text not null check (role in ('USER', 'Q')),
  content           text not null check (
                      length(content) >= 1
                      and ((role = 'USER' and length(content) <= 2000)
                        or (role = 'Q' and length(content) <= 4000))),
  -- Who answered this turn (USER), or how what Q said was made (Q).
  routed            text not null check (routed in ('ask_q', 'smalltalk', 'model_only')),
  -- The person typed it on the open line rather than said it.
  typed             boolean not null default false,
  -- The provider's item or response id: an opaque reference, never a payload.
  provider_ref      text check (provider_ref is null or
                      (provider_ref ~ '^[A-Za-z0-9._:-]+$'
                       and length(provider_ref) between 1 and 128)),
  spoken_at         timestamptz not null,
  created_at        timestamptz not null default clock_timestamp(),

  foreign key (conversation_id, tenant_id)
    references q_runtime.conversations (id, tenant_id) on delete cascade
);

comment on table q_runtime.voice_line_turns is
  'The full-duplex voice line transcript, both sides, with who answered each turn (ask_q, smalltalk, model_only). Owner-private, server-only; never canonical business truth, never a prompt. Retention follows the linked conversation.';

create index voice_line_turns_session_idx
  on q_runtime.voice_line_turns (tenant_id, user_id, voice_session_id, spoken_at);
create index voice_line_turns_conversation_idx
  on q_runtime.voice_line_turns (conversation_id, spoken_at)
  where conversation_id is not null;

alter table q_runtime.voice_line_turns enable row level security;

-- No policies and no client grants (as every q_runtime table): the Q API
-- is the boundary, and it passes every read and write through the actor.
revoke all on q_runtime.voice_line_turns from public, anon, authenticated;
grant select, insert on q_runtime.voice_line_turns to postgres, service_role;
