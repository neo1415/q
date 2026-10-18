-- OpenAI as the first fallback for the interview (QX-004 core gate).
--
-- The dialogue policy ran on Gemini with two free-tier Groq models behind
-- it. When Gemini returned 504s (2026-09-23, EU) the person heard "I can't
-- reach my reasoning service" mid-sentence: the free tier was saturated or
-- refused the request outright. The operator's decision is that a paid,
-- reviewed provider stands behind Gemini so a vendor outage degrades to a
-- slower turn rather than a lost one.
--
-- Review basis (ai_ops.providers.privacy_policy_class is the review policy,
-- written once in packages/model-gateway/src/policy/eligibility.ts):
--   OpenAI's API terms state API inputs and outputs are not used to train
--   models, and Zero Data Retention is offered for eligible API usage
--   (https://openai.com/policies/ and the enterprise privacy page,
--   verified 2026-09-23). The class describes what the vendor OFFERS;
--   supports_zero_retention records what THIS account has ENABLED. Without
--   both, the effective ceiling stays INTERNAL and no interview turn will
--   route here. The operator asserts ZDR is enabled on the Capital Q
--   OpenAI organisation; if that is not the case, set
--   supports_zero_retention = false and this provider serves nothing
--   confidential.
--
-- Not a general provider: the adapter runs one model (gpt-5.6-luna) and
-- refuses every other before opening a socket. Cost is bounded by the
-- policy's own cost ceiling per call.

update ai_ops.providers
set privacy_policy_class = 'NO_TRAINING_ZERO_RETENTION',
    supports_zero_retention = true,
    metadata = metadata || '{"review_status":"REVIEWED","purpose":"dialogue-fallback","reviewed_at":"2026-09-23","review_basis":"OpenAI API terms: inputs/outputs not used for training; Zero Data Retention offered for eligible API usage. supports_zero_retention records that ZDR is enabled on this organisation.","terms_url":"https://openai.com/policies/"}'::jsonb
where code = 'openai';

update ai_ops.models
set sensitivity_ceiling = 'CONFIDENTIAL',
    metadata = metadata || '{"purpose":"dialogue-fallback","ceiling_basis":"ai_ops.providers.privacy_policy_class = NO_TRAINING_ZERO_RETENTION with zero data retention enabled (openai, 2026-09-23)"}'::jsonb
where id = 'a2000000-0000-4000-8000-000000000009';

-- First fallback: tried as soon as the preferred model fails, before the
-- free-tier models. Idempotent: not re-added if already present.
update ai_ops.routing_policies
set fallback_models = array_prepend('a2000000-0000-4000-8000-000000000009'::uuid,
      array_remove(fallback_models, 'a2000000-0000-4000-8000-000000000009'::uuid))
where code = 'normal_dialogue.v1'
  and status = 'ACTIVE';
