-- DECISIONS 112 (owner, 2026-11-20): Claude first, then OpenAI, for every
-- Q text task class Anthropic is eligible for, normal and test accounts
-- alike. Supersedes the order of decision 67 (OpenAI first, Claude as the
-- backup); decision 69 still binds: Claude's answering model throughout
-- (quality class HIGH), never its smaller model, for anything that reads
-- or answers.
--
-- What this adds, and nothing else: version 3 of each active text routing
-- policy, inserted ACTIVE (UI_TRANSLATION, which had only version 1, goes
-- to 3 as well, so "version 3" names this routing for every class).
-- Nothing is updated in place. The gateway
-- takes, per task class, the lowest covering sensitivity ceiling and then
-- the highest ACTIVE version (policy/eligibility.ts selectRoutingPolicy),
-- so each new row wins over the row it copies, which stays as it is.
--
--   preferred_models  the Anthropic text models of quality HIGH that are
--                     ACTIVE and in effect, read from ai_ops.models
--   fallback_models   the OpenAI text models that are ACTIVE and in
--                     effect, then the rest of the copied row's chain in
--                     its own order (Groq, then the PUBLIC-only Gemini
--                     models), with Anthropic and OpenAI rows removed
--
-- Every other column is copied from the active row it supersedes, except:
--   hedge_after_ms    raised to 3000 where the copied row hedges sooner:
--                     Claude's turn reading ran at p50 2.2 s and p90 2.7 s
--                     (ai_ops.model_usage, 14 days to 20 Nov), so a 2 s
--                     hedge would fire on most turns and pay for two calls
--   cost_ceiling_usd  UI_TRANSLATION raised to 0.25: the gateway prices an
--                     attempt with no cache credit plus its whole output
--                     budget, and 0.05 would skip Claude on most batches.
--                     The other classes' ceilings were sized for Claude by
--                     20261231360000.
--
-- Excluded, and why:
--   REALTIME_VOICE, and the image and embedding models: Claude has no
--     realtime voice, image generation or embedding equivalent; their
--     routes are not policies here and nothing about them changes.
--   Sensitivity above Anthropic's ceiling: anthropic carries
--     owner_approved_ceiling CONFIDENTIAL (decision 62). The copied rows
--     cover up to RESTRICTED, and the gateway checks each request against
--     each candidate's ceiling before anything else (planRoute), so a
--     HIGHLY_CONFIDENTIAL or RESTRICTED request skips Claude and goes to
--     OpenAI, exactly as before.
--
-- Spend: the owner's USD 20 hard cap is set in the Anthropic console
-- (provider metadata). When it is reached Anthropic refuses every call;
-- the adapter reads that refusal as the account (accountExhausted), so the
-- turn falls over to OpenAI and Claude is set aside until a probe succeeds.
--
-- Rollback (one statement, back to the rows this copies):
--   update ai_ops.routing_policies set status = 'RETIRED'
--    where code in ('normal_dialogue.v3', 'evidence_synthesis.v3',
--                   'comparison.v3', 'deep_investigation.v3',
--                   'fast_classification.v3', 'structured_extraction.v3',
--                   'taxonomy_mapping.v3', 'ui_translation.v3');
--
-- Data only: no DROP, no grant, no RLS change.
-- 999_ai_ops_claude_first.test.sql covers it.

with claude as (
  select coalesce(array_agg(m.id order by m.model_code), '{}') as ids
    from ai_ops.models m
    join ai_ops.providers p on p.id = m.provider_id
   where p.code = 'anthropic' and p.status = 'ACTIVE'
     and m.model_type = 'TEXT_GENERATION' and m.status = 'ACTIVE'
     and m.quality_class = 'HIGH'
     and m.effective_from <= now()
     and (m.effective_to is null or m.effective_to > now())
), openai as (
  select coalesce(array_agg(m.id order by m.model_code), '{}') as ids
    from ai_ops.models m
    join ai_ops.providers p on p.id = m.provider_id
   where p.code = 'openai' and p.status = 'ACTIVE'
     and m.model_type = 'TEXT_GENERATION' and m.status = 'ACTIVE'
     and m.effective_from <= now()
     and (m.effective_to is null or m.effective_to > now())
), current_rows as (
  select distinct on (rp.task_class, rp.sensitivity_class) rp.*
    from ai_ops.routing_policies rp
   where rp.status = 'ACTIVE'
     and rp.task_class in ('NORMAL_DIALOGUE', 'EVIDENCE_SYNTHESIS',
                           'COMPARISON', 'DEEP_INVESTIGATION',
                           'FAST_CLASSIFICATION', 'STRUCTURED_EXTRACTION',
                           'TAXONOMY_MAPPING', 'UI_TRANSLATION')
   order by rp.task_class, rp.sensitivity_class, rp.version desc
)
insert into ai_ops.routing_policies
  (code, task_class, sensitivity_class, quality_floor, latency_target_ms,
   hedge_after_ms, reasoning_levels, cost_ceiling_usd, preferred_models,
   fallback_models, allow_free_router, status, version)
select regexp_replace(c.code, '\.v[0-9]+$', '') || '.v3',
       c.task_class, c.sensitivity_class, c.quality_floor, c.latency_target_ms,
       case when c.hedge_after_ms is null then null
            else greatest(c.hedge_after_ms, 3000) end,
       c.reasoning_levels,
       case when c.task_class = 'UI_TRANSLATION'
            then greatest(coalesce(c.cost_ceiling_usd, 0.25), 0.25)
            else c.cost_ceiling_usd end,
       claude.ids,
       openai.ids
         || array(select u.m
                    from unnest(c.preferred_models || c.fallback_models)
                         with ordinality u(m, n)
                    join ai_ops.models mm on mm.id = u.m
                    join ai_ops.providers pp on pp.id = mm.provider_id
                   where pp.code not in ('anthropic', 'openai')
                   order by u.n),
       c.allow_free_router, 'ACTIVE', 3
  from current_rows c, claude, openai
 where c.version < 3;

do $$
begin
  if (select cardinality(ids) from (
        select array_agg(m.id) ids from ai_ops.models m
          join ai_ops.providers p on p.id = m.provider_id
         where p.code = 'anthropic' and m.model_type = 'TEXT_GENERATION'
           and m.status = 'ACTIVE' and m.quality_class = 'HIGH') x) is null then
    raise exception 'no active Anthropic text model of quality HIGH to prefer';
  end if;
  if exists (
    select 1
      from (select distinct on (task_class, sensitivity_class) *
              from ai_ops.routing_policies
             where status = 'ACTIVE'
               and task_class in ('NORMAL_DIALOGUE', 'EVIDENCE_SYNTHESIS',
                                  'COMPARISON', 'DEEP_INVESTIGATION',
                                  'FAST_CLASSIFICATION', 'STRUCTURED_EXTRACTION',
                                  'TAXONOMY_MAPPING', 'UI_TRANSLATION')
             order by task_class, sensitivity_class, version desc) top
      join ai_ops.models m on m.id = top.preferred_models[1]
      join ai_ops.providers p on p.id = m.provider_id
     where p.code <> 'anthropic') then
    raise exception 'an active text policy does not prefer Anthropic';
  end if;
end $$;
