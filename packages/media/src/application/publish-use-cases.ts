import { z } from "zod";

import {
  auditActorFromContext,
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  createAuditEventId,
  createPostgresMaterialActionAuditWriter,
  occurredNow,
} from "@capital-q/audit";
import type { CorrelationId } from "@capital-q/contracts";
import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { ActorContext, TenantId } from "@capital-q/security";

import {
  MediaAssetIdSchema,
  PITCH_TITLE_MAX,
  PitchAudienceSchema,
  type MediaAsset,
  type MediaAssetId,
  type MediaOwnerRef,
} from "../contracts/index.js";
import { createPostgresMediaRepositories } from "../infrastructure/postgres-media-repository.js";
import {
  MediaAssetConflictError,
  MediaAssetNotFoundError,
  MediaRuleError,
} from "../domain/errors.js";
import {
  AUTOMATED_MODERATION_RULE_V1,
  evaluateAutomatedModeration,
  type AutomatedModerationRule,
  type ModerationVerdict,
} from "../domain/moderation.js";
import {
  mediaAssetModeratedEvent,
  mediaAssetPlaybackPolicyChangedEvent,
} from "../events/index.js";
import {
  activeOrganisation,
  MEDIA_MANAGE,
  ownedResource,
  ownerScope,
} from "./authority.js";
import type { MediaServiceDependencies } from "./dependencies.js";

/**
 * The publish path (CQ-MEDIA-013; doc 20 §30, §99–§100), as two separate
 * authorities that never collapse into one:
 *
 *   the founder decides whether investors may play the pitch — commercial
 *   authority over their own material, exercised as a playback policy;
 *
 *   Capital Q decides whether the pitch is allowed on the platform —
 *   integrity authority, exercised as moderation by a versioned rule.
 *
 * Neither publishes anything. Discoverability stays what it was: the feed
 * and the company projection show a pitch only when it is READY, ALLOWED,
 * not PRIVATE and the company is visible to the network. Each decision
 * here opens one gate and says so, and no decision opens another.
 */

const RESOURCE_MEDIA = AuditResourceTypeSchema.parse("media_asset");
const ACTION = {
  playbackPolicySet: AuditActionTypeSchema.parse(
    "media.asset.playback_policy_set",
  ),
  moderated: AuditActionTypeSchema.parse("media.asset.moderated"),
  detailsSet: AuditActionTypeSchema.parse("media.asset.details_set"),
};
const PITCH = "FOUNDER_PITCH" as const;

function companyRef(companyId: string): MediaOwnerRef {
  return { ownerType: "COMPANY", ownerId: companyId };
}

// ---------------------------------------------------------------------------
// The founder's decision
// ---------------------------------------------------------------------------

/**
 * What an owner may choose. PUBLIC is deliberately absent: a pitch at an
 * external URL is a product decision (doc 20 §34, Shareable Q Identity)
 * that no packet has made, and a field that admitted it would make it by
 * accident.
 */
export const OwnerPlaybackPolicySchema = z.enum(["AUTHORISED", "PRIVATE"]);
export type OwnerPlaybackPolicy = z.infer<typeof OwnerPlaybackPolicySchema>;

export type SetPitchPlaybackPolicyCommand = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly mediaAssetId: MediaAssetId;
  readonly playbackPolicy: OwnerPlaybackPolicy;
  /** The version the founder saw. A stale screen does not decide. */
  readonly expectedVersion: number;
  readonly correlationId: CorrelationId;
};

/**
 * Records the owner's playback policy. Consequential — it changes what
 * investors may be granted — so it needs `media.manage`, is audited, and
 * emits its own event. Idempotent: choosing the policy already in force
 * changes nothing and emits nothing.
 *
 * This is the single entry point for the decision. A later packet that
 * lets a founder tell Q "publish my pitch" prepares exactly this command
 * for approval; it does not get a second way in.
 */
