-- DOCS · artifacts.brand_kit_versions: a company's own look (logo,
-- colours, type pairing) for the documents Q prepares for it.
--
-- Append-only and versioned. A suggestion Q read from the company's
-- website is a RECOMMENDED row; nothing applies until the person confirms
-- it, which writes a CONFIRMED row copying exactly the suggestion they
-- were shown (based_on_version). Values a person sets themselves are a
-- declaration and are CONFIRMED as given. The effective kit is the latest
-- CONFIRMED row. Content about the company: it colours the company's own
-- files and never the Capital Q chrome (--cq-* tokens, ADR-001 D3).
--
-- Server-only, the same posture as artifacts.artifacts: RLS on, no policy,
-- no browser grant. Read and written through the Q API under an explicit
-- actor context.

create table artifacts.brand_kit_versions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  organisation_id     uuid not null,
  company_id          uuid references core.companies (id) on delete restrict,
  version             integer not null check (version >= 1),
  status              text not null
                        check (status in ('RECOMMENDED', 'CONFIRMED', 'DECLINED')),
  source              text not null
                        check (source in ('WEBSITE', 'PERSON', 'Q_DESIGN')),
  source_url          text check (source_url is null or (length(source_url) <= 2048 and source_url ~ '^https?://')),
  palette             jsonb not null
                        check (jsonb_typeof(palette) = 'object'
                               and palette ? 'primary'
                               and length(palette::text) <= 400),
  pairing             text check (pairing is null or pairing ~ '^[A-Z][A-Z0-9_]{2,47}$'),
  logo                bytea check (logo is null or octet_length(logo) between 8 and 524288),
  logo_content_type   text check (logo_content_type is null or logo_content_type in ('image/png', 'image/jpeg')),
  constraint brand_kit_versions_logo_typed
    check ((logo is null) = (logo_content_type is null)),
  based_on_version    integer check (based_on_version is null or based_on_version >= 1),
  constraint brand_kit_versions_confirmation_names_its_suggestion
    check (based_on_version is null or status in ('CONFIRMED', 'DECLINED')),
  created_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  created_at          timestamptz not null default now(),
  unique (organisation_id, version),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

comment on table artifacts.brand_kit_versions is
  'A company''s look for the documents Q prepares (logo, colours, type pairing). Append-only versions; RECOMMENDED until the person confirms; the latest CONFIRMED row applies. Never the Capital Q chrome, never evidence.';
comment on column artifacts.brand_kit_versions.based_on_version is
  'For a CONFIRMED or DECLINED row: the RECOMMENDED version the person answered. Confirmation copies that version''s payload exactly; a newer suggestion does not change what was confirmed.';
comment on column artifacts.brand_kit_versions.logo is
  'PNG or JPEG bytes, at most 512 KB, magic-byte checked by the server before insert. Stored here rather than linked so a renderer fetches nothing a brand kit names.';

create index brand_kit_versions_latest_idx
  on artifacts.brand_kit_versions (tenant_id, organisation_id, version desc);

-- Append-only: corrections are new versions.
create or replace function artifacts.brand_kit_versions_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'artifacts.brand_kit_versions is append-only'
    using errcode = '55000';
end;
$$;

create trigger brand_kit_versions_append_only
  before update or delete on artifacts.brand_kit_versions
  for each row execute function artifacts.brand_kit_versions_append_only();

alter table artifacts.brand_kit_versions enable row level security;
revoke all on artifacts.brand_kit_versions from anon, authenticated;
revoke all on function artifacts.brand_kit_versions_append_only() from public, anon, authenticated;
