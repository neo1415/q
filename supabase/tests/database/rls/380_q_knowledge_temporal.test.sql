-- CQ-KNW-003 · time and disagreement in the knowledge store.
--
--   historical ≠ false;  old ≠ wrong;  corrected ≠ fraudulent
--   different ≠ contradictory;  disputed ≠ rejected;  superseded ≠ deleted
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(31);

-- Fixtures ------------------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000008c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Temporal Co A', 'temporal-co-a'),
  ('00000000-0000-4000-8000-0000000008c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Temporal Co B', 'temporal-co-b');

insert into q_knowledge.objects
  (id, tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
   truth_class, evidence_status, confidence_class, visibility_scope, sensitivity_class, status)
values ('00000000-0000-4000-8000-00000000e8e3', pg_temp.rls_id('tenant_b'), 'COMPANY',
        '00000000-0000-4000-8000-0000000008c2', 'fact', 'financial.arr', 'ARR is USD 1m.',
        'USER_CLAIM', 'DOCUMENT_SUPPORTED', 'MODERATE', 'founder_private', 'CONFIDENTIAL', 'ACTIVE');

-- Shape ---------------------------------------------------------------------------
select has_table('q_knowledge', 'contradiction_sets', 'disagreement has somewhere durable to live');
select has_table('q_knowledge', 'contradiction_members', 'and records which understandings disagree');
select has_column('q_knowledge', 'objects', 'definition_qualifier',
  'a metric can be measured more than one defensible way');
select has_column('q_knowledge', 'objects', 'measurement_basis',
  'a forecast is not a competing measurement');
select has_column('q_knowledge', 'objects', 'last_verified_at',
  'freshness is checked against a source, not against the clock alone');
select has_column('q_knowledge', 'revisions', 'correction_of_revision_id',
  'a correction points at what it corrected, and both survive');

select is((select count(*)::int from pg_policies where schemaname = 'q_knowledge'
            and tablename in ('contradiction_sets','contradiction_members')), 0,
  'no policy on either contradiction table: server-internal, never browser-reachable');
select is((select bool_and(relrowsecurity) from pg_class
            where oid in ('q_knowledge.contradiction_sets'::regclass,
                          'q_knowledge.contradiction_members'::regclass)), true,
  'RLS is enabled on both');

select hasnt_index('q_knowledge', 'objects', 'objects_one_active_per_key_idx',
  '"current" is no longer a status: one ACTIVE row per key would forbid a history');
select has_index('q_knowledge', 'objects', 'objects_one_active_per_period_idx',
  'the constraint moved down to the period, where a real contradiction lives');

-- A metric with a history ------------------------------------------------------------
select lives_ok($$
  insert into q_knowledge.objects
    (id, tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     structured_value, truth_class, evidence_status, confidence_class, visibility_scope,
     sensitivity_class, valid_from, valid_to, status)
  values ('00000000-0000-4000-8000-00000000e8e1', pg_temp.rls_id('tenant_a'), 'COMPANY',
          '00000000-0000-4000-8000-0000000008c1', 'fact', 'financial.arr',
          'ARR was USD 1.8m in January.', '{"kind":"MONEY","amount":1800000,"currency":"USD"}',
          'USER_CLAIM', 'DOCUMENT_SUPPORTED', 'MODERATE', 'founder_private', 'RESTRICTED',
          '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', 'ACTIVE')
$$, 'January ARR is recorded');

select lives_ok($$
  insert into q_knowledge.objects
    (id, tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     structured_value, truth_class, evidence_status, confidence_class, visibility_scope,
     sensitivity_class, valid_from, valid_to, status)
  values ('00000000-0000-4000-8000-00000000e8e2', pg_temp.rls_id('tenant_a'), 'COMPANY',
          '00000000-0000-4000-8000-0000000008c1', 'fact', 'financial.arr',
          'ARR was USD 2.4m in August.', '{"kind":"MONEY","amount":2400000,"currency":"USD"}',
          'USER_CLAIM', 'DOCUMENT_SUPPORTED', 'MODERATE', 'founder_private', 'RESTRICTED',
          '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', 'ACTIVE')
$$, 'August ARR stands beside it: a company''s own growth is not a discrepancy');

