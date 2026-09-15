-- Demo posture (human operator decision, 2026-09-15): Google Gemini models
-- may serve CONFIDENTIAL work in this environment so that a demo is not
-- gated by one provider's free-tier minute. This is a posture, not a
-- provider review: the google provider row keeps its UNREVIEWED review
-- status and its decision text. Revert this ceiling before real customer
-- data is processed (see docs/modules/q-voice.md, "Demo posture").
update ai_ops.models
set
  sensitivity_ceiling = 'CONFIDENTIAL',
  metadata = metadata || jsonb_build_object(
    'ceiling_basis',
      'DEMO POSTURE: raised to CONFIDENTIAL by the human operator on 2026-09-15 for demo and development traffic only; the google provider review remains UNREVIEWED for confidential customer data. Revert before production data.'
  ),
  updated_at = now()
where provider_id = (select id from ai_ops.providers where code = 'google');

-- Dialogue and synthesis keep Groq first for speed, then every other quota.
update ai_ops.routing_policies
set fallback_models = '{a2000000-0000-4000-8000-000000000003,a2000000-0000-4000-8000-000000000005,a2000000-0000-4000-8000-000000000002,a2000000-0000-4000-8000-000000000001}'
where code = 'normal_dialogue.v1';

update ai_ops.routing_policies
set fallback_models = '{a2000000-0000-4000-8000-000000000004,a2000000-0000-4000-8000-000000000003,a2000000-0000-4000-8000-000000000005,a2000000-0000-4000-8000-000000000001}'
where code = 'evidence_synthesis.v1';

update ai_ops.routing_policies
set fallback_models = '{a2000000-0000-4000-8000-000000000003,a2000000-0000-4000-8000-000000000002,a2000000-0000-4000-8000-000000000005}'
where code = 'structured_extraction.v1';
