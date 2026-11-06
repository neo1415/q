-- DECISIONS 67 (owner, 2026-11-06): OpenAI stays Q's primary; Claude is the
-- CONFIDENTIAL backup. The live comparison on the staged Claude-first
-- routing (20261231280000) answered correctly but cost about ten times
-- OpenAI per case, with slower turns, so Claude-as-primary is parked.
--
-- This reorders the seven STAGED v2 policies, still RETIRED, so the
-- switch-on configuration is:
--
--   gpt-5.6-luna -> Claude (Sonnet 5.5 for answers and analysis, Haiku 5.5
--   for the reader, classification, extraction and taxonomy)
--   -> Groq gpt-oss-120b -> the classes' Gemini fallbacks (PUBLIC-only)
--
-- The switch is unchanged: one UPDATE sets the v2 rows ACTIVE (the
-- gateway takes the highest active version) and the same UPDATE back to
-- RETIRED rolls back to v1, which 20261231290000 gives Groq as its
-- CONFIDENTIAL fallback. No status changes here, no row is added or
-- dropped, no v1 row or any other column is touched, and no grant or RLS.
--
-- 999_ai_ops_claude_as_backup.test.sql covers it.

with order_of (code, claude) as (
  values
    ('normal_dialogue.v2',       'a2000000-0000-4000-8000-000000000030'::uuid),
    ('evidence_synthesis.v2',    'a2000000-0000-4000-8000-000000000030'::uuid),
    ('comparison.v2',            'a2000000-0000-4000-8000-000000000030'::uuid),
    ('deep_investigation.v2',    'a2000000-0000-4000-8000-000000000030'::uuid),
    ('fast_classification.v2',   'a2000000-0000-4000-8000-000000000031'::uuid),
    ('structured_extraction.v2', 'a2000000-0000-4000-8000-000000000031'::uuid),
    ('taxonomy_mapping.v2',      'a2000000-0000-4000-8000-000000000031'::uuid)
)
update ai_ops.routing_policies rp
   set preferred_models = array['a2000000-0000-4000-8000-000000000009'::uuid],
       fallback_models =
         array[o.claude, 'a2000000-0000-4000-8000-000000000004'::uuid]
         || array(select u.m
                    from unnest(rp.preferred_models || rp.fallback_models)
                         with ordinality u(m, n)
                   where u.m not in ('a2000000-0000-4000-8000-000000000009'::uuid,
                                     'a2000000-0000-4000-8000-000000000004'::uuid,
                                     'a2000000-0000-4000-8000-000000000030'::uuid,
                                     'a2000000-0000-4000-8000-000000000031'::uuid)
                   order by u.n)
  from order_of o
 where rp.code = o.code
   and rp.version = 2;

do $$
begin
  if (select count(*) from ai_ops.routing_policies
       where version = 2
         and preferred_models = array['a2000000-0000-4000-8000-000000000009'::uuid]
         and fallback_models[2] = 'a2000000-0000-4000-8000-000000000004'::uuid
         and fallback_models[1] in ('a2000000-0000-4000-8000-000000000030'::uuid,
                                    'a2000000-0000-4000-8000-000000000031'::uuid)) <> 7 then
    raise exception 'expected seven v2 policies ordered OpenAI, Claude, Groq';
  end if;
end $$;
