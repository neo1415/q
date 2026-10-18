-- ADR 0038 · INVESTOR_IDENTITY and the fix-forward reclassification.
--
-- An investor's person is verified under INVESTOR_IDENTITY; FOUNDER_IDENTITY
-- stays for founders. Existing investor-side FOUNDER_IDENTITY rows are
-- re-created under the new type with their whole history -- the originals are
-- never changed -- and each move is recorded. Running it twice moves nothing.
-- The record is server-only: no client reads it, in any tenant.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(14);

-- org_b is an investor organisation; org_a stays a plain (founder-side) one.
insert into core.investor_organisations (tenant_id, organisation_id, investor_type, display_name)
values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Zino Capital');

insert into evidence.verification_claims (id, tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision, requested_by_user_id, created_at) values
  ('00000000-0000-4000-8000-0000000c0b01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'FOUNDER_IDENTITY', 'PERSON', pg_temp.rls_id('user_b'), 'PENDING', 1, pg_temp.rls_id('user_b'), now() - interval '2 days'),
  ('00000000-0000-4000-8000-0000000c0a01', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'FOUNDER_IDENTITY', 'PERSON', pg_temp.rls_id('user_a'), 'PENDING', 1, pg_temp.rls_id('user_a'), now() - interval '2 days');
insert into evidence.verification_claims (id, tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision, decides_claim_id,
                                          method, provider, decision_basis, decided_by_actor_type, decided_by_user_id, decided_at,
                                          requested_by_user_id, revoked_at, revocation_reason, created_at) values
  ('00000000-0000-4000-8000-0000000c0b02', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'FOUNDER_IDENTITY', 'PERSON', pg_temp.rls_id('user_b'), 'REVOKED', 2,
   '00000000-0000-4000-8000-0000000c0b01', 'OPERATOR_DECISION', 'CAPITAL_Q_OPERATOR', 'Name differs from ID', 'HUMAN', pg_temp.rls_id('user_a'), now() - interval '1 day',
   pg_temp.rls_id('user_b'), now() - interval '1 day', 'Name differs from ID', now() - interval '1 day');

-- The type itself --------------------------------------------------------------------
select lives_ok(
  $$insert into evidence.verification_claims (tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision, requested_by_user_id)
    values (pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'INVESTOR_IDENTITY', 'PERSON', pg_temp.rls_id('user_r'), 'PENDING', 1, pg_temp.rls_id('user_r'))$$,
  'INVESTOR_IDENTITY is a person claim');
select throws_ok(
  $$insert into evidence.verification_claims (tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision, requested_by_user_id)
    values (pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'INVESTOR_IDENTITY', 'ORGANISATION', pg_temp.rls_id('org_r'), 'PENDING', 1, pg_temp.rls_id('user_r'))$$,
  '23514', null, 'INVESTOR_IDENTITY never names an organisation');
select throws_ok(
  $$insert into evidence.verification_claims (tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision, requested_by_user_id)
    values (pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'PARTNER_IDENTITY', 'PERSON', pg_temp.rls_id('user_r'), 'PENDING', 1, pg_temp.rls_id('user_r'))$$,
  '23514', null, 'an unknown claim type is still refused');

-- The move ----------------------------------------------------------------------------
select is(private.reclassify_investor_identity_claims(), 2, 'both investor-side revisions are re-created');
select is(private.reclassify_investor_identity_claims(), 0, 'running it again moves nothing');

select results_eq(
  $$select claim_type, status, revision, revocation_reason, decided_by_user_id
      from evidence.verification_claims
     where organisation_id = pg_temp.rls_id('org_b') order by claim_type, revision$$,
  $$values ('FOUNDER_IDENTITY', 'PENDING', 1, null::text, null::uuid),
           ('FOUNDER_IDENTITY', 'REVOKED', 2, 'Name differs from ID', pg_temp.rls_id('user_a')),
           ('INVESTOR_IDENTITY', 'PENDING', 1, null::text, null::uuid),
           ('INVESTOR_IDENTITY', 'REVOKED', 2, 'Name differs from ID', pg_temp.rls_id('user_a'))$$,
  'the history is kept beside the original rows, decision and decider included');
select is(
  (select n.decides_claim_id from evidence.verification_claims n
    where n.organisation_id = pg_temp.rls_id('org_b') and n.claim_type = 'INVESTOR_IDENTITY' and n.revision = 2),
  (select r.to_claim_id from evidence.verification_claim_reclassifications r
    where r.from_claim_id = '00000000-0000-4000-8000-0000000c0b01'),
  'the moved decision points at the moved request');
select is(
  (select count(*)::int from evidence.verification_claim_reclassifications
    where from_claim_id in ('00000000-0000-4000-8000-0000000c0b01', '00000000-0000-4000-8000-0000000c0b02')),
  2, 'every move is recorded');
select is(
  (select count(*)::int from evidence.verification_claims
    where organisation_id = pg_temp.rls_id('org_a') and claim_type = 'INVESTOR_IDENTITY'),
  0, 'a founder-side claim is never moved');
select throws_ok(
  $$update evidence.verification_claim_reclassifications set reason = 'rewritten'$$,
  '23001', null, 'the record is never rewritten');
select throws_ok(
  $$delete from evidence.verification_claims where id = '00000000-0000-4000-8000-0000000c0b02'$$,
  '23001', null, 'the original decided row is never deleted');

-- Clients -----------------------------------------------------------------------------
select pg_temp.act_as('auth_b');
select throws_ok($$select count(*) from evidence.verification_claim_reclassifications$$,
  '42501', null, 'an investor member cannot read the record of their own moves');
select pg_temp.act_as('auth_a');
select throws_ok($$select count(*) from evidence.verification_claim_reclassifications$$,
  '42501', null, 'another tenant cannot read it either');
select pg_temp.act_as_anonymous();
select throws_ok($$select count(*) from evidence.verification_claim_reclassifications$$,
  '42501', null, 'anonymous reads nothing');

select * from finish();
rollback;
