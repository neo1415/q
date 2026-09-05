-- CQ-MEDIA-001 · Pitch media: the single primary pitch, replacement lineage,
-- the separation of encoding from moderation, and the fact that no browser
-- reaches media rows at all.
--
--   MediaAsset ≠ provider asset
--   media READY ≠ company discoverable ≠ pitch approved
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(28);

-- Fixtures ------------------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Media Co A', 'media-co-a'),
  ('00000000-0000-4000-8000-0000000009c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Media Co B', 'media-co-b');

insert into media.media_assets
  (id, tenant_id, owner_type, owner_id, owner_organisation_id, purpose, created_by_user_id)
values
  ('00000000-0000-4000-8000-0000000009a1', pg_temp.rls_id('tenant_a'), 'COMPANY',
   '00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('org_a'), 'FOUNDER_PITCH', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000009a2', pg_temp.rls_id('tenant_b'), 'COMPANY',
   '00000000-0000-4000-8000-0000000009c2', pg_temp.rls_id('org_b'), 'FOUNDER_PITCH', pg_temp.rls_id('user_b'));

-- Defaults are conservative --------------------------------------------------------
select is((select status from media.media_assets where id = '00000000-0000-4000-8000-0000000009a1'),
  'CREATED', 'a new media asset is CREATED: a record exists, no video does');
select is((select playback_policy from media.media_assets where id = '00000000-0000-4000-8000-0000000009a1'),
  'PRIVATE', 'a new pitch is private; uploading never publishes');
select is((select moderation_status from media.media_assets where id = '00000000-0000-4000-8000-0000000009a1'),
  'NOT_REVIEWED', 'a new pitch is unreviewed, not allowed');
select is((select provider || '/' || coalesce(provider_asset_id, 'none') from media.media_assets where id = '00000000-0000-4000-8000-0000000009a1'),
  'UNASSIGNED/none', 'no provider asset is invented before a provider exists');
select is((select caption_state || '/' || transcript_state from media.media_assets where id = '00000000-0000-4000-8000-0000000009a1'),
  'NOT_REQUESTED/NOT_REQUESTED', 'captions and transcripts are separate states, and neither is faked');

-- Vocabulary is bounded --------------------------------------------------------------
select throws_ok(
  $$ update media.media_assets set status = 'PUBLISHED' where id = '00000000-0000-4000-8000-0000000009a1' $$,
  '23514', null, 'an asset cannot invent a lifecycle state');
select throws_ok(
  $$ update media.media_assets set moderation_status = 'READY' where id = '00000000-0000-4000-8000-0000000009a1' $$,
  '23514', null, 'moderation and encoding vocabularies are not interchangeable');
select throws_ok(
  $$ update media.media_assets set playback_policy = 'network_visible' where id = '00000000-0000-4000-8000-0000000009a1' $$,
  '23514', null, 'playback policy is not a disclosure scope');
