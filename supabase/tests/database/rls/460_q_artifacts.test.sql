-- QX-003C · artifacts.artifacts and artifact_versions: what Q composed,
-- owner-scoped, versioned and reachable by no browser principal.
--
--   generated artifact ≠ canonical truth ≠ verified evidence ≠ disclosure
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION. Ownership is enforced in the repository's own
-- where clause, which the package's integration test asserts against real
-- SQL; what is asserted here is that no browser principal can go around it.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(16);

-- Fixtures ------------------------------------------------------------------------
insert into artifacts.artifacts (id, tenant_id, organisation_id, type, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000cc01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'),
   'INVESTMENT_BRIEF', pg_temp.rls_id('user_b'));

insert into artifacts.artifact_versions
  (id, artifact_id, tenant_id, version, title, summary, content, created_by_user_id)
values
  ('00000000-0000-4000-8000-00000000cc11', '00000000-0000-4000-8000-00000000cc01', pg_temp.rls_id('tenant_b'),
   1, 'Investment brief', 'What the record supports.',
   '{"sections":[{"heading":"Business","body":"What the record supports.","findings":[]}],"gaps":["Traction"]}'::jsonb,
   pg_temp.rls_id('user_b'));

-- Shape ------------------------------------------------------------------------------
select has_table('artifacts', 'artifacts', 'the artifact exists');
select has_table('artifacts', 'artifact_versions', 'and its versions');

select is((select bool_and(relrowsecurity) from pg_class
            where oid in ('artifacts.artifacts'::regclass, 'artifacts.artifact_versions'::regclass)), true,
  'row level security is on for both');
select is((select count(*)::int from pg_policies where schemaname = 'artifacts'), 0,
  'and there is no policy: a draft about a company''s position is not a table anybody browses');

-- No browser principal reaches the tables at all.
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'artifacts' and grantee in ('anon', 'authenticated')), 0,
  'neither anon nor authenticated holds any grant on an artifacts table');

-- Versioning ---------------------------------------------------------------------------
select col_is_unique('artifacts', 'artifact_versions', array['artifact_id', 'version'],
  'one version number per artifact, enforced by the database rather than by whoever writes the revise path');

select throws_ok($$
  insert into artifacts.artifact_versions (artifact_id, tenant_id, version, title, summary, content, created_by_user_id)
  values ('00000000-0000-4000-8000-00000000cc01', pg_temp.rls_id('tenant_b'), 1, 'Overwrite', 's',
          '{"sections":[]}'::jsonb, pg_temp.rls_id('user_b'))
$$, '23505', null, 'a second version 1 is refused: a revision appends, it never replaces');

select lives_ok($$
  insert into artifacts.artifact_versions (artifact_id, tenant_id, version, title, summary, content, created_by_user_id)
  values ('00000000-0000-4000-8000-00000000cc01', pg_temp.rls_id('tenant_b'), 2, 'Revised', 's',
          '{"sections":[]}'::jsonb, pg_temp.rls_id('user_b'))
$$, 'but version 2 is welcome');

select is((select title from artifacts.artifact_versions
            where artifact_id = '00000000-0000-4000-8000-00000000cc01' and version = 1), 'Investment brief',
  'and version 1 is exactly what it was: somebody who sent a brief last week can still see what they sent');

select throws_ok($$
  insert into artifacts.artifact_versions (artifact_id, tenant_id, version, title, summary, content, created_by_user_id)
  values ('00000000-0000-4000-8000-00000000cc01', pg_temp.rls_id('tenant_b'), 0, 'Zeroth', 's',
          '{"sections":[]}'::jsonb, pg_temp.rls_id('user_b'))
$$, '23514', null, 'versions count from one');

-- What may be stored ---------------------------------------------------------------------
select throws_ok($$
  insert into artifacts.artifacts (tenant_id, organisation_id, type, company_id, investor_organisation_id, created_by_user_id)
  values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'INVESTMENT_BRIEF',
          '00000000-0000-4000-8000-00000000dd01', '00000000-0000-4000-8000-00000000dd02', pg_temp.rls_id('user_b'))
$$, '23514', null, 'an artifact about a company and an investor organisation at once is two artifacts');

select throws_ok($$
  insert into artifacts.artifacts (tenant_id, organisation_id, type, created_by_user_id)
  values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'investment brief', pg_temp.rls_id('user_b'))
$$, '23514', null, 'a type is a reference code, not free text');

select throws_ok($$
  insert into artifacts.artifacts (tenant_id, organisation_id, type, visibility_scope, created_by_user_id)
  values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'INVESTMENT_BRIEF', 'ORGANISATION_PRIVATE', pg_temp.rls_id('user_b'))
$$, '23514', null, 'visibility scopes are ADR-001''s eight values, persisted lowercase');

select is((select visibility_scope from artifacts.artifacts where id = '00000000-0000-4000-8000-00000000cc01'),
  'organisation_private',
  'and an artifact starts visible to the organisation that owns it and to nobody else');

-- Capabilities ----------------------------------------------------------------------------
select is((select count(*)::int from permissions.capabilities
            where code in ('artifact.view', 'artifact.create', 'artifact.revise')), 3,
  'the three artifact capabilities exist');

-- Artifacts owns no other context's data ---------------------------------------------------
select is((select count(*)::int from information_schema.columns
            where table_schema = 'artifacts'
              and column_name in ('evidence_id', 'document_id', 'claim_id', 'readiness_score', 'rank_score', 'truth_class')), 0,
  'no evidence column, no claim column, no score column: a generated artifact is not evidence, not canonical truth and not a ranking input');

select * from finish();
rollback;
