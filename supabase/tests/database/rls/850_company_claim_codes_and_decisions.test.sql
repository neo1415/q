-- P14 (20261209100000): claim codes are hashes with an expiry; decisions name
-- their decider; the table stays server-only.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(9);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, website_url) values
  ('00000000-0000-4000-8000-0000000085c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'Claim Co A', 'claim-co-a', 'https://claimco.example');
insert into core.company_claim_requests
  (id, tenant_id, company_id, requester_user_id, method, work_email, client_request_id)
values
  ('00000000-0000-4000-8000-0000000085d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000085c1',
   pg_temp.rls_id('user_b'), 'WORK_EMAIL', 'b@claimco.example', 'claim-fixture-1'),
  ('00000000-0000-4000-8000-0000000085d2', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000085c1',
   pg_temp.rls_id('user_b'), 'REGISTRY_DOCUMENT', null, 'claim-fixture-2');

select lives_ok(
  $$ update core.company_claim_requests
        set code_hash = repeat('a', 64), code_expires_at = now() + interval '30 minutes'
      where id = '00000000-0000-4000-8000-0000000085d1' $$,
  'a work-email claim keeps its code as a hash with an expiry');
select throws_ok(
  $$ update core.company_claim_requests set code_hash = '123456', code_expires_at = now()
      where id = '00000000-0000-4000-8000-0000000085d1' $$,
  '23514', null, 'a raw code is never stored');
select throws_ok(
  $$ update core.company_claim_requests
        set code_hash = repeat('b', 64), code_expires_at = now()
      where id = '00000000-0000-4000-8000-0000000085d2' $$,
  '23514', null, 'only a work-email claim has a code');
select throws_ok(
  $$ update core.company_claim_requests set code_attempts = 11
      where id = '00000000-0000-4000-8000-0000000085d1' $$,
  '23514', null, 'attempts are bounded');
select throws_ok(
  $$ update core.company_claim_requests set status = 'APPROVED', decided_at = now()
      where id = '00000000-0000-4000-8000-0000000085d2' $$,
  '23514', null, 'an approval without its decider is refused');
select lives_ok(
  $$ update core.company_claim_requests
        set status = 'APPROVED', decided_at = now(), decided_by_user_id = pg_temp.rls_id('user_a'),
            decided_via = 'PLATFORM_ADMIN', decision_reason = 'Registry document matches.'
      where id = '00000000-0000-4000-8000-0000000085d2' $$,
  'an approval names who decided and by which authority');

select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from core.company_claim_requests $$, '42501', null,
  'the requester reads claim rows only through the API');
select pg_temp.act_as_revoked_user();
select throws_ok($$ select count(*) from core.company_claim_requests $$, '42501', null,
  'a revoked user reads nothing');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from core.company_claim_requests $$, '42501', null,
  'an anonymous visitor reads nothing');

select * from finish();
rollback;
