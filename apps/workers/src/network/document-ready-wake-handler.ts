import { EventEnvelopeSchema } from "@capital-q/contracts";

import type { RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";

/**
 * D82 (owner live 2026-11-09): when a document finishes reading
 * (`evidence.document.ready`), the Q API is told, so a turn about it that
 * Q answered "I'm reading it now" is answered properly -- as that turn's
 * person, through the firewall, once per (turn, document).
 *
 * Only the document id travels: nothing of the document or its text. A
 * failed announcement never holds the event back (logged, not retried).
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DocumentReadyWakeOptions = {
  readonly channel: string;
  /** `select pg_notify(channel, payload)`, as the composition provides it. */
  readonly notify: (channel: string, payload: string) => Promise<void>;
  readonly logger: RunnerLogger;
};

/** The document id of an `evidence.document.ready` event, else null. */
export function readyDocumentOf(message: unknown): string | null {
  const parsed = EventEnvelopeSchema.safeParse(message);
  if (!parsed.success) return null;
  if (parsed.data.type !== "evidence.document.ready") return null;
  const data: unknown = parsed.data.data;
  const documentId: unknown =
    typeof data === "object" && data !== null
      ? Reflect.get(data, "documentId")
      : undefined;
  return typeof documentId === "string" && UUID.test(documentId)
    ? documentId
    : null;
}

export function withDocumentReadyWake(
  inner: (message: QueueMessage) => Promise<MessageOutcome>,
  options: DocumentReadyWakeOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  return async (message) => {
    const outcome = await inner(message);
    const documentId = readyDocumentOf(message.message);
    if (documentId === null) return outcome;
    await options
      .notify(options.channel, documentId)
      .catch((error: unknown) => {
        options.logger.warn(
          { msgId: message.msgId, err: error },
          "document-ready wake not announced",
        );
      });
    return outcome;
  };
}
