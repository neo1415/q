-- Brand presets (K3, founder 2026-10-06; ADR 0051): "Capital Q's colours
-- are black and gold... anybody should be able to change the branding at
-- any time". A preset sets the page, surfaces, menu bar, accent and Q's
-- light together; the admin's own primary colour, when set, still goes on
-- top. Black and gold is the platform default: a missing row means it,
-- and every existing row moves to it (the founder's switch), keeping its
-- colour. Classic blue is one click back in the console.
--
-- Only the preset's key is stored. The palettes are code, each pair's
-- contrast tested, so the key is checked for its spelling here and
-- against the known presets by the API (reference data, never an enum).
--
-- RLS is unchanged: INTERNAL_SERVER_ONLY, no policy and no client grant.

alter table platform_ops.brand_themes
  add column preset_key text not null default 'black_gold'
    check (preset_key ~ '^[a-z][a-z0-9_]{0,39}$');

-- A preset with its own accent stores no colour.
alter table platform_ops.brand_themes
  alter column primary_hex drop not null;

comment on column platform_ops.brand_themes.preset_key is
  'Brand preset key (black_gold, classic_blue). Palettes live in code; the API accepts only known keys.';
comment on column platform_ops.brand_themes.primary_hex is
  'Optional primary colour over the preset (lowercase #rrggbb, written into a style element); null keeps the preset''s accent.';
comment on table platform_ops.brand_themes is
  'Brand preset and optional primary colour: the platform default (tenant_id null) and per-tenant overrides. Server-only; changes audited in admin_actions.';
