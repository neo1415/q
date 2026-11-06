-- DECISIONS 67 (20261231300000): the staged v2 policies, still RETIRED,
-- reordered so the switch-on configuration keeps OpenAI first and makes
-- Claude the CONFIDENTIAL backup: luna -> Claude -> Groq -> Gemini. No
-- status, row, v1 policy or other column changes.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

select is(
  (select count(*)::int from ai_ops.routing_policies where version = 2 and status = 'ACTIVE'),
  7,
  'the seven v2 policies are switched on (20261231340000)');

select is(
  (select count(*)::int from ai_ops.routing_policies where version = 2
      and preferred_models = array['a2000000-0000-4000-8000-000000000009'::uuid]),
  7,
  'every v2 policy prefers gpt-5.6-luna');

select is(
  (select array_agg(rp.code || '=' || m.model_code order by rp.code)
     from ai_ops.routing_policies rp join ai_ops.models m on m.id = rp.fallback_models[1]
    where rp.version = 2),
  array['comparison.v2=claude-sonnet-5-5', 'deep_investigation.v2=claude-sonnet-5-5',
        'evidence_synthesis.v2=claude-sonnet-5-5', 'fast_classification.v2=claude-sonnet-5-5',
        'normal_dialogue.v2=claude-sonnet-5-5', 'structured_extraction.v2=claude-sonnet-5-5',
        'taxonomy_mapping.v2=claude-sonnet-5-5'],
  'the first fallback is Claude Sonnet on every route (Haiku removed by 20261231360000, DECISIONS 69)');

select is(
  (select count(*)::int from ai_ops.routing_policies where version = 2
      and fallback_models[2] = 'a2000000-0000-4000-8000-000000000004'::uuid),
  7,
  'Groq gpt-oss-120b follows Claude');

select is(
  (select count(*)::int
     from ai_ops.routing_policies rp,
          unnest(rp.preferred_models || rp.fallback_models) with ordinality u(m, n)
     join ai_ops.models mm on mm.id = u.m
    where rp.version = 2 and mm.sensitivity_ceiling = 'PUBLIC' and u.n < 4),
  0,
  'PUBLIC-only models come only after OpenAI, Claude and Groq');

select is(
  (select count(*)::int from ai_ops.routing_policies rp
    where rp.version = 2
      and cardinality(rp.preferred_models || rp.fallback_models)
          <> (select count(distinct m) from unnest(rp.preferred_models || rp.fallback_models) m)),
  0,
  'no model appears twice in a v2 policy');

select is(
  (select count(*)::int from ai_ops.routing_policies where status = 'ACTIVE' and version = 1),
  8,
  'the eight v1 policies stay active beside v2 as the rollback');

-- The switch still prefers OpenAI once on.
update ai_ops.routing_policies set status = 'ACTIVE' where version = 2;
select is(
  (select m.model_code
     from ai_ops.routing_policies rp join ai_ops.models m on m.id = rp.preferred_models[1]
    where rp.status = 'ACTIVE' and rp.task_class = 'NORMAL_DIALOGUE'
    order by rp.version desc limit 1),
  'gpt-5.6-luna',
  'switched on: dialogue still starts with OpenAI');

select * from finish();
rollback;
