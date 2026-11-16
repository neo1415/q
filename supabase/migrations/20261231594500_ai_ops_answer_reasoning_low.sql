-- Voice audit Phase 3 (owner directive 2026-11-15, latency): a
-- conversational comparison or analysis thinks at LOW, not MEDIUM.
--
-- Live on production 8647c718c (16 Nov 2026, investor turns): at MEDIUM the
-- answer call's first words came 10.2 s into a 19.6 s comparison
-- (6497c94c, three companies) and 15.3 s into a 16.4 s "why does the deck
-- show a different number" (84be6936), on evidence code had already read
-- and put in front of the model. LOW keeps a reasoning step for both; a
-- document (ANSWER_DOCUMENT) keeps MEDIUM, and chat, lookups and
-- follow-ups are unchanged.
--
-- Routing only: the same models, fallbacks, prompts, tools and Context
-- Firewall; what Q may see and say is unchanged. Data-only and additive:
-- the two keys are rewritten on the maps the step 7 migration
-- (20261231260000) wrote on the active Q answer policies; no row is added,
-- retired or dropped, and no other column changes. The code-side default
-- (ANSWER_REASONING_V1) carries the same levels.

update ai_ops.routing_policies
   set reasoning_levels = reasoning_levels
         || jsonb_build_object(
              'ANSWER_COMPARISON', 'LOW',
              'ANSWER_ANALYSIS', 'LOW')
 where status = 'ACTIVE'
   and task_class in ('NORMAL_DIALOGUE', 'EVIDENCE_SYNTHESIS', 'COMPARISON')
   and reasoning_levels is not null;
