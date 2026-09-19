-- CQ-REC-003 · recommendation: purpose-approved semantic representations and
-- their vectors are server-only, versioned, immutable, tenant-provable and
-- cannot outlive the canonical row they were derived from.
--
--   representation ≠ company truth ≠ Q knowledge;  vector ≠ discoverability
--   similarity ≠ fit ≠ match;  stale vector ≠ current permission
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(34);

-- Fixtures ------------------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, short_description, marketplace_visibility) values
  ('00000000-0000-4000-8000-0000000007c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Semantic Co A', 'semantic-co-a', 'Logistics workflow software for African distributors.', 'network_visible'),
  ('00000000-0000-4000-8000-0000000007c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Semantic Co B', 'semantic-co-b', 'A private company.', 'organisation_private');

insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000007b1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Semantic Capital B');
insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000007a1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000007b1', 'Africa logistics', 'ACTIVE', now(), pg_temp.rls_id('user_b'));

-- Shape ------------------------------------------------------------------------------
select has_table('recommendation', 'company_representations', 'company representations exist');
select has_table('recommendation', 'mandate_representations', 'mandate representations exist');
select has_table('recommendation', 'company_embeddings', 'company embeddings exist');
select has_table('recommendation', 'mandate_embeddings', 'mandate embeddings exist');
select is((select format_type(atttypid, atttypmod) from pg_attribute
            where attrelid = 'recommendation.company_embeddings'::regclass and attname = 'embedding'),
  'vector(1024)', 'company vectors are native pgvector at the configured dimension');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'recommendation' and c.relkind = 'r' and c.relrowsecurity), 8,
  'every recommendation table has RLS enabled (four semantic tables, the feature snapshot store, slates, slate items and refresh requests)');
select is((select count(*)::int from pg_policies where schemaname = 'recommendation'), 0,
  'and no policy: the schema is server-internal, never browser-reachable');

-- Company representation lifecycle ----------------------------------------------------
select lives_ok($$
  insert into recommendation.company_representations (id, tenant_id, company_id, purpose, representation_version, source_fingerprint, content_sha256, content)
  values ('00000000-0000-4000-8000-0000000007d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000007c1', 'INVESTOR_DISCOVER', 'company-investment-representation.v1', repeat('1', 64), repeat('a', 64), 'Company: Semantic Co A')
$$, 'a current representation is stored for a company');
select throws_ok($$
  insert into recommendation.company_representations (tenant_id, company_id, purpose, representation_version, source_fingerprint, content_sha256, content)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000007c1', 'INVESTOR_DISCOVER', 'company-investment-representation.v1', repeat('2', 64), repeat('b', 64), 'Company: Semantic Co A (again)')
$$, '23505', null, 'one CURRENT representation per company, purpose and version');
select throws_ok($$
  update recommendation.company_representations set content = 'edited' where id = '00000000-0000-4000-8000-0000000007d1'
$$, '23514', null, 'a representation''s content is never edited in place');
select throws_ok($$
  insert into recommendation.company_representations (tenant_id, company_id, purpose, representation_version, source_fingerprint, content_sha256, content)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000007c2', 'INVESTOR_DISCOVER', 'company-investment-representation.v1', repeat('3', 64), repeat('c', 64), 'wrong tenant')
$$, '23503', null, 'a representation cannot claim a tenant its company does not have');
select throws_ok($$
  insert into recommendation.company_representations (tenant_id, company_id, purpose, representation_version, source_fingerprint, content_sha256, content)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000007c1', 'FOUNDER_DISCOVER', 'company-investment-representation.v1', repeat('4', 64), repeat('d', 64), 'other purpose')
$$, '23514', null, 'only the approved purpose exists in V1');

