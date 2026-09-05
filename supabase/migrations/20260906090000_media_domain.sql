-- CQ-MEDIA-001 · Pitch media domain: Capital Q's canonical record of a piece
-- of pitch media, its lifecycle, and the lineage that survives replacement
-- (doc 20 §5–8, §14, §19–20, §99–100; doc 13; doc 15).
--
--   MediaAsset ≠ provider asset
--   media READY ≠ company discoverable ≠ pitch approved
--   encoding status ≠ moderation status
--   video quality ≠ investment quality
--
-- No video bytes live in PostgreSQL and none ever will: a managed provider
-- stores and delivers them. What lives here is who owns the media, what it
-- is for, where it stands, and which external asset — if any yet — holds the
-- bytes. The provider's identifier is replaceable integration metadata,
-- never this record's identity and never a permission.

create schema if not exists media;
comment on schema media is
  'Media bounded context: canonical pitch media assets and their lifecycle. Never company identity, never recommendation input, never video bytes.';

revoke all on schema media from public, anon, authenticated;
grant usage on schema media to postgres, service_role;

-- ---------------------------------------------------------------------------
-- media.media_assets
--
-- Ownership is polymorphic but bounded, exactly as evidence subjects are: a
-- closed set of owner types resolved through a typed registry over the
-- owning domain's query port. There is no dynamic table lookup anywhere.
-- ---------------------------------------------------------------------------

