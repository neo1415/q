-- Claude first, staged and NOT active (owner direction, 6 Nov 2026 evening:
-- Claude becomes Q's main model once its cost per case is near OpenAI's;
-- the owner decides after the numbers). DECISIONS 67/68.
--
-- Seven version-3 policies, one per Q reasoning class, inserted RETIRED:
--
--   Claude (Sonnet 5.5 for answers and analysis, Haiku 5.5 for the reader,
--   classification, extraction and taxonomy) -> gpt-5.6-luna -> the v2
--   row's remaining fallbacks in their order (Groq where present, then the
--   PUBLIC-only Gemini models)
--
-- Every other column is copied from the class's v2 row (reasoning levels,
-- hedge, sensitivity, quality floor, latency target, cost ceiling).
--
-- The switch is one statement each way. The gateway takes the highest
-- ACTIVE version per class, so:
--   Claude first:  update ai_ops.routing_policies set status = 'ACTIVE'
--                   where version = 3 and code in (<the seven .v3 codes>);
--   back to v2:    the same with status = 'RETIRED' (v2, OpenAI first with
--                   Claude as backup, stays ACTIVE throughout).
--
-- Additive: inserts only; no status change to any existing row, no DROP,
-- no grant or RLS change. 999_ai_ops_claude_first_staged.test.sql.

insert into ai_ops.routing_policies
  (code, task_class, sensitivity_class, quality_floor, latency_target_ms,
   hedge_after_ms, reasoning_levels, cost_ceiling_usd, preferred_models,
   fallback_models, allow_free_router, status, version)
select regexp_replace(v2.code, '\.v2$', '.v3'),
       v2.task_class, v2.sensitivity_class, v2.quality_floor,
       v2.latency_target_ms, v2.hedge_after_ms, v2.reasoning_levels,
       v2.cost_ceiling_usd,
       array[v2.fallback_models[1]],
       array['a2000000-0000-4000-8000-000000000009'::uuid]
         || array(select u.m
                    from unnest(v2.fallback_models) with ordinality u(m, n)
                   where u.n > 1
                     and u.m <> 'a2000000-0000-4000-8000-000000000009'::uuid
                   order by u.n),
       v2.allow_free_router, 'RETIRED', 3
  from ai_ops.routing_policies v2
 where v2.version = 2
   and v2.code in ('normal_dialogue.v2', 'evidence_synthesis.v2',
                   'comparison.v2', 'deep_investigation.v2',
                   'fast_classification.v2', 'structured_extraction.v2',
                   'taxonomy_mapping.v2');

do $$
begin
  if (select count(*) from ai_ops.routing_policies rp
        join ai_ops.models m on m.id = rp.preferred_models[1]
        join ai_ops.providers p on p.id = m.provider_id
       where rp.version = 3 and rp.status = 'RETIRED' and p.code = 'anthropic'
         and rp.fallback_models[1] = 'a2000000-0000-4000-8000-000000000009'::uuid) <> 7 then
    raise exception 'expected seven staged v3 policies: Claude first, then gpt-5.6-luna';
  end if;
end $$;
