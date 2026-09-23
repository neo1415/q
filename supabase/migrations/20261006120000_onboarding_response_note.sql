-- A person's own meaning beside a structured onboarding answer (CQ-QX-005).
--
-- "It doesn't really matter as long as they've got the grit to do it" was
-- recorded as "No specific preference": the options could hold the enum
-- reading (no pedigree required) but not the meaning (resilience matters).
-- The note keeps that meaning with the response it qualifies. It is prose
-- for people and for Q's reading of the person; it is never a filter, a
-- ranking feature or a mandate value, and it is as immutable as the rest
-- of the response: a correction is a new response, never an edit.
--
-- Distinct from raw_text, which is the verbatim utterance of a TEXT
-- response; a note may accompany any response type.

alter table onboarding.responses
  add column note text
    check (note is null or length(note) between 1 and 500);

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
  return new;
end;
$$;
revoke all on function onboarding.protect_response_history() from public;
