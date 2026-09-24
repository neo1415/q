import type { TransactionContext } from "@capital-q/database";

import type {
  MediaAsset,
  MediaStatus,
  MediaTechnicalMetadata,
} from "../contracts/index.js";
import type { VideoAssetStatus } from "../contracts/provider.js";
import { MediaAssetConflictError } from "../domain/errors.js";
import { transitionPath } from "../domain/lifecycle.js";
import {
  mediaAssetStatusChangedEvent,
  type EventContext,
  type SystemContext,
} from "../events/index.js";
import type { MediaServiceDependencies } from "./dependencies.js";

/**
 * What a provider report means for one asset, and applying it.
 *
 * Shared by the founder's status poll (CQ-MEDIA-011) and verified provider
 * webhooks (CQ-MEDIA-012). Two ways of hearing the provider; one reading of
 * what it said. Neither path decides anything the lifecycle does not
 * already allow.
 */

/** `1080 × 1920` → `9:16`; anything that will not reduce to three digits stays unknown. */
export function aspectRatioOf(
  width: number,
  height: number,
): string | undefined {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  const w = width / divisor;
  const h = height / divisor;
  return w > 999 || h > 999 ? undefined : `${String(w)}:${String(h)}`;
}

/** What the provider told us that the record does not yet hold. */
function metadataDelta(
  asset: MediaAsset,
  status: VideoAssetStatus,
): MediaTechnicalMetadata | null {
  const delta: {
    -readonly [K in keyof MediaTechnicalMetadata]: MediaTechnicalMetadata[K];
  } = {};
  if (
    status.durationSeconds !== undefined &&
    status.durationSeconds !== asset.durationSeconds
  ) {
    delta.durationSeconds = status.durationSeconds;
  }
  if (status.width !== undefined && status.width !== asset.width) {
    delta.width = status.width;
  }
  if (status.height !== undefined && status.height !== asset.height) {
    delta.height = status.height;
  }
  if (status.width !== undefined && status.height !== undefined) {
    const ratio = aspectRatioOf(status.width, status.height);
    if (ratio !== undefined && ratio !== asset.aspectRatio) {
      delta.aspectRatio = ratio;
    }
  }
  if (
    status.thumbnailReference !== undefined &&
    status.thumbnailReference !== asset.thumbnailReference
  ) {
    delta.thumbnailReference = status.thumbnailReference;
  }
  return Object.keys(delta).length === 0 ? null : delta;
}

export type ProviderReportPlan = {
  /** The legal steps to take, in order. Empty when there is nothing to do. */
  readonly path: readonly MediaStatus[];
  readonly metadata: MediaTechnicalMetadata | null;
  /**
   * True when the report cannot be reconciled with the record — PROCESSING
   * for a READY asset, a failure after READY, anything for a DELETED one.
   * The record already knows better, so nothing in the report is applied,
   * not even its metadata: a stale answer is stale all the way through.
   */
  readonly stale: boolean;
};

export function planProviderReport(
  asset: MediaAsset,
  reported: VideoAssetStatus,
): ProviderReportPlan {
  // Deletion is a decision, never something a provider can report into
  // being; an adapter that ever said so would be refused here.
  const path =
    asset.status === "DELETED" || reported.status === "DELETED"
      ? null
      : transitionPath(asset.status, reported.status);
  if (path === null) {
    return { path: [], metadata: null, stale: true };
  }
  return { path, metadata: metadataDelta(asset, reported), stale: false };
}

export function isEmptyPlan(plan: ProviderReportPlan): boolean {
  return plan.path.length === 0 && plan.metadata === null;
}

/**
 * Applies a plan to the LOCKED row, inside the caller's transaction: the
 * metadata first, then every lifecycle step, each versioned and each with
 * its own `media.asset.status_changed` through the outbox. A stale version
 * anywhere is a conflict, never an overwrite.
 */
export async function applyProviderReportPlan(
  tx: TransactionContext,
  dependencies: Pick<MediaServiceDependencies, "repositories" | "outbox">,
  locked: MediaAsset,
  plan: ProviderReportPlan,
  context: EventContext | SystemContext,
): Promise<{
  readonly asset: MediaAsset;
  readonly applied: readonly MediaStatus[];
}> {
  const { repositories, outbox } = dependencies;
  let current = locked;

  if (plan.metadata !== null) {
    const described = await repositories.mediaAssets.updateProviderMetadata(
      tx,
      {
        tenantId: current.tenantId,
        mediaAssetId: current.id,
        expectedVersion: current.version,
        metadata: plan.metadata,
      },
    );
    if (described === null) {
      throw new MediaAssetConflictError();
    }
    current = described;
  }

  const applied: MediaStatus[] = [];
  for (const next of plan.path) {
    const previous = current.status;
    const moved = await repositories.mediaAssets.transitionStatus(tx, {
      tenantId: current.tenantId,
      mediaAssetId: current.id,
      expectedVersion: current.version,
      status: next,
      ...(next === "READY" ? { readyAt: new Date().toISOString() } : {}),
    });
    if (moved === null) {
      throw new MediaAssetConflictError();
    }
    current = moved;
    applied.push(next);
    await outbox.enqueue(
      tx,
      mediaAssetStatusChangedEvent(context, current.version, {
        mediaAssetId: current.id,
        ownerType: current.ownerType,
        ownerId: current.ownerId,
        purpose: current.purpose,
        previousStatus: previous,
        status: next,
      }),
    );
  }
  return { asset: current, applied };
}
