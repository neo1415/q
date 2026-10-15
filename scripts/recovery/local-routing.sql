-- LOCAL recovery stack only (run by `local-stack.sh start db` through the
-- local container's psql; never a hosted database, never a migration).
--
-- G2 K2: the product row fast_classification.v1 prefers Gemini
-- (gemini-3.5-flash-lite). Locally Gemini is refused by the egress guard,
-- so a one-attempt TURN_SKIM was silently lost on it, and the provider
-- breaker (3 failures/60 s -> skipped 30 s) made the call count of the same
-- ask depend on timing. Locally, FAST_CLASSIFICATION prefers the OpenAI
-- model the fake vendor serves; the product row in the migrations is
-- unchanged. Idempotent.
update ai_ops.routing_policies
   set preferred_models = array['a2000000-0000-4000-8000-000000000009'::uuid],
       fallback_models  = array['a2000000-0000-4000-8000-000000000001'::uuid,
                                'a2000000-0000-4000-8000-000000000010'::uuid]
 where code = 'fast_classification.v1'
   and preferred_models <> array['a2000000-0000-4000-8000-000000000009'::uuid];
