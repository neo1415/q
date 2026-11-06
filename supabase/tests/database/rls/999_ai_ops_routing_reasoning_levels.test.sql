-- Q intelligence step 7 (20261231260000): ai_ops.routing_policies gains
-- reasoning_levels, the reasoning level per kind of work a caller names.
-- Additive: no policy added or retired, no route changed, no client grant;
-- the map is well formed and written on the Q answer classes only.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

select has_column('ai_ops', 'routing_policies', 'reasoning_levels',
  'routing_policies has reasoning_levels');

select col_is_null('ai_ops', 'routing_policies', 'reasoning_levels',
  'reasoning_levels is nullable: NULL keeps the request''s own level');

select is(
  (select reasoning_levels from ai_ops.routing_policies
    where code = 'normal_dialogue.v1' and status = 'ACTIVE'),
  '{"ANSWER_CHAT":"NONE","ANSWER_LOOKUP":"NONE","ANSWER_FOLLOW_UP":"LOW","ANSWER_COMPARISON":"MEDIUM","ANSWER_ANALYSIS":"MEDIUM","ANSWER_DOCUMENT":"MEDIUM"}'::jsonb,
  'dialogue: chat and lookups NONE, follow-ups LOW, comparison, analysis and documents MEDIUM');

select is(
  (select count(*)::int from ai_ops.routing_policies
    where status = 'ACTIVE'
      and task_class in ('NORMAL_DIALOGUE', 'EVIDENCE_SYNTHESIS', 'COMPARISON')
      and reasoning_levels is null),
  0,
  'every active Q answer class has the map');

select is(
  (select count(*)::int from ai_ops.routing_policies
    where task_class not in ('NORMAL_DIALOGUE', 'EVIDENCE_SYNTHESIS', 'COMPARISON')
      and reasoning_levels is not null),
  0,
  'no other class was given a map');

select is(
  (select count(*)::int from ai_ops.routing_policies where status = 'ACTIVE' and task_class <> 'UI_TRANSLATION'),
  7,
  'no Q policy was added or retired');

select is(
  (select preferred_models from ai_ops.routing_policies
    where code = 'normal_dialogue.v1' and status = 'ACTIVE'),
  array['a2000000-0000-4000-8000-000000000009'::uuid],
  'dialogue routing is unchanged');

select throws_ok(
  $$update ai_ops.routing_policies set reasoning_levels = '{"ANSWER_CHAT":"MAXIMUM"}'::jsonb
     where code = 'normal_dialogue.v1'$$,
  '23514', null,
  'an unknown level is refused');

select throws_ok(
  $$update ai_ops.routing_policies set reasoning_levels = '{"answer chat":"LOW"}'::jsonb
     where code = 'normal_dialogue.v1'$$,
  '23514', null,
  'a malformed key is refused');

select throws_ok(
  $$update ai_ops.routing_policies set reasoning_levels = '{"ANSWER_CHAT":2}'::jsonb
     where code = 'normal_dialogue.v1'$$,
  '23514', null,
  'a non-string level is refused');

select throws_ok(
  $$update ai_ops.routing_policies set reasoning_levels = '["LOW"]'::jsonb
     where code = 'normal_dialogue.v1'$$,
  '23514', null,
  'a map that is not an object is refused');

select is(
  (select count(*)::int from information_schema.role_column_grants
    where table_schema = 'ai_ops' and table_name = 'routing_policies'
      and column_name = 'reasoning_levels'
      and grantee in ('anon', 'authenticated')),
  0,
  'no browser role is granted the column');

select * from finish();
rollback;
