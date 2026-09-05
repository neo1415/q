import { z } from "zod";

import {
  auditActorFromContext,
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import type { CorrelationId } from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  MediaAssetIdSchema,
  toCompanyPitch,
  type CompanyPitch,
  type MediaAsset,
  type MediaAssetId,
  type MediaOwnerRef,
} from "../contracts/index.js";
import {
  MediaAssetNotFoundError,
  MediaReplacementConflictError,
} from "../domain/errors.js";
import {
  mediaAssetCreatedEvent,
  mediaAssetDeletedEvent,
  mediaAssetReplacedEvent,
} from "../events/index.js";
import {
  activeOrganisation,
  MEDIA_CREATE,
  MEDIA_MANAGE,
  MEDIA_VIEW,
  ownedResource,
  ownerScope,
} from "./authority.js";
import type { MediaServiceDependencies } from "./dependencies.js";

/**
 * Founder pitch media: create, replace, read, delete.
 *
 * What these use cases deliberately cannot do is as important as what they
 * do. Nothing here uploads bytes, reserves a provider asset, marks anything
 * READY, approves moderation or makes a pitch visible to anyone. Creating a
 * pitch asset creates a logical record in state CREATED and says exactly
 * that — a founder is never told an upload succeeded when no bytes moved.
 *
 *   MediaAsset ≠ uploaded video
 *   READY ≠ approved ≠ discoverable
 */

const RESOURCE_MEDIA = AuditResourceTypeSchema.parse("media_asset");
const ACTION = {
  created: AuditActionTypeSchema.parse("media.asset.created"),
  replaced: AuditActionTypeSchema.parse("media.asset.replaced"),
  deleted: AuditActionTypeSchema.parse("media.asset.deleted"),
};

const PITCH = "FOUNDER_PITCH" as const;

export const CreateCompanyPitchInputSchema = z
  .object({
    /**
     * The asset the caller believes is current, when replacing one. Its
     * absence means "there is none"; a mismatch is refused rather than
     * resolved, because guessing which of two pitches is the pitch is the
     * ambiguity the single-primary rule exists to prevent.
     */
    replacesMediaAssetId: MediaAssetIdSchema.optional(),
  })
  .strict();
export type CreateCompanyPitchInput = z.infer<
  typeof CreateCompanyPitchInputSchema
>;

export type CreateCompanyPitchCommand = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly input: CreateCompanyPitchInput;
  readonly correlationId: CorrelationId;
};

export type CompanyPitchResult = {
  readonly asset: MediaAsset;
  /** The predecessor, when this call replaced one. */
  readonly replaced: MediaAsset | null;
};

function companyRef(companyId: string): MediaOwnerRef {
  return { ownerType: "COMPANY", ownerId: companyId };
}

/**
 * Creates the company's pitch asset, or replaces the current one.
 *
 * Replacement never overwrites: a new asset is created, the predecessor is
 * marked superseded, and the lineage link between them survives. Both the
 * supersede and the insert happen in one transaction under a row lock, and
 * the database's single-current-pitch index is the final arbiter — two
 * simultaneous replacements cannot both succeed.
 */
export function createCreateCompanyPitch(
  dependencies: MediaServiceDependencies,
) {
  const { repositories, transactions, audit, outbox } = dependencies;

  return async (
    command: CreateCompanyPitchCommand,
  ): Promise<CompanyPitchResult> => {
    const input = CreateCompanyPitchInputSchema.parse(command.input);
    const { actor } = command;
    const organisationId = activeOrganisation(actor);
    const owner = await ownedResource(
      dependencies,
      actor,
      companyRef(command.companyId),
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: MEDIA_CREATE,
      resource: ownerScope(actor, owner),
    });

    return transactions.run(async (tx: TransactionContext) => {
      const current = await repositories.mediaAssets.lockCurrentForOwner(
        tx,
        owner.tenantId,
        owner,
        PITCH,
      );

      if (input.replacesMediaAssetId === undefined) {
        if (current !== null) {
          // A company has one primary pitch. Adding a second is not a
          // creation, it is a replacement, and the caller must say so.
          throw new MediaReplacementConflictError(
            "This company already has a current pitch; replace it explicitly.",
          );
        }
      } else if (
        current === null ||
        current.id !== input.replacesMediaAssetId
      ) {
        throw new MediaReplacementConflictError();
      }

      if (current !== null) {
        const superseded = await repositories.mediaAssets.markSuperseded(tx, {
          tenantId: owner.tenantId,
          mediaAssetId: current.id,
          expectedVersion: current.version,
        });
        if (superseded === null) {
          throw new MediaReplacementConflictError();
        }
      }

      const asset = await repositories.mediaAssets.insert(tx, {
        tenantId: owner.tenantId,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        ownerOrganisationId: owner.ownerOrganisationId,
        purpose: PITCH,
        // Conservative by construction. A new pitch is visible to nobody
        // until a deliberate later decision widens it.
        playbackPolicy: "PRIVATE",
        createdByUserId: actor.userId,
        ...(current === null ? {} : { replacesMediaAssetId: current.id }),
      });

      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: current === null ? ACTION.created : ACTION.replaced,
        resourceType: RESOURCE_MEDIA,
        resourceId: asset.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        // Identifiers and coded states only: never a provider identifier,
        // an upload target or a thumbnail reference.
        metadata: {
          ownerType: asset.ownerType,
          ownerId: asset.ownerId,
          purpose: asset.purpose,
          status: asset.status,
          ...(current === null ? {} : { replacesMediaAssetId: current.id }),
        },
        correlationId: command.correlationId,
      });

      const context = {
        actor,
        organisationId,
        correlationId: command.correlationId,
      };
      const payload = {
        mediaAssetId: asset.id,
        ownerType: asset.ownerType,
        ownerId: asset.ownerId,
        purpose: asset.purpose,
        status: asset.status,
      };
      await outbox.enqueue(
        tx,
        current === null
          ? mediaAssetCreatedEvent(context, payload)
          : mediaAssetReplacedEvent(context, {
              ...payload,
              replacesMediaAssetId: current.id,
            }),
      );

      return { asset, replaced: current };
    });
  };
}

