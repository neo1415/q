import { FOUNDER_STEPS } from "@capital-q/founder-onboarding";
import { INVESTOR_STEPS } from "@capital-q/investor-onboarding";
import {
  PRESENCE_RESEARCH_QUEUE,
  PresenceResearchJobSchema,
  presenceResearchJob,
  ResearchOnboardingPresenceJob,
} from "@capital-q/q-presence";

import type { RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";
import type { PresenceResearchDispatch } from "./dispatch.js";

/**
 * Onboarding research as a durable job (onboarding plan §7, P1-4).
 *
 * The domain-event consumer only ENQUEUES: one job for an answer that names
 * the subject (a company or firm name) or gives a founder's website after
 * it. The consumer returns at once, so no other event waits on a web read,
 * and an enqueue that fails is retried with the event. A dedicated runner
 * then works the job with its own visibility timeout (120 s, a build is
 * bounded at 45 s), retries and dead letter: a deploy mid-read leaves the
 * message to be delivered again, and the presence build log keeps a
 * redelivery from reading the same pages twice (a build already running is
 * waited for, one done inside the refresh window is not repeated).
 */

/** The answers worth a read of the public web. */
export const RESEARCH_TRIGGER_STEPS: ReadonlySet<string> = new Set([
  FOUNDER_STEPS.companyName,
  FOUNDER_STEPS.website,
  INVESTOR_STEPS.organisationName,
]);

export type PresenceResearchQueue = {
  readonly send: (queue: string, message: unknown) => Promise<number>;
};

export type PresenceResearchRequester = {
  /** True when a job was enqueued; false when the answer is not one to research on. Throws when the queue refuses. */
  readonly request: (event: {
    readonly tenantId: string | undefined;
    readonly sessionId: string;
    readonly stepKey: string;
    readonly responseId: string;
    readonly correlationId?: string | undefined;
  }) => Promise<boolean>;
};

export function createPresenceResearchRequester(dependencies: {
  readonly queue: PresenceResearchQueue;
}): PresenceResearchRequester {
  return {
    request: async (event) => {
      if (!RESEARCH_TRIGGER_STEPS.has(event.stepKey)) return false;
      await dependencies.queue.send(
        PRESENCE_RESEARCH_QUEUE,
        presenceResearchJob({
          // Onboarding events are platform-scoped: the tenant travels when
          // the event has one; the work resolves it from the session.
          ...(event.tenantId === undefined ? {} : { tenantId: event.tenantId }),
          sessionId: event.sessionId,
          stepKey: event.stepKey,
          responseId: event.responseId,
          ...(event.correlationId === undefined
            ? {}
            : { correlationId: event.correlationId }),
        }),
      );
      return true;
    },
  };
}

export function createPresenceResearchJobHandler(dependencies: {
  readonly dispatch: PresenceResearchDispatch;
  readonly logger: RunnerLogger;
}): (message: QueueMessage) => Promise<MessageOutcome> {
  const { dispatch, logger } = dependencies;
  return async (message) => {
    const parsed = PresenceResearchJobSchema.safeParse(message.message);
    if (!parsed.success) {
      logger.warn(
        { msgId: message.msgId },
        "presence research job not understood; dead-lettered",
      );
      return { kind: "PERMANENT", errorCode: "INVALID_JOB" };
    }
    const job = parsed.data;
    if (
      job.type !== ResearchOnboardingPresenceJob.name ||
      job.jobVersion !== ResearchOnboardingPresenceJob.version
    ) {
      return { kind: "PERMANENT", errorCode: "UNKNOWN_JOB" };
    }
    // Never throws: a failed read is DONE (paid searches are not retried).
    const result = await dispatch.onResponseCommitted(job.data);
    return result === "RETRY"
      ? { kind: "RETRY", errorCode: "BUILD_IN_PROGRESS" }
      : { kind: "DONE" };
  };
}
