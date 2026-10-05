-- P3 Documents page · the keyset indexes behind the paged lists, and the
-- archive (delete) that can be undone. Server-only posture is unchanged.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads and writes these
-- rows; browser sessions (anon, authenticated) still cannot, in any tenant.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(8);

select has_index('evidence', 'documents', 'documents_owner_active_updated_idx', 'uploaded documents page by (updated_at, id)');
select has_index('artifacts', 'artifacts', 'artifacts_owner_updated_id_idx', 'Q documents page by (updated_at, id)');

insert into evidence.documents (id, tenant_id, owner_organisation_id, document_type, title, created_by_user_id)
values ('00000000-0000-4000-8000-0000000770d1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
        'PITCH_DECK', 'Seed deck', pg_temp.rls_id('user_a'));

select lives_ok(
  $$ update evidence.documents set status = 'ARCHIVED' where id = '00000000-0000-4000-8000-0000000770d1' $$,
  'a document can be deleted (archived)');
select lives_ok(
  $$ update evidence.documents set status = 'ACTIVE' where id = '00000000-0000-4000-8000-0000000770d1' $$,
  'and brought back');
select throws_ok(
  $$ update evidence.documents set status = 'DELETED' where id = '00000000-0000-4000-8000-0000000770d1' $$,
  '23514', null, 'there is no hard-delete status');
select throws_ok(
  $$ update evidence.documents set title = repeat('x', 1000) where id = '00000000-0000-4000-8000-0000000770d1' $$,
  '23514', null, 'a rename keeps the title bound');

-- Browser sessions still have no way in.
select ok(not has_table_privilege('authenticated', 'evidence.documents', 'update'),
  'authenticated cannot rename or delete a document directly');
select ok(not has_table_privilege('anon', 'evidence.documents', 'select'),
  'anon cannot read documents');

select * from finish();
rollback;
