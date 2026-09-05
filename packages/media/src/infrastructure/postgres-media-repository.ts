import { z } from "zod";

import { UtcTimestampSchema } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import type {
  CompanyPitchQueryPort,
  MediaAssetRepository,
  MediaRepositories,
} from "../application/ports.js";
import {
  CaptionStateSchema,
  MediaAssetIdSchema,
  MediaOwnerTypeSchema,
  MediaProviderSchema,
  MediaPurposeSchema,
  MediaStatusSchema,
  ModerationStatusSchema,
  PlaybackPolicySchema,
  toCompanyPitch,
  TranscriptStateSchema,
  type MediaAsset,
} from "../contracts/index.js";

/**
 * PostgreSQL for `media.media_assets`.
 *
 * Two habits run through every statement here. Tenant is always in the
 * predicate, never assumed from context. And every mutation carries the
 * expected version, so a stale writer — a late provider event, a retried
 * request, a second tab — updates zero rows and is told so rather than
 * quietly winning.
 */

const Timestamp = z
  .union([z.date(), z.string()])
  .transform((value) =>
    UtcTimestampSchema.parse(
      value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString(),
    ),
  );

const MediaAssetRow = z.object({
  id: MediaAssetIdSchema,
  tenant_id: TenantIdSchema,
  owner_type: MediaOwnerTypeSchema,
  owner_id: z.string().uuid(),
  owner_organisation_id: OrganisationIdSchema,
  purpose: MediaPurposeSchema,
  provider: MediaProviderSchema,
  provider_asset_id: z.string().nullable(),
  status: MediaStatusSchema,
  duration_seconds: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  aspect_ratio: z.string().nullable(),
  playback_policy: PlaybackPolicySchema,
  thumbnail_reference: z.string().nullable(),
  caption_state: CaptionStateSchema,
  transcript_state: TranscriptStateSchema,
  moderation_status: ModerationStatusSchema,
  replaces_media_asset_id: MediaAssetIdSchema.nullable(),
  superseded_at: Timestamp.nullable(),
  created_by_user_id: UserIdSchema,
  created_at: Timestamp,
  ready_at: Timestamp.nullable(),
  deleted_at: Timestamp.nullable(),
  version: z.number().int().min(1),
});

function toAsset(row: unknown): MediaAsset {
  const r = MediaAssetRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    ownerType: r.owner_type,
    ownerId: r.owner_id,
    ownerOrganisationId: r.owner_organisation_id,
    purpose: r.purpose,
    provider: r.provider,
    providerAssetId: r.provider_asset_id,
    status: r.status,
    durationSeconds: r.duration_seconds,
    width: r.width,
    height: r.height,
    aspectRatio: r.aspect_ratio,
    playbackPolicy: r.playback_policy,
    thumbnailReference: r.thumbnail_reference,
    captionState: r.caption_state,
    transcriptState: r.transcript_state,
    moderationStatus: r.moderation_status,
    replacesMediaAssetId: r.replaces_media_asset_id,
    supersededAt: r.superseded_at,
    createdByUserId: r.created_by_user_id,
    createdAt: r.created_at,
    readyAt: r.ready_at,
    deletedAt: r.deleted_at,
    version: r.version,
  };
}

/** The projection every read shares, as a query fragment. */
function select(executor: DatabaseExecutor) {
  return executor`
    select m.id, m.tenant_id, m.owner_type, m.owner_id, m.owner_organisation_id,
           m.purpose, m.provider, m.provider_asset_id, m.status, m.duration_seconds,
           m.width, m.height, m.aspect_ratio, m.playback_policy, m.thumbnail_reference,
           m.caption_state, m.transcript_state, m.moderation_status,
           m.replaces_media_asset_id, m.superseded_at, m.created_by_user_id,
           m.created_at, m.ready_at, m.deleted_at, m.version
      from media.media_assets m`;
}

