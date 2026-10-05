-- P7 · gateq.policy_extractions: an investor's mandate read into DRAFT gate
-- criteria. Server-only provenance; never a rule, never the mandate text.
--
--   mandate text ≠ GateQ published policy
--   a proposal ≠ a rule
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(14);

-- Fixtures: one gateway in tenant B --------------------------------------------------
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000dd01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Embed Capital B');

insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000dd11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000dd01', pg_temp.rls_id('org_b'),
   'gq_dd23456789abcdefghjkmnpqrs', 'Embed gateway', pg_temp.rls_id('user_b'));

insert into gateq.policy_extractions
  (id, tenant_id, gateway_id, source_kind, source_sha256, source_chars, reader_version, proposals, not_found, client_request_id, created_by_user_id)
values
  ('00000000-0000-4000-8000-00000000dd21', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000dd11',
   'PASTED_TEXT', repeat('a', 64), 120, 'gateq-mandate-reader.v1',
   '[{"dimension":"STAGE","label":"Stage","config":{"type":"STAGE","allowedStageCodes":["seed"]}}]'::jsonb,
   array['CHEQUE'], 'extract-0000000001', pg_temp.rls_id('user_b'));

-- Shape -------------------------------------------------------------------------------
select has_table('gateq', 'policy_extractions', 'the provenance table exists');
select is((select relrowsecurity from pg_class where oid = 'gateq.policy_extractions'::regclass), true,
  'row level security is on');
select is((select count(*)::int from pg_policies where schemaname = 'gateq' and tablename = 'policy_extractions'), 0,
  'and there is no policy: no browser principal reads an investor''s mandate reading');
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'gateq' and table_name = 'policy_extractions'
              and grantee in ('anon', 'authenticated')), 0,
  'neither anon nor authenticated holds any grant');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'gateq' and table_name = 'policy_extractions'
              and column_name in ('text', 'source_text', 'mandate_text', 'content', 'mandate_id')), 0,
  'the mandate text is never stored, and this is not the investor mandate');

-- Positive: the privileged server path ---------------------------------------------------
select is((select count(*)::int from gateq.policy_extractions
            where gateway_id = '00000000-0000-4000-8000-00000000dd11'), 1,
  'the server reads the reading it recorded');

-- Idempotency and integrity ---------------------------------------------------------------
select throws_ok($$
  insert into gateq.policy_extractions
    (tenant_id, gateway_id, source_kind, source_sha256, source_chars, reader_version, proposals, client_request_id, created_by_user_id)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000dd11', 'PASTED_TEXT', repeat('b', 64), 10,
          'gateq-mandate-reader.v1', '[]'::jsonb, 'extract-0000000001', pg_temp.rls_id('user_b'))
$$, '23505', null, 'one client request is one reading: a double-click cannot produce two');

select throws_ok($$
  insert into gateq.policy_extractions
    (tenant_id, gateway_id, source_kind, source_sha256, source_chars, reader_version, proposals, client_request_id, created_by_user_id)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000dd11', 'PASTED_TEXT', repeat('c', 64), 10,
          'gateq-mandate-reader.v1', '[]'::jsonb, 'extract-0000000002', pg_temp.rls_id('user_a'))
$$, '23514', null, 'cross-tenant: a reading cannot be filed under another tenant''s gateway');

select throws_ok($$
  insert into gateq.policy_extractions
    (tenant_id, gateway_id, source_kind, source_sha256, source_chars, reader_version, proposals, client_request_id, created_by_user_id)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000dd11', 'PASTED_TEXT', 'not-a-digest', 10,
          'gateq-mandate-reader.v1', '[]'::jsonb, 'extract-0000000003', pg_temp.rls_id('user_b'))
$$, '23514', null, 'only a digest of the source is accepted');

select throws_ok($$
  update gateq.policy_extractions set proposals = '[]'::jsonb
   where id = '00000000-0000-4000-8000-00000000dd21'
$$, '23001', null, 'what was proposed is never rewritten');

select throws_ok($$
  delete from gateq.policy_extractions where id = '00000000-0000-4000-8000-00000000dd21'
$$, '23001', null, 'nor deleted');

-- Negative: browser principals ----------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from gateq.policy_extractions $$, '42501', null,
  'cross-tenant: user A cannot read tenant B''s mandate reading');
select pg_temp.reset_test_identity();

select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from gateq.policy_extractions $$, '42501', null,
  'even the owning tenant''s member reads it only through the API, never the table');
select pg_temp.reset_test_identity();

select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from gateq.policy_extractions $$, '42501', null,
  'and an anonymous visitor to an embedded gateway reaches nothing');
select pg_temp.reset_test_identity();

select * from finish();
rollback;
