-- CQ-VERIFY-001 · Verification claims: append-only history, provenance that
-- follows the method, tenancy, and the fact that no browser reaches a row.
--
--   Verification ≠ Evidence ≠ Endorsement ≠ Q inference
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(16);

-- Fixtures: a pending founder-identity request and a pending organisation
-- request in tenant A, one pending organisation request in tenant B.
insert into evidence.verification_claims
  (id, tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision, requested_by_user_id)
values
  ('00000000-0000-4000-8000-000000000ac1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'FOUNDER_IDENTITY', 'PERSON', pg_temp.rls_id('user_a'), 'PENDING', 1, pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-000000000ac2', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'ORGANISATION', 'ORGANISATION', pg_temp.rls_id('org_a'), 'PENDING', 1, pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-000000000bc1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'),
   'ORGANISATION', 'ORGANISATION', pg_temp.rls_id('org_b'), 'PENDING', 1, pg_temp.rls_id('user_b'));

-- A decision is a new row naming the request ------------------------------------------
select lives_ok(
  $$ insert into evidence.verification_claims
       (tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision,
        decides_claim_id, method, provider, decision_basis, decided_by_actor_type, decided_at,
        verified_at, requested_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'ORGANISATION', 'ORGANISATION',
             pg_temp.rls_id('org_a'), 'VERIFIED', 2, '00000000-0000-4000-8000-000000000ac2',
             'SYNTHETIC_DEMO_ATTESTATION', 'CAPITAL_Q_SYNTHETIC_DEMO',
             'operator opted in; environment local; database host 127.0.0.1', 'SYSTEM', now(), now(),
             pg_temp.rls_id('user_a')) $$,
  'a synthetic attestation decision is a new, fully attributed row');
select is(
  (select status from evidence.verification_claims
    where tenant_id = pg_temp.rls_id('tenant_a') and claim_type = 'ORGANISATION'
    order by revision desc limit 1),
  'VERIFIED', 'the highest revision is the current standing');
select is(
  (select count(*)::int from evidence.verification_claims
    where tenant_id = pg_temp.rls_id('tenant_a') and claim_type = 'ORGANISATION'),
  2, 'the request is still there: deciding never overwrites history');

-- Append-only ---------------------------------------------------------------------------
select throws_ok(
  $$ update evidence.verification_claims set status = 'VERIFIED'
      where id = '00000000-0000-4000-8000-000000000ac1' $$,
  '23001', null, 'a claim row cannot be updated into a standing');
select throws_ok(
  $$ delete from evidence.verification_claims where id = '00000000-0000-4000-8000-000000000ac1' $$,
  '23001', null, 'a claim row cannot be deleted');

-- Provenance follows the status and the method ------------------------------------------
select throws_ok(
  $$ insert into evidence.verification_claims
       (tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision, requested_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'FOUNDER_IDENTITY', 'PERSON',
             pg_temp.rls_id('user_a'), 'VERIFIED', 2, pg_temp.rls_id('user_a')) $$,
  '23514', null, 'a VERIFIED row without a method, provider and basis is refused');
select throws_ok(
  $$ insert into evidence.verification_claims
       (tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision,
        method, provider, decision_basis, decided_by_actor_type, decided_at, verified_at, requested_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'FOUNDER_IDENTITY', 'PERSON',
             pg_temp.rls_id('user_a'), 'VERIFIED', 2, 'SYNTHETIC_DEMO_ATTESTATION', 'CAPITAL_Q_OPERATOR',
             'basis', 'SYSTEM', now(), now(), pg_temp.rls_id('user_a')) $$,
  '23514', null, 'the method and the provider must name the same party');
select throws_ok(
  $$ insert into evidence.verification_claims
       (tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision,
        method, provider, decision_basis, decided_by_actor_type, decided_at, verified_at, requested_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'FOUNDER_IDENTITY', 'PERSON',
             pg_temp.rls_id('user_a'), 'VERIFIED', 2, 'SYNTHETIC_DEMO_ATTESTATION', 'CAPITAL_Q_SYNTHETIC_DEMO',
             'basis', 'HUMAN', now(), now(), pg_temp.rls_id('user_a')) $$,
  '23514', null, 'a synthetic attestation is the system deciding, never a person');
select throws_ok(
  $$ insert into evidence.verification_claims
       (tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision, requested_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'FOUNDER_IDENTITY', 'ORGANISATION',
             pg_temp.rls_id('org_a'), 'PENDING', 2, pg_temp.rls_id('user_a')) $$,
  '23514', null, 'the subject type follows the claim type');

-- Revisions cannot collide ---------------------------------------------------------------
select throws_ok(
  $$ insert into evidence.verification_claims
       (tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision, requested_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'FOUNDER_IDENTITY', 'PERSON',
             pg_temp.rls_id('user_a'), 'PENDING', 1, pg_temp.rls_id('user_a')) $$,
  '23505', null, 'two writers cannot both claim the same revision');

-- Tenancy ----------------------------------------------------------------------------------
select throws_ok(
  $$ insert into evidence.verification_claims
       (tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision, requested_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_b'), 'ORGANISATION', 'ORGANISATION',
             pg_temp.rls_id('org_b'), 'PENDING', 1, pg_temp.rls_id('user_a')) $$,
  '23503', null, 'a claim cannot name an organisation outside its tenant');

-- Browser principals ------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from evidence.verification_claims $$,
  '42501', null, 'anonymous cannot read verification claims');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from evidence.verification_claims $$,
  '42501', null, 'an authenticated browser session cannot read claims, even its own organisation''s');
select throws_ok(
  $$ insert into evidence.verification_claims
       (tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision, requested_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'FOUNDER_IDENTITY', 'PERSON',
             pg_temp.rls_id('user_a'), 'PENDING', 9, pg_temp.rls_id('user_a')) $$,
  '42501', null, 'a browser cannot write a claim, not even a request');

select pg_temp.act_as_revoked_user();
select throws_ok($$ select count(*) from evidence.verification_claims $$,
  '42501', null, 'a revoked member''s session reads nothing');

select pg_temp.act_as_privileged();
select is((select count(*)::int from evidence.verification_claims
            where tenant_id in (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('tenant_b'))),
  4, 'the privileged server role reads every claim; DB privilege is not business authorisation');

select * from finish();
rollback;