-- Company embedding ---------------------------------------------------------------------
select lives_ok($$
  insert into recommendation.company_embeddings (id, tenant_id, representation_id, company_id, provider_code, model_code, model_revision, configuration_version, instruction_version, embedding_dimension, embedding, content_sha256)
  values ('00000000-0000-4000-8000-0000000007e1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000007d1', '00000000-0000-4000-8000-0000000007c1', 'local-tei', 'Qwen/Qwen3-Embedding-0.6B', repeat('a', 40), 'capital-q-qwen3-embedding-0-6b-1024-v1', 'none-v1', 1024,
          (select ('[' || string_agg('0.03125', ',') || ']')::extensions.vector from generate_series(1, 1024)), repeat('a', 64))
$$, 'a vector is stored for the current representation');
select throws_ok($$
  insert into recommendation.company_embeddings (tenant_id, representation_id, company_id, provider_code, model_code, configuration_version, instruction_version, embedding_dimension, embedding, content_sha256)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000007d1', '00000000-0000-4000-8000-0000000007c1', 'local-tei', 'Qwen/Qwen3-Embedding-0.6B', 'capital-q-qwen3-embedding-0-6b-1024-v1', 'none-v1', 1024,
          (select ('[' || string_agg('0.03125', ',') || ']')::extensions.vector from generate_series(1, 1024)), repeat('a', 64))
$$, '23505', null, 'the same work identity cannot be stored twice: a retried refresh collides');
select throws_ok($$
  insert into recommendation.company_embeddings (tenant_id, representation_id, company_id, provider_code, model_code, configuration_version, instruction_version, embedding_dimension, embedding, content_sha256)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000007d1', '00000000-0000-4000-8000-0000000007c1', 'local-tei', 'short/model', 'capital-q-short-v1', 'none-v1', 1023,
          (select ('[' || string_agg('0.5', ',') || ']')::extensions.vector from generate_series(1, 1023)), repeat('a', 64))
$$, '22000', null, 'a 1023-dimensional vector does not fit the store');
select throws_ok($$
  insert into recommendation.company_embeddings (tenant_id, representation_id, company_id, provider_code, model_code, configuration_version, instruction_version, embedding_dimension, embedding, content_sha256)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000007d1', '00000000-0000-4000-8000-0000000007c1', 'local-tei', 'lying/model', 'capital-q-lying-v1', 'none-v1', 768,
          (select ('[' || string_agg('0.03125', ',') || ']')::extensions.vector from generate_series(1, 1024)), repeat('a', 64))
$$, '23514', null, 'the recorded dimension must equal the vector''s own');
select throws_ok($$
  insert into recommendation.company_embeddings (tenant_id, representation_id, company_id, provider_code, model_code, configuration_version, instruction_version, embedding_dimension, embedding, content_sha256)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000007d1', '00000000-0000-4000-8000-0000000007c1', 'local-tei', 'x/y', 'capital-q-x-v1', 'none-v1', 1024,
          (select ('[' || string_agg('0.03125', ',') || ']')::extensions.vector from generate_series(1, 1024)), repeat('a', 64))
$$, '23503', null, 'a vector cannot claim a tenant its representation does not have');
select throws_ok($$
  update recommendation.company_embeddings
     set embedding = (select ('[' || string_agg('0.001', ',') || ']')::extensions.vector from generate_series(1, 1024))
   where id = '00000000-0000-4000-8000-0000000007e1'
$$, '23514', null, 'a stored vector is never edited; re-embedding means a new configuration');

