import { z } from "zod";

import { defineJob, UuidSchema } from "@capital-q/contracts";

import {
  RefreshPrioritySchema,
  RefreshReasonSchema,
} from "../slates/contracts.js";

/**
 * Recommendation jobs: work a worker performs, never facts.
 *
 *   core.investor_mandate.activated     a fact: a mandate went live
 *   recommendation.slate.refresh        an instruction: rebuild the slate
 *   (the slate row itself)              the durable result
 *
 * The payload names the investor organisation, the mandate and the
 * context, plus the bounded reason and the request sequence the message
 * carries forward. No mandate field, no company, no snapshot: a queue
 * message outlives the work through retries and dead-letter records. The
 * worker claims the request row and resolves everything else from the
 * database; the identifiers confer no authority.
 */

/** The durable queue and its dead letter, created by the REC-006 migration. */
export const RECOMMENDATION_REFRESH_QUEUE = "recommendation-refresh" as const;
export const RECOMMENDATION_REFRESH_DEAD_LETTER_QUEUE =
  "recommendation-refresh-dead" as const;

export const REFRESH_RECOMMENDATION_SLATE_JOB_DATA = z
  .object({
    investorOrganisationId: UuidSchema,
    mandateId: UuidSchema,
    mode: z.literal("INVESTOR_DISCOVER"),
    reason: RefreshReasonSchema,
    priority: RefreshPrioritySchema,
    /** The refresh-request sequence this message was sent for; a claim takes everything up to the latest. */
    requestSequence: z.number().int().min(1),
  })
  .strict();

export type RefreshRecommendationSlateJobData = z.infer<
  typeof REFRESH_RECOMMENDATION_SLATE_JOB_DATA
>;

export const RefreshRecommendationSlateJob = defineJob({
  name: "recommendation.slate.refresh",
  version: 1,
  owner: "@capital-q/discovery",
  handlerOwner: "@capital-q/workers",
  // Names an investor's mandate even though it carries none of it.
  sensitivity: "CONFIDENTIAL",
  dataSchema: REFRESH_RECOMMENDATION_SLATE_JOB_DATA,
  idempotency: {
    describes: "investorOrganisationId + mandateId + mode + requestSequence",
    derive: (data) =>
      `${data.investorOrganisationId}:${data.mandateId}:${data.mode}:${data.requestSequence}`,
  },
  retryPolicy: {
    maxAttempts: 5,
    // A bounded pipeline run over at most CANDIDATE_POOL_MAX companies,
    // including one embedding call for the mandate; well inside this.
    visibilityTimeoutSeconds: 180,
    backoff: {
      strategy: "EXPONENTIAL",
      initialDelaySeconds: 10,
      maxDelaySeconds: 600,
      jitter: true,
    },
    /**
     * Only outcomes another attempt could change: a concurrent build, a
     * store that moved under the ranker, an outage. A ranker refusal is a
     * version decision and stays in the dead letter until code changes.
     */
    retryableErrorCodes: [
      "BUILD_IN_PROGRESS",
      "SNAPSHOT_MISSING",
      "FINGERPRINT_MISMATCH",
      "PUBLISH_FAILED",
      "BUILD_ERROR",
      "DATABASE_UNAVAILABLE",
      "WORKER_INTERRUPTED",
    ],
    deadLetter: true,
  },
  description:
    "Rebuild one investor mandate's recommendation slate for one context, claiming the coalesced refresh request first.",
});
