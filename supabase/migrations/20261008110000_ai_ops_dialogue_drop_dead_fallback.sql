-- The dialogue fallback chain stops ending on a model that never answers
-- (CQ-VOICE-010).
--
-- Measured 2026-09-24: gemini-3.8-flash returned PROVIDER_OUTAGE on 5 of 5
-- replayed interview turns and on every call in the hosted ledger. As the
-- last dialogue fallback it only lengthens a failing turn before the
-- person hears the honest notice. It is removed from normal_dialogue.v1's
-- fallbacks only; the model row and other policies are untouched, and a
-- later reviewed migration can put it back once it answers again.

update ai_ops.routing_policies
   set fallback_models = array_remove(
         fallback_models,
         'a2000000-0000-4000-8000-000000000002'::uuid)
 where code = 'normal_dialogue.v1'
   and status = 'ACTIVE';
