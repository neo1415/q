-- Founder documents (2026-10-08): decline notes, named-request declines,
-- investor questions and the founder's answers.
--
-- EXPECTED DB BEHAVIOUR: server-only (RLS on, no policies, no client
-- grants); append-only; every row stays inside its relationship's tenant;
-- an answer is always USER_CLAIM and DOCUMENT_SUPPORTED only with a
-- document. APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: the
-- server decides the party (company side answers, investor side asks).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(25);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000086c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Docs Co A', 'docs-co-a'),
  ('00000000-0000-4000-8000-0000000086c2', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'Docs Co R', 'docs-co-r');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000086e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Docs Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000008601', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000086c1', '00000000-0000-4000-8000-0000000086e2', 'DISCOVERED'),
  ('00000000-0000-4000-8000-000000008602', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-0000000086c2', '00000000-0000-4000-8000-0000000086e2', 'DISCOVERED');
-- Requests go only through a connected relationship (suite 889): this one is.
insert into network.relationship_events (tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, correlation_id) values
  (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008601', 1, 'connection_accepted', 'HUMAN', pg_temp.rls_id('user_a'), 'MANUAL', 'relationship_shared', 'cor_00000000-0000-4000-8000-000000008601');
insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000086d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000086c1', pg_temp.rls_id('org_a'), 'FINANCIAL', 'Management accounts', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000086d3', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-0000000086c2', pg_temp.rls_id('org_r'), 'LEGAL', 'Other tenant doc', pg_temp.rls_id('user_r'));
insert into evidence.data_room_access_requests (id, tenant_id, company_id, document_id, relationship_id, investor_organisation_id, requested_by_user_id, idempotency_key) values
  ('00000000-0000-4000-8000-0000000086a1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000086c1', null,
   '00000000-0000-4000-8000-000000008601', '00000000-0000-4000-8000-0000000086e2', pg_temp.rls_id('user_b'), 'docs-request-0001'),
  ('00000000-0000-4000-8000-0000000086a2', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000086c1', null,
   '00000000-0000-4000-8000-000000008601', '00000000-0000-4000-8000-0000000086e2', pg_temp.rls_id('user_b'), 'docs-request-0002');
insert into network.diligence_requests (id, tenant_id, relationship_id, requested_by_user_id, title, idempotency_key) values
  ('00000000-0000-4000-8000-0000000086b1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008601', pg_temp.rls_id('user_b'), 'Management accounts', 'docs-dili-0001'),
  ('00000000-0000-4000-8000-0000000086b2', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008601', pg_temp.rls_id('user_b'), 'Customer contracts', 'docs-dili-0002');

-- Server-only.
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'network.diligence_request_declines'::regclass, 'network.diligence_questions'::regclass,
  'network.diligence_question_answers'::regclass)), true, 'row level security is on for the new tables');
select is((select count(*)::int from pg_policies where schemaname = 'network'
            and tablename in ('diligence_request_declines', 'diligence_questions', 'diligence_question_answers')), 0,
  'server-only: no policies');
select ok(not has_table_privilege('authenticated', 'network.diligence_questions', 'select')
          and not has_table_privilege('anon', 'network.diligence_questions', 'select')
          and not has_table_privilege('authenticated', 'network.diligence_question_answers', 'insert')
          and not has_table_privilege('authenticated', 'network.diligence_request_declines', 'select'),
  'no client role reads or writes them');

-- Data-room decisions: a decline's note, a fulfilment's document.
select lives_ok(
  $$ insert into evidence.data_room_request_decisions (request_id, tenant_id, decision, note, decided_by_user_id)
     values ('00000000-0000-4000-8000-0000000086a1', pg_temp.rls_id('tenant_a'), 'DECLINED', 'After a term sheet.', pg_temp.rls_id('user_a')) $$,
  'positive: a decline carries the founder''s note');
