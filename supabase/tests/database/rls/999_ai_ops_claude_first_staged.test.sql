-- 20261231350000: Claude first, staged. Seven v3 policies, RETIRED: Claude
-- -> gpt-5.6-luna -> the v2 row's remaining fallbacks. Nothing active
-- changes; one UPDATE makes Claude first and the same UPDATE back undoes it.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

select is(
  (select count(*)::int from ai_ops.routing_policies where version = 3 and status = 'RETIRED'),
  7,
  'seven v3 policies, staged (RETIRED)');

select is(
  (select array_agg(rp.code || '=' || m.model_code order by rp.code)
     from ai_ops.routing_policies rp join ai_ops.models m on m.id = rp.preferred_models[1]
    where rp.version = 3),
  array['comparison.v3=claude-sonnet-5-5', 'deep_investigation.v3=claude-sonnet-5-5',
        'evidence_synthesis.v3=claude-sonnet-5-5', 'fast_classification.v3=claude-haiku-5-5',
        'normal_dialogue.v3=claude-sonnet-5-5', 'structured_extraction.v3=claude-haiku-5-5',
        'taxonomy_mapping.v3=claude-haiku-5-5'],
  'Claude first: Sonnet for answers and analysis, Haiku for the fast classes');

select is(
  (select count(*)::int from ai_ops.routing_policies where version = 3
      and fallback_models[1] = 'a2000000-0000-4000-8000-000000000009'::uuid),
  7,
  'gpt-5.6-luna is the first fallback');

select is(
  (select count(*)::int
     from ai_ops.routing_policies v3
     join ai_ops.routing_policies v2
       on v2.task_class = v3.task_class and v2.version = 2
    where v3.version = 3
      and (v3.reasoning_levels is distinct from v2.reasoning_levels
           or v3.hedge_after_ms is distinct from v2.hedge_after_ms
           or v3.cost_ceiling_usd is distinct from v2.cost_ceiling_usd
           or v3.sensitivity_class <> v2.sensitivity_class
           or v3.quality_floor <> v2.quality_floor)),
  0,
  'every other column copied from v2');

select is(
  (select count(*)::int
     from ai_ops.routing_policies rp,
          unnest(rp.preferred_models || rp.fallback_models) with ordinality u(m, n)
     join ai_ops.models mm on mm.id = u.m
    where rp.version = 3 and mm.sensitivity_ceiling = 'PUBLIC' and u.n < 3),
  0,
  'PUBLIC-only models never ahead of Claude and OpenAI');

select is(
  (select count(*)::int from ai_ops.routing_policies rp
    where rp.version = 3
      and cardinality(rp.preferred_models || rp.fallback_models)
          <> (select count(distinct m) from unnest(rp.preferred_models || rp.fallback_models) m)),
  0,
  'no model twice in a v3 policy');

-- The switch, and back.
update ai_ops.routing_policies set status = 'ACTIVE' where version = 3;
select is(
  (select m.model_code
     from ai_ops.routing_policies rp join ai_ops.models m on m.id = rp.preferred_models[1]
    where rp.status = 'ACTIVE' and rp.task_class = 'NORMAL_DIALOGUE'
    order by rp.version desc limit 1),
  'claude-sonnet-5-5',
  'switched on: dialogue starts with Claude');
update ai_ops.routing_policies set status = 'RETIRED' where version = 3;
select is(
  (select m.model_code
     from ai_ops.routing_policies rp join ai_ops.models m on m.id = rp.preferred_models[1]
    where rp.status = 'ACTIVE' and rp.task_class = 'NORMAL_DIALOGUE'
    order by rp.version desc limit 1),
  (select m.model_code
     from ai_ops.routing_policies rp join ai_ops.models m on m.id = rp.preferred_models[1]
    where rp.code = 'normal_dialogue.v2'),
  'switched off: back to whatever v2 starts with');

select * from finish();
rollback;