select lives_ok($$
  insert into q_knowledge.objects
    (tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     truth_class, evidence_status, confidence_class, visibility_scope, sensitivity_class,
     definition_qualifier, valid_from, valid_to, status)
  values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000008c1',
          'fact', 'financial.arr', 'ARR net of churn was USD 1.6m in January.',
          'USER_CLAIM', 'DOCUMENT_SUPPORTED', 'MODERATE', 'founder_private', 'RESTRICTED',
          'net_of_churn', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', 'ACTIVE')
$$, 'the same period under a different definition is an accepted difference');

select lives_ok($$
  insert into q_knowledge.objects
    (tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     truth_class, evidence_status, confidence_class, visibility_scope, sensitivity_class,
     measurement_basis, valid_from, valid_to, status)
  values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000008c1',
          'fact', 'financial.arr', 'ARR is forecast at USD 4m for January.',
          'ESTIMATE', 'SELF_REPORTED', 'LOW', 'founder_private', 'RESTRICTED',
          'FORECAST', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', 'ACTIVE')
$$, 'a projection sits beside the measurement it projects');

select throws_ok($$
  insert into q_knowledge.objects
    (tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     truth_class, evidence_status, confidence_class, visibility_scope, sensitivity_class,
     valid_from, valid_to, status)
  values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000008c1',
          'fact', 'financial.arr', 'ARR was USD 9m in January.',
          'USER_CLAIM', 'DOCUMENT_SUPPORTED', 'MODERATE', 'founder_private', 'RESTRICTED',
          '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', 'ACTIVE')
$$, '23505', null,
  'but two settled answers to the same question about the same period is a contradiction, and is held rather than stored');

select throws_ok($$
  insert into q_knowledge.objects
    (tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     truth_class, evidence_status, confidence_class, visibility_scope, sensitivity_class,
     measurement_basis)
  values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000008c1',
          'fact', 'financial.mrr', 'MRR is 200k.', 'USER_CLAIM', 'DOCUMENT_SUPPORTED',
          'MODERATE', 'founder_private', 'RESTRICTED', 'GUESS')
$$, '23514', null, 'a measurement basis is one of four named things, not free text');

select throws_ok($$
  insert into q_knowledge.objects
    (tenant_id, subject_type, subject_id, knowledge_type, knowledge_key, statement,
     truth_class, evidence_status, confidence_class, visibility_scope, sensitivity_class,
     definition_qualifier)
  values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000008c1',
          'fact', 'financial.mrr', 'MRR is 200k.', 'USER_CLAIM', 'DOCUMENT_SUPPORTED',
          'MODERATE', 'founder_private', 'RESTRICTED',
          'ARR as the founder explained it on the call')
$$, '23514', null, 'a definition qualifier is a code, not prose a document could write');

-- Recorded disagreement ---------------------------------------------------------------
select lives_ok($$
  insert into q_knowledge.contradiction_sets
    (id, tenant_id, subject_type, subject_id, knowledge_key, measurement_basis,
     contested_from, conflict_kind, visibility_scope, sensitivity_class)
  values ('00000000-0000-4000-8000-0000000091a1', pg_temp.rls_id('tenant_a'), 'COMPANY',
          '00000000-0000-4000-8000-0000000008c1', 'financial.arr', 'ACTUAL',
          '2026-08-01T00:00:00Z', 'VALUE_MISMATCH', 'founder_private', 'RESTRICTED')
$$, 'a disagreement is opened');

select is((select materiality from q_knowledge.contradiction_sets
            where id = '00000000-0000-4000-8000-0000000091a1'), 'UNDETERMINED',
  'materiality defaults to UNDETERMINED: no calibrated threshold was invented');

select throws_ok($$
  insert into q_knowledge.contradiction_sets
    (tenant_id, subject_type, subject_id, knowledge_key, measurement_basis,
     contested_from, conflict_kind, visibility_scope, sensitivity_class)
  values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000008c1',
          'financial.arr', 'ACTUAL', '2026-08-01T00:00:00Z', 'VALUE_MISMATCH',
          'founder_private', 'RESTRICTED')
