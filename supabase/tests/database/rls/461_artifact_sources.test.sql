-- SEC-01 · artifacts.artifact_sources: which source documents an artifact
-- was composed from, server-only, tenant-bound and append-oriented.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role records and reads every
-- row. APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION. Whether a reader may still open each source is
-- decided by the Q API on every read (packages/q-artifacts service tests);
-- what is asserted here is the table's shape, its tenant binding, and that
-- no browser principal can read or write it.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(15);

-- Fixtures ------------------------------------------------------------------------
insert into artifacts.artifacts (id, tenant_id, organisation_id, type, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000ce01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'),
   'INVESTMENT_BRIEF', pg_temp.rls_id('user_b')),
  ('00000000-0000-4000-8000-00000000ce02', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'INVESTMENT_BRIEF', pg_temp.rls_id('user_a'));

-- Shape ------------------------------------------------------------------------------
select has_table('artifacts', 'artifact_sources', 'an artifact''s sources are recorded');
select is((select relrowsecurity from pg_class where oid = 'artifacts.artifact_sources'::regclass), true,
  'row level security is on');
select is((select count(*)::int from pg_policies
            where schemaname = 'artifacts' and tablename = 'artifact_sources'), 0,
  'and there is no policy: provenance of a private draft is not a table anybody browses');
select col_is_unique('artifacts', 'artifact_sources', array['artifact_id', 'source_kind', 'source_id'],
  'one row per (artifact, source): a revision that re-reads a document adds nothing');
select has_index('artifacts', 'artifact_sources', 'artifact_sources_source_idx',
  'sources are findable by document without a scan');

-- Positive: the server role records a source for an artifact in its tenant ----------
select lives_ok($$
  insert into artifacts.artifact_sources (tenant_id, artifact_id, source_kind, source_id)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ce01',
          'data_room_document', '00000000-0000-4000-8000-00000000cf01')
$$, 'a source is recorded against an artifact of the same tenant');

select throws_ok($$
  insert into artifacts.artifact_sources (tenant_id, artifact_id, source_kind, source_id)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ce01',
          'data_room_document', '00000000-0000-4000-8000-00000000cf01')
$$, '23505', null, 'the same source twice is refused (callers insert on conflict do nothing)');

-- Cross-tenant negative --------------------------------------------------------------
select throws_ok($$
  insert into artifacts.artifact_sources (tenant_id, artifact_id, source_kind, source_id)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ce01',
          'retrieved_document', '00000000-0000-4000-8000-00000000cf02')
$$, '23503', null, 'a source cannot be filed under another tenant than its artifact''s');

select throws_ok($$
  insert into artifacts.artifact_sources (tenant_id, artifact_id, source_kind, source_id)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ce99',
          'retrieved_document', '00000000-0000-4000-8000-00000000cf02')
$$, '23503', null, 'nor against an artifact that does not exist');

select throws_ok($$
  insert into artifacts.artifact_sources (tenant_id, artifact_id, source_kind, source_id)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ce01',
          'Data Room', '00000000-0000-4000-8000-00000000cf03')
$$, '23514', null, 'a source kind is a reference code, not free text');

-- No browser principal ----------------------------------------------------------------
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'artifacts' and table_name = 'artifact_sources'
              and grantee in ('anon', 'authenticated')), 0,
  'neither anon nor authenticated holds any grant on artifact_sources');

select pg_temp.act_as_user_b();
select throws_ok($$ select * from artifacts.artifact_sources $$, '42501', null,
  'the artifact''s own owner cannot read its sources from a browser session');
select throws_ok($$
  insert into artifacts.artifact_sources (tenant_id, artifact_id, source_kind, source_id)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ce01',
          'retrieved_document', '00000000-0000-4000-8000-00000000cf04')
$$, '42501', null, 'nor record one');
reset role;

set local role anon;
select throws_ok($$ select * from artifacts.artifact_sources $$, '42501', null,
  'anon reads nothing');
reset role;

-- Provenance survives with its artifact ------------------------------------------------
select is((select count(*)::int from artifacts.artifact_sources
            where artifact_id = '00000000-0000-4000-8000-00000000ce01'), 1,
  'exactly the one recorded source stands');

select * from finish();
rollback;
