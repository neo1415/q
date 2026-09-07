-- CQ-KNW-002 · q_knowledge objects: what Capital Q understands, kept apart
-- from what a source said, and unreachable from a browser.
--
--   Claim ≠ Knowledge Object ≠ canonical company state ≠ Data Room ≠ audit
--   evidence status ≠ confidence ≠ truth class;  existing ≠ readable
--   document-supported ≠ verified;  a candidate ≠ Capital Q's position
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(32);

-- Fixtures ------------------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000007c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Knowledge Co A', 'knowledge-co-a'),
  ('00000000-0000-4000-8000-0000000007c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Knowledge Co B', 'knowledge-co-b');

insert into evidence.sources (id, tenant_id, source_type, subject_type, subject_id, title, created_by_user_id, visibility_scope, sensitivity_class) values
  ('00000000-0000-4000-8000-00000000a7a1', pg_temp.rls_id('tenant_a'), 'DOCUMENT', 'COMPANY', '00000000-0000-4000-8000-0000000007c1', 'Deck A', pg_temp.rls_id('user_a'), 'founder_private', 'RESTRICTED'),
  ('00000000-0000-4000-8000-00000000a7a2', pg_temp.rls_id('tenant_b'), 'DOCUMENT', 'COMPANY', '00000000-0000-4000-8000-0000000007c2', 'Deck B', pg_temp.rls_id('user_b'), 'founder_private', 'CONFIDENTIAL');

insert into evidence.evidence_items (id, tenant_id, source_id, subject_type, subject_id, evidence_type, summary, locator, evidence_status, visibility_scope, sensitivity_class, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000b7b1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000a7a1', 'COMPANY', '00000000-0000-4000-8000-0000000007c1', 'financial.extracted', 'ARR: $2.4m', '{"kind":"statement"}', 'DOCUMENT_SUPPORTED', 'founder_private', 'RESTRICTED', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-00000000b7b2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000a7a2', 'COMPANY', '00000000-0000-4000-8000-0000000007c2', 'financial.extracted', 'ARR: $1.0m', '{"kind":"statement"}', 'DOCUMENT_SUPPORTED', 'founder_private', 'CONFIDENTIAL', pg_temp.rls_id('user_b'));

-- Shape ---------------------------------------------------------------------------
select has_table('q_knowledge', 'objects', 'the knowledge store exists');
select has_table('q_knowledge', 'revisions', 'understandings have an append-only history');
select has_table('q_knowledge', 'object_evidence', 'an understanding records the evidence it rests on');
select has_table('q_knowledge', 'object_sources', 'and the sources behind that evidence');
select has_table('q_knowledge', 'lineage', 'derived understandings record what they came from');
select hasnt_table('q_knowledge', 'memory_items',
  'no long-term memory feature was built here: KNW-002 is knowledge, not memory');

select is((select count(*)::int from pg_policies where schemaname = 'q_knowledge'
            and tablename in ('objects','revisions','object_evidence','object_sources','lineage')), 0,
  'no policy on any knowledge table: server-internal, never browser-reachable');
select is((select bool_and(relrowsecurity) from pg_class
            where oid in ('q_knowledge.objects'::regclass, 'q_knowledge.revisions'::regclass,
                          'q_knowledge.object_evidence'::regclass, 'q_knowledge.object_sources'::regclass,
                          'q_knowledge.lineage'::regclass)), true,
  'RLS is enabled on every knowledge table');

-- A recorded understanding ---------------------------------------------------------
select lives_ok($$
  insert into q_knowledge.objects
    (id, tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     structured_value, truth_class, evidence_status, confidence_class, visibility_scope,
     sensitivity_class, status)
  values ('00000000-0000-4000-8000-00000000d7d1', pg_temp.rls_id('tenant_a'), 'COMPANY',
          '00000000-0000-4000-8000-0000000007c1', 'fact', 'financial.arr',
          'Annual recurring revenue is approximately USD 2.4m.',
          '{"kind":"MONEY","amount":2400000,"currency":"USD"}', 'USER_CLAIM',
          'DOCUMENT_SUPPORTED', 'MODERATE', 'founder_private', 'RESTRICTED', 'ACTIVE')
$$, 'a document-supported understanding is recorded');

