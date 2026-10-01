-- DOCS · artifacts.document_images and the cq-document-images bucket:
-- AI-generated images for documents, provenance kept, server-only.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role appends and reads.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION. Ownership is the repository's where clause;
-- asserted here: no browser principal reaches the table or the bucket's
-- objects, rows never change, provenance is always AI_GENERATED.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(13);

insert into artifacts.document_images
  (id, tenant_id, organisation_id, storage_key, content_type, byte_size,
   provider_code, model_code, prompt, purpose, created_by_user_id)
values
  ('00000000-0000-4000-8000-00000000ee01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'),
   '00000000-0000-4000-8000-00000000aaaa/00000000-0000-4000-8000-00000000ee01.png', 'image/png', 1024,
   'openai', 'gpt-image-1', 'Editorial illustration: freight between cities.', 'SLIDE',
   pg_temp.rls_id('user_b'));

select has_table('artifacts', 'document_images', 'document images exist');
select is((select relrowsecurity from pg_class where oid = 'artifacts.document_images'::regclass), true,
  'row level security is on');
select is((select count(*)::int from pg_policies
            where schemaname = 'artifacts' and tablename = 'document_images'), 0,
  'and no policy: server-only');
select is((select provenance from artifacts.document_images
            where id = '00000000-0000-4000-8000-00000000ee01'), 'AI_GENERATED',
  'every image says it is AI-generated');

set local role authenticated;
select throws_ok($$ select * from artifacts.document_images $$, '42501', null,
  'an authenticated session cannot read any document image row, its tenant''s or another''s');
reset role;
set local role anon;
select throws_ok($$ select * from artifacts.document_images $$, '42501', null,
  'nor can anon');
reset role;

select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'artifacts' and table_name = 'document_images'
              and grantee in ('anon', 'authenticated')), 0,
  'no browser grant to revoke: none was given');

select throws_ok($$
  update artifacts.document_images set prompt = 'changed'
   where id = '00000000-0000-4000-8000-00000000ee01'
$$, '55000', null, 'provenance is never rewritten');
select throws_ok($$
  insert into artifacts.document_images
    (tenant_id, organisation_id, storage_key, content_type, byte_size,
     provenance, provider_code, model_code, prompt, purpose, created_by_user_id)
  values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'),
   '00000000-0000-4000-8000-00000000aaaa/00000000-0000-4000-8000-00000000ee02.png', 'image/png', 10,
   'PHOTOGRAPH', 'openai', 'gpt-image-1', 'x', 'SLIDE', pg_temp.rls_id('user_b'))
$$, '23514', null, 'a generated image cannot be filed as anything but AI-generated');
select throws_ok($$
  insert into artifacts.document_images
    (tenant_id, organisation_id, storage_key, content_type, byte_size,
     provider_code, model_code, prompt, purpose, created_by_user_id)
  values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'),
   '../../etc/passwd', 'image/png', 10, 'openai', 'gpt-image-1', 'x', 'SLIDE', pg_temp.rls_id('user_b'))
$$, '23514', null, 'a storage key is the fixed shape, never a path a caller chose');

select is((select public from storage.buckets where id = 'cq-document-images'), false,
  'the bucket is private');
select is((select count(*)::int from pg_policies
            where schemaname = 'storage' and tablename = 'objects'
              and (qual like '%cq-document-images%' or with_check like '%cq-document-images%')), 0,
  'no storage policy opens the bucket to a browser session');

select ok((select pg_get_constraintdef(oid) from pg_constraint
            where conname = 'model_usage_task_class_check') like '%IMAGE_GENERATION%',
  'image generation is a Model Gateway task class, recorded like any other');

select * from finish();
rollback;
