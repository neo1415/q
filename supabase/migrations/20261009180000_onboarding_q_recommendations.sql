-- Q's recommendations as durable onboarding suggestions (CQ-QX-008 P0-2;
-- lead decision 2026-09-25: pending recommendations survive a restart,
-- bound to the exact payload proposed).
--
-- onboarding.suggestions was built for this ("proposals for a step, future
-- Q output"): a value validated against the pinned step, typed source
-- references, a model run reference, PENDING -> ACCEPTED / EDITED /
-- REJECTED / EXPIRED, and acceptance that creates a normal validated
-- response. A Q recommendation is one of these with a Q_RECOMMENDATION
-- source reference. What it lacked:
--
-- - the reason Q gave, said to the person with the recommendation;
-- - a guarantee that the proposed payload can never change after it was
--   proposed, and that a decision is made once. An approval binds to the
--   exact payload; the payload therefore cannot move under it.

alter table onboarding.suggestions
  add column rationale text
    check (rationale is null or length(rationale) between 1 and 300);

comment on column onboarding.suggestions.rationale is
  'Why it was proposed, as said to the person. Prose for people; never a filter.';

create or replace function onboarding.protect_suggestion_history() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'onboarding suggestions are history and cannot be deleted' using errcode = 'check_violation';
  end if;
  if new.session_id is distinct from old.session_id
     or new.step_key is distinct from old.step_key
     or new.target_field is distinct from old.target_field
     or new.suggested_value is distinct from old.suggested_value
     or new.source_refs is distinct from old.source_refs
     or new.confidence is distinct from old.confidence
     or new.model_run_id is distinct from old.model_run_id
     or new.rationale is distinct from old.rationale
     or new.created_at is distinct from old.created_at then
    raise exception 'an onboarding suggestion''s proposal is immutable' using errcode = 'check_violation';
  end if;
  if old.status <> 'PENDING' and new.status is distinct from old.status then
    raise exception 'an onboarding suggestion is decided exactly once' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function onboarding.protect_suggestion_history() from public;

create trigger suggestions_history_only
  before update or delete on onboarding.suggestions
  for each row execute function onboarding.protect_suggestion_history();

-- At most one pending Q recommendation per session and step: a new one
-- supersedes (EXPIRED) the old in the same transaction.
create unique index suggestions_one_pending_q_recommendation
  on onboarding.suggestions (session_id, step_key)
  where status = 'PENDING'
    and source_refs @> '[{"sourceType": "Q_RECOMMENDATION"}]'::jsonb;
