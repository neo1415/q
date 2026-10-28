import { EventEnvelopeSchema } from "@capital-q/contracts";

import type { RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";

/**
 * Situation-first planning, S6 (addendum 2): plans wait on CONDITIONS over
 * the person's records, never on named events, so there are no
 * per-feature watchers. ANY domain event of a tenant announces the tenant
 * on the `q_plan_wake` channel; the Q API re-evaluates every open plan of
 * that tenant (as each plan's owner), fires the steps whose conditions now
 * hold, and drops the tenant's cached situations.
 *
 * Only the tenant id travels: nothing of the event's payload. Idempotent:
 * a second announcement finds the plans already moved on (the thread's
 * keys). A failed announcement never holds the event back -- the Q API's
 * own sweep is the safety net -- so it is logged, never retried.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PlanWakeOptions = {
  readonly channel: string;
  /** `select pg_notify(channel, payload)`, as the composition provides it. */
  readonly notify: (channel: string, payload: string) => Promise<void>;
  readonly logger: RunnerLogger;
};

export function withPlanWake(
  inner: (message: QueueMessage) => Promise<MessageOutcome>,
  options: PlanWakeOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  return async (message) => {
    const outcome = await inner(message);
    // Any event: the envelope alone says whose tenant it is (an event this
    // registry does not know still moves someone's records).
    const parsed = EventEnvelopeSchema.safeParse(message.message);
    const tenantId = parsed.success ? parsed.data.tenantId : undefined;
    if (tenantId === undefined || !UUID.test(tenantId)) return outcome;
    // After the event is handled (its projections are current), whatever
    // the inner outcome: a plan reads the records, not the message.
    await options.notify(options.channel, tenantId).catch((error: unknown) => {
      options.logger.warn(
        { msgId: message.msgId, err: error },
        "plan wake not announced; the plans' sweep will catch up",
      );
    });
    return outcome;
  };
}
