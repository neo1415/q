-- ADMIN-3 · core.human_reviews and core.kyb_submissions.
--
-- A person reads only their own review cases, and only while an active
-- member of the tenant; an organisation's active members read only its KYB
-- submissions. Never another tenant's rows, never after a membership is
-- revoked, never anonymously. No client writes. Rows are decided once and
-- never deleted.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(22);

-- Fixtures (server role) ------------------------------------------------------
insert into core.human_reviews (id, tenant_id, organisation_id, requester_user_id, subject_type, subject_ref, reason, due_at, idempotency_key) values
  ('00000000-0000-4000-8000-00000000ca01', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'),
   'VERIFICATION_DECISION', 'verification_claim:x', 'Please look at my verification again', now() + interval '3 days', 'review-a-0001'),
  ('00000000-0000-4000-8000-00000000cb01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), pg_temp.rls_id('user_b'),
   'ACCOUNT_ACTION', null, 'My account was paused by mistake', now() + interval '3 days', 'review-b-0001'),
  ('00000000-0000-4000-8000-00000000cc01', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), pg_temp.rls_id('user_r'),
   'OTHER', null, 'A review from before I left', now() + interval '3 days', 'review-r-0001');

insert into evidence.verification_claims (id, tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision, requested_by_user_id) values
  ('00000000-0000-4000-8000-00000000da01', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'ORGANISATION', 'ORGANISATION', pg_temp.rls_id('org_a'), 'PENDING', 1, pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-00000000db01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'ORGANISATION', 'ORGANISATION', pg_temp.rls_id('org_b'), 'PENDING', 1, pg_temp.rls_id('user_b')),
  ('00000000-0000-4000-8000-00000000dc01', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'ORGANISATION', 'ORGANISATION', pg_temp.rls_id('org_r'), 'PENDING', 1, pg_temp.rls_id('user_r'));

insert into core.kyb_submissions (id, tenant_id, organisation_id, submitted_by_user_id, legal_name, registration_number, jurisdiction_code, claim_id, idempotency_key) values
  ('00000000-0000-4000-8000-00000000ea01', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'Org A Ltd', 'RC 1', 'NG', '00000000-0000-4000-8000-00000000da01', 'kyb-a-0001'),
  ('00000000-0000-4000-8000-00000000eb01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), pg_temp.rls_id('user_b'), 'Org B LLP', 'RC 2', 'GB', '00000000-0000-4000-8000-00000000db01', 'kyb-b-0001'),
  ('00000000-0000-4000-8000-00000000ec01', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), pg_temp.rls_id('user_r'), 'Org R Inc', 'RC 3', 'US', '00000000-0000-4000-8000-00000000dc01', 'kyb-r-0001');

-- Shape --------------------------------------------------------------------------
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'core.human_reviews'::regclass, 'core.kyb_submissions'::regclass)), true,
  'row level security is on for both tables');
select ok(not has_table_privilege('authenticated', 'core.human_reviews', 'insert')
      and not has_table_privilege('authenticated', 'core.human_reviews', 'update')
      and not has_table_privilege('authenticated', 'core.kyb_submissions', 'insert')
      and not has_table_privilege('authenticated', 'core.kyb_submissions', 'update'),
  'no client role may write a case or a submission');
select ok(not has_table_privilege('anon', 'core.human_reviews', 'select')
      and not has_table_privilege('anon', 'core.kyb_submissions', 'select'),
  'the anonymous role has no grant');
select ok(not has_function_privilege('authenticated', 'private.decide_once_guard()', 'execute'),
  'the decide-once guard is not callable by clients');

-- Invariants (server role) ---------------------------------------------------------
select throws_ok(
  $$insert into core.kyb_submissions (tenant_id, organisation_id, submitted_by_user_id, legal_name, registration_number, jurisdiction_code, claim_id, idempotency_key)
    values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'Org A Ltd', 'RC 1', 'NG', '00000000-0000-4000-8000-00000000da01', 'kyb-a-0002')$$,
  '23505', null, 'one open submission per organisation');
