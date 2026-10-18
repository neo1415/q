-- CQ-PRE-REC-001 · onboarding.interview_questions
--
-- The questions Q still wants to ask in a journey, persisted as journey
-- state so an interview survives a refresh, a logout and a new machine.
-- A question is not an answer: answering one submits a normal validated
-- response to the step the question maps to, through the existing commit
-- path, and the question is then marked ANSWERED. A question never carries
-- a canonical value and never becomes truth on its own.
--
-- Rows are created only by trusted server work (the founder document
-- review, the investor mandate reading, the conversational interview);
-- the browser can only answer or dismiss one it owns through the runtime.

create table onboarding.interview_questions (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references onboarding.sessions (id) on delete restrict,
  -- The step a plain answer lands on. Options may name another eligible step.
  step_key       text not null check (step_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  -- The journey's own stable key for the fact being asked about; one PENDING question per fact.
  fact_key       text not null check (fact_key ~ '^[a-z][a-z0-9_.]{0,79}$'),
  question       text not null check (length(question) between 1 and 500),
  why            text check (why is null or length(why) <= 500),
  reason         text not null check (reason in (
                   'CONTRADICTION', 'REQUIRED_AND_UNANSWERED', 'AMBIGUITY', 'MATERIAL_GAP', 'EXCLUSION_CONFIRMATION'
                 )),
  -- Competing readings attached to a contradiction, as short strings. Never a decision.
  readings       jsonb not null default '[]'::jsonb check (jsonb_typeof(readings) = 'array' and length(readings::text) <= 2048),
  -- Server-built quick answers [{label, stepKey, value}], each already a valid response for its step.
  options        jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array' and length(options::text) <= 8192),
  -- Typed bounded references [{sourceType, sourceId}]. No bodies, prompts or URLs.
  source_refs    jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs) = 'array' and length(source_refs::text) <= 4096),
  status         text not null default 'PENDING' check (status in ('PENDING', 'ANSWERED', 'DISMISSED', 'SUPERSEDED')),
  created_at     timestamptz not null default clock_timestamp(),
  resolved_at    timestamptz,
  check ((status = 'PENDING') = (resolved_at is null))
);

comment on table onboarding.interview_questions is
  'Questions Q still wants answered in a journey. Answering submits a normal validated response to the mapped step; the question itself is never a value and never truth.';

create unique index interview_questions_one_pending_per_fact
  on onboarding.interview_questions (session_id, fact_key)
  where status = 'PENDING';
create index interview_questions_session_status_created_idx
  on onboarding.interview_questions (session_id, status, created_at);

-- Answering and dismissing are session mutations with the same idempotency
-- record every other mutation uses.
alter table onboarding.session_mutation_requests
  drop constraint session_mutation_requests_operation_check;
alter table onboarding.session_mutation_requests
  add constraint session_mutation_requests_operation_check
  check (operation in ('submit', 'skip', 'resolve_suggestion', 'answer_question', 'dismiss_question'));

-- Exposure: INTERNAL_SERVER_ONLY, like every other journey-state table.
alter table onboarding.interview_questions enable row level security;
-- No policies, no anon/authenticated/service_role grants.
