-- GateQ brand from website (owner 2026-11-14): an investor organisation's
-- admins brand their gateway from the website already on their canonical
-- record. Capital Q reads the site for the organisation's name, logo and
-- colours; the admin corrects what is missing or wrong, then saves.
--
--   gateway logo asset ≠ the organisation's card photo (public identity)
--   gateway display name ≠ the canonical organisation name (which stays
--                          the authority everywhere else)
--
-- A logo found on the site is kept here, in Capital Q's own storage, and
-- the public gateway serves these bytes: it is never hot-linked from the
-- organisation's site. PNG or JPEG only (checked by magic bytes before the
-- insert), at most 512 KB, the same bound as the documents' brand kit
-- logo. ICON: the site's favicon or touch icon, which the admin chose
-- knowing it is not a full logo; a logo is never invented.
--
-- Append-only like the appearance revisions: an asset is history and is
-- never rewritten. Server-only like every gateq table: RLS on, no policy,
-- no browser grant.

create table gateq.gateway_logo_assets (
  id                  uuid primary key default gen_random_uuid(),
  gateway_id          uuid not null references gateq.gateways (id) on delete restrict,
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  kind                text not null check (kind in ('LOGO', 'ICON')),
  content_type        text not null check (content_type in ('image/png', 'image/jpeg')),
  bytes               bytea not null check (octet_length(bytes) between 8 and 524288),
  sha256              text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Where on the organisation's own site it was found (provenance).
  source_url          text not null check (length(source_url) <= 2048 and source_url ~* '^https?://'),
  created_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  created_at          timestamptz not null default now(),
  -- The appearance's reference names the gateway too, so a revision can
  -- only point at its own gateway's logo.
  unique (id, gateway_id),
  -- One row per image per gateway: reading the site again reuses it.
  unique (gateway_id, sha256, kind)
);

comment on table gateq.gateway_logo_assets is
  'Brand from website: a logo (or, labelled ICON, a site icon) read from the organisation''s canonical website and kept by Capital Q, so the public gateway never hot-links it. Append-only. Never a ranking signal.';

create trigger gateway_logo_assets_tenant before insert on gateq.gateway_logo_assets
  for each row execute function gateq.inbox_gateway_tenant_matches();

create or replace function gateq.protect_gateway_logo_asset_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'a gateway logo asset is history and is never rewritten'
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function gateq.protect_gateway_logo_asset_history() from public;

create trigger gateway_logo_assets_append_only before update or delete on gateq.gateway_logo_assets
  for each row execute function gateq.protect_gateway_logo_asset_history();

alter table gateq.gateway_logo_assets enable row level security;

revoke all on gateq.gateway_logo_assets from anon, authenticated;

-- The appearance revision now also carries the gateway's display name and
-- logo. Both nullable: null is the canonical name and no logo, which is
-- what every earlier revision meant.
alter table gateq.gateway_appearances
  add column display_name text
    check (display_name is null or length(btrim(display_name)) between 1 and 120),
  add column logo_asset_id uuid,
  add constraint gateway_appearances_logo_same_gateway
    foreign key (logo_asset_id, gateway_id)
    references gateq.gateway_logo_assets (id, gateway_id)
    on delete restrict;

create index gateway_appearances_logo_idx
  on gateq.gateway_appearances (logo_asset_id)
  where logo_asset_id is not null;
