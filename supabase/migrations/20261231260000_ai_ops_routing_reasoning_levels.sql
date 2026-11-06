-- Q Intelligence step 7 (adaptive reasoning): think when it matters.
--
-- reasoning_levels: the reasoning level per kind of work a caller names on
-- a model call (`reasoningKey` on the gateway request), kept in the
-- versioned routing configuration instead of code. The gateway uses the
-- policy's level for the key the request names; with no key, or a key the
-- map does not list, or a NULL map, the request's own level stands (the
-- caller's code default, so a service deployed before this migration and a
-- catalogue read before it behave exactly as today).
--
-- Q's conversational answer names one key per answer kind the turn reader
-- read (TURN_READER v78 answerKind; a compound ask takes its heaviest
-- part). Small talk and lookups think least so follow-ups stay fast;
-- comparison, analysis (diligence, memo, planning) and documents get
-- MEDIUM. Never set from the person's words.
--
-- Additive only: one nullable column with a check, and the map written on
-- the active rows of the three classes a Q answer can route under. No row
-- is added, retired or dropped, no model or fallback order changes, and
-- every other column is untouched.
--
-- pgTAP note: ai_ops has no client grants (service_role and postgres only,
-- 20260907090000); the new column inherits the table-level grants and the
-- RLS-with-no-policy posture, so no new grant or policy surface.
-- 999_ai_ops_routing_reasoning_levels.test.sql covers the constraint and
-- the written map.

alter table ai_ops.routing_policies
  add column reasoning_levels jsonb
    constraint routing_policies_reasoning_levels_shape
      check (
        reasoning_levels is null
        or (
          jsonb_typeof(reasoning_levels) = 'object'
          and not jsonb_path_exists(
            reasoning_levels,
            '$.keyvalue() ? (!(@.key like_regex "^[A-Z][A-Z0-9_]{0,47}$"))'
          )
          and not jsonb_path_exists(
            reasoning_levels, '$.* ? (@.type() != "string")'
          )
          and not jsonb_path_exists(
            reasoning_levels,
            '$.* ? (@ != "NONE" && @ != "LOW" && @ != "MEDIUM" && @ != "HIGH")'
          )
        )
      );

comment on column ai_ops.routing_policies.reasoning_levels is
  'Reasoning level (NONE, LOW, MEDIUM, HIGH) per kind of work a caller names on a model call (the request''s reasoningKey). NULL, or a key not listed: the request''s own level.';

update ai_ops.routing_policies
   set reasoning_levels = jsonb_build_object(
         'ANSWER_CHAT', 'NONE',
         'ANSWER_LOOKUP', 'NONE',
         'ANSWER_FOLLOW_UP', 'LOW',
         'ANSWER_COMPARISON', 'MEDIUM',
         'ANSWER_ANALYSIS', 'MEDIUM',
         'ANSWER_DOCUMENT', 'MEDIUM')
 where status = 'ACTIVE'
   and task_class in ('NORMAL_DIALOGUE', 'EVIDENCE_SYNTHESIS', 'COMPARISON');
