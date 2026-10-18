import { createHash } from "node:crypto";

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
  LIVE_PITCHES_MAX,
  MediaAssetIdSchema,
  toCompanyPitch,
  type CompanyPitch,
  type MediaAsset,
  type MediaAssetId,
  type MediaOwnerRef,
} from "../contracts/index.js";
import {
  MediaAssetNotFoundError,
  MediaIdempotencyConflictError,
  MediaReplacementConflictError,
  MediaRuleError,
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
     * The live video this one replaces. Absent: this is another video,
     * added beside the company's others (ADR 0022). A video that is not
     * live and theirs is refused, never guessed at.
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
  /**
   * The client's key for this intended change, reused on retry. With it a
   * retry whose first answer was lost gets that same asset back instead of
   * a conflict (or, worse, a second replacement).
   */
  readonly idempotencyKey?: string | undefined;
  readonly correlationId: CorrelationId;
};

export type CompanyPitchResult = {
  readonly asset: MediaAsset;
  /** The predecessor, when this call replaced one. */
  readonly replaced: MediaAsset | null;
  /** True when a retried request was answered with what it created. */
  readonly replayed: boolean;
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Namespaced so a key reused for another command can never collide. */
export function hashPitchIdempotencyKey(key: string): string {
  return sha256Hex(`media.pitch.create:${key}`);
}

/** What the request meant: which company, and which pitch it replaces. */
function hashCreatePitchRequest(
  companyId: string,
  replacesMediaAssetId: string | undefined,
): string {
  return sha256Hex(
    JSON.stringify({
      companyId,
      replacesMediaAssetId: replacesMediaAssetId ?? null,
    }),
  );
}

function companyRef(companyId: string): MediaOwnerRef {
  return { ownerType: "COMPANY", ownerId: companyId };
}

/**
 * Adds a pitch video to the company, or replaces one of its live videos.
 *
 * Replacement never overwrites: a new asset is created, the predecessor is
 * marked superseded, and the lineage link between them survives. Both the
 * supersede and the insert happen in one transaction under the
 * predecessor's row lock; the conditional supersede and the one-successor
 * index make two simultaneous replacements of the same video resolve to
 * one winner.
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

    const requests = repositories.pitchRequests;
    const key = command.idempotencyKey;
    if (key !== undefined && requests === undefined) {
      throw new MediaRuleError(
        "This deployment cannot honour an idempotency key for a pitch.",
      );
    }

    return transactions.run(async (tx: TransactionContext) => {
      const keyHash = key === undefined ? null : hashPitchIdempotencyKey(key);
      const requestHash = hashCreatePitchRequest(
        owner.ownerId,
        input.replacesMediaAssetId,
      );
      if (keyHash !== null && requests !== undefined) {
        await requests.lock(tx, actor.userId, organisationId, keyHash);
        const previous = await requests.find(
          tx,
          actor.userId,
          organisationId,
          keyHash,
        );
        if (previous !== null) {
          if (previous.requestHash !== requestHash) {
            throw new MediaIdempotencyConflictError();
          }
          const asset = await repositories.mediaAssets.findById(
            tx.sql,
            owner.tenantId,
            previous.mediaAssetId,
          );
          if (asset === null) throw new MediaIdempotencyConflictError();
          const replaced =
            asset.replacesMediaAssetId === null
              ? null
              : await repositories.mediaAssets.findById(
                  tx.sql,
                  owner.tenantId,
                  asset.replacesMediaAssetId,
                );
          return { asset, replaced, replayed: true };
        }
      }

      // Several videos may be live at once (ADR 0022). Without a named
      // predecessor this adds another; with one, exactly that live video
      // is replaced, under its row lock, and its lineage kept.
      let current: MediaAsset | null = null;
      if (input.replacesMediaAssetId === undefined) {
        const live = await repositories.mediaAssets.countLiveForOwner(
          tx,
          owner.tenantId,
          owner,
          PITCH,
        );
        if (live >= LIVE_PITCHES_MAX) {
          throw new MediaRuleError(
            `A company can have at most ${String(LIVE_PITCHES_MAX)} live videos. Delete one to add another.`,
          );
        }
      } else {
        current = await repositories.mediaAssets.lockById(
          tx,
          owner.tenantId,
          input.replacesMediaAssetId,
        );
        if (
          current === null ||
          current.ownerType !== owner.ownerType ||
          current.ownerId !== owner.ownerId ||
          current.purpose !== PITCH ||
          current.deletedAt !== null ||
          current.supersededAt !== null
        ) {
          throw new MediaReplacementConflictError();
        }
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
        // A replacement is the same video re-recorded: it keeps the name
        // and audience its owner gave it.
        ...(current === null
          ? {}
          : {
              replacesMediaAssetId: current.id,
              title: current.title,
              audience: current.audience,
            }),
      });
      if (keyHash !== null && requests !== undefined) {
        await requests.record(tx, {
          userId: actor.userId,
          organisationId,
          tenantId: owner.tenantId,
          idempotencyKeyHash: keyHash,
          requestHash,
          mediaAssetId: asset.id,
        });
      }

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

      return { asset, replaced: current, replayed: false };
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
 *
 * The bytes are a different matter from the record: once the row says
 * DELETED, the provider's copy is deleted too (doc 20 §20.4), after the
 * transaction and outside it, as the upload cancel does. It is best-effort
 * and retried by repeating the delete: the record is already honest, the
 * viewer path already refuses a DELETED asset, and a provider outage must
 * not turn a founder's decision into an error.
 */
export function createDeleteCompanyPitch(
  dependencies: MediaServiceDependencies,
) {
  const { repositories, transactions, audit, outbox, videoProvider } =
    dependencies;

  const release = async (asset: MediaAsset): Promise<void> => {
    if (asset.providerAssetId === null) return;
    try {
      await videoProvider.deleteAsset(asset.providerAssetId);
    } catch {
      // Left for the next delete of the same pitch to retry.
    }
  };

  return async (command: DeleteCompanyPitchCommand): Promise<MediaAsset> => {
    const deleted = await deleteRecord(command);
    await release(deleted);
    return deleted;
  };

  async function deleteRecord(
    command: DeleteCompanyPitchCommand,
  ): Promise<MediaAsset> {
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
  }
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
