-- NORMAL_DIALOGUE and STRUCTURED_EXTRACTION on Gemini flash-lite first,
-- while the OpenAI account has no credit (live 2026-10-01: every
-- gpt-5.6-luna call answered credit_balance_exhausted).
--
-- PREPARED, NOT APPLIED. With the model gateway's exhausted-account
-- handling deployed, this is not needed: health skips every OpenAI model
-- for ten minutes after one such answer, so these task classes already
-- reach flash-lite (their first fallback) at once, and luna is first
-- again on its own once credit returns. Apply this only to stop paying
-- the one probe per ten minutes, or if the gateway change is not
-- deployed.
--
-- Data only, in place, as 20261110000000 did. To restore OpenAI first
-- when credit returns, a later migration sets the arrays back to:
--   preferred_models = array['a2000000-0000-4000-8000-000000000009'::uuid]
--   fallback_models  = array['a2000000-0000-4000-8000-000000000001'::uuid,
--                            'a2000000-0000-4000-8000-000000000010'::uuid]
-- (the rows as they were on 2026-10-01). gemini-3.5-flash stays last: it
-- hung to its 45 s deadline on the turns that failed.

update ai_ops.routing_policies
   set preferred_models = array['a2000000-0000-4000-8000-000000000001'::uuid],
       fallback_models  = array['a2000000-0000-4000-8000-000000000009'::uuid,
                                'a2000000-0000-4000-8000-000000000010'::uuid]
 where status = 'ACTIVE'
   and code in ('normal_dialogue.v1', 'structured_extraction.v1');