-- The three axes stay independent ---------------------------------------------------
select throws_ok($$
  insert into q_knowledge.objects
    (tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     truth_class, evidence_status, confidence_class, visibility_scope, sensitivity_class)
  values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000007c1',
          'fact', 'financial.mrr', 'MRR is 200k.', 'VERIFIED', 'DOCUMENT_SUPPORTED',
          'HIGH', 'founder_private', 'RESTRICTED')
$$, '23514', null,
  'a VERIFIED understanding needs verifying evidence: a document is not verification');

select lives_ok($$
  insert into q_knowledge.objects
    (tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     truth_class, evidence_status, confidence_class, visibility_scope, sensitivity_class)
  values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000007c1',
          'fact', 'financial.mrr', 'MRR is 200k.', 'VERIFIED', 'PLATFORM_VERIFIED',
          'HIGH', 'founder_private', 'RESTRICTED')
$$, 'with platform-verified evidence it is permitted');

select throws_ok($$
  insert into q_knowledge.objects
    (tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     truth_class, evidence_status, confidence_class, visibility_scope, sensitivity_class)
  values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000007c1',
          'inference', 'market.size', 'The market looks large.', 'USER_CLAIM', 'SELF_REPORTED',
          'LOW', 'founder_private', 'CONFIDENTIAL')
$$, '23514', null,
  'an inference cannot be recorded as something the subject asserted');

select throws_ok($$
  insert into q_knowledge.objects
    (tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     truth_class, evidence_status, confidence_class, visibility_scope, sensitivity_class)
  values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000007c1',
          'fact', 'financial.revenue', 'Revenue is 1m.', 'USER_CLAIM', 'DOCUMENT_SUPPORTED',
          '0.92', 'founder_private', 'CONFIDENTIAL')
$$, '23514', null,
  'confidence is a category: there is no column shape a percentage fits');

-- One settled understanding per key --------------------------------------------------
select throws_ok($$
  insert into q_knowledge.objects
    (tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     truth_class, evidence_status, confidence_class, visibility_scope, sensitivity_class, status)
  values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000007c1',
          'fact', 'financial.arr', 'ARR is 9m.', 'USER_CLAIM', 'DOCUMENT_SUPPORTED',
          'MODERATE', 'founder_private', 'RESTRICTED', 'ACTIVE')
$$, '23505', null,
  'two ACTIVE understandings of one key would make "what do we know?" ambiguous');

select lives_ok($$
  insert into q_knowledge.objects
    (id, tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     truth_class, evidence_status, confidence_class, visibility_scope, sensitivity_class,
     status, hold_reason)
  values ('00000000-0000-4000-8000-00000000d7d2', pg_temp.rls_id('tenant_a'), 'COMPANY',
          '00000000-0000-4000-8000-0000000007c1', 'fact', 'financial.arr', 'ARR is 1.9m.',
          'USER_CLAIM', 'DOCUMENT_SUPPORTED', 'CONFLICTING_EVIDENCE', 'founder_private',
          'RESTRICTED', 'CANDIDATE', 'CONFLICTS_WITH_ACTIVE')
$$, 'a conflicting candidate coexists beside the active one; neither is chosen');

select throws_ok($$
  insert into q_knowledge.objects
    (tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     truth_class, evidence_status, confidence_class, visibility_scope, sensitivity_class,
     status, hold_reason)
  values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000007c1',
          'fact', 'team.employee_count', '24 people.', 'USER_CLAIM', 'DOCUMENT_SUPPORTED',
          'MODERATE', 'founder_private', 'RESTRICTED', 'ACTIVE', 'CONFLICTS_WITH_ACTIVE')
$$, '23514', null, 'a settled understanding is not simultaneously held');

-- Provenance is cross-tenant-proof ---------------------------------------------------
select lives_ok($$
  insert into q_knowledge.object_evidence (tenant_id, knowledge_object_id, evidence_item_id, relationship)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000d7d1',
          '00000000-0000-4000-8000-00000000b7b1', 'SUPPORTS')