create table media.media_assets (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references identity.tenants (id) on delete restrict,

  -- Bounded owner. Adding a type is a deliberate schema and resolver change,
  -- never a string a caller invents.
  owner_type               text not null check (owner_type in ('COMPANY')),
  owner_id                 uuid not null,
  -- The organisation accountable for the owning resource, resolved from the
  -- owner at creation. Never supplied by a client.
  owner_organisation_id    uuid not null,

  -- Policy differs by purpose: a founder pitch is made to be shown to
  -- investors, and its rules must never be inherited by a recording of a
  -- private conversation. MEETING_RECORDING is deliberately absent.
  purpose                  text not null check (purpose in (
                             'FOUNDER_PITCH', 'COMPANY_PRODUCT_DEMO', 'OTHER')),

  -- UNASSIGNED is the truthful state before any provider integration
  -- exists. A fake identifier to fill the column would make the row lie.
  provider                 text not null default 'UNASSIGNED'
                             check (provider in ('UNASSIGNED', 'CLOUDFLARE_STREAM')),
  provider_asset_id        text check (provider_asset_id is null or
                             (provider_asset_id ~ '^[A-Za-z0-9._:-]+$'
                              and length(provider_asset_id) between 1 and 255)),

  -- Capital Q's lifecycle, not a mirror of vendor states (doc 20 §14).
  status                   text not null default 'CREATED' check (status in (
                             'CREATED', 'UPLOAD_PENDING', 'UPLOADING', 'PROCESSING',
                             'READY', 'UPLOAD_FAILED', 'PROCESSING_FAILED',
                             'EXPIRED', 'DELETED')),

  -- Provider-normalised technical facts. They describe a video and say
  -- nothing about a company; product duration guidance lives in application
  -- configuration, not in this bound.
  duration_seconds         integer check (duration_seconds is null or duration_seconds between 1 and 86400),
  width                    integer check (width is null or width between 1 and 16384),
  height                   integer check (height is null or height between 1 and 16384),
  aspect_ratio             text check (aspect_ratio is null or aspect_ratio ~ '^[0-9]{1,3}:[0-9]{1,3}$'),
  thumbnail_reference      text check (thumbnail_reference is null or
                             (thumbnail_reference ~ '^[A-Za-z0-9][A-Za-z0-9/_.:-]*$'
                              and length(thumbnail_reference) between 1 and 255)),

  -- What kind of authorization playback demands. Not a DisclosureScope:
  -- disclosure decides whether this viewer may see this company's material,
  -- and both must be satisfied. A new pitch is PRIVATE.
  playback_policy          text not null default 'PRIVATE'
                             check (playback_policy in ('PRIVATE', 'AUTHORISED', 'PUBLIC')),

  -- Separate from lifecycle on purpose: a provider can encode a video
  -- perfectly that Capital Q must not show.
  moderation_status        text not null default 'NOT_REVIEWED'
                             check (moderation_status in ('NOT_REVIEWED', 'PENDING', 'ALLOWED', 'BLOCKED')),

  -- Derived text lifecycles. Nothing generates either yet, and neither is a
  -- canonical company fact when it eventually does.
  caption_state            text not null default 'NOT_REQUESTED'
                             check (caption_state in ('NOT_REQUESTED', 'PENDING', 'AVAILABLE', 'FAILED')),
  transcript_state         text not null default 'NOT_REQUESTED'
                             check (transcript_state in ('NOT_REQUESTED', 'PENDING', 'AVAILABLE', 'FAILED')),

  -- Lineage. Replacing a pitch creates a new asset that points at the old
  -- one; the old row stays historically interpretable and is never rewritten.
  replaces_media_asset_id  uuid references media.media_assets (id) on delete restrict,
  -- Set on the predecessor when a successor replaces it. Superseded is not
  -- deleted: the media still exists, it is simply no longer the current one.
  superseded_at            timestamptz,

  created_by_user_id       uuid not null references identity.user_profiles (id) on delete restrict,
  created_at               timestamptz not null default now(),
  ready_at                 timestamptz,
  deleted_at               timestamptz,

  -- Optimistic concurrency. A late provider event carrying stale state must
  -- not overwrite a newer decision.
  version                  integer not null default 1 check (version >= 1),

  -- Only a READY asset has a ready time, and only a DELETED one a deletion
  -- time: the timestamps cannot disagree with the status they describe.
  constraint media_assets_ready_state_check
    check ((ready_at is null) or status in ('READY', 'DELETED')),
  constraint media_assets_deleted_state_check
    check ((deleted_at is null) = (status <> 'DELETED')),
  -- An asset never replaces itself.
  constraint media_assets_lineage_check
    check (replaces_media_asset_id is null or replaces_media_asset_id <> id),
  -- A provider identifier only means something once a provider is assigned.
  constraint media_assets_provider_reference_check
    check (provider <> 'UNASSIGNED' or provider_asset_id is null),

  foreign key (owner_organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict,
  -- Lets dependants reference (asset, tenant) as a pair.
  unique (id, tenant_id)
);

comment on table media.media_assets is
  'Canonical pitch media: ownership, purpose, lifecycle, playback policy, moderation and derived-text state, and replacement lineage. The provider asset id is integration metadata, never identity and never authorization. No video bytes are stored here.';
comment on column media.media_assets.provider_asset_id is
  'The external provider''s identifier for the bytes. Replaceable integration metadata: knowing it is never permission to play the media.';
comment on column media.media_assets.status is
  'Capital Q lifecycle. READY means the provider considers the media playable; it does not mean the company is discoverable, verified or approved.';
comment on column media.media_assets.moderation_status is
  'Content review, deliberately separate from encoding status: a provider may encode successfully something Capital Q must not show.';
comment on column media.media_assets.superseded_at is
  'Set on the predecessor when a replacement pitch is created. Superseded is not deleted; the asset remains historically interpretable.';

-- The single primary pitch, enforced by the database rather than by a
-- convention two concurrent requests could each believe they satisfied. At
-- most one live, unsuperseded founder pitch may exist per owner, so two
-- simultaneous replacements collide here instead of producing two "current"
-- pitches (doc 20 §8, §19).
create unique index media_assets_current_pitch_idx
  on media.media_assets (tenant_id, owner_type, owner_id)
  where purpose = 'FOUNDER_PITCH' and deleted_at is null and superseded_at is null;

-- One successor per predecessor: a lineage chain, never a lineage tree.
create unique index media_assets_replaces_idx
  on media.media_assets (replaces_media_asset_id)
  where replaces_media_asset_id is not null;

-- A provider identifier identifies one asset within that provider.
create unique index media_assets_provider_asset_idx
  on media.media_assets (provider, provider_asset_id)
  where provider_asset_id is not null;

create index media_assets_owner_idx
  on media.media_assets (tenant_id, owner_type, owner_id, purpose, created_at desc);
create index media_assets_status_idx
  on media.media_assets (status, created_at desc);

alter table media.media_assets enable row level security;

-- ---------------------------------------------------------------------------
-- Capabilities (production reference data; mirrored in the local seed).
--
-- Media authority is a capability, never a business title. Being the founder
-- or holding the title CEO grants nothing on its own.
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('media.create', 'Create or replace pitch media owned by the active organisation.'),
  ('media.view',   'Read pitch media metadata for the active organisation''s resources.'),
  ('media.manage', 'Delete pitch media and manage its lifecycle for the active organisation.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'media.create'),
      ('organisation_admin',  'media.view'),
      ('organisation_admin',  'media.manage'),
      -- A member may publish and replace their company's pitch; removing one
      -- is consequential and stays with organisation administrators.
      ('organisation_member', 'media.create'),
      ('organisation_member', 'media.view')
    )
on conflict (role_id, capability_id) do nothing;