export function createSetPitchPlaybackPolicy(
  dependencies: MediaServiceDependencies,
) {
  const { repositories, transactions, audit, outbox } = dependencies;

  return async (
    command: SetPitchPlaybackPolicyCommand,
  ): Promise<MediaAsset> => {
    const { actor } = command;
    const playbackPolicy = OwnerPlaybackPolicySchema.parse(
      command.playbackPolicy,
    );
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
        asset.ownerId !== owner.ownerId ||
        asset.purpose !== PITCH
      ) {
        throw new MediaAssetNotFoundError();
      }
      if (asset.version !== command.expectedVersion) {
        throw new MediaAssetConflictError();
      }
      if (asset.status === "DELETED") {
        throw new MediaRuleError("A deleted pitch has no playback policy.");
      }
      if (asset.playbackPolicy === playbackPolicy) {
        return asset;
      }

      const updated = await repositories.mediaAssets.setStates(tx, {
        tenantId: owner.tenantId,
        mediaAssetId: asset.id,
        expectedVersion: asset.version,
        playbackPolicy,
      });
      if (updated === null) {
        throw new MediaAssetConflictError();
      }

      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.playbackPolicySet,
        resourceType: RESOURCE_MEDIA,
        resourceId: asset.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          ownerType: asset.ownerType,
          ownerId: asset.ownerId,
          purpose: asset.purpose,
          previousPlaybackPolicy: asset.playbackPolicy,
          playbackPolicy,
          status: asset.status,
          moderationStatus: asset.moderationStatus,
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        mediaAssetPlaybackPolicyChangedEvent(
          { actor, organisationId, correlationId: command.correlationId },
          updated.version,
          {
            mediaAssetId: asset.id,
            ownerType: asset.ownerType,
            ownerId: asset.ownerId,
            purpose: asset.purpose,
            previousPlaybackPolicy: asset.playbackPolicy,
            playbackPolicy,
          },
        ),
      );
      return updated;
    });
  };
}

/**
 * The owner's name for a video and who beyond them may watch it (ADR 0021,
 * ADR 0022). Blank is no title. The audience widens disclosure, so this is
 * `media.manage`, like the playback policy, and it is audited.
 */
export const PitchDetailsSchema = z
  .object({
    title: z
      .string()
      .trim()
      .max(PITCH_TITLE_MAX)
      .transform((title) => (title.length === 0 ? null : title))
      .nullable(),
    audience: PitchAudienceSchema,
  })
  .strict();
export type PitchDetails = z.input<typeof PitchDetailsSchema>;

export type SetPitchDetailsCommand = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly mediaAssetId: MediaAssetId;
  readonly details: PitchDetails;
  /** The version the owner saw. A stale screen does not decide. */
  readonly expectedVersion: number;
  readonly correlationId: CorrelationId;
};

export function createSetPitchDetails(dependencies: MediaServiceDependencies) {
  const { repositories, transactions, audit } = dependencies;

  return async (command: SetPitchDetailsCommand): Promise<MediaAsset> => {
    const { actor } = command;
    const details = PitchDetailsSchema.parse(command.details);
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
        asset.ownerId !== owner.ownerId ||
        asset.purpose !== PITCH
      ) {
        throw new MediaAssetNotFoundError();
      }
      if (asset.version !== command.expectedVersion) {
        throw new MediaAssetConflictError();
      }
      if (asset.status === "DELETED") {
        throw new MediaRuleError("A deleted video can't be changed.");
      }
      if (
        asset.title === details.title &&
        asset.audience === details.audience
      ) {
        return asset;
      }
      const updated = await repositories.mediaAssets.setDetails(tx, {
        tenantId: owner.tenantId,
        mediaAssetId: asset.id,
        expectedVersion: asset.version,
        title: details.title,
        audience: details.audience,
      });
      if (updated === null) {
        throw new MediaAssetConflictError();
      }
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.detailsSet,
        resourceType: RESOURCE_MEDIA,
        resourceId: asset.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        // Coded states only; the title is the owner's display text and is
        // not repeated into the audit trail.
        metadata: {
          ownerType: asset.ownerType,
          ownerId: asset.ownerId,
          purpose: asset.purpose,
          previousAudience: asset.audience,
          audience: details.audience,
          titleChanged: asset.title !== details.title,
        },
        correlationId: command.correlationId,
      });
      return updated;
    });
  };
}

// ---------------------------------------------------------------------------
// Capital Q's decision
// ---------------------------------------------------------------------------

export type ApplyAutomatedModerationCommand = {
  readonly tenantId: string;
  readonly mediaAssetId: MediaAssetId;
  readonly correlationId: CorrelationId;
};

export type AutomatedModerationResult =
  | {
      readonly kind: "DECIDED";
      readonly asset: MediaAsset;
      readonly verdict: ModerationVerdict;
    }
  /** Nothing to decide: not READY yet, already reviewed, or gone. */
  | {
      readonly kind: "SKIPPED";
      readonly reason:
        "NOT_FOUND" | "NOT_READY" | "ALREADY_DECIDED" | "DELETED";
    };