export function createPostgresMediaAssetRepository(): MediaAssetRepository {
  const findById: MediaAssetRepository["findById"] = async (
    executor,
    tenantId,
    mediaAssetId,
  ) => {
    const rows = await executor`
      ${select(executor)} where m.id = ${mediaAssetId} and m.tenant_id = ${tenantId}`;
    return rows.length === 0 ? null : toAsset(rows[0]);
  };

  /** Re-reads through the same transaction after a conditional update. */
  const reread = (
    tx: TransactionContext,
    tenantId: MediaAsset["tenantId"],
    id: MediaAsset["id"],
  ) => findById(tx.sql, tenantId, id);

  return {
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into media.media_assets
          (tenant_id, owner_type, owner_id, owner_organisation_id, purpose,
           playback_policy, created_by_user_id, replaces_media_asset_id)
        values (${input.tenantId}, ${input.ownerType}, ${input.ownerId},
                ${input.ownerOrganisationId}, ${input.purpose},
                ${input.playbackPolicy}, ${input.createdByUserId},
                ${input.replacesMediaAssetId ?? null})
        returning id`;
      const { id } = z.object({ id: MediaAssetIdSchema }).parse(rows[0]);
      const created = await reread(tx, input.tenantId, id);
      if (created === null) {
        throw new Error("media asset insert did not return a row");
      }
      return created;
    },

    findById,

    lockById: async (tx, tenantId, mediaAssetId) => {
      const rows = await tx.sql`
        ${select(tx.sql)}
         where m.id = ${mediaAssetId} and m.tenant_id = ${tenantId}
         for update`;
      return rows.length === 0 ? null : toAsset(rows[0]);
    },

    findCurrentForOwner: async (executor, tenantId, owner, purpose) => {
      // Exactly the predicate the partial unique index enforces, so this can
      // return at most one row by construction, not by convention.
      const rows = await executor`
        ${select(executor)}
         where m.tenant_id = ${tenantId}
           and m.owner_type = ${owner.ownerType}
           and m.owner_id = ${owner.ownerId}
           and m.purpose = ${purpose}
           and m.deleted_at is null
           and m.superseded_at is null`;
      return rows.length === 0 ? null : toAsset(rows[0]);
    },

    lockCurrentForOwner: async (tx, tenantId, owner, purpose) => {
      const rows = await tx.sql`
        ${select(tx.sql)}
         where m.tenant_id = ${tenantId}
           and m.owner_type = ${owner.ownerType}
           and m.owner_id = ${owner.ownerId}
           and m.purpose = ${purpose}
           and m.deleted_at is null
           and m.superseded_at is null
         for update`;
      return rows.length === 0 ? null : toAsset(rows[0]);
    },

    listForOwner: async (executor, tenantId, owner) => {
      const rows = await executor`
        ${select(executor)}
         where m.tenant_id = ${tenantId}
           and m.owner_type = ${owner.ownerType}
           and m.owner_id = ${owner.ownerId}
         order by m.created_at desc, m.id desc`;
      return rows.map(toAsset);
    },

    transitionStatus: async (tx, input) => {
      const rows = await tx.sql`
        update media.media_assets m
           set status = ${input.status},
               ready_at = case
                            when ${input.readyAt ?? null}::timestamptz is not null
                              then ${input.readyAt ?? null}::timestamptz
                            else m.ready_at
                          end,
               deleted_at = case
                              when ${input.deletedAt ?? null}::timestamptz is not null
                                then ${input.deletedAt ?? null}::timestamptz
                              else m.deleted_at
                            end,
               version = m.version + 1
         where m.id = ${input.mediaAssetId}
           and m.tenant_id = ${input.tenantId}
           and m.version = ${input.expectedVersion}
        returning m.id`;
      return rows.length === 0
        ? null
        : reread(tx, input.tenantId, input.mediaAssetId);
    },

    setProviderReference: async (tx, input) => {
      const rows = await tx.sql`
        update media.media_assets m
           set provider = ${input.provider},
               provider_asset_id = ${input.providerAssetId},
               version = m.version + 1
         where m.id = ${input.mediaAssetId}
           and m.tenant_id = ${input.tenantId}
           and m.version = ${input.expectedVersion}
        returning m.id`;
      return rows.length === 0
        ? null
        : reread(tx, input.tenantId, input.mediaAssetId);
    },

    updateProviderMetadata: async (tx, input) => {
      const { metadata } = input;
      const rows = await tx.sql`
        update media.media_assets m
           set duration_seconds = coalesce(${metadata.durationSeconds ?? null}, m.duration_seconds),
               width = coalesce(${metadata.width ?? null}, m.width),
               height = coalesce(${metadata.height ?? null}, m.height),
               aspect_ratio = coalesce(${metadata.aspectRatio ?? null}, m.aspect_ratio),
               thumbnail_reference = coalesce(${metadata.thumbnailReference ?? null}, m.thumbnail_reference),
               version = m.version + 1
         where m.id = ${input.mediaAssetId}
           and m.tenant_id = ${input.tenantId}
           and m.version = ${input.expectedVersion}
        returning m.id`;
      return rows.length === 0
        ? null
        : reread(tx, input.tenantId, input.mediaAssetId);
    },

    markSuperseded: async (tx, input) => {
      // Only an asset that is still current can be superseded; a second
      // attempt updates nothing, which is what makes concurrent replacement
      // resolve to one winner.
      const rows = await tx.sql`
        update media.media_assets m
           set superseded_at = now(),
               version = m.version + 1
         where m.id = ${input.mediaAssetId}
           and m.tenant_id = ${input.tenantId}
           and m.version = ${input.expectedVersion}
           and m.superseded_at is null
        returning m.id`;
      return rows.length === 0
        ? null
        : reread(tx, input.tenantId, input.mediaAssetId);
    },

    setStates: async (tx, input) => {
      const rows = await tx.sql`
        update media.media_assets m
           set playback_policy = coalesce(${input.playbackPolicy ?? null}, m.playback_policy),
               moderation_status = coalesce(${input.moderationStatus ?? null}, m.moderation_status),
               caption_state = coalesce(${input.captionState ?? null}, m.caption_state),
               transcript_state = coalesce(${input.transcriptState ?? null}, m.transcript_state),
               version = m.version + 1
         where m.id = ${input.mediaAssetId}
           and m.tenant_id = ${input.tenantId}
           and m.version = ${input.expectedVersion}
        returning m.id`;
      return rows.length === 0
        ? null
        : reread(tx, input.tenantId, input.mediaAssetId);
    },
  };
}

export function createPostgresMediaRepositories(): MediaRepositories {
  return { mediaAssets: createPostgresMediaAssetRepository() };
}

/**
 * The read port for later consumers. One indexed lookup against the same
 * predicate the single-current-pitch index enforces — never a scan of a
 * company's media history.
 */
export function createPostgresCompanyPitchQueryPort(options: {
  readonly sql: DatabaseExecutor;
}): CompanyPitchQueryPort {
  const repository = createPostgresMediaAssetRepository();
  return {
    getCurrentPitchForCompany: async (tenantId, companyId) => {
      const asset = await repository.findCurrentForOwner(
        options.sql,
        tenantId,
        { ownerType: "COMPANY", ownerId: companyId },
        "FOUNDER_PITCH",
      );
      return asset === null ? null : toCompanyPitch(asset);
    },
  };
}
