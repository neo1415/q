# Duplex transcript storage

Why included: Both sides of the voice line stored server-only; no purge path; user FK restrict.

## `supabase/migrations/20261220150000_q_voice_line_transcripts.sql` lines 1-64

```sql
    1  -- VOICE-BRAIN (founder live 2026-10-08): the full-duplex voice line's
    2  -- transcript, both sides, server-only.
    3  --
    4  -- On 2026-10-08 09:59-10:01 UTC a founder's duplex call ran one ask_q;
    5  -- everything else he said was answered by the realtime voice model alone
    6  -- ("I can't open files"), and none of it was stored anywhere. This table
    7  -- holds every turn of a duplex line: what the person said (the provider's
    8  -- transcript, or what they typed) and what the voice said, with when, and
    9  -- who answered it: Q's pipeline (ask_q), small talk the voice may answer,
   10  -- or the voice alone (model_only).
   11  --
   12  -- Founder- or investor-private: the owner is the person on the line; it
   13  -- is never shared with their organisation, never read by a browser (no
   14  -- grants, RLS on with no policies), and the Q API reads and writes it only
   15  -- as that person. Interaction history, never canonical business truth,
   16  -- never a prompt. Retention follows the conversation's messages: a turn
   17  -- linked to a conversation goes when the conversation does (cascade); the
   18  -- conversation_messages copy of a model-only turn is written by q-runtime.
   19
   20  create table q_runtime.voice_line_turns (
   21    id                uuid primary key default gen_random_uuid(),
   22    tenant_id         uuid not null references identity.tenants (id) on delete restrict,
   23    user_id           uuid not null references identity.user_profiles (id) on delete restrict,
   24    -- The voice session (the line), as the Q API issued it: an opaque id.
   25    voice_session_id  text not null check (
   26                        voice_session_id ~ '^[A-Za-z0-9._:-]+$'
   27                        and length(voice_session_id) between 1 and 128),
   28    -- Null until the line's first answer from Q starts a conversation.
   29    conversation_id   uuid,
   30    role              text not null check (role in ('USER', 'Q')),
   31    content           text not null check (
   32                        length(content) >= 1
   33                        and ((role = 'USER' and length(content) <= 2000)
   34                          or (role = 'Q' and length(content) <= 4000))),
   35    -- Who answered this turn (USER), or how what Q said was made (Q).
   36    routed            text not null check (routed in ('ask_q', 'smalltalk', 'model_only')),
   37    -- The person typed it on the open line rather than said it.
   38    typed             boolean not null default false,
   39    -- The provider's item or response id: an opaque reference, never a payload.
   40    provider_ref      text check (provider_ref is null or
   41                        (provider_ref ~ '^[A-Za-z0-9._:-]+$'
   42                         and length(provider_ref) between 1 and 128)),
   43    spoken_at         timestamptz not null,
   44    created_at        timestamptz not null default clock_timestamp(),
   45
   46    foreign key (conversation_id, tenant_id)
   47      references q_runtime.conversations (id, tenant_id) on delete cascade
   48  );
   49
   50  comment on table q_runtime.voice_line_turns is
   51    'The full-duplex voice line transcript, both sides, with who answered each turn (ask_q, smalltalk, model_only). Owner-private, server-only; never canonical business truth, never a prompt. Retention follows the linked conversation.';
   52
   53  create index voice_line_turns_session_idx
   54    on q_runtime.voice_line_turns (tenant_id, user_id, voice_session_id, spoken_at);
   55  create index voice_line_turns_conversation_idx
   56    on q_runtime.voice_line_turns (conversation_id, spoken_at)
   57    where conversation_id is not null;
   58
   59  alter table q_runtime.voice_line_turns enable row level security;
   60
   61  -- No policies and no client grants (as every q_runtime table): the Q API
   62  -- is the boundary, and it passes every read and write through the actor.
   63  revoke all on q_runtime.voice_line_turns from public, anon, authenticated;
   64  grant select, insert on q_runtime.voice_line_turns to postgres, service_role;
```

## `apps/q-api/src/voice/duplex/transcript.ts` lines 40-74

```ts
   40  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
   41  const REF = /^[A-Za-z0-9._:-]{1,128}$/;
   42
   43  export function createPostgresDuplexTranscriptStore(dependencies: {
   44    readonly sql: DatabaseExecutor;
   45    readonly mirror: DuplexTranscriptStore["mirror"];
   46  }): DuplexTranscriptStore {
   47    const { sql } = dependencies;
   48    return {
   49      record: async (entry) => {
   50        const content = entry.content
   51          .trim()
   52          .slice(0, entry.role === "USER" ? 2_000 : 4_000);
   53        if (content.length === 0 || !REF.test(entry.voiceSessionId)) return;
   54        const conversationId =
   55          entry.conversationId !== null && UUID.test(entry.conversationId)
   56            ? entry.conversationId
   57            : null;
   58        const providerRef =
   59          entry.providerRef !== undefined &&
   60          entry.providerRef !== null &&
   61          REF.test(entry.providerRef)
   62            ? entry.providerRef
   63            : null;
   64        await sql`
   65          insert into q_runtime.voice_line_turns
   66            (tenant_id, user_id, voice_session_id, conversation_id, role,
   67             content, routed, typed, provider_ref, spoken_at)
   68          values (${entry.actor.tenantId}, ${entry.actor.userId},
   69                  ${entry.voiceSessionId}, ${conversationId}::uuid, ${entry.role},
   70                  ${content}, ${entry.routed}, ${entry.typed === true},
   71                  ${providerRef}, ${entry.spokenAt.toISOString()}::timestamptz)`;
   72      },
   73      mirror: dependencies.mirror,
   74    };
```
