-- 2026-10-08 (20261220140000, 20261220140100): a registry document on a
-- company claim is an object identity plus what storage observed, only on a
-- REGISTRY_DOCUMENT claim, and the table stays server-only. The founder's
-- grant by auth account adds a platform_owner for that account's profile,
-- and nothing for anyone else.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(12);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, website_url) values
  ('00000000-0000-4000-8000-0000000886c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'Evidence Co', 'evidence-co', 'https://evidenceco.example');
insert into core.company_claim_requests
  (id, tenant_id, company_id, requester_user_id, method, work_email, client_request_id)
values
  ('00000000-0000-4000-8000-0000000886d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000886c1',
   pg_temp.rls_id('user_b'), 'REGISTRY_DOCUMENT', null, 'claim-evidence-1'),
  ('00000000-0000-4000-8000-0000000886d2', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000886c1',
   pg_temp.rls_id('user_a'), 'WORK_EMAIL', 'a@evidenceco.example', 'claim-evidence-2');

select lives_ok(
  $$ update core.company_claim_requests
        set evidence_object_key = 'company-claims/00000000-0000-4000-8000-0000000886d1/00000000-0000-4000-8000-00000000e001',
            evidence_file_name = 'certificate.pdf', evidence_content_type = 'application/pdf'
      where id = '00000000-0000-4000-8000-0000000886d1' $$,
  'a registry claim names the key the server issued');
select lives_ok(
  $$ update core.company_claim_requests
        set evidence_size_bytes = 2048, evidence_uploaded_at = now()
      where id = '00000000-0000-4000-8000-0000000886d1' $$,
  'and records what storage observed once uploaded');
select throws_ok(
  $$ update core.company_claim_requests
        set evidence_object_key = 'company-claims/00000000-0000-4000-8000-0000000886d2/00000000-0000-4000-8000-00000000e002',
            evidence_file_name = 'x.pdf', evidence_content_type = 'application/pdf'
      where id = '00000000-0000-4000-8000-0000000886d2' $$,
  '23514', null, 'only a registry-document claim carries a document');
select throws_ok(
  $$ update core.company_claim_requests set evidence_object_key = 'elsewhere/secret.pdf'
      where id = '00000000-0000-4000-8000-0000000886d1' $$,
  '23514', null, 'a key outside company-claims/ is refused');
select throws_ok(
  $$ update core.company_claim_requests set evidence_content_type = 'text/html'
      where id = '00000000-0000-4000-8000-0000000886d1' $$,
  '23514', null, 'only a PDF or an image');
select throws_ok(
  $$ update core.company_claim_requests set evidence_size_bytes = 20000000
      where id = '00000000-0000-4000-8000-0000000886d1' $$,
  '23514', null, 'a file over 10 MB is refused');
select throws_ok(
  $$ update core.company_claim_requests set evidence_uploaded_at = null
      where id = '00000000-0000-4000-8000-0000000886d1' $$,
  '23514', null, 'a size without an upload time (or the reverse) is refused');

select pg_temp.act_as_user_b();
select throws_ok($$ select evidence_object_key from core.company_claim_requests $$, '42501', null,
  'the claimant reads their evidence row only through the API');
select pg_temp.act_as_revoked_user();
select throws_ok($$ select count(*) from core.company_claim_requests $$, '42501', null,
  'a revoked user reads nothing');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from core.company_claim_requests $$, '42501', null,
  'an anonymous visitor reads nothing');
select pg_temp.reset_test_identity();

-- The founder grant: re-running the migration's statement against a
-- fixture profile keyed by that auth id makes exactly that profile an owner.
insert into auth.users (id, email)
values ('49f77890-d071-414c-b9b5-682a66339c07', 'founder-fixture@example.invalid')
on conflict (id) do nothing;
insert into identity.platform_admins (user_id, role, note)
select p.id, 'platform_owner', 'Founder (by auth account), 2026-10-08'
  from identity.user_profiles p
 where p.auth_user_id = '49f77890-d071-414c-b9b5-682a66339c07'
on conflict (user_id) do nothing;
select is(
  (select a.role from identity.platform_admins a
     join identity.user_profiles p on p.id = a.user_id
    where p.auth_user_id = '49f77890-d071-414c-b9b5-682a66339c07'),
  'platform_owner', 'the founder''s auth account holds platform_owner');
select is(
  (select count(*)::int from identity.platform_admins a
     join identity.user_profiles p on p.id = a.user_id
    where p.auth_user_id in (pg_temp.rls_id('auth_a'), pg_temp.rls_id('auth_b'))),
  0, 'no other account is granted anything');

select * from finish();
rollback;