export type GetCompanyPitchQuery = {
  readonly actor: ActorContext;
  readonly companyId: string;
};

/**
 * The company's current pitch, or null. Metadata only: reading this is not
 * playback authorization and never yields a provider identifier.
 */
export function createGetCompanyPitch(dependencies: MediaServiceDependencies) {
  return async (query: GetCompanyPitchQuery): Promise<MediaAsset | null> => {
    const owner = await ownedResource(
      dependencies,
      query.actor,
      companyRef(query.companyId),
    );
    await dependencies.authorization.requireCapability({
      actor: query.actor,
      capability: MEDIA_VIEW,
      resource: ownerScope(query.actor, owner),
    });
    return dependencies.repositories.mediaAssets.findCurrentForOwner(
      dependencies.sql,
      owner.tenantId,
      owner,
      PITCH,
    );
  };
}

/** The company's media history, newest first, including superseded assets. */
export function createListCompanyMedia(dependencies: MediaServiceDependencies) {
  return async (
    query: GetCompanyPitchQuery,
  ): Promise<readonly MediaAsset[]> => {
    const owner = await ownedResource(
      dependencies,
      query.actor,
      companyRef(query.companyId),
    );
    await dependencies.authorization.requireCapability({
      actor: query.actor,
      capability: MEDIA_VIEW,
      resource: ownerScope(query.actor, owner),
    });
    return dependencies.repositories.mediaAssets.listForOwner(
      dependencies.sql,
      owner.tenantId,
      owner,
    );
  };
}

export type DeleteCompanyPitchCommand = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly mediaAssetId: MediaAssetId;
  readonly correlationId: CorrelationId;
};

/**
 * Soft deletion: the row stays, the status becomes DELETED and application
 * visibility ends. The history is not erased, because a deleted pitch is
 * still something that happened, and material derived from it elsewhere is
 * governed by its own lineage rules rather than cascading from here.
 *
 * Deleting is consequential, so it needs `media.manage`, and it is audited.
 */
export function createDeleteCompanyPitch(
  dependencies: MediaServiceDependencies,
) {
  const { repositories, transactions, audit, outbox } = dependencies;

  return async (command: DeleteCompanyPitchCommand): Promise<MediaAsset> => {
    const { actor } = command;
    const organisationId = activeOrganisation(actor);
    const owner = await ownedResource(
      dependencies,
      actor,
      companyRef(command.companyId),
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: MEDIA_MANAGE,
      resource: ownerScope(actor, owner),
    });

    return transactions.run(async (tx: TransactionContext) => {
      const asset = await repositories.mediaAssets.lockById(
        tx,
        owner.tenantId,
        command.mediaAssetId,
      );
      if (
        asset === null ||
        asset.ownerType !== owner.ownerType ||
        asset.ownerId !== owner.ownerId
      ) {
        throw new MediaAssetNotFoundError();
      }
      if (asset.status === "DELETED") {
        // Already gone. Deleting twice is the same outcome, and re-emitting
        // the event would tell consumers something happened that did not.
        return asset;
      }

      const deleted = await repositories.mediaAssets.transitionStatus(tx, {
        tenantId: owner.tenantId,
        mediaAssetId: asset.id,
        expectedVersion: asset.version,
        status: "DELETED",
        deletedAt: new Date().toISOString(),
      });
      if (deleted === null) {
        throw new MediaAssetNotFoundError();
      }

      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.deleted,
        resourceType: RESOURCE_MEDIA,
        resourceId: asset.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          ownerType: asset.ownerType,
          ownerId: asset.ownerId,
          purpose: asset.purpose,
          previousStatus: asset.status,
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        mediaAssetDeletedEvent(
          { actor, organisationId, correlationId: command.correlationId },
          deleted.version,
          {
            mediaAssetId: asset.id,
            ownerType: asset.ownerType,
            ownerId: asset.ownerId,
            purpose: asset.purpose,
          },
        ),
      );
      return deleted;
    });
  };
}

/**
 * The projection later consumers read. Permission-neutral by design: the
 * caller has already decided who is asking, and this answers only what the
 * pitch is and where it stands.
 */
export function createGetCurrentPitchProjection(
  dependencies: MediaServiceDependencies,
) {
  return async (
    tenantId: MediaAsset["tenantId"],
    companyId: string,
  ): Promise<CompanyPitch | null> => {
    const asset =
      await dependencies.repositories.mediaAssets.findCurrentForOwner(
        dependencies.sql,
        tenantId,
        companyRef(companyId),
        PITCH,
      );
    return asset === null ? null : toCompanyPitch(asset);
  };
}
