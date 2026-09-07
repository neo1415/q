-- CQ-Q-002 · Q runtime foundation: the durable spine of a Q interaction —
-- the conversation that contains it, the messages exchanged in it, the run
-- that does the work, and the append-only, sequence-ordered events the run
-- emits (doc 12 §9, §37; doc 13 §34, §47; doc 22 §66–78).
--
--   Q conversation ≠ Q institutional memory
--   Q message      ≠ canonical company truth
--   Q run          ≠ Q Knowledge Object
--   Q run event    ≠ domain event ≠ audit event
--   run accepted   ≠ analysis completed
--
-- Nothing here reasons. No model, no graph, no retrieval, no tool and no
-- approval exists at this migration; a run is a durable record of what was
-- asked, by whom, in which context, and where the runtime is with it. The
-- schema is built so those later systems cannot casually dump a prompt, a
-- provider response or a reasoning trace into it: every text column is
-- bounded, every vocabulary is closed, and there is no free-form column at
-- all.

create schema if not exists q_runtime;
comment on schema q_runtime is
  'Q runtime bounded context: conversations, conversation messages, runs and append-only run events. Interaction history and runtime state only — never institutional Q knowledge, never canonical company truth, never chain-of-thought.';

revoke all on schema q_runtime from public, anon, authenticated;
grant usage on schema q_runtime to postgres, service_role;

-- ---------------------------------------------------------------------------
-- q_runtime.conversations  (doc 13 §34.1)
--
-- The container for one person's exchange with Q. Owned by the person who
-- started it; the organisation is the context they were acting in, and is
-- NOT a grant of visibility to the rest of that organisation. Organisation-
-- shared Q is a deliberate later feature, never a side effect of a column.
-- ---------------------------------------------------------------------------

create table q_runtime.conversations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  -- The owner. Resolved from the authenticated actor, never from a request.
  user_id          uuid not null references identity.user_profiles (id) on delete restrict,
  -- The organisation context the person was acting in, when there was one.
  -- Context, not authority: membership of this organisation grants nothing
  -- on this row.
  organisation_id  uuid,
  -- Whether the person was acting personally or for an organisation. Derived
  -- from the actor context at creation and fixed for the life of the
  -- conversation: a later run cannot quietly pivot it.
  context_type     text not null check (context_type in ('PERSONAL', 'ORGANISATION')),
  -- Typed canonical subject references (QSubjectRef[]), validated by the
  -- application before writing. Bounded here so a malformed writer cannot
  -- store a document under the name of a reference. Never a dynamic table
  -- name.
  subject_refs     jsonb not null default '[]'::jsonb
                     check (jsonb_typeof(subject_refs) = 'array'
                        and jsonb_array_length(subject_refs) <= 20
                        and length(subject_refs::text) <= 4096),
  created_at       timestamptz not null default now(),
  archived_at      timestamptz,

  -- Context type and organisation agree by construction.
  constraint conversations_context_check
    check ((context_type = 'ORGANISATION') = (organisation_id is not null)),

  foreign key (organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict,
  -- Lets dependants reference (conversation, tenant) as a pair.
  unique (id, tenant_id)
);

comment on table q_runtime.conversations is
  'One person''s Q interaction container. Owned by user_id; organisation_id is the acting context, not organisation-wide visibility. Interaction history, never institutional memory.';
comment on column q_runtime.conversations.organisation_id is
  'The organisation the owner was acting for. Context only: it does not make the conversation visible to other members.';

create index conversations_owner_idx
  on q_runtime.conversations (tenant_id, user_id, created_at desc);
create index conversations_organisation_idx
  on q_runtime.conversations (tenant_id, organisation_id, created_at desc)
  where organisation_id is not null;

alter table q_runtime.conversations enable row level security;

-- ---------------------------------------------------------------------------
-- q_runtime.runs  (doc 13 §47.1)
--
-- One unit of Q work. Status is the deterministic machine lifecycle from
-- the Q contract (QRunStatus); it is set only through the lifecycle policy
-- in @capital-q/q-runtime and never by a route. It is not the visible stage
-- a person is shown, not relationship state, and not a judgement about the
-- subject.
-- ---------------------------------------------------------------------------

