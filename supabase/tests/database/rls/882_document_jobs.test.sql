-- Q room W5 (R8, 20261215090000 + 20261215091000): document jobs, own
-- pictures for documents, and the image model's new catalog row.
--
-- A job is server-only (no browser principal reads or writes one, own
-- organisation included), one per artifact, bounded in attempts, with a
-- known stage. An own picture names the document it came from; a
-- generated one does not. The retired Gemini image model stays in the
-- catalog (earlier usage rows name it) and its replacement is active.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every job.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the Q API reads progress only as the person).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(15);

-- Fixtures ------------------------------------------------------------------------
insert into artifacts.artifacts (id, tenant_id, organisation_id, type, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000089a1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'PITCH_DECK', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000089a2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'MEMO', pg_temp.rls_id('user_b'));

insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000089d1', pg_temp.rls_id('tenant_a'), null, pg_temp.rls_id('org_a'), 'UNCLASSIFIED', 'Team photo', pg_temp.rls_id('user_a'));

-- Writing jobs ---------------------------------------------------------------------
select lives_ok(
  $$ insert into artifacts.document_jobs
       (tenant_id, organisation_id, artifact_id, requested_by_user_id, q_run_id, kind, input)
     values
       (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000089a1',
        pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-0000000089f1', 'PITCH_DECK', '{"title":"Deck"}'::jsonb),
       (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-0000000089a2',
        pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-0000000089f2', 'MEMO', '{"title":"Memo"}'::jsonb) $$,
  'the Q API queues one job per document');
select throws_ok(
  $$ insert into artifacts.document_jobs
       (tenant_id, organisation_id, artifact_id, requested_by_user_id, q_run_id, kind, input)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000089a1',
        pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-0000000089f1', 'PITCH_DECK', '{}'::jsonb) $$,
  '23505', null, 'one job per artifact');
select throws_ok(
  $$ update artifacts.document_jobs set kind = 'NOVEL' where artifact_id = '00000000-0000-4000-8000-0000000089a1' $$,
  '23514', null, 'only known kinds');
select throws_ok(
  $$ update artifacts.document_jobs set stage = 'THINKING' where artifact_id = '00000000-0000-4000-8000-0000000089a1' $$,
  '23514', null, 'only known stages');
select throws_ok(
  $$ update artifacts.document_jobs set attempts = 4 where artifact_id = '00000000-0000-4000-8000-0000000089a1' $$,
  '23514', null, 'attempts are bounded');
select throws_ok(
  $$ update artifacts.document_jobs set status = 'DONE' where artifact_id = '00000000-0000-4000-8000-0000000089a1' $$,
  '23514', null, 'a finished job says when it finished');
select lives_ok(
  $$ update artifacts.document_jobs set status = 'RUNNING', stage = 'DESIGNING', attempts = 1
      where artifact_id = '00000000-0000-4000-8000-0000000089a1' $$,
  'the worker moves a job through its stages');

-- Own pictures ---------------------------------------------------------------------
select lives_ok(
  $$ insert into artifacts.document_images
       (tenant_id, organisation_id, storage_key, content_type, byte_size, provenance,
        provider_code, model_code, prompt, purpose, cost_usd, created_by_user_id, source_document_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
        pg_temp.rls_id('org_a')::text || '/00000000-0000-4000-8000-0000000089e1.png',
        'image/png', 2048, 'OWN_UPLOAD', 'upload', 'own-upload',
        'The person''s own picture, dropped on a placeholder.', 'UPLOAD', 0,
        pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-0000000089d1') $$,
  'an own picture is filed with the document it came from');
select throws_ok(
  $$ insert into artifacts.document_images
       (tenant_id, organisation_id, storage_key, content_type, byte_size, provenance,
        provider_code, model_code, prompt, purpose, cost_usd, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
        pg_temp.rls_id('org_a')::text || '/00000000-0000-4000-8000-0000000089e2.png',
        'image/png', 2048, 'OWN_UPLOAD', 'upload', 'own-upload', 'x', 'UPLOAD', 0,
        pg_temp.rls_id('user_a')) $$,
  '23514', null, 'an own picture must name its source document');

-- Image model catalog --------------------------------------------------------------
-- By model code, not id: …022 is gpt-realtime-mini, and asserting its
-- status passed for the wrong reason (audit F-D2). 897 pins the ids.
select is((select m.status from ai_ops.models m join ai_ops.providers p on p.id = m.provider_id
            where p.code = 'google' and m.model_code = 'gemini-3.1-flash-lite-image'
              and m.model_type = 'IMAGE_GENERATION'),
  'ACTIVE', 'gemini-3.1-flash-lite-image is the active Gemini image model');
select is((select status from ai_ops.models where id = 'a2000000-0000-4000-8000-000000000021'),
  'RETIRED', 'gemini-2.5-flash-image is retired, not deleted');

-- Browser principals -------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from artifacts.document_jobs $$,
  '42501', null, 'anonymous cannot read jobs');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from artifacts.document_jobs $$,
  '42501', null, 'an authenticated browser session cannot read jobs, even its own');

select pg_temp.act_as_revoked_user();
select throws_ok($$ select count(*) from artifacts.document_jobs $$,
  '42501', null, 'a revoked user reads nothing');

select pg_temp.act_as_privileged();
select is((select count(*)::int from artifacts.document_jobs), 2,
  'the privileged server role reads the jobs; DB privilege is not business authorisation');

select * from finish();
rollback;
