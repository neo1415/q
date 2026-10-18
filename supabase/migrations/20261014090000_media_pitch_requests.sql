-- VID · Idempotency record for creating or replacing a company's pitch
-- (POST /v1/companies/:companyId/pitch; doc 22 §43; CLAUDE.md "every
-- consequential action carries an idempotency key").
--
-- Replacing a pitch supersedes the current one, so a retried request whose
-- first answer was lost must get that same new asset back, never a second
-- replacement and never a conflict for a change that did happen. The key is
-- the client's; only its hash is stored, next to a fingerprint of what the
-- request meant, so the same key reused for a different request is refused.
--
-- Server-only, in the pattern of network.interest_requests: no policies and
-- no client grants. Written in the same transaction as the asset it names.

create table media.pitch_requests (
  user_id               uuid not null references identity.user_profiles (id) on delete restrict,
  organisation_id       uuid not null,
  tenant_id             uuid not null,
  idempotency_key_hash  text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_hash          text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  media_asset_id        uuid not null,
  created_at            timestamptz not null default clock_timestamp(),
  primary key (user_id, organisation_id, idempotency_key_hash),
  foreign key (organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict,
  -- The asset in the same tenant as the record, never another tenant's.
  foreign key (media_asset_id, tenant_id)
    references media.media_assets (id, tenant_id) on delete restrict
);

comment on table media.pitch_requests is
  'Idempotency record for creating or replacing a company pitch: (person, organisation, key hash) -> the media asset the request created. Hashes only; written in the creation transaction; server-only.';

create index pitch_requests_media_asset_idx
  on media.pitch_requests (media_asset_id);

alter table media.pitch_requests enable row level security;
-- No policies and no client grants: server-internal.
