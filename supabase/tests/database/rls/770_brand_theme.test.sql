-- P5 · platform_ops.brand_themes: the brand's primary colour, a platform
-- default and at most one per tenant. Server-only: no browser session (in
-- any tenant, member or not) reads or writes it; only a #rrggbb colour can
-- be stored, because the value is written into a style element.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the API lets only a platform admin change it).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(16);

-- Shape ------------------------------------------------------------------------
select has_table('platform_ops', 'brand_themes', 'brand themes are kept');
select ok((select relrowsecurity from pg_class where oid = 'platform_ops.brand_themes'::regclass),
  'RLS is on');
select is((select count(*)::int from pg_policies where schemaname = 'platform_ops' and tablename = 'brand_themes'),
  0, 'no policy for any client role');

-- Rules (positive and negative) -------------------------------------------------
select lives_ok(
  $$ insert into platform_ops.brand_themes (tenant_id, primary_hex, updated_by)
     values (null, '#0f766e', pg_temp.rls_id('user_a')) $$,
  'the server sets the platform default');
select lives_ok(
  $$ insert into platform_ops.brand_themes (tenant_id, primary_hex, updated_by)
     values (pg_temp.rls_id('tenant_a'), '#7c3aed', pg_temp.rls_id('user_a')) $$,
  'and a tenant override');
select throws_ok(
  $$ insert into platform_ops.brand_themes (tenant_id, primary_hex, updated_by)
     values (null, '#123456', pg_temp.rls_id('user_a')) $$,
  '23505', null, 'there is only one platform default');
select throws_ok(
  $$ insert into platform_ops.brand_themes (tenant_id, primary_hex, updated_by)
     values (pg_temp.rls_id('tenant_a'), '#123456', pg_temp.rls_id('user_a')) $$,
  '23505', null, 'and one row per tenant');
select throws_ok(
  $$ insert into platform_ops.brand_themes (tenant_id, primary_hex, updated_by)
     values (pg_temp.rls_id('tenant_b'), 'red;}</style>', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'nothing but a #rrggbb colour is stored');
select throws_ok(
  $$ insert into platform_ops.brand_themes (tenant_id, primary_hex, updated_by)
     values (pg_temp.rls_id('tenant_b'), '#0F766E', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'lowercase only, so one colour has one spelling');
select throws_ok(
  $$ insert into platform_ops.brand_themes (tenant_id, primary_hex, updated_by)
     values (pg_temp.rls_id('tenant_b'), '#0f766e', null) $$,
  '23502', null, 'every colour names who set it');

-- RLS: server-only, cross-tenant negative, revoked member negative ---------------
select pg_temp.act_as_user_a();
select throws_ok($$ select primary_hex from platform_ops.brand_themes $$, '42501', null,
  'a member cannot read brand themes, not even their own tenant''s');
select throws_ok(
  $$ update platform_ops.brand_themes set primary_hex = '#000000' where tenant_id = pg_temp.rls_id('tenant_a') $$,
  '42501', null, 'nor change their own tenant''s colour');
select pg_temp.act_as_user_b();
select throws_ok(
  $$ insert into platform_ops.brand_themes (tenant_id, primary_hex, updated_by)
     values (pg_temp.rls_id('tenant_b'), '#000000', pg_temp.rls_id('user_b')) $$,
  '42501', null, 'another tenant''s member cannot set one either');
select pg_temp.act_as_revoked_user();
select throws_ok($$ select 1 from platform_ops.brand_themes $$, '42501', null,
  'a person whose membership was revoked cannot read it');
select pg_temp.act_as_anonymous();
select throws_ok($$ select 1 from platform_ops.brand_themes $$, '42501', null,
  'anonymous visitors cannot read it');
select pg_temp.act_as_privileged();
select is((select count(*)::int from platform_ops.brand_themes), 2,
  'the privileged server role reads every row');

select * from finish();
rollback;
