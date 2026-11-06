-- DECISIONS 69 (20261231360000): Sonnet throughout the Claude backup. No
-- route reaches Haiku; OpenAI stays first; ceilings fit Sonnet; v1 is
-- untouched. The header's rollback is exercised inside the transaction.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

select is(
  (select count(*)::int from ai_ops.routing_policies rp,
          unnest(rp.preferred_models || rp.fallback_models) m
     join ai_ops.models mm on mm.id = m
    where rp.status = 'ACTIVE' and mm.model_code = 'claude-haiku-5-5'),
  0,
  'no active route reaches claude-haiku-5-5');

select is(
  (select array_agg(code || '=' || m.model_code order by code)
     from ai_ops.routing_policies rp join ai_ops.models m on m.id = rp.fallback_models[1]
    where rp.version = 2),
  array['comparison.v2=claude-sonnet-5-5', 'deep_investigation.v2=claude-sonnet-5-5',
        'evidence_synthesis.v2=claude-sonnet-5-5', 'fast_classification.v2=claude-sonnet-5-5',
        'normal_dialogue.v2=claude-sonnet-5-5', 'structured_extraction.v2=claude-sonnet-5-5',
        'taxonomy_mapping.v2=claude-sonnet-5-5'],
  'the Claude backup is Sonnet on every v2 route, the turn reader included');

select is(
  (select count(*)::int from ai_ops.routing_policies rp
     join ai_ops.models m on m.id = rp.preferred_models[1]
    where rp.version = 2 and rp.status = 'ACTIVE' and m.model_code = 'gpt-5.6-luna'),
  7,
  'OpenAI stays first on all seven active v2 routes');

select is(
  (select array_agg(code || '=' || cost_ceiling_usd::text order by code)
     from ai_ops.routing_policies
    where version = 2
      and code in ('fast_classification.v2', 'structured_extraction.v2', 'taxonomy_mapping.v2')),
  array['fast_classification.v2=0.150000', 'structured_extraction.v2=0.300000',
        'taxonomy_mapping.v2=0.050000'],
  'ceilings sized for Sonnet (no cache credit in the estimate)');

select is(
  (select count(*)::int from ai_ops.routing_policies v1
    where v1.version = 1 and v1.status = 'ACTIVE'
      and not exists (select 1 from unnest(v1.preferred_models || v1.fallback_models) m
                        join ai_ops.models mm on mm.id = m
                        join ai_ops.providers p on p.id = mm.provider_id
                       where p.code = 'anthropic')),
  8,
  'v1 untouched: eight active rows, none reaching Claude');

select is(
  (select count(*)::int from ai_ops.models
    where model_code = 'claude-haiku-5-5' and status = 'ACTIVE'),
  1,
  'the Haiku model row stays in the catalogue');

-- the header's rollback
update ai_ops.routing_policies rp
   set fallback_models[1] = 'a2000000-0000-4000-8000-000000000031',
       cost_ceiling_usd = case rp.code
         when 'structured_extraction.v2' then 0.05 else 0.02 end
 where rp.version = 2
   and rp.code in ('fast_classification.v2', 'structured_extraction.v2',
                   'taxonomy_mapping.v2');

select is(
  (select array_agg(code || '=' || m.model_code || '@' || rp.cost_ceiling_usd::text order by code)
     from ai_ops.routing_policies rp join ai_ops.models m on m.id = rp.fallback_models[1]
    where rp.version = 2
      and rp.code in ('fast_classification.v2', 'structured_extraction.v2', 'taxonomy_mapping.v2')),
  array['fast_classification.v2=claude-haiku-5-5@0.020000',
        'structured_extraction.v2=claude-haiku-5-5@0.050000',
        'taxonomy_mapping.v2=claude-haiku-5-5@0.020000'],
  'rollback: the Haiku rows of 20261231300000 again, with their ceilings');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'ai_ops' and grantee in ('anon', 'authenticated')),
  0,
  'ai_ops still has no client grants');

select * from finish();
rollback;
