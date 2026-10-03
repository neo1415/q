import type { EventRegistry } from "@capital-q/contracts";
import { RelationshipMessageSentEvent } from "@capital-q/network/events";

import type { RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";

/**
 * A chat message landed on a relationship (QA run 8a1d57b9: a founder asked
 * "What's your typical cheque size and do you lead?" and nothing reacted,
 * because the investor's standing instruction only ran every 240 minutes).
 *
 * On `network.relationship.message_sent`, announce the relationship id on
 * the instruction wake channel: the Q API makes every ACTIVE instruction
 * that covers the relationship -- on the side that did not send -- due at
 * once. The announcement is only a wake-up and carries no words; the Q API
 * re-reads everything under the owner's own access, and a second
 * announcement finds the firing already claimed. A failed announcement is
 * retried with the message; the instruction's own cadence is the last
 * safety net.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ChatMessageEventOptions = {
  readonly registry: EventRegistry;
  readonly channel: string;
  /** `select pg_notify(channel, payload)`, as the composition provides it. */
  readonly notify: (channel: string, payload: string) => Promise<void>;
  readonly logger: RunnerLogger;
};

export function withChatMessageEvents(
  inner: (message: QueueMessage) => Promise<MessageOutcome>,
  options: ChatMessageEventOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  return async (message) => {
    const parsed = options.registry.parse(message.message);
    if (
      !parsed.ok ||
      parsed.message.type !== RelationshipMessageSentEvent.name
    ) {
      return inner(message);
    }
    const data = RelationshipMessageSentEvent.dataSchema.safeParse(
      parsed.message.data,
    );
    if (!data.success || !UUID.test(data.data.relationshipId)) {
      return inner(message);
    }
    try {
      await options.notify(options.channel, data.data.relationshipId);
    } catch (error: unknown) {
      options.logger.warn(
        { msgId: message.msgId, err: error },
        "instruction wake not announced; retrying",
      );
      return { kind: "RETRY", errorCode: "INSTRUCTION_WAKE_FAILED" };
    }
    return inner(message);
  };
}
