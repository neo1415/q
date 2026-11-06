-- 20261231340000: the Claude backup is switched on. v2 serves every Q text
-- class in the agreed order (OpenAI -> Claude -> Groq -> PUBLIC-only
-- Gemini); v1 stays active beside it as the one-statement rollback.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

select is(
  (select count(*)::int from ai_ops.routing_policies where version = 2 and status = 'ACTIVE'),
  7,
  'the seven v2 Q text policies are ACTIVE');

select is(
  (select count(*)::int from ai_ops.routing_policies rp
    where rp.status = 'ACTIVE' and rp.task_class <> 'UI_TRANSLATION'
      and rp.version <> (select max(x.version) from ai_ops.routing_policies x
                          where x.task_class = rp.task_class
                            and x.sensitivity_class = rp.sensitivity_class
                            and x.status = 'ACTIVE')
      and rp.version = 2),
  0,
  'v2 is the highest active version for each class, so it serves');

select is(
  (select count(*)::int from ai_ops.routing_policies where version = 1 and status = 'ACTIVE'),
  8,
  'every v1 row stays active for the rollback');

select is(
  (select array_agg(rp.code || '=' || (select string_agg(p.code, '>' order by u.n)
                                         from unnest(rp.preferred_models || rp.fallback_models) with ordinality u(m, n)
                                         join ai_ops.models mm on mm.id = u.m
                                         join ai_ops.providers p on p.id = mm.provider_id
                                        where u.n <= 3)
                   order by rp.code)
     from ai_ops.routing_policies rp
    where rp.version = 2 and rp.status = 'ACTIVE'),
  array['comparison.v2=openai>anthropic>groq',
        'deep_investigation.v2=openai>anthropic>groq',
        'evidence_synthesis.v2=openai>anthropic>groq',
        'fast_classification.v2=openai>anthropic>groq',
        'normal_dialogue.v2=openai>anthropic>groq',
        'structured_extraction.v2=openai>anthropic>groq',
        'taxonomy_mapping.v2=openai>anthropic>groq'],
  'every active v2 policy: OpenAI, then Claude, then Groq');

select is(
  (select array_agg(rp.code || '=' || mm.model_code order by rp.code)
     from ai_ops.routing_policies rp
     join ai_ops.models mm on mm.id = rp.fallback_models[1]
    where rp.version = 2 and rp.status = 'ACTIVE'),
  array['comparison.v2=claude-sonnet-5-5', 'deep_investigation.v2=claude-sonnet-5-5',
        'evidence_synthesis.v2=claude-sonnet-5-5', 'fast_classification.v2=claude-sonnet-5-5',
        'normal_dialogue.v2=claude-sonnet-5-5', 'structured_extraction.v2=claude-sonnet-5-5',
        'taxonomy_mapping.v2=claude-sonnet-5-5'],
  'Claude Sonnet backs every route, the reader included (20261231360000, DECISIONS 69)');

select is(
  (select count(*)::int from ai_ops.routing_policies rp,
          unnest(rp.preferred_models || rp.fallback_models) with ordinality u(m, n)
     join ai_ops.models mm on mm.id = u.m
    where rp.version = 2 and rp.status = 'ACTIVE'
      and mm.sensitivity_ceiling = 'PUBLIC' and u.n <= 3),
  0,
  'Gemini (PUBLIC-only) comes only after OpenAI, Claude and Groq');

select is(
  (select count(*)::int from ai_ops.models mm join ai_ops.providers p on p.id = mm.provider_id
    where p.code = 'google'
      and (mm.sensitivity_ceiling <> 'PUBLIC' or p.privacy_policy_class <> 'UNREVIEWED'
           or p.owner_approved_ceiling is not null)),
  0,
  'Gemini can never serve CONFIDENTIAL');

select is(
  (select count(*)::int from ai_ops.routing_policies rp,
          unnest(rp.preferred_models || rp.fallback_models) u(m)
     join ai_ops.models mm on mm.id = u.m
     join ai_ops.providers p on p.id = mm.provider_id
    where rp.status = 'ACTIVE' and p.code = 'groq' and mm.max_request_tokens is null),
  0,
  'every Groq model in an active policy carries its per-request limit');

select * from finish();
rollback;
