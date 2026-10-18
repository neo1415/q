-- F2 · gateq.application_founders: which signed-in founder sent an
-- application. Server-only; never readable by a browser principal.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(7);

insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000fa01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Founder Link Capital');
insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000fa11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fa01', pg_temp.rls_id('org_b'),
   'gq_fa3456789abcdefghjkmnpqrs0', 'Seed gate', pg_temp.rls_id('user_b'));
insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000fa21', '00000000-0000-4000-8000-00000000fa11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed', 'gateq-qualification.v1', pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());
insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000fa31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fa11',
   '00000000-0000-4000-8000-00000000fa21', 'ga_fa3456789abcdefghjkmnpqrs1');

select is((select relrowsecurity from pg_class where oid = 'gateq.application_founders'::regclass), true,
  'row level security is on');
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'gateq' and table_name = 'application_founders'
              and grantee in ('anon', 'authenticated')), 0,
  'no browser principal holds a grant');
select lives_ok($$
  insert into gateq.application_founders (application_id, tenant_id, founder_user_id)
  values ('00000000-0000-4000-8000-00000000fa31', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_a'))
$$, 'the server links a signed-in founder to the application they sent');
select throws_ok($$
  insert into gateq.application_founders (application_id, tenant_id, founder_user_id)
  values ('00000000-0000-4000-8000-00000000fa31', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'))
$$, '23505', null, 'one founder per application');

select throws_ok($$
  update gateq.application_founders set tenant_id = pg_temp.rls_id('tenant_a')
   where application_id = '00000000-0000-4000-8000-00000000fa31'
$$, '23514', null, 'cross-tenant: a link stays in its application''s tenant');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from gateq.application_founders $$, '42501', null,
  'even the linked founder reads it only through the API');
select pg_temp.reset_test_identity();

select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from gateq.application_founders $$, '42501', null,
  'an anonymous visitor reaches nothing');
select pg_temp.reset_test_identity();

select * from finish();
rollback;
