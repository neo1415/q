-- RECOVERY F7 (20261220192000, audit F-D1/F-D2): every model has its own
-- catalog row, and the ids the code pins name the model they claim.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

select is(
  (select model_code from ai_ops.models where id = 'a2000000-0000-4000-8000-000000000022'),
  'gpt-realtime-mini',
  '…022 is the realtime voice model (packages/model-gateway/src/realtime/openai.ts)');
select is(
  (select model_type from ai_ops.models where id = 'a2000000-0000-4000-8000-000000000022'),
  'REALTIME', 'and it is a realtime model, not an image model');
select is(
  (select m.model_code || '/' || p.code || '/' || m.model_type || '/' || m.status
     from ai_ops.models m join ai_ops.providers p on p.id = m.provider_id
    where m.id = 'a2000000-0000-4000-8000-000000190001'),
  'gemini-3.1-flash-lite-image/google/IMAGE_GENERATION/ACTIVE',
  'the Gemini image model has its own row (packages/model-gateway/src/images/config.ts)');
select is(
  (select status from ai_ops.models where id = 'a2000000-0000-4000-8000-000000000021'),
  'RETIRED', 'gemini-2.5-flash-image stays retired, not deleted');
select is(
  (select count(*)::int from ai_ops.models m
    group by m.provider_id, m.model_code order by 1 desc limit 1),
  1, 'no provider has two rows for one model code');

select * from finish();
rollback;
