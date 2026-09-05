-- CQ-EVD-002 · Secure direct upload: the document bucket is private, the
-- upload session is server-owned and its object identity immutable, and no
-- browser credential can reach either the storage objects or the session
-- rows.
--
-- A public document bucket is a release blocker (doc 16 TM-FILE-06), so the
-- bucket's `public` flag is asserted here rather than assumed.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(23);

-- Fixtures ------------------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000000c9', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Upload Co A', 'upload-co-a');

insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000d1a1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c9', pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Deck', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-00000000d1b1', pg_temp.rls_id('tenant_b'), null, pg_temp.rls_id('org_b'), 'PITCH_DECK', 'Their deck', pg_temp.rls_id('user_b'));

insert into evidence.document_upload_sessions
  (id, tenant_id, owner_organisation_id, created_by_user_id, document_id, storage_bucket, storage_key,
   original_filename, declared_mime_type, declared_size_bytes, authorising_capability, expires_at)
values
  ('00000000-0000-4000-8000-00000000a501', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'),
   '00000000-0000-4000-8000-00000000d1a1', 'cq-documents-private', 'raw/tenant-a/0123456789abcdef0123456789abcdef',
   'deck.pdf', 'application/pdf', 4096, 'document.create', now() + interval '30 minutes');

-- The private bucket -------------------------------------------------------------
select is((select count(*)::int from storage.buckets where id = 'cq-documents-private'), 1,
  'the private document bucket exists');
select is((select public from storage.buckets where id = 'cq-documents-private'), false,
  'the document bucket is private: a public bucket is a release blocker');
select is((select file_size_limit from storage.buckets where id = 'cq-documents-private'), 26214400::bigint,
  'the bucket carries the upload size limit as its own ceiling');
select ok((select 'application/pdf' = any(allowed_mime_types) and not ('application/zip' = any(allowed_mime_types))
             from storage.buckets where id = 'cq-documents-private'),
  'the bucket admits the business formats and not archives');
