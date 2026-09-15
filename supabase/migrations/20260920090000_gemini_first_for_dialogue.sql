-- Demo posture, continued (human operator, 2026-09-15): Gemini leads the
-- conversational and extraction work; Groq's models follow as fallbacks.
-- Gemini's free tier is bounded per request-minute rather than by an 8k
-- token-minute, which suits a live conversation of many mid-sized turns.
update ai_ops.routing_policies
set
  preferred_models = '{a2000000-0000-4000-8000-000000000001}',
  fallback_models = '{a2000000-0000-4000-8000-000000000004,a2000000-0000-4000-8000-000000000003,a2000000-0000-4000-8000-000000000005,a2000000-0000-4000-8000-000000000002}'
where code = 'normal_dialogue.v1';

update ai_ops.routing_policies
set
  preferred_models = '{a2000000-0000-4000-8000-000000000002}',
  fallback_models = '{a2000000-0000-4000-8000-000000000001,a2000000-0000-4000-8000-000000000004,a2000000-0000-4000-8000-000000000003,a2000000-0000-4000-8000-000000000005}'
where code = 'evidence_synthesis.v1';

update ai_ops.routing_policies
set
  preferred_models = '{a2000000-0000-4000-8000-000000000001}',
  fallback_models = '{a2000000-0000-4000-8000-000000000002,a2000000-0000-4000-8000-000000000003,a2000000-0000-4000-8000-000000000005}'
where code = 'structured_extraction.v1';