create table q_runtime.runs (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references identity.tenants (id) on delete restrict,
  actor_user_id            uuid not null references identity.user_profiles (id) on delete restrict,
  actor_organisation_id    uuid,
  -- Nullable per doc 13: a future system-initiated run may have no
  -- conversation. Every run created through the API today has one.
  conversation_id          uuid,

  objective                text not null check (length(objective) between 1 and 500),
  -- QCapability. Product outcomes, never internal agents.
  capability               text not null check (capability in (
                             'ANSWER', 'INVESTIGATE', 'COMPARE', 'ASSESS', 'CLASSIFY', 'PREPARE_ACTION')),
  -- QConsequenceClass, decided by the server from capability and policy.
  -- A client cannot declare its own request low-consequence.
  consequence_class        text not null check (consequence_class in ('LOW', 'MODERATE', 'HIGH')),
  -- QRunStatus, exactly. Terminal: COMPLETED, FAILED, CANCELLED, EXPIRED.
  status                   text not null default 'RECEIVED' check (status in (
                             'RECEIVED', 'PREFLIGHT', 'CONTEXT_RESOLUTION', 'POLICY_CHECK',
                             'PLANNING', 'RETRIEVAL', 'SPECIALIST_EXECUTION', 'SYNTHESIS',
                             'VERIFICATION', 'AWAITING_INPUT', 'AWAITING_APPROVAL',
                             'ACTION_EXECUTION', 'CANCEL_REQUESTED',
                             'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED')),
  subject_refs             jsonb not null default '[]'::jsonb
                             check (jsonb_typeof(subject_refs) = 'array'
                                and jsonb_array_length(subject_refs) <= 20
                                and length(subject_refs::text) <= 4096),

  -- Reproducibility identities (doc 12 §9.3). NULL until the systems that
  -- own them exist: the orchestrator (CQ-Q-003), the prompt registry
  -- (CQ-Q-006) and the model policy (CQ-Q-005). A placeholder value here
  -- would be a lie about what ran.
  orchestration_version    text check (orchestration_version is null or
                             (orchestration_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')),
  prompt_bundle_version    text check (prompt_bundle_version is null or
                             (prompt_bundle_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')),
  model_policy_version     text check (model_policy_version is null or
                             (model_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')),

  correlation_id           text not null check (correlation_id ~ '^cor_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),

  created_at               timestamptz not null default now(),
  -- When orchestration actually began. Not creation: a run that was
  -- accepted and never picked up has no start.
  started_at               timestamptz,
  -- Set on every terminal transition and only then.
  completed_at             timestamptz,
  -- Internal diagnostic vocabulary (QFailureDiagnosticCode). Never sent to
  -- a client as-is; the public projection is a fixed plain-English table.
  failure_code             text check (failure_code is null or failure_code in (
                             'INVALID_REQUEST', 'SUBJECT_NOT_RESOLVED', 'CONTEXT_RESOLUTION_FAILED',
                             'POLICY_DENIED', 'MODEL_PROVIDER_TIMEOUT', 'MODEL_PROVIDER_UNAVAILABLE',
                             'EVIDENCE_PROCESSING_UNAVAILABLE', 'RETRIEVAL_FAILED', 'TOOL_FAILED',
                             'APPROVAL_EXPIRED', 'BUDGET_EXCEEDED', 'RUN_CANCELLED', 'RUN_EXPIRED',
                             'INTERNAL_ERROR')),

  -- Optimistic concurrency for lifecycle moves: a stale writer updates
  -- zero rows and is told so.
  version                  integer not null default 1 check (version >= 1),
  -- Allocator for the per-run event sequence. Incremented under the row
  -- lock an UPDATE takes, so two concurrent appends cannot both claim the
  -- same number and neither is lost.
  last_event_sequence      integer not null default 0 check (last_event_sequence >= 0),

  -- Terminal state and completion time agree by construction.
  constraint runs_completed_state_check
    check ((completed_at is not null) = (status in ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'))),
  -- A failed run always says why (internally); a live or completed run
  -- never carries a failure code.
  constraint runs_failure_state_check
    check ((status = 'FAILED' and failure_code is not null)
        or (status in ('CANCELLED', 'EXPIRED'))
        or (status not in ('FAILED', 'CANCELLED', 'EXPIRED') and failure_code is null)),
  -- A run cannot have started after it completed, nor completed before it
  -- was created.
  constraint runs_time_order_check
    check ((started_at is null or started_at >= created_at)
       and (completed_at is null or completed_at >= created_at)),

  foreign key (actor_organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict,
  foreign key (conversation_id, tenant_id)
    references q_runtime.conversations (id, tenant_id) on delete restrict,
  unique (id, tenant_id)
);

comment on table q_runtime.runs is
  'One unit of Q work. status is QRunStatus, set only through the q-runtime lifecycle policy. Version identities stay NULL until the orchestrator, prompt registry and model policy exist. Not Q knowledge, not relationship state.';
comment on column q_runtime.runs.consequence_class is
  'Server-derived from capability and policy. Never accepted from a client.';
comment on column q_runtime.runs.started_at is
  'When orchestration began. NULL for a run that was accepted but never picked up; creation time is created_at.';
comment on column q_runtime.runs.last_event_sequence is
  'Per-run event sequence allocator. Incremented under the row lock so concurrent appends receive distinct consecutive numbers.';

create index runs_actor_idx
  on q_runtime.runs (tenant_id, actor_user_id, created_at desc);
create index runs_conversation_idx
  on q_runtime.runs (tenant_id, conversation_id, created_at desc)
  where conversation_id is not null;
-- Live-run lookups for the orchestrator and cancellation sweeps.
create index runs_active_idx
  on q_runtime.runs (status, created_at)
  where status not in ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');
create index runs_correlation_idx
  on q_runtime.runs (correlation_id);

alter table q_runtime.runs enable row level security;

-- ---------------------------------------------------------------------------
-- q_runtime.conversation_messages  (doc 13 §34.2)
--
-- The one canonical store of what was said. Two roles, Capital Q's own:
-- USER and Q. No provider role, no system role, no tool role — a provider's
-- message model is not the product's. Every message belongs to the run that
-- received or produced it (the Q contract requires runId on a message), and
-- through it to a conversation and a tenant.
-- ---------------------------------------------------------------------------

create table q_runtime.conversation_messages (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  conversation_id       uuid not null,
  run_id                uuid not null,
  role                  text not null check (role in ('USER', 'Q')),
  -- Plain text only. A person's turn is bounded at the public request limit;
  -- Q's turn may be longer. Neither is unbounded: an unbounded text column
  -- is where a future provider's entire response object would end up.
  content               text not null check (
                          length(content) >= 1
                          and ((role = 'USER' and length(content) <= 8000)
                            or (role = 'Q' and length(content) <= 32000))),
  content_type          text not null default 'TEXT' check (content_type in ('TEXT')),
  -- Reserved by doc 13 for a provider-side message reference. No provider
  -- exists, so it stays NULL; when one does, this holds an opaque reference
  -- only — never a provider payload, and never a provider-specific column.
  provider_message_ref  text check (provider_message_ref is null or
                          (provider_message_ref ~ '^[A-Za-z0-9._:-]+$'
                           and length(provider_message_ref) between 1 and 255)),
  created_at            timestamptz not null default clock_timestamp(),

  foreign key (conversation_id, tenant_id)
    references q_runtime.conversations (id, tenant_id) on delete restrict,
  foreign key (run_id, tenant_id)
    references q_runtime.runs (id, tenant_id) on delete restrict,
  unique (id, tenant_id)
);

comment on table q_runtime.conversation_messages is
  'The canonical Q conversation message store: what the person said and what Q answered, as bounded plain text. Interaction history, never canonical business truth, never a prompt, never a provider payload.';
comment on column q_runtime.conversation_messages.provider_message_ref is
  'Reserved opaque provider reference (doc 13). NULL until a provider exists; never a payload.';

create index conversation_messages_conversation_idx
  on q_runtime.conversation_messages (conversation_id, created_at, id);
create index conversation_messages_run_idx
  on q_runtime.conversation_messages (run_id, created_at, id);

alter table q_runtime.conversation_messages enable row level security;

-- ---------------------------------------------------------------------------
-- q_runtime.run_events  (doc 13 §47.2; doc 22 §71–74)
--
-- Append-only, sequence-ordered, user-safe runtime history. This is what a
-- later resumable stream (CQ-Q-009) replays from Last-Event-ID. It is not
-- the domain event bus, not the outbox, not audit, and it never carries a
-- token delta, a prompt, a reasoning trace or a message body — an event that
-- concerns a message carries its id.
-- ---------------------------------------------------------------------------

create table q_runtime.run_events (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references identity.tenants (id) on delete restrict,
  run_id         uuid not null,
  -- 1, 2, 3 … per run, allocated from runs.last_event_sequence under lock.
  sequence       integer not null check (sequence >= 1),
  -- QStreamEventType, exactly. There is no reasoning event and no free-text
  -- activity event; adding a type is a contract change.
  event_type     text not null check (event_type in (
                   'q.run.started', 'q.stage.changed', 'q.message.delta', 'q.message.completed',
                   'q.finding.available', 'q.action.proposed', 'q.approval.required',
                   'q.input.required', 'q.run.completed', 'q.run.failed')),
  -- QVisibleStage: the approved vocabulary a person may be shown.
  visible_stage  text check (visible_stage is null or visible_stage in (
                   'UNDERSTANDING_REQUEST', 'REVIEWING_COMPANY', 'CHECKING_EVIDENCE',
                   'REVIEWING_INVESTOR_CRITERIA', 'COMPARING_OPPORTUNITIES', 'REVIEWING_RELATIONSHIP',
                   'PREPARING_ANALYSIS', 'WAITING_FOR_REPLY', 'WAITING_FOR_APPROVAL',
                   'COMPLETING_APPROVED_ACTION')),
  -- The event's typed data, validated against the stream contract by the
  -- writer. Bounded: identifiers, coded states and short public text only.
  payload        jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 16384),
  occurred_at    timestamptz not null default clock_timestamp(),

  unique (run_id, sequence),
  foreign key (run_id, tenant_id)
    references q_runtime.runs (id, tenant_id) on delete restrict
);

comment on table q_runtime.run_events is
  'Append-only, sequence-ordered, user-safe Q run history (QStreamEvent). Replay source for the later resumable stream. Not a domain event, not audit, never chain-of-thought.';

-- (run_id, sequence) is served by the unique constraint's index.
create index run_events_tenant_run_idx
  on q_runtime.run_events (tenant_id, run_id, sequence);
create index run_events_type_time_idx
  on q_runtime.run_events (event_type, occurred_at);

-- Append-only is a database guarantee, not a convention: history is never
-- rewritten because a status later changed.
create function q_runtime.protect_run_events() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'q_runtime.run_events is append-only'
    using errcode = 'check_violation';
end;
$$;
revoke all on function q_runtime.protect_run_events() from public;

create trigger run_events_append_only
  before update or delete on q_runtime.run_events
  for each row execute function q_runtime.protect_run_events();

alter table q_runtime.run_events enable row level security;

-- ---------------------------------------------------------------------------
-- Idempotency records (server-only), following the established per-domain
-- pattern: hashes only, written inside the creating transaction. A retried
-- POST maps to the run or message it already created; the same key with a
-- different payload is a conflict.
-- ---------------------------------------------------------------------------

create table q_runtime.run_creation_requests (
  user_id               uuid not null references identity.user_profiles (id) on delete restrict,
  idempotency_key_hash  text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_hash          text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  run_id                uuid not null,
  tenant_id             uuid not null,
  created_at            timestamptz not null default now(),
  primary key (user_id, idempotency_key_hash),
  foreign key (run_id, tenant_id)
    references q_runtime.runs (id, tenant_id) on delete restrict
);

comment on table q_runtime.run_creation_requests is
  'Idempotency record for POST /v1/q/runs: (person, key hash) -> the run created. Hashes only; written in the creation transaction; server-only.';

create index run_creation_requests_run_idx
  on q_runtime.run_creation_requests (run_id);

alter table q_runtime.run_creation_requests enable row level security;

create table q_runtime.message_creation_requests (
  user_id               uuid not null references identity.user_profiles (id) on delete restrict,
  run_id                uuid not null,
  idempotency_key_hash  text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_hash          text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  message_id            uuid not null,
  tenant_id             uuid not null,
  created_at            timestamptz not null default now(),
  primary key (user_id, run_id, idempotency_key_hash),
  foreign key (run_id, tenant_id)
    references q_runtime.runs (id, tenant_id) on delete restrict,
  foreign key (message_id, tenant_id)
    references q_runtime.conversation_messages (id, tenant_id) on delete restrict
);

comment on table q_runtime.message_creation_requests is
  'Idempotency record for POST /v1/q/runs/:runId/messages: (person, run, key hash) -> the message created. Hashes only; server-only.';

create index message_creation_requests_message_idx
  on q_runtime.message_creation_requests (message_id);

alter table q_runtime.message_creation_requests enable row level security;

-- No policies and no client grants on any q_runtime table: the Q API is the
-- application boundary. A browser never reads a conversation row, a run row
-- or an event row, and the privileged server connection still passes every
-- read and write through ActorContext and the q-runtime ownership checks.
-- DB privilege ≠ business authorisation.
