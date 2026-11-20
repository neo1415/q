-- V1 · Business verification foundations (20261231599900).
--
-- The real providers and their methods are accepted, each only with its own
-- party and as the system deciding; anything else is still refused. An
-- investor's session reads no founder's ID data: not the identity details,
-- not the claims.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes these rows.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(14);

-- A founder's pending identity and organisation requests in tenant A.
insert into evidence.verification_claims
  (id, tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision, requested_by_user_id)
values
  ('00000000-0000-4000-8000-0000000a1001', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'FOUNDER_IDENTITY', 'PERSON', pg_temp.rls_id('user_a'), 'PENDING', 1, pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000a1002', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'ORGANISATION', 'ORGANISATION', pg_temp.rls_id('org_a'), 'PENDING', 1, pg_temp.rls_id('user_a'));

insert into core.identity_submissions
  (id, tenant_id, organisation_id, user_id, name_on_id, role, claim_id, idempotency_key)
values
  ('00000000-0000-4000-8000-0000000a1003', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   pg_temp.rls_id('user_a'), 'Ada Example', 'Founder', '00000000-0000-4000-8000-0000000a1001', 'v1-id-a-0001');

-- A system decision with one method and provider, as the next revision.
create function pg_temp.decide(claim uuid, kind text, subject_kind text, subject uuid,
                               rev int, m text, p text, actor text, decider uuid)
returns void language sql as $$
  insert into evidence.verification_claims
    (tenant_id, organisation_id, claim_type, subject_type, subject_id, status, revision,
     decides_claim_id, method, provider, decision_basis, decided_by_actor_type,
     decided_by_user_id, decided_at, verified_at, requested_by_user_id)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), kind, subject_kind, subject,
          'VERIFIED', rev, claim, m, p, 'synthetic fixture basis', actor, decider, now(), now(),
          pg_temp.rls_id('user_a'))
$$;

-- The new values, each with its own party ---------------------------------------
select lives_ok($$ select pg_temp.decide('00000000-0000-4000-8000-0000000a1002', 'ORGANISATION', 'ORGANISATION',
  pg_temp.rls_id('org_a'), 2, 'REGISTRY_LOOKUP', 'COMPANIES_HOUSE', 'SYSTEM', null) $$,
  'a Companies House registry lookup is a system decision');
select lives_ok($$ select pg_temp.decide('00000000-0000-4000-8000-0000000a1002', 'ORGANISATION', 'ORGANISATION',
  pg_temp.rls_id('org_a'), 3, 'REGISTRY_LOOKUP', 'DOJAH', 'SYSTEM', null) $$,
  'a Dojah registry lookup');
select lives_ok($$ select pg_temp.decide('00000000-0000-4000-8000-0000000a1002', 'ORGANISATION', 'ORGANISATION',
  pg_temp.rls_id('org_a'), 4, 'BANK_NAME_MATCH', 'DOJAH', 'SYSTEM', null) $$,
  'a Dojah bank account name match');
select lives_ok($$ select pg_temp.decide('00000000-0000-4000-8000-0000000a1001', 'FOUNDER_IDENTITY', 'PERSON',
  pg_temp.rls_id('user_a'), 2, 'ID_SELFIE', 'SUMSUB', 'SYSTEM', null) $$,
  'a Sumsub ID and selfie check');
select lives_ok($$ select pg_temp.decide('00000000-0000-4000-8000-0000000a1001', 'FOUNDER_IDENTITY', 'PERSON',
  pg_temp.rls_id('user_a'), 3, 'DIRECTOR_MATCH', 'SUMSUB', 'SYSTEM', null) $$,
  'a director match on a Sumsub register');
select lives_ok($$ select pg_temp.decide('00000000-0000-4000-8000-0000000a1001', 'FOUNDER_IDENTITY', 'PERSON',
  pg_temp.rls_id('user_a'), 4, 'OPERATOR_DECISION', 'CAPITAL_Q_OPERATOR', 'HUMAN', pg_temp.rls_id('user_b')) $$,
  'an operator decision is unchanged');
select lives_ok($$ insert into core.kyb_submissions
    (tenant_id, organisation_id, legal_name, registration_number, jurisdiction_code,
     submitted_by_user_id, provider, idempotency_key, claim_id)
  select pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Example Ltd', '01234567', 'GB',
         pg_temp.rls_id('user_a'), 'COMPANIES_HOUSE', 'v1-kyb-a-0001', '00000000-0000-4000-8000-0000000a1002'::uuid $$,
  'a KYB submission names a real provider');

-- Negative: anything outside the widened vocabulary is still refused -----------------
select throws_ok($$ select pg_temp.decide('00000000-0000-4000-8000-0000000a1002', 'ORGANISATION', 'ORGANISATION',
  pg_temp.rls_id('org_a'), 5, 'ID_SELFIE', 'COMPANIES_HOUSE', 'SYSTEM', null) $$,
  '23514', null, 'Companies House never decides an ID check');
select throws_ok($$ select pg_temp.decide('00000000-0000-4000-8000-0000000a1002', 'ORGANISATION', 'ORGANISATION',
  pg_temp.rls_id('org_a'), 5, 'REGISTRY_LOOKUP', 'DOJAH', 'HUMAN', pg_temp.rls_id('user_b')) $$,
  '23514', null, 'a provider method is never recorded as a human decision');
select throws_ok($$ select pg_temp.decide('00000000-0000-4000-8000-0000000a1002', 'ORGANISATION', 'ORGANISATION',
  pg_temp.rls_id('org_a'), 5, 'REGISTRY_LOOKUP', 'ONFIDO', 'SYSTEM', null) $$,
  '23514', null, 'an unlisted provider is refused');
select throws_ok($$ select pg_temp.decide('00000000-0000-4000-8000-0000000a1002', 'ORGANISATION', 'ORGANISATION',
  pg_temp.rls_id('org_a'), 5, 'TAX_ID', 'DOJAH', 'SYSTEM', null) $$,
  '23514', null, 'an unlisted method is refused');
select throws_ok($$ insert into core.kyb_submissions
    (tenant_id, organisation_id, legal_name, registration_number, jurisdiction_code,
     submitted_by_user_id, provider, idempotency_key, claim_id)
  select pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Example Ltd', '01234567', 'GB',
         pg_temp.rls_id('user_a'), 'CAPITAL_Q_EMAIL_CODE', 'v1-kyb-a-0002', '00000000-0000-4000-8000-0000000a1002'::uuid $$,
  '23514', null, 'the email code is not a KYB provider');

-- An investor's session reads no founder's ID data -----------------------------------
-- user_b acts for an investment firm (org_b).
select pg_temp.act_as('auth_b');
select is((select count(*)::int from core.identity_submissions
            where id = '00000000-0000-4000-8000-0000000a1003'), 0,
  'an investor cannot read a founder''s identity details');
select throws_ok($$ select count(*) from evidence.verification_claims $$,
  '42501', null, 'an investor''s browser session cannot read verification claims');

select * from finish();
rollback;
