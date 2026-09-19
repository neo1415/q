import { createJobSchema } from "@capital-q/contracts";
import {
  RefreshRecommendationSlateJob,
  sendRefreshJob,
  type RefreshQueue,
  type RefreshRequestStore,
  type SlateBuilder,
  type SlateKey,
} from "@capital-q/discovery";

import type { RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";
import type { BuildPrincipalResolver } from "./build-principal.js";

/**
 * The `recommendation-refresh` consumer (CQ-REC-006 Checkpoint C).
 *
 *   message → claim the request row (nothing pending: done, coalesced)
 *   → act as the investor organisation's build principal
 *   → builder (REC-002 → REC-005 → slate) → complete the row
 *   → a request that landed mid-build reopens it: one more message.
 *
 * The message names a key and a sequence; it is not authority and not
 * the work. The claim row is: two deliveries of one message, or two
 * messages for one key, produce one build, because only one claim
 * succeeds and the other finds nothing pending.
 */

const RefreshJobSchema = createJobSchema(
  RefreshRecommendationSlateJob.dataSchema,
);

const RETRYABLE = new Set(
  RefreshRecommendationSlateJob.retryPolicy.retryableErrorCodes,
);

export type RecommendationRefreshHandlerOptions = {
  readonly builder: SlateBuilder;
  readonly requests: RefreshRequestStore;
  readonly principals: BuildPrincipalResolver;
  readonly queue: RefreshQueue;
  readonly clock?: (() => Date) | undefined;
  readonly logger: RunnerLogger;
};

export function createRecommendationRefreshHandler(
  options: RecommendationRefreshHandlerOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  const { builder, requests, principals, queue, logger } = options;
  const clock = options.clock ?? (() => new Date());

  return async (message) => {
    const parsed = RefreshJobSchema.safeParse(message.message);
    if (!parsed.success) {
      logger.warn(
        { msgId: message.msgId },
        "recommendation refresh job not understood; dead-lettered",
      );
      return { kind: "PERMANENT", errorCode: "INVALID_JOB" };
    }
    const job = parsed.data;
    if (
      job.type !== RefreshRecommendationSlateJob.name ||
      job.jobVersion !== RefreshRecommendationSlateJob.version
    ) {
      return { kind: "PERMANENT", errorCode: "UNKNOWN_JOB" };
    }
    if (job.tenantId === undefined) {
      return { kind: "PERMANENT", errorCode: "INVALID_JOB" };
    }
    const key: SlateKey = {
      tenantId: job.tenantId,
      investorOrganisationId: job.data.investorOrganisationId,
      mandateId: job.data.mandateId,
      mode: job.data.mode,
    };
    const fields = {
      msgId: message.msgId,
      jobId: job.id,
      mandateId: key.mandateId,
      reason: job.data.reason,
      requestSequence: job.data.requestSequence,
    };

    const claimed = await requests.claim(key, clock().toISOString());
    if (claimed === null) {
      // Coalesced into an earlier delivery, already built, or never
      // requested through the row: nothing to do, and nothing to retry.
      logger.info(fields, "recommendation refresh: nothing pending");
      return { kind: "DONE" };
    }

    const actor = await principals.resolve(key);
    if (actor === null) {
      await requests.release(claimed.id, "FAILED", "NO_BUILD_PRINCIPAL");
      logger.warn(
        fields,
        "recommendation refresh: no active member to build for; dead-lettered",
      );
      return { kind: "PERMANENT", errorCode: "NO_BUILD_PRINCIPAL" };
    }

    let result;
    try {
      result = await builder.build({
        actor,
        mode: job.data.mode,
        mandateId: key.mandateId,
      });
    } catch (error: unknown) {
      await requests.release(claimed.id, "RETRY", "BUILD_ERROR");
      logger.warn(
        { ...fields, err: error },
        "recommendation refresh failed; retrying",
      );
      return { kind: "RETRY", errorCode: "BUILD_ERROR" };
    }

    switch (result.kind) {
      case "BUILD_IN_PROGRESS": {
        await requests.release(claimed.id, "RETRY", "BUILD_IN_PROGRESS");
        return { kind: "RETRY", errorCode: "BUILD_IN_PROGRESS" };
      }
      case "FAILED": {
        const retry = RETRYABLE.has(result.failureCode);
        await requests.release(
          claimed.id,
          retry ? "RETRY" : "FAILED",
          result.failureCode,
        );
        logger.warn(
          {
            ...fields,
            slateId: result.slateId,
            failureCode: result.failureCode,
          },
          retry
            ? "recommendation slate build failed; retrying"
            : "recommendation slate build refused; dead-lettered",
        );
        return retry
          ? { kind: "RETRY", errorCode: result.failureCode }
          : { kind: "PERMANENT", errorCode: result.failureCode };
      }
      case "PUBLISHED":
      case "UNCHANGED":
      case "NO_ACTIVE_MANDATE":
      case "NOT_AN_INVESTOR": {
        const { reopened } = await requests.complete(
          claimed.id,
          clock().toISOString(),
        );
        logger.info(
          {
            ...fields,
            outcome: result.kind,
            slateId:
              result.kind === "PUBLISHED" || result.kind === "UNCHANGED"
                ? result.slate.id
                : null,
            reopened,
          },
          "recommendation refresh handled",
        );
        if (reopened) {
          // A change arrived while this build ran; its request coalesced
          // into the row and reopened it. One more message carries it.
          const latest = await requests.findByKey(key);
          if (latest !== null) {
            await sendRefreshJob(queue, {
              ...key,
              reason: latest.reason,
              priority: latest.priority,
              requestSequence: latest.requestSequence,
              causationId: `cau_${job.id}`,
            });
          }
        }
        return { kind: "DONE" };
      }
    }
  };
}
