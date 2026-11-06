-- DECISIONS 62 (20261231280000): the Anthropic provider, two Claude models
-- with prices, and seven staged v2 routing policies. Additive: no active
-- route changes until the switch, no client grant, the owner's approval
-- bounded by checks. The switch and its rollback are exercised here inside
-- the test transaction (rolled back at the end).
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);

-- the provider row, honestly classed
select is(
  (select row(privacy_policy_class, supports_zero_retention, status,
              owner_approved_ceiling, owner_approval_ref)::text
     from ai_ops.providers where code = 'anthropic'),
  row('NO_TRAINING_DEFAULT_RETENTION', false, 'ACTIVE', 'CONFIDENTIAL', 'DECISIONS-62')::text,
  'anthropic: no-training, zero retention NOT claimed, CONFIDENTIAL by owner decision 62');

select ok(
  (select metadata ->> 'confidential_eligibility' from ai_ops.providers where code = 'anthropic')
    like '%decision 62%',
  'the metadata says the CONFIDENTIAL eligibility is the owner''s decision 62');

select is(
  (select count(*)::int from ai_ops.providers
    where code <> 'anthropic' and (owner_approved_ceiling is not null or owner_approval_ref is not null)),
  0,
  'no other provider gained an approval');

-- the approval's guard rails
select throws_ok(
  $$update ai_ops.providers set owner_approved_ceiling = 'HIGHLY_CONFIDENTIAL' where code = 'anthropic'$$,
  '23514', null, 'an approval never reaches HIGHLY_CONFIDENTIAL');

select throws_ok(
  $$update ai_ops.providers set owner_approval_ref = null where code = 'anthropic'$$,
  '23514', null, 'an approval without a recorded decision is refused');

select throws_ok(
  $$update ai_ops.providers set owner_approved_ceiling = 'CONFIDENTIAL', owner_approval_ref = 'DECISIONS-99'
     where code = 'google'$$,
  '23514', null, 'an unreviewed provider cannot be approved upward');

select throws_ok(
  $$update ai_ops.providers set owner_approval_ref = 'decisions 62' where code = 'anthropic'$$,
  '23514', null, 'a malformed decision reference is refused');

-- the models
select is(
  (select array_agg(model_code || ':' || sensitivity_ceiling || ':' || quality_class || ':' || latency_class
                    order by model_code)
     from ai_ops.models m join ai_ops.providers p on p.id = m.provider_id
    where p.code = 'anthropic'),
  array['claude-haiku-5-5:CONFIDENTIAL:STANDARD:FAST',
        'claude-sonnet-5-5:CONFIDENTIAL:HIGH:STANDARD'],
  'two Claude models, CONFIDENTIAL per decision 62');

select is(
  (select count(*)::int from ai_ops.models m join ai_ops.providers p on p.id = m.provider_id
    where p.code = 'anthropic'
      and m.model_type = 'TEXT_GENERATION' and m.status = 'ACTIVE'
      and m.supports_tools and m.supports_structured_output
      and m.supports_prompt_cache and m.supports_reasoning
      and not m.supports_realtime and not m.supports_audio),
  2,
  'both: tools, structured output, prompt cache, reasoning; no realtime or audio');

select is(
  (select array_agg(m.model_code || ':' || mp.input_per_million || '/' || mp.cached_input_per_million
                    || '/' || mp.output_per_million order by m.model_code)
     from ai_ops.model_prices mp join ai_ops.models m on m.id = mp.model_id
     join ai_ops.providers p on p.id = m.provider_id
    where p.code = 'anthropic'),
  array['claude-haiku-5-5:0.100000/0.010000/0.500000',
        'claude-sonnet-5-5:2.000000/0.200000/10.000000'],
  'priced: input / cache read / output per million');

-- staged, not active
select is(
  (select count(*)::int from ai_ops.routing_policies where version = 2 and status = 'RETIRED'),
  7,
  'seven v2 policies, staged (RETIRED)');

select is(
  (select count(*)::int from ai_ops.routing_policies rp
    where rp.status = 'ACTIVE'
      and exists (select 1 from unnest(rp.preferred_models || rp.fallback_models) m
                   join ai_ops.models mm on mm.id = m
                   join ai_ops.providers p on p.id = mm.provider_id
                  where p.code = 'anthropic')),
  0,
  'no ACTIVE policy reaches Claude before the switch');

select is(
  (select count(*)::int from ai_ops.routing_policies where status = 'ACTIVE'),
  8,
  'the active routes are exactly the eight from before');

select is(
  (select count(*)::int from ai_ops.routing_policies
    where task_class in ('REALTIME_VOICE', 'UI_TRANSLATION', 'EMBEDDING') and version > 1),
  0,
  'voice, translation and embedding routes untouched');