$$, 'an understanding records the evidence it rests on');

select throws_ok($$
  insert into q_knowledge.object_evidence (tenant_id, knowledge_object_id, evidence_item_id, relationship)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000d7d1',
          '00000000-0000-4000-8000-00000000b7b2', 'SUPPORTS')
$$, '23503', null,
  'another tenant''s evidence cannot support this tenant''s understanding');

select lives_ok($$
  insert into q_knowledge.object_evidence (tenant_id, knowledge_object_id, evidence_item_id, relationship)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000d7d1',
          '00000000-0000-4000-8000-00000000b7b1', 'CONTRADICTS')
$$, 'contradicting evidence is recorded beside supporting evidence, never instead of it');

select throws_ok($$
  insert into q_knowledge.object_sources (tenant_id, knowledge_object_id, source_id)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000d7d1',
          '00000000-0000-4000-8000-00000000a7a2')
$$, '23503', null, 'another tenant''s source cannot stand behind this understanding');

-- Lineage ---------------------------------------------------------------------------
select lives_ok($$
  insert into q_knowledge.lineage (tenant_id, parent_object_id, child_object_id, relationship)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000d7d1',
          '00000000-0000-4000-8000-00000000d7d2', 'reassesses')
$$, 'one understanding may reassess another');

select throws_ok($$
  insert into q_knowledge.lineage (tenant_id, parent_object_id, child_object_id, relationship)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000d7d1',
          '00000000-0000-4000-8000-00000000d7d1', 'derived_from')
$$, '23514', null, 'nothing is derived from itself');

-- History is history -----------------------------------------------------------------
select lives_ok($$
  insert into q_knowledge.revisions
    (id, tenant_id, knowledge_object_id, revision_number, statement, truth_class,
     evidence_status, confidence_class, change_reason, created_by_type)
  values ('00000000-0000-4000-8000-00000000f7f1', pg_temp.rls_id('tenant_a'),
          '00000000-0000-4000-8000-00000000d7d1', 1, 'ARR is 2.4m.', 'USER_CLAIM',
          'DOCUMENT_SUPPORTED', 'MODERATE', 'RECORDED', 'SYSTEM')
$$, 'a revision is recorded');

select throws_ok($$
  update q_knowledge.revisions set statement = 'rewritten'
   where id = '00000000-0000-4000-8000-00000000f7f1'
$$, '23514', null, 'a revision cannot be edited after the fact');

select throws_ok($$
  delete from q_knowledge.revisions where id = '00000000-0000-4000-8000-00000000f7f1'
$$, '23514', null, 'and it cannot be deleted');

select throws_ok($$
  update q_knowledge.objects set knowledge_key = 'financial.mrr'
   where id = '00000000-0000-4000-8000-00000000d7d1'
$$, '23514', null,
  'identity is immutable: changing the key would silently become a different fact');

select throws_ok($$
  update q_knowledge.objects set tenant_id = pg_temp.rls_id('tenant_b')
   where id = '00000000-0000-4000-8000-00000000d7d1'
$$, '23514', null, 'and an understanding cannot be moved to another tenant');

select throws_ok($$
  update q_knowledge.objects set current_revision_number = 0
   where id = '00000000-0000-4000-8000-00000000d7d1'
$$, '23514', null, 'revision numbers never go backwards');

-- No coupling to disclosure or canonical state ----------------------------------------
select hasnt_column('q_knowledge', 'objects', 'data_room_visible',
  'knowledge is not the Data Room: being recorded shares nothing');
select hasnt_column('q_knowledge', 'objects', 'recommendation_eligible',
  'and it does not enter recommendation features by existing');

-- Existing is not readable --------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select statement from q_knowledge.objects $$,
  '42501', null, 'the browser cannot read what Capital Q understands');

select pg_temp.act_as_user_b();
select throws_ok($$ select statement from q_knowledge.objects where tenant_id = pg_temp.rls_id('tenant_a') $$,
  '42501', null, 'and a signed-in user cannot read another tenant''s understanding');

select * from finish();
rollback;
