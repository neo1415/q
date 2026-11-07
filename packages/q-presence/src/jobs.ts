import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  createJobSchema,
  defineJob,
  JobIdSchema,
  UtcTimestampSchema,
  UuidSchema,
} from "@capital-q/contracts";

/**
 * Onboarding research as a durable job (onboarding plan §7, P1-4).
 *
 *   onboarding.response.committed       a fact: an answer was saved
 *   presence.onboarding.research        an instruction: read their public web
 *   (suggestions, the presence log)     the durable result
 *
 * Before this, the read ran detached inside the domain-event consumer (and,
 * in q-api, in an in-process Map), so a deploy mid-read lost it. The event
 * consumer now only enqueues this job, which a dedicated runner works with
 * its own visibility timeout, retries and dead letter. The payload names
 * the session, the step and the response; nothing of the answer itself (a
 * queue message outlives the work through retries and dead-letter records).
 * The worker resolves everything else from the database, and the
 * identifiers confer no authority.
 */

/** The durable queue and its dead letter, created by migration 20261231430000. */
export const PRESENCE_RESEARCH_QUEUE = "presence-research" as const;
export const PRESENCE_RESEARCH_DEAD_LETTER_QUEUE =
  "presence-research-dead" as const;

export const PRESENCE_RESEARCH_JOB_DATA = z
  .object({
    sessionId: UuidSchema,
    stepKey: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u),
    responseId: UuidSchema,
  })
  .strict();

export type PresenceResearchJobData = z.infer<
  typeof PRESENCE_RESEARCH_JOB_DATA
>;

export const ResearchOnboardingPresenceJob = defineJob({
  name: "presence.onboarding.research",
  version: 1,
  owner: "@capital-q/q-presence",
  handlerOwner: "@capital-q/workers",
  // Names a person's onboarding session and the company they named.
  sensitivity: "CONFIDENTIAL",
  dataSchema: PRESENCE_RESEARCH_JOB_DATA,
  idempotency: {
    describes: "sessionId + stepKey + responseId",
    derive: (data) => `${data.sessionId}:${data.stepKey}:${data.responseId}`,
  },
  retryPolicy: {
    maxAttempts: 6,
    // One build is bounded at 45 s (PRESENCE_RESEARCH_BOUND_MS in the
    // worker); a message is never handed to a second worker mid-read.
    visibilityTimeoutSeconds: 120,
    backoff: {
      strategy: "EXPONENTIAL",
      initialDelaySeconds: 15,
      maxDelaySeconds: 600,
      jitter: true,
    },
    /**
     * Only a build of the same subject already running is worth waiting
     * for (its identity may predate a website given since). A failed read
     * is never retried: its searches are paid, and the person is never told
     * (DECISIONS 77).
     */
    retryableErrorCodes: ["BUILD_IN_PROGRESS"],
    deadLetter: true,
  },
  description:
    "Read the public web about the company or firm a person named during onboarding, and hold what is found as suggestions for them to confirm.",
});

export const PresenceResearchJobSchema = createJobSchema(
  PRESENCE_RESEARCH_JOB_DATA,
);
export type PresenceResearchJob = z.infer<typeof PresenceResearchJobSchema>;

/** One bounded message on the research queue: identifiers only. */
export function presenceResearchJob(
  input: PresenceResearchJobData & {
    readonly tenantId?: string | undefined;
    readonly correlationId?: string | undefined;
  },
  clock: () => Date = () => new Date(),
): PresenceResearchJob {
  return PresenceResearchJobSchema.parse({
    id: JobIdSchema.parse(randomUUID()),
    type: ResearchOnboardingPresenceJob.name,
    jobVersion: ResearchOnboardingPresenceJob.version,
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    ...(input.correlationId === undefined
      ? {}
      : { correlationId: input.correlationId }),
    createdAt: UtcTimestampSchema.parse(clock().toISOString()),
    data: {
      sessionId: input.sessionId,
      stepKey: input.stepKey,
      responseId: input.responseId,
    },
  });
}
