-- Sonnet throughout the Claude backup (owner, DECISIONS 69, 2026-11-06):
-- "No downgrade to a smaller model, Haiku included, for anything that
-- affects understanding or answers: the turn reader, binding and answers.
-- In the Claude backup chain the reader runs on Sonnet too."
--
-- The three v2 policies that reached claude-haiku-5-5 after OpenAI --
-- fast_classification.v2 (the turn reader, TURN_READ, and Q's other
-- readers), structured_extraction.v2 and taxonomy_mapping.v2 -- reach
-- claude-sonnet-5-5 instead. No offline check proves Haiku equal on any of
-- them, so none keeps it ("if unsure, Sonnet"). The Haiku model and price
-- rows stay (catalogue data); no route reaches them.
--
-- Their cost ceilings were sized for Haiku. The gateway prices each
-- attempt with no cache credit (policy/cost.ts estimateAttemptCost), so a
-- ~31k-token turn reading on Sonnet is estimated at ~$0.075 and $0.02 would
-- skip Sonnet for Groq or Gemini -- the downgrade this removes. Raised to
-- fit Sonnet; a request's own budget still bounds it (the lower of the
-- two applies). OpenAI stays first on every row.
--
-- Data only: no DROP, no new table, no RLS or grant change; v1 untouched.
--
-- Rollback (back to the Haiku rows of 20261231300000, one statement):
--   update ai_ops.routing_policies rp
--      set fallback_models[1] = 'a2000000-0000-4000-8000-000000000031',
--          cost_ceiling_usd = case rp.code
--            when 'structured_extraction.v2' then 0.05 else 0.02 end
--    where rp.version = 2
--      and rp.code in ('fast_classification.v2', 'structured_extraction.v2',
--                      'taxonomy_mapping.v2');

do $$
begin
  if (select count(*) from ai_ops.routing_policies
       where version = 2
         and code in ('fast_classification.v2', 'structured_extraction.v2',
                      'taxonomy_mapping.v2')
         and fallback_models[1] = 'a2000000-0000-4000-8000-000000000031') <> 3 then
    raise exception 'expected the three v2 Haiku backup rows of 20261231300000';
  end if;
end;
$$;

update ai_ops.routing_policies
   set fallback_models[1] = 'a2000000-0000-4000-8000-000000000030',
       cost_ceiling_usd = case code
         when 'fast_classification.v2' then 0.15
         when 'structured_extraction.v2' then 0.30
         when 'taxonomy_mapping.v2' then 0.05
       end
 where version = 2
   and code in ('fast_classification.v2', 'structured_extraction.v2',
                'taxonomy_mapping.v2');

do $$
begin
  if exists (
    select 1 from ai_ops.routing_policies rp,
                  unnest(rp.preferred_models || rp.fallback_models) m
     where rp.status = 'ACTIVE' and m = 'a2000000-0000-4000-8000-000000000031'
  ) then
    raise exception 'an active route still reaches claude-haiku-5-5';
  end if;
end;
$$;
