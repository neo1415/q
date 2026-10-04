-- Duplex voice on real accounts (founder approval 2026-10-04).
--
-- gpt-realtime-mini arrived (20261203090000) with a PUBLIC ceiling, so the
-- duplex broker opened it only where a context plan stayed public. The
-- founder approved giving it the same standing as the reviewed OpenAI text
-- model: the provider row is already REVIEWED with
-- NO_TRAINING_ZERO_RETENTION and zero retention enabled (20261006100000),
-- and the effective ceiling is still the lower of the model's and the
-- provider's, so this raises nothing beyond what that review allows.
-- Fix forward only: the row is updated, never deleted.

update ai_ops.models
set sensitivity_ceiling = 'CONFIDENTIAL',
    metadata = metadata || '{"purpose":"duplex-voice","ceiling_basis":"ai_ops.providers.privacy_policy_class = NO_TRAINING_ZERO_RETENTION with zero data retention enabled (openai); founder approval 2026-10-04"}'::jsonb
where id = 'a2000000-0000-4000-8000-000000000022';