select throws_ok(
  $$insert into core.kyb_submissions (tenant_id, organisation_id, submitted_by_user_id, legal_name, registration_number, jurisdiction_code, claim_id, idempotency_key,
                                     status, decision_reason, decided_by_user_id, decided_at)
    values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), pg_temp.rls_id('user_b'), 'X', 'Y', 'NG', '00000000-0000-4000-8000-00000000da01', 'kyb-b-cross',
            'REJECTED', 'cross', pg_temp.rls_id('user_a'), now())$$,
  '23503', null, 'a submission cannot point at another tenant''s claim');
select throws_ok(
  $$update core.human_reviews set status = 'DECIDED', outcome = 'UPHELD', decision_reason = 'self',
           decided_by_user_id = requester_user_id, decided_at = now()
     where id = '00000000-0000-4000-8000-00000000ca01'$$,
  '23514', null, 'nobody decides their own review');
select lives_ok(
  $$update core.human_reviews set status = 'DECIDED', outcome = 'NEEDS_EVIDENCE', decision_reason = 'Add the registry extract',
           decided_by_user_id = pg_temp.rls_id('user_b'), decided_at = now()
     where id = '00000000-0000-4000-8000-00000000ca01'$$,
  'an operator decides a review once');
select throws_ok(
  $$update core.human_reviews set outcome = 'CHANGED' where id = '00000000-0000-4000-8000-00000000ca01'$$,
  '23001', null, 'a decided review is never decided again');
select throws_ok(
  $$update core.human_reviews set reason = 'rewritten' where id = '00000000-0000-4000-8000-00000000cb01'$$,
  '23001', null, 'the person''s words are never rewritten');
select throws_ok(
  $$delete from core.kyb_submissions where id = '00000000-0000-4000-8000-00000000eb01'$$,
  '23001', null, 'a submission is never deleted');
select lives_ok(
  $$update core.kyb_submissions set status = 'REJECTED', decision_reason = 'Registry shows no match',
           decided_by_user_id = pg_temp.rls_id('user_a'), decided_at = now()
     where id = '00000000-0000-4000-8000-00000000eb01'$$,
  'an operator decides a submission once');

-- Member of tenant A ------------------------------------------------------------------
select pg_temp.act_as('auth_a');
select is((select array_agg(id::text) from core.human_reviews),
  array['00000000-0000-4000-8000-00000000ca01'], 'A reads only their own review case');
select is((select array_agg(id::text) from core.kyb_submissions),
  array['00000000-0000-4000-8000-00000000ea01'], 'A reads only their organisation''s submission');
select is((select count(*)::int from core.human_reviews where tenant_id = pg_temp.rls_id('tenant_b')), 0,
  'A cannot read B''s case (cross-tenant)');
select throws_ok($$insert into core.human_reviews (tenant_id, requester_user_id, subject_type, reason, due_at, idempotency_key)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'OTHER', 'client write attempt', now() + interval '1 day', 'client-0001')$$,
  '42501', null, 'A cannot create a case directly');

-- Member of tenant B ------------------------------------------------------------------
select pg_temp.act_as('auth_b');
select is((select count(*)::int from core.kyb_submissions where organisation_id = pg_temp.rls_id('org_a')), 0,
  'B cannot read A''s submission (cross-tenant)');
select is((select array_agg(id::text) from core.kyb_submissions),
  array['00000000-0000-4000-8000-00000000eb01'], 'B reads its own decided submission');

-- Revoked member --------------------------------------------------------------------
select pg_temp.act_as('auth_r');
select is((select count(*)::int from core.human_reviews), 0,
  'a revoked member no longer reads their earlier case');
select is((select count(*)::int from core.kyb_submissions), 0,
  'a revoked member no longer reads the organisation''s submission');

-- Anonymous ----------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$select count(*) from core.human_reviews$$, '42501', null, 'anonymous reads no case');
select throws_ok($$select count(*) from core.kyb_submissions$$, '42501', null, 'anonymous reads no submission');

select * from finish();
rollback;
