-- Brand theming (P5, founder 2026-10-05): an admin sets the brand's primary
-- colour so Capital Q takes on any brand in a few clicks. One row for the
-- platform default (tenant_id null) and at most one per tenant, which wins
-- over the default for that tenant's people. The web app derives readable
-- accent tokens from the colour (AA in both themes); only the colour is kept.
--
-- INTERNAL_SERVER_ONLY like the rest of platform_ops: RLS on, no policy and
-- no grant for anon or authenticated. The API reads the effective colour for
-- the signed-in person's tenant and lets only a platform admin holding the
-- write permission change it (with step-up); every change is recorded in
-- platform_ops.admin_actions with the colour before and after.

create table platform_ops.brand_themes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references identity.tenants (id) on delete cascade,
  -- Lowercase #rrggbb only: the value is written into a style element, so
  -- nothing but a colour may ever be stored.
  primary_hex  text not null check (primary_hex ~ '^#[0-9a-f]{6}$'),
  updated_by   uuid not null references identity.user_profiles (id) on delete restrict,
  updated_at   timestamptz not null default clock_timestamp()
);

-- One platform default, and one row per tenant.
create unique index brand_themes_platform_key on platform_ops.brand_themes ((true)) where tenant_id is null;
create unique index brand_themes_tenant_key on platform_ops.brand_themes (tenant_id) where tenant_id is not null;

alter table platform_ops.brand_themes enable row level security;

revoke all on platform_ops.brand_themes from public, anon, authenticated;
grant select, insert, update, delete on platform_ops.brand_themes to postgres, service_role;

comment on table platform_ops.brand_themes is
  'Brand primary colour: the platform default (tenant_id null) and per-tenant overrides. Server-only; changes audited in admin_actions.';
