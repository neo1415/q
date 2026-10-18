-- ADMIN-4 · core.identity_submissions.
--
-- A person reads only their own identity details, and only while an active
-- member of the organisation. Never another tenant's rows, never after a
-- membership is revoked, never anonymously. No client writes. Rows are
-- decided once, never by the person themselves, and never deleted.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(13);

-- Fixtures (server role) ------------------------------------------------------
insert into evidence.verification_claims (id, tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision, requested_by_user_id) values
  ('00000000-0000-4000-8000-00000000fa01', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'FOUNDER_IDENTITY', 'PERSON', pg_temp.rls_id('user_a'), 'PENDING', 1, pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-00000000fb01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'FOUNDER_IDENTITY', 'PERSON', pg_temp.rls_id('user_b'), 'PENDING', 1, pg_temp.rls_id('user_b')),
  ('00000000-0000-4000-8000-00000000fc01', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'FOUNDER_IDENTITY', 'PERSON', pg_temp.rls_id('user_r'), 'PENDING', 1, pg_temp.rls_id('user_r'));

insert into core.identity_submissions (id, tenant_id, organisation_id, user_id, name_on_id, role, claim_id, idempotency_key) values
  ('00000000-0000-4000-8000-00000000fd01', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'Ada Example', 'Founder & CEO', '00000000-0000-4000-8000-00000000fa01', 'id-a-00001'),
  ('00000000-0000-4000-8000-00000000fd02', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), pg_temp.rls_id('user_b'), 'Bo Example', 'Partner', '00000000-0000-4000-8000-00000000fb01', 'id-b-00001'),
  ('00000000-0000-4000-8000-00000000fd03', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), pg_temp.rls_id('user_r'), 'Ri Example', 'Founder', '00000000-0000-4000-8000-00000000fc01', 'id-r-00001');

-- Invariants (server role) ---------------------------------------------------------
select throws_ok(
  $$insert into core.identity_submissions (tenant_id, organisation_id, user_id, name_on_id, role, claim_id, idempotency_key)
    values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'Ada Example', 'CEO', '00000000-0000-4000-8000-00000000fa01', 'id-a-00002')$$,
  '23505', null, 'one open identity submission per person and organisation');
select throws_ok(
  $$insert into core.identity_submissions (tenant_id, organisation_id, user_id, name_on_id, role, claim_id, idempotency_key,
                                          status, decision_reason, decided_by_user_id, decided_at)
    values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), pg_temp.rls_id('user_b'), 'X', 'Y', '00000000-0000-4000-8000-00000000fa01', 'id-b-cross',
            'REJECTED', 'cross', pg_temp.rls_id('user_a'), now())$$,
  '23503', null, 'a submission cannot point at another tenant''s claim');
select throws_ok(
  $$update core.identity_submissions set status = 'APPROVED', decision_reason = 'Looks right',
           decided_by_user_id = pg_temp.rls_id('user_a'), decided_at = now()
     where id = '00000000-0000-4000-8000-00000000fd01'$$,
  '23514', null, 'nobody decides their own identity');
select throws_ok(
  $$delete from core.identity_submissions where id = '00000000-0000-4000-8000-00000000fd02'$$,
  '23001', null, 'a submission is never deleted');
select lives_ok(
  $$update core.identity_submissions set status = 'REJECTED', decision_reason = 'Name does not match the ID',
           decided_by_user_id = pg_temp.rls_id('user_a'), decided_at = now()
     where id = '00000000-0000-4000-8000-00000000fd02'$$,
  'an operator decides a submission once');
select throws_ok(
  $$update core.identity_submissions set status = 'APPROVED', decision_reason = 'Changed my mind'
     where id = '00000000-0000-4000-8000-00000000fd02'$$,
  '23001', null, 'a decision is never rewritten');

select is(has_table_privilege('authenticated', 'core.identity_submissions', 'update'), false,
  'no client update grant');

-- Member of tenant A ------------------------------------------------------------------
select pg_temp.act_as('auth_a');
select is((select array_agg(id::text) from core.identity_submissions),
  array['00000000-0000-4000-8000-00000000fd01'], 'A reads only their own identity details');
select is((select count(*)::int from core.identity_submissions where tenant_id = pg_temp.rls_id('tenant_b')), 0,
  'A cannot read B''s identity details (cross-tenant)');
select throws_ok($$insert into core.identity_submissions (tenant_id, organisation_id, user_id, name_on_id, role, claim_id, idempotency_key)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'Ada', 'CEO', '00000000-0000-4000-8000-00000000fa01', 'client-0001')$$,
  '42501', null, 'A cannot write identity details directly');

-- Member of tenant B ------------------------------------------------------------------
select pg_temp.act_as('auth_b');
select is((select array_agg(id::text) from core.identity_submissions),
  array['00000000-0000-4000-8000-00000000fd02'], 'B reads their own decided submission');

-- Revoked member --------------------------------------------------------------------
select pg_temp.act_as('auth_r');
select is((select count(*)::int from core.identity_submissions), 0,
  'a revoked member no longer reads their identity details');

-- Anonymous ----------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$select count(*) from core.identity_submissions$$, '42501', null, 'anonymous reads nothing');

select * from finish();
rollback;
