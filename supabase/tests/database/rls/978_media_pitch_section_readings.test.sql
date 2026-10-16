-- Lane ov · media.pitch_section_readings: Q's section-by-section read of a
-- pitch transcript, once per pitch, language, prompt and section-list
-- version; bounded; server-only (no browser principal reads it, in any
-- tenant, its own company's included -- the media context authorises every
-- read with the pitch's playback rule).
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes and reads rows.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(9);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000978c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Section Co A', 'section-co-a-978'),
  ('00000000-0000-4000-8000-0000000978c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Section Co B', 'section-co-b-978');

insert into media.media_assets
  (id, tenant_id, owner_type, owner_id, owner_organisation_id, purpose, created_by_user_id)
values
  ('00000000-0000-4000-8000-0000000978a1', pg_temp.rls_id('tenant_a'), 'COMPANY',
   '00000000-0000-4000-8000-0000000978c1', pg_temp.rls_id('org_a'), 'FOUNDER_PITCH', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000978a2', pg_temp.rls_id('tenant_b'), 'COMPANY',
   '00000000-0000-4000-8000-0000000978c2', pg_temp.rls_id('org_b'), 'FOUNDER_PITCH', pg_temp.rls_id('user_b'));

select lives_ok(
  $$ insert into media.pitch_section_readings
       (tenant_id, media_asset_id, language, prompt_version, sections_version, sections)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000978a1', 'en', 1, 'v1',
             '[{"key":"problem","facts":[{"label":"Delay","value":"a day","atSeconds":12}]}]'::jsonb) $$,
  'the server stores a reading of a pitch');
select throws_ok(
  $$ insert into media.pitch_section_readings
       (tenant_id, media_asset_id, language, prompt_version, sections_version, sections)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000978a1', 'en', 1, 'v1', '[]'::jsonb) $$,
  '23505', null, 'one reading per pitch, language, prompt and section-list version (read once, cached)');
select lives_ok(
  $$ insert into media.pitch_section_readings
       (tenant_id, media_asset_id, language, prompt_version, sections_version, sections)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000978a1', 'en', 2, 'v1', '[]'::jsonb) $$,
  'a new prompt version is a new row, never an overwrite');
select throws_ok(
  $$ insert into media.pitch_section_readings
       (tenant_id, media_asset_id, language, prompt_version, sections_version, sections)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000978a2', 'en', 1, 'v1', '{}'::jsonb) $$,
  '23514', null, 'sections are an array');
select throws_ok(
  $$ insert into media.pitch_section_readings
       (tenant_id, media_asset_id, language, prompt_version, sections_version, sections)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000978a2', 'English', 1, 'v1', '[]'::jsonb) $$,
  '23514', null, 'the language is a language tag');

select pg_temp.act_as_user_a();
select throws_ok($$ select * from media.pitch_section_readings $$, '42501', null,
  'browser user A cannot read readings, even of their own company''s pitch');
select throws_ok(
  $$ insert into media.pitch_section_readings
       (tenant_id, media_asset_id, language, prompt_version, sections_version, sections)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000978a2', 'en', 9, 'v1', '[]'::jsonb) $$,
  '42501', null, 'a browser user cannot write a reading for another tenant''s pitch');
select pg_temp.act_as_user_b();
select throws_ok($$ select * from media.pitch_section_readings $$, '42501', null,
  'browser user B (another tenant) is denied too');
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from media.pitch_section_readings $$, '42501', null, 'anonymous denied');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
