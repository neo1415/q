import {
  CorrelationIdSchema,
  type CorrelationId,
  type EventRegistry,
} from "@capital-q/contracts";
import { VerificationClaimRecordedEvent } from "@capital-q/verification/events";
import type {
  DecideSyntheticCommand,
  DecideSyntheticOutcome,
} from "@capital-q/verification";
import { randomUUID } from "node:crypto";

import type { RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";

/**
 * The `verification.claim.recorded` consumer (CQ-VERIFY-001).
 *
 * Wraps the domain-event handler rather than joining it: the message is
 * offered to Capital Q's synthetic decider first, then passed on unchanged
 * so every other consumer (the slate invalidation included) still sees it.
 *
 * The event names a claim and nothing else. Whether it may be decided —
 * the deployment's attestation, the posture, whether the people involved
 * are synthetic, whether the request is still current — is decided by the
 * use case from the database, never from the message. A refusal is final
 * for this message (the request stays PENDING, which is the truth); a
 * failure retries, and a retry after success finds nothing to decide.
 */

type Decide = (
  command: DecideSyntheticCommand,
) => Promise<DecideSyntheticOutcome>;

export type VerificationDecisionHandlerOptions = {
  readonly registry: EventRegistry;
  readonly decide: Decide;
  readonly logger: RunnerLogger;
};

export function withVerificationDecisions(
  inner: (message: QueueMessage) => Promise<MessageOutcome>,
  options: VerificationDecisionHandlerOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  const { registry, decide, logger } = options;
  return async (message) => {
    const parsed = registry.parse(message.message);
    if (
      !parsed.ok ||
      parsed.message.type !== VerificationClaimRecordedEvent.name ||
      parsed.message.eventVersion !== VerificationClaimRecordedEvent.version
    ) {
      return inner(message);
    }
    const event = parsed.message;
    const data = VerificationClaimRecordedEvent.dataSchema.safeParse(
      event.data,
    );
    if (
      !data.success ||
      data.data.status !== "PENDING" ||
      event.tenantId === undefined
    ) {
      return inner(message);
    }
    const correlationId: CorrelationId =
      event.correlationId ?? CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    const fields = {
      msgId: message.msgId,
      eventId: event.id,
      claimId: data.data.claimId,
      claimType: data.data.claimType,
    };
    try {
      const outcome = await decide({
        tenantId: event.tenantId,
        claimId: data.data.claimId,
        correlationId,
      });
      logger.info(
        {
          ...fields,
          outcome: outcome.kind,
          ...(outcome.kind === "REFUSED" ? { reason: outcome.reason } : {}),
        },
        "verification request considered",
      );
    } catch (error: unknown) {
      logger.warn(
        { ...fields, err: error },
        "verification decision failed; retrying",
      );
      return { kind: "RETRY", errorCode: "VERIFICATION_DECISION_FAILED" };
    }
    return inner(message);
  };
}
