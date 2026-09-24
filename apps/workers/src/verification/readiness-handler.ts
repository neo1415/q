import {
  CorrelationIdSchema,
  type CorrelationId,
  type EventRegistry,
} from "@capital-q/contracts";
import type { DecidedClaimOwner } from "@capital-q/verification";
import { VerificationClaimDecidedEvent } from "@capital-q/verification/events";
import { randomUUID } from "node:crypto";

import type { RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";

/**
 * The `verification.claim.decided` consumer (CQ-VERIFY-002): readiness
 * follows a verification decision without anyone pressing "Check
 * readiness".
 *
 * The event names a claim. Whose readiness to reconcile is read from the
 * claim row, never from the message, and the reconciliation is the
 * Companies context's own, run as Capital Q (SYSTEM). It runs for every
 * decision, not only VERIFIED: an expiry or a revocation is a decision
 * too, and it can only lower readiness — the policy decides, not this
 * handler. A redelivery reconciles again and writes nothing, because the
 * stored state already agrees with the policy.
 */

type Reconcile = (command: {
  readonly tenantId: DecidedClaimOwner["tenantId"];
  readonly organisationId: DecidedClaimOwner["organisationId"];
  readonly correlationId: CorrelationId;
  readonly trigger: "VERIFICATION_DECIDED";
}) => Promise<
  readonly {
    readonly companyId: string;
    readonly state: string;
    readonly changed: boolean;
  }[]
>;

export type ReadinessAfterVerificationOptions = {
  readonly registry: EventRegistry;
  readonly ownerOf: (
    tenantId: string,
    claimId: string,
  ) => Promise<DecidedClaimOwner | null>;
  readonly reconcile: Reconcile;
  readonly logger: RunnerLogger;
};

export function withReadinessAfterVerification(
  inner: (message: QueueMessage) => Promise<MessageOutcome>,
  options: ReadinessAfterVerificationOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  const { registry, ownerOf, reconcile, logger } = options;
  return async (message) => {
    const parsed = registry.parse(message.message);
    if (
      !parsed.ok ||
      parsed.message.type !== VerificationClaimDecidedEvent.name ||
      parsed.message.eventVersion !== VerificationClaimDecidedEvent.version ||
      parsed.message.tenantId === undefined
    ) {
      return inner(message);
    }
    const event = parsed.message;
    const data = VerificationClaimDecidedEvent.dataSchema.safeParse(event.data);
    if (!data.success || event.tenantId === undefined) {
      return inner(message);
    }
    const fields = {
      msgId: message.msgId,
      eventId: event.id,
      claimId: data.data.claimId,
      status: data.data.status,
    };
    try {
      const owner = await ownerOf(event.tenantId, data.data.claimId);
      if (owner === null) {
        logger.warn(fields, "verification decision names no decided claim");
        return inner(message);
      }
      const outcomes = await reconcile({
        tenantId: owner.tenantId,
        organisationId: owner.organisationId,
        correlationId:
          event.correlationId ??
          CorrelationIdSchema.parse(`cor_${randomUUID()}`),
        trigger: "VERIFICATION_DECIDED",
      });
      logger.info(
        {
          ...fields,
          companies: outcomes.map((o) => ({
            companyId: o.companyId,
            state: o.state,
            changed: o.changed,
          })),
        },
        "readiness reconciled after a verification decision",
      );
    } catch (error: unknown) {
      logger.warn(
        { ...fields, err: error },
        "readiness reconciliation after a verification decision failed; retrying",
      );
      return { kind: "RETRY", errorCode: "READINESS_RECONCILE_FAILED" };
    }
    return inner(message);
  };
}