select ok((select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  'storage.objects enforces row level security');
select is((select count(*)::int from pg_policy p
             join pg_class c on c.oid = p.polrelid
            where c.relname = 'objects' and c.relnamespace = 'storage'::regnamespace), 0,
  'no policy grants any browser principal access to storage objects');

-- Session shape ------------------------------------------------------------------
select is((select status from evidence.document_upload_sessions where id = '00000000-0000-4000-8000-00000000a501'),
  'PENDING_AUTHORIZATION', 'a session starts before any upload target has been minted');
select is((select cleanup_pending from evidence.document_upload_sessions where id = '00000000-0000-4000-8000-00000000a501'),
  false, 'a new session carries no cleanup debt');
select throws_ok(
  $$ update evidence.document_upload_sessions set status = 'COMPLETED'
      where id = '00000000-0000-4000-8000-00000000a501' $$,
  '23514', null, 'COMPLETED without a version and a finalization time is refused');
select throws_ok(
  $$ update evidence.document_upload_sessions set status = 'REJECTED'
      where id = '00000000-0000-4000-8000-00000000a501' $$,
  '23514', null, 'a refusal must name its reason');
select throws_ok(
  $$ update evidence.document_upload_sessions set storage_key = 'raw/tenant-a/ffffffffffffffffffffffffffffffff'
      where id = '00000000-0000-4000-8000-00000000a501' $$,
  '23514', null, 'the object a session was authorised for is immutable');
select throws_ok(
  $$ update evidence.document_upload_sessions set expires_at = now() + interval '10 years'
      where id = '00000000-0000-4000-8000-00000000a501' $$,
  '23514', null, 'the upload window cannot be extended after the fact');
select lives_ok(
  $$ update evidence.document_upload_sessions set status = 'AUTHORIZED'
      where id = '00000000-0000-4000-8000-00000000a501' $$,
  'the status may still advance');

-- Object identity and ownership ---------------------------------------------------
select throws_ok(
  $$ insert into evidence.document_upload_sessions
       (tenant_id, owner_organisation_id, created_by_user_id, document_id, storage_bucket, storage_key,
        original_filename, declared_mime_type, declared_size_bytes, authorising_capability, expires_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-00000000d1a1', 'cq-documents-private', 'raw/tenant-a/0123456789abcdef0123456789abcdef',
             'other.pdf', 'application/pdf', 10, 'document.create', now() + interval '5 minutes') $$,
  '23505', null, 'one object identity is never reused by a second session');
select throws_ok(
  $$ insert into evidence.document_upload_sessions
       (tenant_id, owner_organisation_id, created_by_user_id, document_id, storage_bucket, storage_key,
        original_filename, declared_mime_type, declared_size_bytes, authorising_capability, expires_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-00000000d1b1', 'cq-documents-private', 'raw/tenant-a/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             'deck.pdf', 'application/pdf', 10, 'document.create', now() + interval '5 minutes') $$,
  '23503', null, 'a session cannot be opened against another tenant''s document');
select throws_ok(
  $$ insert into evidence.document_upload_sessions
       (tenant_id, owner_organisation_id, created_by_user_id, document_id, storage_bucket, storage_key,
        original_filename, declared_mime_type, declared_size_bytes, authorising_capability, expires_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-00000000d1a1', 'cq-documents-private', 'raw/../../etc/passwd',
             'deck.pdf', 'application/pdf', 10, 'document.create', now() + interval '5 minutes') $$,
  '23514', null, 'a storage key that traverses is refused');
select throws_ok(
  $$ insert into evidence.document_upload_sessions
       (tenant_id, owner_organisation_id, created_by_user_id, document_id, storage_bucket, storage_key,
        original_filename, declared_mime_type, declared_size_bytes, authorising_capability, expires_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-00000000d1a1', 'cq-documents-private', 'raw/tenant-a/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
             'reports/deck.pdf', 'application/pdf', 10, 'document.create', now() + interval '5 minutes') $$,
  '23514', null, 'a filename is a name, never a path');
select throws_ok(
  $$ insert into evidence.document_upload_sessions
       (tenant_id, owner_organisation_id, created_by_user_id, document_id, storage_bucket, storage_key,
        original_filename, declared_mime_type, declared_size_bytes, authorising_capability, expires_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-00000000d1a1', 'cq-documents-private', 'raw/tenant-a/cccccccccccccccccccccccccccccccc',
             'deck.pdf', 'application/pdf', 10, 'document.download', now() + interval '5 minutes') $$,
  '23514', null, 'only creating or managing a document may authorise an upload');

-- Browser principals ---------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok(
  $$ select count(*) from evidence.document_upload_sessions $$,
  '42501', null, 'anonymous cannot read upload sessions');

select pg_temp.act_as_user_a();
select throws_ok(
  $$ select count(*) from evidence.document_upload_sessions $$,
  '42501', null, 'an authenticated browser session cannot read upload sessions, even its own');
select throws_ok(
  $$ select count(*) from evidence.document_upload_requests $$,
  '42501', null, 'an authenticated browser session cannot read upload idempotency records');
select throws_ok(
  $$ insert into evidence.document_upload_sessions
       (tenant_id, owner_organisation_id, created_by_user_id, document_id, storage_bucket, storage_key,
        original_filename, declared_mime_type, declared_size_bytes, authorising_capability, expires_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-00000000d1a1', 'cq-documents-private', 'raw/self/dddddddddddddddddddddddddddddddd',
             'deck.pdf', 'application/pdf', 10, 'document.create', now() + interval '5 minutes') $$,
  '42501', null, 'a browser cannot authorise its own upload by writing the row');

select pg_temp.act_as_privileged();
select is((select count(*)::int from evidence.document_upload_sessions), 1,
  'the privileged server role reads the session; DB privilege is not business authorisation');

select * from finish();
rollback;
