-- Roll back 20261231290000 (Groq as the CONFIDENTIAL fallback on the v1 text
-- policies). Production, 6 Nov 13:00 UTC: the turn reader's call to
-- gpt-5.6-luna timed out (as it sometimes does), the gateway moved on to Groq
-- gpt-oss-120b / gpt-oss-20b, Groq refused the ~17k-token reader prompt with
-- 413 rate_limit_exceeded, and the turn failed ("couldn't read that request")
-- where before it retried luna. Restores the exact pre-20261231290000 lists.
-- The v2 (Claude backup) policies are untouched and stay RETIRED.
update ai_ops.routing_policies
   set fallback_models = array_remove(
         array_remove(fallback_models, 'a2000000-0000-4000-8000-000000000004'::uuid),
         'a2000000-0000-4000-8000-000000000003'::uuid)
 where status = 'ACTIVE'
   and version = 1
   and code in ('normal_dialogue.v1','evidence_synthesis.v1','comparison.v1',
                'deep_investigation.v1','fast_classification.v1',
                'structured_extraction.v1','taxonomy_mapping.v1');