-- Supersession ----------------------------------------------------------------------------
select lives_ok($$
  update recommendation.company_representations set status = 'SUPERSEDED', superseded_at = now() where id = '00000000-0000-4000-8000-0000000007d1'
$$, 'a representation can be superseded');
select lives_ok($$
  insert into recommendation.company_representations (id, tenant_id, company_id, purpose, representation_version, source_fingerprint, content_sha256, content)
  values ('00000000-0000-4000-8000-0000000007d2', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000007c1', 'INVESTOR_DISCOVER', 'company-investment-representation.v1', repeat('5', 64), repeat('e', 64), 'Company: Semantic Co A, rebuilt')
$$, 'and a new current one takes its place');
select throws_ok($$
  update recommendation.company_representations set status = 'CURRENT', superseded_at = null where id = '00000000-0000-4000-8000-0000000007d1'
$$, '23514', null, 'a superseded representation never becomes current again');
select is((select count(*)::int from recommendation.company_embeddings where representation_id = '00000000-0000-4000-8000-0000000007d1'), 1,
  'the superseded representation keeps its vector for provenance; retrieval reads status, not presence');

-- Mandate representation ------------------------------------------------------------------
select lives_ok($$
  insert into recommendation.mandate_representations (id, tenant_id, investor_organisation_id, mandate_id, mandate_version, purpose, representation_version, source_fingerprint, content_sha256, content)
  values ('00000000-0000-4000-8000-0000000007f1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000007b1', '00000000-0000-4000-8000-0000000007a1', 1, 'INVESTOR_DISCOVER', 'investor-mandate-representation.v1', repeat('6', 64), repeat('f', 64), 'Mandate: Africa logistics')
$$, 'an investor''s mandate representation is stored under the investor''s tenant');
select throws_ok($$
  insert into recommendation.mandate_representations (tenant_id, investor_organisation_id, mandate_id, mandate_version, purpose, representation_version, source_fingerprint, content_sha256, content)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000007b1', '00000000-0000-4000-8000-0000000007a1', 1, 'INVESTOR_DISCOVER', 'investor-mandate-representation.v2', repeat('7', 64), repeat('0', 64), 'wrong tenant')
$$, '23503', null, 'a mandate representation cannot be filed under another tenant');
select lives_ok($$
  insert into recommendation.mandate_embeddings (tenant_id, representation_id, investor_organisation_id, provider_code, model_code, configuration_version, instruction_version, embedding_dimension, embedding, content_sha256)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000007f1', '00000000-0000-4000-8000-0000000007b1', 'local-tei', 'Qwen/Qwen3-Embedding-0.6B', 'capital-q-qwen3-embedding-0-6b-1024-v1', 'capital-q-mandate-matching-v1', 1024,
          (select ('[' || string_agg('0.03125', ',') || ']')::extensions.vector from generate_series(1, 1024)), repeat('f', 64))
$$, 'the mandate''s query vector is stored under the matching instruction version');

-- Cascade: derived data never outlives its canonical row ------------------------------
select lives_ok($$ delete from core.companies where id = '00000000-0000-4000-8000-0000000007c1' $$,
  'the company can be removed');
select is((select count(*)::int from recommendation.company_representations where company_id = '00000000-0000-4000-8000-0000000007c1'), 0,
  'its representations go with it');
select is((select count(*)::int from recommendation.company_embeddings where company_id = '00000000-0000-4000-8000-0000000007c1'), 0,
  'and so do its vectors: no orphan vector outlives the company it describes');

-- Exposure ---------------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from recommendation.company_representations $$, '42501', null, 'anonymous cannot read representations');

select pg_temp.act_as_user_a();
select throws_ok($$ select * from recommendation.company_embeddings $$, '42501', null, 'a signed-in founder cannot read company vectors');
select throws_ok($$ select id from recommendation.mandate_representations limit 1 $$, '42501', null, 'a signed-in founder cannot read an investor''s mandate representation, not even its id');
select throws_ok($$ select * from recommendation.mandate_embeddings $$, '42501', null, 'nor an investor''s query vector');
select throws_ok($$
  insert into recommendation.company_representations (tenant_id, company_id, purpose, representation_version, source_fingerprint, content_sha256, content)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000007c2', 'INVESTOR_DISCOVER', 'company-investment-representation.v1', repeat('8', 64), repeat('9', 64), 'client-authored')
$$, '42501', null, 'a browser principal cannot author a representation: embeddings are server-derived');

select pg_temp.act_as_user_b();
select throws_ok($$ select * from recommendation.mandate_representations where tenant_id = pg_temp.rls_id('tenant_b') $$,
  '42501', null, 'not even the owning tenant''s member reads the store through the database');

select * from finish();
rollback;