-- the order: Claude -> OpenAI -> Groq -> (PUBLIC-only Gemini)
select is(
  (select array_agg(p.code order by u.n)
     from ai_ops.routing_policies rp,
          unnest(rp.preferred_models || rp.fallback_models) with ordinality u(m, n)
     join ai_ops.models mm on mm.id = u.m
     join ai_ops.providers p on p.id = mm.provider_id
    where rp.code = 'normal_dialogue.v2'),
  array['anthropic', 'openai', 'groq', 'google', 'google'],
  'dialogue v2: Claude, then OpenAI, then Groq, then Gemini');

select is(
  (select count(*)::int from ai_ops.routing_policies rp
    where rp.version = 2
      and (rp.fallback_models[1] <> 'a2000000-0000-4000-8000-000000000009'
           or rp.fallback_models[2] <> 'a2000000-0000-4000-8000-000000000004')),
  0,
  'every v2 policy falls back to OpenAI first, Groq second');

select is(
  (select array_agg(code || '=' || m.model_code order by code)
     from ai_ops.routing_policies rp join ai_ops.models m on m.id = rp.preferred_models[1]
    where rp.version = 2),
  array['comparison.v2=claude-sonnet-5-5', 'deep_investigation.v2=claude-sonnet-5-5',
        'evidence_synthesis.v2=claude-sonnet-5-5', 'fast_classification.v2=claude-haiku-5-5',
        'normal_dialogue.v2=claude-sonnet-5-5', 'structured_extraction.v2=claude-haiku-5-5',
        'taxonomy_mapping.v2=claude-haiku-5-5'],
  'Sonnet answers and analyses; Haiku reads, classifies and extracts');

select is(
  (select count(*)::int from ai_ops.routing_policies v2
     join ai_ops.routing_policies v1 on v1.task_class = v2.task_class and v1.version = 1
    where v2.version = 2
      and (v1.reasoning_levels is distinct from v2.reasoning_levels
           or v1.hedge_after_ms is distinct from v2.hedge_after_ms
           or v1.sensitivity_class <> v2.sensitivity_class
           or v1.quality_floor <> v2.quality_floor
           or v1.latency_target_ms is distinct from v2.latency_target_ms)),
  0,
  'v2 copies reasoning levels, hedge, sensitivity, quality floor and latency from v1');

select is(
  (select cost_ceiling_usd from ai_ops.routing_policies where code = 'normal_dialogue.v2'),
  0.25::numeric,
  'dialogue v2 ceiling sized for Sonnet prices');

-- a PUBLIC-only model never in front of a CONFIDENTIAL-capable one
select is(
  (select count(*)::int from ai_ops.routing_policies rp,
          unnest(rp.preferred_models || rp.fallback_models) with ordinality u(m, n)
     join ai_ops.models mm on mm.id = u.m
    where rp.version = 2 and mm.sensitivity_ceiling = 'PUBLIC'
      and u.n < 4),
  0,
  'PUBLIC-only models come only after Claude, OpenAI and Groq');

-- the switch, and back
update ai_ops.routing_policies set status = 'ACTIVE'
 where code in ('normal_dialogue.v2', 'evidence_synthesis.v2', 'comparison.v2',
                'deep_investigation.v2', 'fast_classification.v2',
                'structured_extraction.v2', 'taxonomy_mapping.v2');

select is(
  (select array_agg(distinct rp.code order by rp.code)
     from ai_ops.routing_policies rp
    where rp.status = 'ACTIVE' and rp.task_class = 'NORMAL_DIALOGUE'
      and rp.version = (select max(version) from ai_ops.routing_policies x
                         where x.task_class = rp.task_class and x.status = 'ACTIVE')),
  array['normal_dialogue.v2'],
  'switched on: the highest active version is v2');

select is(
  (select count(*)::int from ai_ops.routing_policies where version = 1 and status = 'ACTIVE'),
  8,
  'switched on: every v1 row stays active for the rollback');

update ai_ops.routing_policies set status = 'RETIRED'
 where code in ('normal_dialogue.v2', 'evidence_synthesis.v2', 'comparison.v2',
                'deep_investigation.v2', 'fast_classification.v2',
                'structured_extraction.v2', 'taxonomy_mapping.v2');

select is(
  (select count(*)::int from ai_ops.routing_policies where status = 'ACTIVE' and version = 2),
  0,
  'switched off: back to v1 with one statement');

-- no client can see any of it
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'ai_ops' and grantee in ('anon', 'authenticated')),
  0,
  'ai_ops still has no client grants');

select * from finish();
rollback;