select throws_ok(
  $$ insert into evidence.data_room_request_decisions (request_id, tenant_id, decision, expires_at, note, decided_by_user_id)
     values ('00000000-0000-4000-8000-0000000086a2', pg_temp.rls_id('tenant_a'), 'APPROVED', clock_timestamp() + interval '30 days', 'note', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'a note belongs to a decline only');
select throws_ok(
  $$ insert into evidence.data_room_request_decisions (request_id, tenant_id, decision, expires_at, fulfilled_document_id, decided_by_user_id)
     values ('00000000-0000-4000-8000-0000000086a2', pg_temp.rls_id('tenant_a'), 'APPROVED', clock_timestamp() + interval '30 days',
             '00000000-0000-4000-8000-0000000086d3', pg_temp.rls_id('user_a')) $$,
  '23503', null, 'cross-tenant: another tenant''s document never fulfils this request');
select lives_ok(
  $$ insert into evidence.data_room_request_decisions (request_id, tenant_id, decision, expires_at, fulfilled_document_id, decided_by_user_id)
     values ('00000000-0000-4000-8000-0000000086a2', pg_temp.rls_id('tenant_a'), 'APPROVED', clock_timestamp() + interval '30 days',
             '00000000-0000-4000-8000-0000000086d1', pg_temp.rls_id('user_a')) $$,
  'positive: an upload fulfils the request');

-- Named-request declines: answered once, inside the tenant.
select throws_ok(
  $$ insert into network.diligence_request_declines (request_id, tenant_id, note, declined_by_user_id)
     values ('00000000-0000-4000-8000-0000000086b1', pg_temp.rls_id('tenant_r'), null, pg_temp.rls_id('user_r')) $$,
  '23514', null, 'cross-tenant: a decline belongs to its request''s tenant');
select lives_ok(
  $$ insert into network.diligence_request_declines (request_id, tenant_id, note, declined_by_user_id)
     values ('00000000-0000-4000-8000-0000000086b2', pg_temp.rls_id('tenant_a'), 'Not before a term sheet.', pg_temp.rls_id('user_a')) $$,
  'positive: the founder declines a named request');
select throws_ok(
  $$ insert into network.diligence_fulfilments (request_id, tenant_id, disclosure_policy_id, document_id, fulfilled_by_user_id)
     select '00000000-0000-4000-8000-0000000086b2', pg_temp.rls_id('tenant_a'), gen_random_uuid(),
            '00000000-0000-4000-8000-0000000086d1', pg_temp.rls_id('user_a') $$,
  '23514', null, 'a declined request is never also fulfilled');
select throws_ok(
  $$ update network.diligence_request_declines set note = 'changed' $$,
  '55000', null, 'a decline is never rewritten');

-- Questions.
select lives_ok(
  $$ insert into network.diligence_questions (id, tenant_id, relationship_id, company_id, asked_by_user_id, position, question,
       assumption_id, assumption_label, sent_via, sent_ref, idempotency_key)
     values ('00000000-0000-4000-8000-0000000086f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008601',
             '00000000-0000-4000-8000-0000000086c1', pg_temp.rls_id('user_b'), 1, 'How many customers paid last month?',
             'TRACTION:1', 'Paying customers', 'DILIGENCE_REQUEST', '00000000-0000-4000-8000-0000000086b1', 'docs-questions-01') $$,
  'positive: the investor''s question is recorded');
select throws_ok(
  $$ insert into network.diligence_questions (tenant_id, relationship_id, company_id, asked_by_user_id, position, question, sent_via, sent_ref, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008601', '00000000-0000-4000-8000-0000000086c2',
             pg_temp.rls_id('user_b'), 2, 'Another company?', 'CHAT_MESSAGE', gen_random_uuid(), 'docs-questions-02') $$,
  '23514', null, 'cross-tenant: a question names its relationship''s own company');
select throws_ok(
  $$ insert into network.diligence_questions (tenant_id, relationship_id, company_id, asked_by_user_id, position, question, sent_via, sent_ref, idempotency_key)
     values (pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-000000008601', '00000000-0000-4000-8000-0000000086c2',
             pg_temp.rls_id('user_b'), 2, 'Wrong tenant', 'CHAT_MESSAGE', gen_random_uuid(), 'docs-questions-03') $$,
  '23514', null, 'cross-tenant: a question lives in its relationship''s tenant');
select throws_ok(
  $$ insert into network.diligence_questions (tenant_id, relationship_id, company_id, asked_by_user_id, position, question, sent_via, sent_ref, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008601', '00000000-0000-4000-8000-0000000086c1',
             pg_temp.rls_id('user_b'), 1, 'Retried', 'CHAT_MESSAGE', gen_random_uuid(), 'docs-questions-01') $$,
  '23505', null, 'a retried send is one set of questions (idempotency key)');
select throws_ok(
  $$ delete from network.diligence_questions $$, '55000', null, 'a question is never deleted');

-- Answers.
select throws_ok(
  $$ insert into network.diligence_question_answers (question_id, tenant_id, answer, evidence_status, answered_by_user_id, idempotency_key)
     values ('00000000-0000-4000-8000-0000000086f1', pg_temp.rls_id('tenant_a'), '131 paid in September.', 'DOCUMENT_SUPPORTED', pg_temp.rls_id('user_a'), 'docs-answer-0001') $$,
  '23514', null, 'document-supported needs a document');
select throws_ok(
  $$ insert into network.diligence_question_answers (question_id, tenant_id, answer, truth_class, evidence_status, answered_by_user_id, idempotency_key)
     values ('00000000-0000-4000-8000-0000000086f1', pg_temp.rls_id('tenant_a'), '131 paid.', 'VERIFIED', 'SELF_REPORTED', pg_temp.rls_id('user_a'), 'docs-answer-0002') $$,
  '23514', null, 'an answer is never verified by being said');
select throws_ok(
  $$ insert into network.diligence_question_answers (question_id, tenant_id, answer, evidence_status, answered_by_user_id, idempotency_key)
     values ('00000000-0000-4000-8000-0000000086f1', pg_temp.rls_id('tenant_r'), '131 paid.', 'SELF_REPORTED', pg_temp.rls_id('user_r'), 'docs-answer-0003') $$,
  '23514', null, 'cross-tenant: an answer lives in its question''s tenant');
select lives_ok(
  $$ insert into network.diligence_question_answers (question_id, tenant_id, answer, document_ids, evidence_status, answered_by_user_id, idempotency_key)
     values ('00000000-0000-4000-8000-0000000086f1', pg_temp.rls_id('tenant_a'), '131 paid in September.',
             array['00000000-0000-4000-8000-0000000086d1']::uuid[], 'DOCUMENT_SUPPORTED', pg_temp.rls_id('user_a'), 'docs-answer-0004') $$,
  'positive: the founder answers with a document');
select is((select truth_class from network.diligence_question_answers where idempotency_key = 'docs-answer-0004'),
  'USER_CLAIM', 'the answer is the founder''s claim');
select throws_ok(
  $$ update network.diligence_question_answers set answer = 'changed' $$,
  '55000', null, 'an answer is never rewritten; a correction is a new row');

-- Client roles: a signed-in founder or investor reads nothing directly.
select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from network.diligence_questions $$, '42501', null,
  'the company''s own member cannot read questions directly (server-only)');
select throws_ok($$ select count(*) from network.diligence_question_answers $$, '42501', null,
  'nor answers');
select pg_temp.act_as_revoked_user();
select throws_ok($$ select count(*) from network.diligence_request_declines $$, '42501', null,
  'a revoked member reads nothing');
select pg_temp.reset_test_identity();

select * from finish();

rollback;