$$, '23505', null,
  'a second challenger joins the argument rather than starting a parallel one');

select throws_ok($$
  insert into q_knowledge.contradiction_sets
    (tenant_id, subject_type, subject_id, knowledge_key, measurement_basis,
     conflict_kind, visibility_scope, sensitivity_class, status, resolved_at)
  values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000008c1',
          'financial.mrr', 'ACTUAL', 'VALUE_MISMATCH', 'founder_private', 'RESTRICTED',
          'OPEN', now())
$$, '23514', null, 'an open disagreement has not been settled');

select lives_ok($$
  insert into q_knowledge.contradiction_members
    (tenant_id, contradiction_set_id, knowledge_object_id, role)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000091a1',
          '00000000-0000-4000-8000-00000000e8e1', 'INCUMBENT'),
         (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000091a1',
          '00000000-0000-4000-8000-00000000e8e2', 'CHALLENGER')
$$, 'both sides are recorded, and neither is chosen');

select throws_ok($$
  insert into q_knowledge.contradiction_members
    (tenant_id, contradiction_set_id, knowledge_object_id, role)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000091a1',
          '00000000-0000-4000-8000-00000000e8e3', 'CHALLENGER')
$$, '23503', null,
  'another tenant''s understanding cannot be dragged into this disagreement');

select throws_ok($$
  update q_knowledge.contradiction_sets set knowledge_key = 'financial.mrr'
   where id = '00000000-0000-4000-8000-0000000091a1'
$$, '23514', null,
  'a disagreement''s identity is immutable: what is contested cannot be edited afterwards');

select lives_ok($$
  update q_knowledge.contradiction_sets
     set status = 'RESOLVED', resolution_reason = 'FOUNDER_CONFIRMED', resolved_at = now()
   where id = '00000000-0000-4000-8000-0000000091a1'
$$, 'a person settles it');

select is((select count(*)::int from q_knowledge.contradiction_members
            where contradiction_set_id = '00000000-0000-4000-8000-0000000091a1'), 2,
  'and every member survives the decision');

select throws_ok($$
  update q_knowledge.contradiction_sets set status = 'OPEN', resolved_at = null
   where id = '00000000-0000-4000-8000-0000000091a1'
$$, '23514', null, 'a settled disagreement is not reopened by editing it');

-- Corrections ---------------------------------------------------------------------------
select lives_ok($$
  insert into q_knowledge.revisions
    (id, tenant_id, knowledge_object_id, revision_number, statement, truth_class,
     evidence_status, confidence_class, change_reason, created_by_type)
  values ('00000000-0000-4000-8000-0000000092a1', pg_temp.rls_id('tenant_a'),
          '00000000-0000-4000-8000-00000000e8e1', 1, 'ARR was USD 1.8m in January.',
          'USER_CLAIM', 'DOCUMENT_SUPPORTED', 'MODERATE', 'RECORDED', 'SYSTEM')
$$, 'the original reading is recorded');

select lives_ok($$
  insert into q_knowledge.revisions
    (tenant_id, knowledge_object_id, revision_number, statement, truth_class,
     evidence_status, confidence_class, change_reason, created_by_type,
     correction_of_revision_id)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000e8e1', 2,
          'ARR was USD 1.75m in January.', 'USER_CLAIM', 'DOCUMENT_SUPPORTED', 'MODERATE',
          'CORRECTION', 'USER', '00000000-0000-4000-8000-0000000092a1')
$$, 'and the correction points at it, rather than replacing it');

select is((select count(*)::int from q_knowledge.revisions
            where knowledge_object_id = '00000000-0000-4000-8000-00000000e8e1'), 2,
  'both survive: a corrected typo is not a deletion');

select throws_ok($$
  delete from q_knowledge.revisions
   where id = '00000000-0000-4000-8000-0000000092a1'
$$, '23514', null, 'and the corrected reading cannot be removed afterwards');

select * from finish();
rollback;