select throws_ok(
  $$ insert into media.media_assets (tenant_id, owner_type, owner_id, owner_organisation_id, purpose, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), 'FOUNDER', '00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('org_a'), 'FOUNDER_PITCH', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'owner types are a closed set');
select throws_ok(
  $$ update media.media_assets set provider_asset_id = 'cf-uid-1' where id = '00000000-0000-4000-8000-0000000009a1' $$,
  '23514', null, 'a provider asset id means nothing without a provider');
select throws_ok(
  $$ update media.media_assets set ready_at = now() where id = '00000000-0000-4000-8000-0000000009a1' $$,
  '23514', null, 'only a ready asset carries a ready time');

-- Tenancy ------------------------------------------------------------------------------
select throws_ok(
  $$ insert into media.media_assets (tenant_id, owner_type, owner_id, owner_organisation_id, purpose, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000009c2', pg_temp.rls_id('org_b'), 'FOUNDER_PITCH', pg_temp.rls_id('user_a')) $$,
  '23503', null, 'media cannot be owned by an organisation outside its tenant');

-- The single primary pitch --------------------------------------------------------------
select throws_ok(
  $$ insert into media.media_assets (tenant_id, owner_type, owner_id, owner_organisation_id, purpose, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('org_a'), 'FOUNDER_PITCH', pg_temp.rls_id('user_a')) $$,
  '23505', null, 'a company has one current pitch; a second is a replacement, not a creation');
select lives_ok(
  $$ insert into media.media_assets (tenant_id, owner_type, owner_id, owner_organisation_id, purpose, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('org_a'), 'COMPANY_PRODUCT_DEMO', pg_temp.rls_id('user_a')) $$,
  'a product demo is not a pitch and does not collide with one');

-- Replacement lineage ----------------------------------------------------------------------
update media.media_assets set superseded_at = now(), version = version + 1
 where id = '00000000-0000-4000-8000-0000000009a1';
insert into media.media_assets
  (id, tenant_id, owner_type, owner_id, owner_organisation_id, purpose, created_by_user_id, replaces_media_asset_id)
values
  ('00000000-0000-4000-8000-0000000009a3', pg_temp.rls_id('tenant_a'), 'COMPANY',
   '00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('org_a'), 'FOUNDER_PITCH', pg_temp.rls_id('user_a'),
   '00000000-0000-4000-8000-0000000009a1');

select is((select count(*)::int from media.media_assets
            where owner_id = '00000000-0000-4000-8000-0000000009c1'
              and purpose = 'FOUNDER_PITCH'
              and deleted_at is null and superseded_at is null),
  1, 'exactly one pitch is current after a replacement');
select is((select count(*)::int from media.media_assets
            where owner_id = '00000000-0000-4000-8000-0000000009c1' and purpose = 'FOUNDER_PITCH'),
  2, 'the replaced pitch is still there; replacement never overwrites history');
select is((select replaces_media_asset_id from media.media_assets where id = '00000000-0000-4000-8000-0000000009a3'),
  '00000000-0000-4000-8000-0000000009a1'::uuid, 'the successor points at what it replaced');
select throws_ok(
  $$ insert into media.media_assets (tenant_id, owner_type, owner_id, owner_organisation_id, purpose, created_by_user_id, replaces_media_asset_id)
     values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('org_a'), 'FOUNDER_PITCH', pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-0000000009a1') $$,
  '23505', null, 'one successor per predecessor: lineage is a chain, never a tree');
select throws_ok(
  $$ delete from media.media_assets where id = '00000000-0000-4000-8000-0000000009a1' $$,
  '23503', null, 'a replaced pitch cannot be erased out from under its successor');

-- Deletion frees the slot ------------------------------------------------------------------
select lives_ok(
  $$ update media.media_assets set status = 'DELETED', deleted_at = now()
      where id = '00000000-0000-4000-8000-0000000009a3' $$,
  'deletion is a soft lifecycle state, not a row removal');
select is((select count(*)::int from media.media_assets
            where owner_id = '00000000-0000-4000-8000-0000000009c1'
              and purpose = 'FOUNDER_PITCH'
              and deleted_at is null and superseded_at is null),
  0, 'deleting the current pitch leaves the company with none, and no dangling current');

-- Provider identity is not a key ------------------------------------------------------------
update media.media_assets
   set provider = 'CLOUDFLARE_STREAM', provider_asset_id = 'provider-uid-1'
 where id = '00000000-0000-4000-8000-0000000009a2';
select throws_ok(
  $$ insert into media.media_assets (tenant_id, owner_type, owner_id, owner_organisation_id, purpose, created_by_user_id, provider, provider_asset_id)
     values (pg_temp.rls_id('tenant_b'), 'COMPANY', '00000000-0000-4000-8000-0000000009c2', pg_temp.rls_id('org_b'), 'COMPANY_PRODUCT_DEMO', pg_temp.rls_id('user_b'),
             'CLOUDFLARE_STREAM', 'provider-uid-1') $$,
  '23505', null, 'one provider asset belongs to one media asset');
select hasnt_column('media', 'media_assets', 'video_data', 'no video bytes are stored in PostgreSQL');
select hasnt_column('core', 'companies', 'pitch_video_url', 'the company table gains no competing pitch pointer');

-- Browser principals ---------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from media.media_assets $$,
  '42501', null, 'anonymous cannot read media assets');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from media.media_assets $$,
  '42501', null, 'an authenticated browser session cannot read media assets, even its own company''s');
select throws_ok(
  $$ update media.media_assets set status = 'READY' where id = '00000000-0000-4000-8000-0000000009a2' $$,
  '42501', null, 'a browser cannot declare media ready');

select pg_temp.act_as_privileged();
select is((select count(*)::int from media.media_assets), 4,
  'the privileged server role reads every asset; DB privilege is not business authorisation');

select * from finish();
rollback;
