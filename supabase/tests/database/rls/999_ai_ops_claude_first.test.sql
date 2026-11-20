-- DECISIONS 112 (20261231599800): Claude first, then OpenAI, on every Q
-- text route; the rows it supersedes are untouched; voice, image and
-- embedding routes are unchanged; Anthropic's ceiling still keeps it off
-- anything above CONFIDENTIAL.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

-- The policy the gateway picks per class: lowest ceiling, highest ACTIVE
-- version (selectRoutingPolicy).
create temporary view picked as
  select distinct on (task_class) *
    from ai_ops.routing_policies
   where status = 'ACTIVE'
   order by task_class,
            array_position(array['PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL',
                                 'CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL',
                                 'RESTRICTED'], sensitivity_class),
            version desc;

select is(
  (select array_agg(p.task_class || '=' || pr.code order by p.task_class)
     from picked p
     join ai_ops.models m on m.id = p.preferred_models[1]
     join ai_ops.providers pr on pr.id = m.provider_id),
  array['COMPARISON=anthropic', 'DEEP_INVESTIGATION=anthropic',
        'EVIDENCE_SYNTHESIS=anthropic', 'FAST_CLASSIFICATION=anthropic',
        'NORMAL_DIALOGUE=anthropic', 'STRUCTURED_EXTRACTION=anthropic',
        'TAXONOMY_MAPPING=anthropic', 'UI_TRANSLATION=anthropic'],
  'every Q text route the gateway picks prefers Anthropic');

select is(
  (select count(*)::int
     from picked p
     join ai_ops.models m on m.id = p.fallback_models[1]
     join ai_ops.providers pr on pr.id = m.provider_id
    where pr.code = 'openai' and m.model_type = 'TEXT_GENERATION'),
  8,
  'and falls back to OpenAI first');

select is(
  (select count(*)::int
     from picked p, unnest(p.preferred_models) u(m)
     join ai_ops.models mm on mm.id = u.m
    where mm.quality_class <> 'HIGH'),
  0,
  'Claude''s answering model throughout, never the smaller one (decision 69)');

select is(
  (select count(*)::int
     from picked p, unnest(p.preferred_models || p.fallback_models) u(m)
     join ai_ops.models mm on mm.id = u.m
     join ai_ops.providers pr on pr.id = mm.provider_id
    where pr.code = 'anthropic'
      and u.m <> all (p.preferred_models)),
  0,
  'Anthropic appears once, at the front, never again as a fallback');

select is(
  (select count(*)::int from ai_ops.routing_policies
    where task_class in ('REALTIME_VOICE', 'EMBEDDING', 'GUARDRAIL')
      and created_at >= now() - interval '1 day'
      and (preferred_models || fallback_models) && array(
            select m.id from ai_ops.models m
              join ai_ops.providers p on p.id = m.provider_id
             where p.code = 'anthropic')),
  0,
  'voice, embedding and guardrail routes gain no Claude');

select is(
  (select status || ':' || model_type from ai_ops.models
    where id = 'a2000000-0000-4000-8000-000000000023'),
  'ACTIVE:REALTIME',
  'the realtime voice model row is unchanged');

select is(
  (select owner_approved_ceiling from ai_ops.providers where code = 'anthropic'),
  'CONFIDENTIAL',
  'Anthropic''s ceiling is still CONFIDENTIAL: anything above it skips Claude');

select is(
  (select hedge_after_ms from picked where task_class = 'FAST_CLASSIFICATION'),
  3000,
  'the turn reader hedges after Claude''s usual time, not before');

select is(
  (select count(*)::int from ai_ops.routing_policies
    where version = 2 and status = 'ACTIVE'
      and code in ('normal_dialogue.v2', 'evidence_synthesis.v2',
                   'comparison.v2', 'deep_investigation.v2',
                   'fast_classification.v2', 'structured_extraction.v2',
                   'taxonomy_mapping.v2')),
  7,
  'the superseded rows are untouched (insert only), ready for the rollback');

select * from finish();
rollback;
