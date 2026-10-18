-- Migration 20261228141700 · Capital Q's own organisation is a real company:
-- its synthetic-demo attestation is revoked by a new, append-only REVOKED
-- revision, never by an update or a delete. The same revocation shape is
-- exercised here on a fixture organisation (the hosted row exists only in
-- production), and Capital Q's organisation is checked to carry no current
-- synthetic attestation.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes these rows.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(6);

-- A request and its synthetic attestation, as Capital Q's record had them.
insert into evidence.verification_claims
  (id, tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision,
   requested_by_user_id)
values
  ('00000000-0000-4000-8000-000000000cd1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'ORGANISATION', 'ORGANISATION', pg_temp.rls_id('org_a'), 'PENDING', 1, pg_temp.rls_id('user_a'));
insert into evidence.verification_claims
  (id, tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision,
   decides_claim_id, method, provider, decision_basis, decided_by_actor_type, decided_at,
   verified_at, requested_by_user_id)
values
  ('00000000-0000-4000-8000-000000000cd2', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'ORGANISATION', 'ORGANISATION', pg_temp.rls_id('org_a'), 'VERIFIED', 2,
   '00000000-0000-4000-8000-000000000cd1', 'SYNTHETIC_DEMO_ATTESTATION', 'CAPITAL_Q_SYNTHETIC_DEMO',
   'environment staging', 'SYSTEM', now(), now(), pg_temp.rls_id('user_a'));

-- The migration's revocation, row for row.
select lives_ok(
  $$ insert into evidence.verification_claims
       (tenant_id, organisation_id, claim_type, subject_type, subject_id,
        status, revision, decides_claim_id, method, provider, decision_basis,
        decided_by_actor_type, decided_at, revoked_at, revocation_reason,
        requested_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'ORGANISATION',
             'ORGANISATION', pg_temp.rls_id('org_a'), 'REVOKED', 3,
             '00000000-0000-4000-8000-000000000cd2', 'SYNTHETIC_DEMO_ATTESTATION',
             'CAPITAL_Q_SYNTHETIC_DEMO',
             'migration 20261228141700: the synthetic-demo attestation applies only to invented companies; Capital Q is a real company',
             'SYSTEM', now(), now(),
             'Not a synthetic company: the demo attestation misstated its evidence status',
             pg_temp.rls_id('user_a')) $$,
  'the revocation is a valid, fully attributed new revision');
select is(
  (select status from evidence.verification_claims
    where tenant_id = pg_temp.rls_id('tenant_a') and claim_type = 'ORGANISATION'
      and subject_id = pg_temp.rls_id('org_a')
    order by revision desc limit 1),
  'REVOKED', 'the revocation is the current standing: no verified badge');
select is(
  (select status from evidence.verification_claims
    where id = '00000000-0000-4000-8000-000000000cd2'),
  'VERIFIED', 'the attestation it ends is kept, unchanged: history is never overwritten');
select is(
  (select count(*)::int from evidence.verification_claims
    where tenant_id = pg_temp.rls_id('tenant_a') and subject_id = pg_temp.rls_id('org_a')),
  3, 'request, attestation and revocation all remain');
select throws_ok(
  $$ delete from evidence.verification_claims where id = '00000000-0000-4000-8000-000000000cd2' $$,
  '23001', null, 'the attestation cannot be deleted instead of revoked');

-- Capital Q's own organisation carries no current synthetic attestation.
select is(
  (select count(*)::int from (
     select distinct on (tenant_id) status, method
       from evidence.verification_claims
      where claim_type = 'ORGANISATION'
        and subject_id = 'f95c3469-ef29-4574-a508-c1ba1131d842'
      order by tenant_id, revision desc) current_standing
    where status = 'VERIFIED' and method = 'SYNTHETIC_DEMO_ATTESTATION'),
  0, 'Capital Q is never shown as a synthetic demo verification');

select * from finish();
rollback;
