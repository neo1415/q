-- Lane ob1 (2026-10-16) · onboarding.responses.channel
--
-- Which surface an answer was given in: the form or the conversation with
-- Q. source_modality says HOW it was given (a selection, typed text, a
-- voice transcript); it cannot tell a choice tapped in the form from one Q
-- recorded in the conversation, and a conversational answer was being
-- credited to "the form". Provenance for people, never authority: nothing
-- decides anything by it. Null for answers recorded before it existed.
-- Immutable with the rest of the response.

alter table onboarding.responses
  add column channel text
    check (channel is null or channel in ('FORM', 'CONVERSATION'));

comment on column onboarding.responses.channel is
  'FORM or CONVERSATION: the surface the answer was given in. Provenance only; null for older answers. Immutable.';

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
     or new.channel is distinct from old.channel
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