export type AutomatedModerationDependencies = Pick<
  MediaServiceDependencies,
  "repositories" | "transactions" | "audit" | "outbox"
> & {
  readonly rule?: AutomatedModerationRule | undefined;
};

/**
 * Runs the rule against one READY asset that nobody has reviewed, and
 * records the verdict under the platform's own authority.
 *
 * Idempotent under redelivery: a second run finds the moderation status
 * already decided and does nothing, emits nothing. A decision a person
 * later makes is never overwritten by the rule, for the same reason. The
 * provenance and the rule's version travel in the audit row and the
 * event — that is where "who decided" belongs — so no column was needed.
 */
export function createApplyAutomatedModeration(
  dependencies: AutomatedModerationDependencies,
) {
  const { repositories, transactions, audit, outbox } = dependencies;
  const rule = dependencies.rule ?? AUTOMATED_MODERATION_RULE_V1;

  return async (
    command: ApplyAutomatedModerationCommand,
  ): Promise<AutomatedModerationResult> => {
    const tenantId = z.string().uuid().parse(command.tenantId) as TenantId;
    const mediaAssetId = MediaAssetIdSchema.parse(command.mediaAssetId);

    return transactions.run(async (tx: TransactionContext) => {
      const asset = await repositories.mediaAssets.lockById(
        tx,
        tenantId,
        mediaAssetId,
      );
      if (asset === null) {
        return { kind: "SKIPPED", reason: "NOT_FOUND" };
      }
      if (asset.status === "DELETED") {
        return { kind: "SKIPPED", reason: "DELETED" };
      }
      if (asset.moderationStatus !== "NOT_REVIEWED") {
        return { kind: "SKIPPED", reason: "ALREADY_DECIDED" };
      }
      if (asset.status !== "READY") {
        return { kind: "SKIPPED", reason: "NOT_READY" };
      }

      const verdict = evaluateAutomatedModeration(asset, rule);
      const moderationStatus = verdict.outcome;
      const holdReasons = verdict.outcome === "PENDING" ? verdict.reasons : [];
      const updated = await repositories.mediaAssets.setStates(tx, {
        tenantId,
        mediaAssetId: asset.id,
        expectedVersion: asset.version,
        moderationStatus,
      });
      if (updated === null) {
        throw new MediaAssetConflictError();
      }

      await audit.record(tx, {
        auditEventId: createAuditEventId(),
        tenantId,
        // The platform's own decision: no person acted, none is named.
        actorType: "SYSTEM",
        organisationId: asset.ownerOrganisationId,
        actionType: ACTION.moderated,
        resourceType: RESOURCE_MEDIA,
        resourceId: asset.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          ownerType: asset.ownerType,
          ownerId: asset.ownerId,
          purpose: asset.purpose,
          previousModerationStatus: asset.moderationStatus,
          moderationStatus,
          provenance: rule.provenance,
          ruleVersion: rule.version,
          holdReasons: [...holdReasons],
          durationSeconds: asset.durationSeconds,
          width: asset.width,
          height: asset.height,
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        mediaAssetModeratedEvent(
          {
            tenantId,
            organisationId: asset.ownerOrganisationId,
            correlationId: command.correlationId,
          },
          updated.version,
          {
            mediaAssetId: asset.id,
            ownerType: asset.ownerType,
            ownerId: asset.ownerId,
            purpose: asset.purpose,
            previousModerationStatus: asset.moderationStatus,
            moderationStatus,
            provenance: rule.provenance,
            ruleVersion: rule.version,
            holdReasons: [...holdReasons],
          },
        ),
      );
      return { kind: "DECIDED", asset: updated, verdict };
    });
  };
}

/**
 * The moderation decision as a worker composes it: the Media context's own
 * PostgreSQL repositories and audit writer, the caller's transactions and
 * outbox. A worker holds no media authority and needs none — it holds a
 * database and a registry, which is all this asks for.
 */
export function createPostgresAutomatedModeration(options: {
  readonly transactions: TransactionManager;
  readonly outbox: OutboxWriter;
  readonly rule?: AutomatedModerationRule | undefined;
}) {
  return createApplyAutomatedModeration({
    repositories: createPostgresMediaRepositories(),
    transactions: options.transactions,
    // Writes through the caller's transaction; needs no executor of its own.
    audit: createPostgresMaterialActionAuditWriter(),
    outbox: options.outbox,
    rule: options.rule,
  });
}
