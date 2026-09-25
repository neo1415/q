-- Taking an onboarding answer back, with its history kept (CQ-QX-008;
-- ADR 0016; lead decision 2026-09-25, "correcting completed answers must
-- work").
--
-- A revision already inserts a new row and links the old one forward. What
-- could not be said was "there is nothing here any more": a completed
-- optional step could not be emptied, so "adult content" could never move
-- from "rather not see" to "never show" when it was the only item — the
-- journey keeps a red flag in one list, and a list needs one item.
--
-- A withdrawal marks the current response withdrawn, once, and never edits
-- or deletes it. Current = neither superseded nor withdrawn. A later answer
-- to the same step is a new row, as any revision is.

alter table onboarding.responses
  add column withdrawn_at timestamptz;

alter table onboarding.responses
  add constraint responses_superseded_or_withdrawn
    check (withdrawn_at is null or superseded_by_response_id is null);

comment on column onboarding.responses.withdrawn_at is
  'Set once when the person took this answer back without replacing it. The row stays as history.';

comment on table onboarding.responses is
  'Onboarding response history. Current = superseded_by_response_id is null and withdrawn_at is null. Content is never edited; a revision inserts a new row and links the old one forward; a withdrawal marks the row withdrawn.';

create or replace function onboarding.protect_response_history() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'onboarding responses are history and cannot be deleted' using errcode = 'check_violation';
  end if;
  if new.session_id is distinct from old.session_id
     or new.step_key is distinct from old.step_key
     or new.response_type is distinct from old.response_type
     or new.response_jsonb is distinct from old.response_jsonb
     or new.raw_text is distinct from old.raw_text
     or new.note is distinct from old.note
     or new.source_modality is distinct from old.source_modality
     or new.created_at is distinct from old.created_at then
    raise exception 'onboarding response content is immutable' using errcode = 'check_violation';
  end if;
  if old.superseded_by_response_id is not null
     and new.superseded_by_response_id is distinct from old.superseded_by_response_id then
    raise exception 'an onboarding response is superseded exactly once' using errcode = 'check_violation';
  end if;
  if old.withdrawn_at is not null
     and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'an onboarding response is withdrawn exactly once' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function onboarding.protect_response_history() from public;

-- One current response per session + step, where current now also means
-- not withdrawn.
drop index onboarding.responses_current_uniq;
create unique index responses_current_uniq
  on onboarding.responses (session_id, step_key)
  where superseded_by_response_id is null and withdrawn_at is null;

-- Withdrawing is a session mutation with the same idempotency record every
-- other mutation uses.
alter table onboarding.session_mutation_requests
  drop constraint session_mutation_requests_operation_check;
alter table onboarding.session_mutation_requests
  add constraint session_mutation_requests_operation_check
  check (operation in ('submit', 'skip', 'resolve_suggestion', 'answer_question', 'dismiss_question', 'say', 'withdraw'));
