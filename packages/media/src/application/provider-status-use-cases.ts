import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import type { CorrelationId } from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";

import type {
  MediaAssetId,
  MediaProvider,
  MediaStatus,
} from "../contracts/index.js";
import {
  VideoAssetStatusSchema,
  type VideoAssetStatus,
} from "../contracts/provider.js";
import type { MediaServiceDependencies } from "./dependencies.js";
import {
  applyProviderReportPlan,
  isEmptyPlan,
  planProviderReport,
} from "./provider-report.js";

/**
 * A provider's own report about one asset, applied under the platform's
 * authority (CQ-MEDIA-012; doc 20 §16–§17, doc 22 §129–§135).
 *
 * The caller is a webhook boundary that has ALREADY verified the delivery's
 * signature and translated the vendor's payload through its adapter; what
 * arrives here is Capital Q's vocabulary only. Nothing about a person is
 * involved — no actor, no capability — because the authority is the
 * verified provider report, and the only thing it can do is move an asset
 * along a path the lifecycle already allows.
 *
 * Idempotent without a receipt table. The row lock serialises concurrent
 * deliveries, and the plan is computed from the LOCKED row, so a duplicate
 * finds the work already done and a late or out-of-order delivery finds the
 * lifecycle refusing it: READY never returns to PROCESSING, a failure after
 * READY is not recorded, and a terminal failure is recorded once. Each step
 * that does happen emits exactly one event, in the same transaction.
 */

const RESOURCE_MEDIA = AuditResourceTypeSchema.parse("media_asset");
const ACTION_APPLIED = AuditActionTypeSchema.parse(
  "media.asset.provider_status_applied",
);

export type ApplyProviderStatusReportCommand = {
  readonly provider: Exclude<MediaProvider, "UNASSIGNED">;
  readonly report: VideoAssetStatus;
  /**
   * The asset the provider says this is about, when it echoes Capital Q's
   * own reference. A cross-check only: a disagreement refuses the report.
   */
  readonly mediaAssetId?: MediaAssetId | undefined;
  readonly correlationId: CorrelationId;
};

export type ProviderStatusReportOutcome =
  /** The record moved, recorded metadata, or both. */
  | {
      readonly kind: "APPLIED";
      readonly mediaAssetId: MediaAssetId;
      readonly status: MediaStatus;
      readonly appliedTransitions: readonly MediaStatus[];
      readonly metadataUpdated: boolean;
    }
  /** Already known, or stale: the record already knows better. */
  | {
      readonly kind: "UNCHANGED";
      readonly mediaAssetId: MediaAssetId;
      readonly status: MediaStatus;
      readonly stale: boolean;
    }
  /** No asset of ours holds this provider identifier. */
  | { readonly kind: "UNKNOWN_ASSET" }
  /** The provider's own reference names a different asset. */
  | {
      readonly kind: "REFERENCE_MISMATCH";
      readonly mediaAssetId: MediaAssetId;
    };

export type ProviderStatusDependencies = Pick<
  MediaServiceDependencies,
  "sql" | "transactions" | "repositories" | "outbox" | "audit"
>;

export function createApplyProviderStatusReport(
  dependencies: ProviderStatusDependencies,
) {
  const { repositories, transactions, outbox, audit } = dependencies;

  return async (
    command: ApplyProviderStatusReportCommand,
  ): Promise<ProviderStatusReportOutcome> => {
    const report = VideoAssetStatusSchema.parse(command.report);

    // Lookup only. The identifier finds a row; it authorises nothing.
    const found = await repositories.mediaAssets.findByProviderAssetId(
      dependencies.sql,
      command.provider,
      report.providerAssetId,
    );
    if (found === null) {
      return { kind: "UNKNOWN_ASSET" };
    }
    if (
      command.mediaAssetId !== undefined &&
      command.mediaAssetId !== found.id
    ) {
      return { kind: "REFERENCE_MISMATCH", mediaAssetId: found.id };
    }

    return transactions.run(
      async (tx: TransactionContext): Promise<ProviderStatusReportOutcome> => {
        // Everything from here is decided against the locked row in the
        // tenant the row itself states — never against what was read above.
        const locked = await repositories.mediaAssets.lockById(
          tx,
          found.tenantId,
          found.id,
        );
        if (
          locked === null ||
          locked.provider !== command.provider ||
          locked.providerAssetId !== report.providerAssetId
        ) {
          return { kind: "UNKNOWN_ASSET" };
        }

        const plan = planProviderReport(locked, report);
        if (isEmptyPlan(plan)) {
          return {
            kind: "UNCHANGED",
            mediaAssetId: locked.id,
            status: locked.status,
            stale: plan.stale,
          };
        }

        const { asset: current, applied } = await applyProviderReportPlan(
          tx,
          { repositories, outbox },
          locked,
          plan,
          {
            tenantId: locked.tenantId,
            organisationId: locked.ownerOrganisationId,
            correlationId: command.correlationId,
          },
        );

        await audit.record(tx, {
          auditEventId: createAuditEventId(),
          tenantId: locked.tenantId,
          // The platform applying a verified provider report: no person
          // acted, none is named.
          actorType: "SYSTEM",
          organisationId: locked.ownerOrganisationId,
          actionType: ACTION_APPLIED,
          resourceType: RESOURCE_MEDIA,
          resourceId: locked.id,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          // Coded states and the vendor's failure code, never its identifier.
          metadata: {
            source: "PROVIDER_WEBHOOK",
            provider: command.provider,
            ownerType: locked.ownerType,
            ownerId: locked.ownerId,
            purpose: locked.purpose,
            previousStatus: locked.status,
            status: current.status,
            appliedTransitions: [...applied],
            metadataUpdated: plan.metadata !== null,
            ...(report.providerErrorCode === undefined
              ? {}
              : { providerErrorCode: report.providerErrorCode }),
          },
          correlationId: command.correlationId,
        });

        return {
          kind: "APPLIED",
          mediaAssetId: current.id,
          status: current.status,
          appliedTransitions: applied,
          metadataUpdated: plan.metadata !== null,
        };
      },
    );
  };
}
