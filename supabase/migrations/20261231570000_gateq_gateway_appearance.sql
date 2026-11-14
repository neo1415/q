-- B6 / B7 (2026-11-14): an investor brands and places their own gateway.
--
--   gateway appearance ≠ the tenant's brand theme (platform_ops.brand_themes)
--   gateway appearance ≠ the published policy (gateq.gateway_versions)
--
-- Until now the public gateway's accent came only from the tenant's brand
-- theme, which a platform operator sets. An organisation admin now sets
-- their gateway's own accent colour and the sites allowed to frame its
-- embed, through GateQ's own gateway authority (investor.gateway.publish:
-- what the public sees is the publishing admin's call). Every change is a
-- new revision; nothing is overwritten, so who showed what, when, stays
-- answerable. The newest revision is the gateway's appearance.
--
-- Server-only like every gateq table: RLS on, no policy, no browser grant.
-- The web derives AA-safe accent tokens from the colour (brandPalette), so
-- only the colour is stored, in the one spelling a style element accepts.

create table gateq.gateway_appearances (
  id                  uuid primary key default gen_random_uuid(),
  gateway_id          uuid not null references gateq.gateways (id) on delete restrict,
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  revision            integer not null check (revision >= 1),
  -- Null: Capital Q's accent (or the tenant's brand theme, when one exists).
  accent_hex          text check (accent_hex ~ '^#[0-9a-f]{6}$'),
  -- Origins only (scheme, host, optional port): they are written into a
  -- Content-Security-Policy header, so nothing else may be stored. Empty:
  -- any site may frame the embed, as before. https only, except a local
  -- http://localhost for an investor testing their own site.
  embed_origins       text[] not null default '{}'
                        check (cardinality(embed_origins) <= 10)
                        check (array_position(embed_origins, null) is null)
                        check (
                          cardinality(embed_origins) = 0
                          or array_to_string(embed_origins, E'\n') ~
                            '^(https://[a-z0-9-]+(\.[a-z0-9-]+)*|http://localhost)(:[0-9]{1,5})?(\n(https://[a-z0-9-]+(\.[a-z0-9-]+)*|http://localhost)(:[0-9]{1,5})?)*$'
                        ),
  created_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  created_at          timestamptz not null default now(),
  unique (gateway_id, revision)
);

comment on table gateq.gateway_appearances is
  'B6/B7: a gateway''s accent colour and allowed embed origins, one row per revision; the newest is current. Set by the owning organisation''s admins (investor.gateway.publish). Never a ranking signal.';

create index gateway_appearances_current_idx
  on gateq.gateway_appearances (gateway_id, revision desc);

-- The row's tenant is the gateway's (the existing inbox helper asserts it).
create trigger gateway_appearances_tenant before insert on gateq.gateway_appearances
  for each row execute function gateq.inbox_gateway_tenant_matches();

create or replace function gateq.protect_gateway_appearance_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'a gateway appearance revision is history and is never rewritten'
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function gateq.protect_gateway_appearance_history() from public;

create trigger gateway_appearances_append_only before update or delete on gateq.gateway_appearances
  for each row execute function gateq.protect_gateway_appearance_history();

alter table gateq.gateway_appearances enable row level security;

revoke all on gateq.gateway_appearances from anon, authenticated;
