-- Decision B (2026-10-23) · network.interests.note: an investor's optional
-- note with their interest. Relationship-shared between the two parties,
-- read only through the server: the table stays server-internal, so no
-- browser principal, in either tenant, can read the note.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(8);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000002c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Note Co A', 'note-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000002e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Note Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id) values
  ('00000000-0000-4000-8000-000000002b01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000002c1', '00000000-0000-4000-8000-0000000002e2');
insert into network.relationship_events (id, tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, payload, correlation_id) values
  ('00000000-0000-4000-8000-000000002b12', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', 1, 'interest_expressed', 'HUMAN', pg_temp.rls_id('user_b'), 'Q', 'relationship_shared', '{}', 'cor_00000000-0000-4000-8000-000000000021'),
  ('00000000-0000-4000-8000-000000002b13', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', 2, 'interest_expressed', 'HUMAN', pg_temp.rls_id('user_b'), 'Q', 'relationship_shared', '{}', 'cor_00000000-0000-4000-8000-000000000022');
insert into network.interests (id, tenant_id, relationship_id, expressed_by_party, expressed_by_user_id, expressed_in_organisation_id, relationship_event_id, note) values
  ('00000000-0000-4000-8000-000000002b21', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000002b01', 'INVESTOR', pg_temp.rls_id('user_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-000000002b12', 'I''d like a call next week about your API.');

select has_column('network', 'interests', 'note', 'interests carry an optional note');
select col_is_null('network', 'interests', 'note', 'the note is optional (nullable)');
select is((select note from network.interests where id = '00000000-0000-4000-8000-000000002b21'),
  'I''d like a call next week about your API.', 'the note is stored as written');

select throws_ok(
  $$ update network.interests set note = repeat('x', 1001) where id = '00000000-0000-4000-8000-000000002b21' $$,
  '23514', null, 'a note longer than 1000 characters is refused');
select throws_ok(
  $$ update network.interests set note = '   ' where id = '00000000-0000-4000-8000-000000002b21' $$,
  '23514', null, 'a blank note is refused (no note is NULL)');

-- No browser principal reads the note, in either tenant (server-internal):
-- founders and investors see it only through the API's own authorisation.
select pg_temp.act_as_user_a();
select throws_ok($$ select note from network.interests $$, '42501', null,
  'the company-side user has no raw access to the note');
select pg_temp.act_as_user_b();
select throws_ok($$ select note from network.interests $$, '42501', null,
  'the investor-side user has no raw access to the note');
select pg_temp.act_as_anonymous();
select throws_ok($$ select note from network.interests $$, '42501', null,
  'anonymous: no access to the note');

select * from finish();
rollback;
