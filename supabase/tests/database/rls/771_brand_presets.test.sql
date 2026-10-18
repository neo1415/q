-- K3 · platform_ops.brand_themes.preset_key: a preset (black and gold by
-- default) with an optional colour on top. Server-only as before: no
-- browser session reads or writes it, in any tenant.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the API lets only a platform admin change it,
-- and accepts only the presets the web app can paint).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(12);

-- Shape ------------------------------------------------------------------------
select has_column('platform_ops', 'brand_themes', 'preset_key', 'a preset is kept');
select col_not_null('platform_ops', 'brand_themes', 'preset_key', 'every row names a preset');
select col_default_is('platform_ops', 'brand_themes', 'preset_key', 'black_gold',
  'black and gold is the default preset');
select col_is_null('platform_ops', 'brand_themes', 'primary_hex',
  'the colour is optional over a preset');

-- Rules (positive and negative) -------------------------------------------------
select lives_ok(
  $$ insert into platform_ops.brand_themes (tenant_id, primary_hex, updated_by)
     values (null, null, pg_temp.rls_id('user_a')) $$,
  'the server sets the platform default to a preset alone');
select is((select preset_key from platform_ops.brand_themes where tenant_id is null),
  'black_gold', 'and it is black and gold unless named');
select lives_ok(
  $$ insert into platform_ops.brand_themes (tenant_id, preset_key, primary_hex, updated_by)
     values (pg_temp.rls_id('tenant_a'), 'classic_blue', '#0f766e', pg_temp.rls_id('user_a')) $$,
  'a tenant switches back to classic blue with its own colour');
select throws_ok(
  $$ insert into platform_ops.brand_themes (tenant_id, preset_key, updated_by)
     values (pg_temp.rls_id('tenant_b'), 'Gold;}</style>', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'a preset key is a plain lowercase word, never markup');
select throws_ok(
  $$ insert into platform_ops.brand_themes (tenant_id, preset_key, updated_by)
     values (pg_temp.rls_id('tenant_b'), null, pg_temp.rls_id('user_a')) $$,
  '23502', null, 'and never missing');

-- RLS: server-only, cross-tenant negative, revoked negative ----------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select preset_key from platform_ops.brand_themes $$, '42501', null,
  'a member cannot read the preset, not even their own tenant''s');
select pg_temp.act_as_user_b();
select throws_ok(
  $$ update platform_ops.brand_themes set preset_key = 'classic_blue' where tenant_id = pg_temp.rls_id('tenant_a') $$,
  '42501', null, 'another tenant''s member cannot change it');
select pg_temp.act_as_revoked_user();
select throws_ok($$ select preset_key from platform_ops.brand_themes $$, '42501', null,
  'a person whose membership was revoked cannot read it');

select * from finish();
rollback;
