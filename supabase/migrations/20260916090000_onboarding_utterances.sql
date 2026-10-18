-- CQ-PRE-REC-001 · onboarding.utterances
--
-- What a person said to Q in the conversational interview when no
-- deterministic rule could place it on a step: a sentence that carries
-- several facts, a figure with a period, a preference in their own words.
-- It is journey state, like a response, and it is read by trusted server
-- work (the founder reading, the investor mandate reading) into
-- suggestions and questions the person then confirms. An utterance never
-- becomes a canonical value on its own.
--
-- Rows are written by the runtime's `say` use case for the session's own
-- user and read by the worker; the browser never reads them back.

create table onboarding.utterances (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references onboarding.sessions (id) on delete restrict,
  -- The step Q was asking about when the person said it, when there was one.
  step_key    text check (step_key is null or step_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  text        text not null check (length(text) between 1 and 2000),
  status      text not null default 'PENDING' check (status in ('PENDING', 'READ', 'IGNORED')),
  created_at  timestamptz not null default clock_timestamp(),
  read_at     timestamptz,
  check ((status = 'PENDING') = (read_at is null))
);

comment on table onboarding.utterances is
  'Free-text turns of the conversational interview that await Q''s reading. Read by trusted server work into suggestions and questions; never a canonical value.';

create index utterances_session_status_created_idx
  on onboarding.utterances (session_id, status, created_at);

-- Saying something is a session mutation with the same idempotency record
-- every other mutation uses.
alter table onboarding.session_mutation_requests
  drop constraint session_mutation_requests_operation_check;
alter table onboarding.session_mutation_requests
  add constraint session_mutation_requests_operation_check
  check (operation in ('submit', 'skip', 'resolve_suggestion', 'answer_question', 'dismiss_question', 'say'));

-- Exposure: INTERNAL_SERVER_ONLY, like every other journey-state table.
alter table onboarding.utterances enable row level security;
-- No policies, no anon/authenticated/service_role grants.
