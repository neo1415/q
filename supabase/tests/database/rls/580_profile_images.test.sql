-- Profile photos and covers · core.profile_images, server-internal
-- (lead-owned test, for review).
--
-- One READY image per subject and kind; rows are history (never deleted,
-- never re-owned, an ended row never returns); a person's image belongs to
-- that person and carries no organisation; the bucket is private and takes
-- raster images only. No browser principal may read or write the table.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(14);

insert into core.profile_images (id, tenant_id, organisation_id, subject_type, subject_id, kind, status,
    upload_key, declared_content_type, declared_byte_size, object_key, width, height, byte_size,
    created_by_user_id, upload_expires_at, ready_at) values
  ('00000000-0000-4000-8000-0000000003a1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'COMPANY',
   '00000000-0000-4000-8000-0000000003c1', 'AVATAR', 'READY', 'raw/a1', 'image/png', 2048,
   'img/a1.webp', 512, 512, 1024, pg_temp.rls_id('user_a'), now() + interval '15 minutes', now()),
  ('00000000-0000-4000-8000-0000000003a2', pg_temp.rls_id('tenant_a'), null, 'PERSON',
   pg_temp.rls_id('user_a'), 'COVER', 'PENDING', 'raw/a2', 'image/jpeg', 4096,
   null, null, null, null, pg_temp.rls_id('user_a'), now() + interval '15 minutes', null);

-- Shape ------------------------------------------------------------------------
select is((select relrowsecurity from pg_class where oid = 'core.profile_images'::regclass), true,
  'row level security is on');
select is((select count(*)::int from pg_policies where schemaname = 'core' and tablename = 'profile_images'), 0,
  'no policies: server-internal');
select is((select public from storage.buckets where id = 'cq-profile-images'), false,
  'the image bucket is private: reads are signed URLs');
select ok((select not ('image/svg+xml'::text = any (allowed_mime_types)) from storage.buckets where id = 'cq-profile-images'),
  'the bucket refuses SVG (script-bearing)');

-- Rules ------------------------------------------------------------------------
select throws_ok(
  $$ insert into core.profile_images (tenant_id, organisation_id, subject_type, subject_id, kind, status,
       upload_key, declared_content_type, declared_byte_size, object_key, width, height, byte_size,
       created_by_user_id, upload_expires_at, ready_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'COMPANY', '00000000-0000-4000-8000-0000000003c1',
       'AVATAR', 'READY', 'raw/dup', 'image/png', 10, 'img/dup.webp', 512, 512, 10,
       pg_temp.rls_id('user_a'), now(), now()) $$,
  '23505', null, 'one current image per subject and kind');
select throws_ok(
  $$ insert into core.profile_images (tenant_id, organisation_id, subject_type, subject_id, kind,
       upload_key, declared_content_type, declared_byte_size, created_by_user_id, upload_expires_at)
     values (pg_temp.rls_id('tenant_a'), null, 'PERSON', pg_temp.rls_id('user_b'), 'AVATAR',
       'raw/x', 'image/png', 10, pg_temp.rls_id('user_a'), now()) $$,
  '23514', null, 'a person''s image can only be uploaded by that person');
select throws_ok(
  $$ insert into core.profile_images (tenant_id, organisation_id, subject_type, subject_id, kind,
       upload_key, declared_content_type, declared_byte_size, created_by_user_id, upload_expires_at)
     values (pg_temp.rls_id('tenant_a'), null, 'COMPANY', gen_random_uuid(), 'AVATAR',
       'raw/x', 'image/png', 10, pg_temp.rls_id('user_a'), now()) $$,
  '23514', null, 'an organisation''s image names its organisation');
select throws_ok(
  $$ insert into core.profile_images (tenant_id, organisation_id, subject_type, subject_id, kind,
       upload_key, declared_content_type, declared_byte_size, created_by_user_id, upload_expires_at)
     values (pg_temp.rls_id('tenant_a'), null, 'PERSON', pg_temp.rls_id('user_a'), 'AVATAR',
       'raw/x', 'image/svg+xml', 10, pg_temp.rls_id('user_a'), now()) $$,
  '23514', null, 'SVG is not an accepted image type');
select throws_ok(
  $$ update core.profile_images set status = 'READY' where id = '00000000-0000-4000-8000-0000000003a2' $$,
  '23514', null, 'a READY image carries its server rendition');
select throws_ok(
  $$ delete from core.profile_images where id = '00000000-0000-4000-8000-0000000003a1' $$,
  '23514', null, 'images are history: never deleted');
select throws_ok(
  $$ update core.profile_images set subject_id = gen_random_uuid() where id = '00000000-0000-4000-8000-0000000003a1' $$,
  '23514', null, 'an image never changes owner in place');

update core.profile_images set status = 'REMOVED', ended_at = now()
 where id = '00000000-0000-4000-8000-0000000003a1';
select throws_ok(
  $$ update core.profile_images set status = 'READY', ended_at = null where id = '00000000-0000-4000-8000-0000000003a1' $$,
  '23514', 'an ended profile image is history', 'a removed image never comes back');

-- Browser principals -------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from core.profile_images $$, '42501', null,
  'user A cannot read image rows directly, even their own');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from core.profile_images $$, '42501', null,
  'an anonymous visitor cannot read image rows');

select * from finish();
rollback;
