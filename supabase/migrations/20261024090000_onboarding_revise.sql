-- Revising a completed onboarding answer (ADR 0024).
--
-- A person changes a profile fact they gave during onboarding (a mandate
-- dimension, their company's categories, team facts) after the session
-- completed, through the same commit as a submission. It is a session
-- mutation with the same idempotency record every other mutation uses.
-- Additive: the operation check gains one value.

alter table onboarding.session_mutation_requests
  drop constraint session_mutation_requests_operation_check;
alter table onboarding.session_mutation_requests
  add constraint session_mutation_requests_operation_check
  check (operation in ('submit', 'skip', 'resolve_suggestion', 'answer_question', 'dismiss_question', 'say', 'withdraw', 'revise'));
