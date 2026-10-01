-- HARDEN 20261110000000: the per-turn readers route flash-lite first, luna
-- second, the stronger Gemini last; no other policy changed.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

select is(
  (select preferred_models from ai_ops.routing_policies
    where code = 'fast_classification.v1' and status = 'ACTIVE'),
  array['a2000000-0000-4000-8000-000000000001'::uuid],
  'fast classification prefers gemini-3.5-flash-lite');

select is(
  (select fallback_models from ai_ops.routing_policies
    where code = 'fast_classification.v1' and status = 'ACTIVE'),
  array['a2000000-0000-4000-8000-000000000009'::uuid,
        'a2000000-0000-4000-8000-000000000010'::uuid],
  'and falls back to gpt-5.6-luna, then gemini-3.5-flash');

select is(
  (select preferred_models from ai_ops.routing_policies
    where code = 'normal_dialogue.v1' and status = 'ACTIVE'),
  array['a2000000-0000-4000-8000-000000000009'::uuid],
  'dialogue still prefers luna');

select is(
  (select count(*)::int from ai_ops.routing_policies where status = 'ACTIVE'),
  7,
  'no policy was added or retired');

select * from finish();
rollback;
