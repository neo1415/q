-- 20261231330000 (re-land of 20261231290000): every active Q text policy
-- has a second CONFIDENTIAL route (Groq, directly after OpenAI), Gemini
-- never serves CONFIDENTIAL, and every Groq model in an active policy
-- carries its per-request limit (20261231320000) so a large turn is never
-- sent to it.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

-- CONFIDENTIAL-eligible as the gateway judges it (eligibility.ts
-- providerJustifiedCeiling): an active model whose own ceiling reaches
-- CONFIDENTIAL, on an active provider whose review justifies it.
create temporary view confidential_route as
select rp.code, mm.id as model_id, p.code as provider_code
  from ai_ops.routing_policies rp,
       unnest(rp.preferred_models || rp.fallback_models) u(m)
  join ai_ops.models mm on mm.id = u.m
  join ai_ops.providers p on p.id = mm.provider_id
 where rp.status = 'ACTIVE'
   and mm.status = 'ACTIVE'
   and p.status = 'ACTIVE'
   and mm.sensitivity_ceiling in ('CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL', 'RESTRICTED')
   and ((p.privacy_policy_class = 'NO_TRAINING_ZERO_RETENTION' and p.supports_zero_retention)
        or (p.privacy_policy_class not in ('UNREVIEWED', 'TRAINING_PERMITTED')
            and p.owner_approved_ceiling = 'CONFIDENTIAL'));

select is(
  (select count(*)::int from ai_ops.routing_policies rp
    where rp.status = 'ACTIVE' and rp.task_class <> 'UI_TRANSLATION'
      and (select count(distinct c.provider_code) from confidential_route c
            where c.code = rp.code) < 2),
  0,
  'every active Q text policy has CONFIDENTIAL-eligible models on two providers');

select is(
  (select count(*)::int from ai_ops.routing_policies rp
    where rp.status = 'ACTIVE' and rp.task_class <> 'UI_TRANSLATION'
      and (select count(*) from confidential_route c where c.code = rp.code) < 2),
  0,
  'and at least two CONFIDENTIAL-eligible models each');

select is(
  (select count(*)::int from ai_ops.models mm
     join ai_ops.providers p on p.id = mm.provider_id
    where p.code = 'google' and mm.sensitivity_ceiling <> 'PUBLIC'),
  0,
  'every Gemini model is PUBLIC-only');

select is(
  (select count(*)::int from ai_ops.providers
    where code = 'google'
      and (privacy_policy_class <> 'UNREVIEWED' or owner_approved_ceiling is not null)),
  0,
  'and Google stays unreviewed with no owner-approved ceiling, so Gemini never serves CONFIDENTIAL');

select is(
  (select count(*)::int from ai_ops.routing_policies rp
    where rp.status = 'ACTIVE' and rp.version = 1
      and rp.code in ('normal_dialogue.v1', 'evidence_synthesis.v1', 'comparison.v1',
                      'deep_investigation.v1', 'fast_classification.v1',
                      'structured_extraction.v1', 'taxonomy_mapping.v1')
      and array_position(rp.preferred_models || rp.fallback_models,
                         'a2000000-0000-4000-8000-000000000004'::uuid)
          is distinct from
          array_position(rp.preferred_models || rp.fallback_models,
                         'a2000000-0000-4000-8000-000000000009'::uuid) + 1),
  0,
  'Groq gpt-oss-120b sits directly after gpt-5.6-luna on all seven');

select is(
  (select array_agg(code order by code) from ai_ops.routing_policies
    where status = 'ACTIVE'
      and 'a2000000-0000-4000-8000-000000000003'::uuid = any (fallback_models)),
  array['fast_classification.v1', 'taxonomy_mapping.v1'],
  'gpt-oss-20b only on the two fast classes');

select is(
  (select count(*)::int from ai_ops.routing_policies
    where status = 'ACTIVE' and task_class <> 'UI_TRANSLATION'),
  7,
  'no policy was added, retired or switched (v2 stays staged)');

select is(
  (select count(*)::int
     from ai_ops.routing_policies rp,
          unnest(rp.preferred_models || rp.fallback_models) u(m)
     join ai_ops.models mm on mm.id = u.m
     join ai_ops.providers p on p.id = mm.provider_id
    where rp.status = 'ACTIVE' and p.code = 'groq'
      and mm.max_request_tokens is null),
  0,
  'every Groq model in an active policy has its per-request limit');

select * from finish();
rollback;
