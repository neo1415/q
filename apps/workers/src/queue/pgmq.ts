import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

/**
 * The queue, as this worker uses it.
 *
 * pgmq reached through the worker's own PostgreSQL connection: no queue SDK,
 * no HTTP, no credential beyond the one already held. Queue names are code
 * constants, never configuration — an environment typo must not be able to
 * reroute work.
 *
 * Delivery is at least once. A visibility timeout, a crash or a restart can
 * each present one message twice, so every handler is idempotent and the
 * runner acknowledges only after the durable state it wanted is committed.
 */

export const DOCUMENTS_QUEUE = "documents" as const;
export const DOCUMENTS_DEAD_LETTER_QUEUE = "documents-dead" as const;

export type QueueMessage = {
  readonly msgId: number;
  /** How many times this message has been delivered, including now. */
  readonly readCount: number;
  readonly enqueuedAt: string;
  readonly message: unknown;
};

const MessageRow = z.object({
  msg_id: z.union([z.number(), z.string()]).transform(Number),
  read_ct: z.union([z.number(), z.string()]).transform(Number),
  enqueued_at: z
    .union([z.date(), z.string()])
    .transform((value) =>
      value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString(),
    ),
  message: z.unknown(),
});

export type QueueClient = {
  readonly send: (
    queue: string,
    message: unknown,
    delaySeconds?: number,
  ) => Promise<number>;
  /** Claims up to `batchSize` messages, hidden for `visibilityTimeoutSeconds`. */
  readonly read: (
    queue: string,
    options: {
      readonly visibilityTimeoutSeconds: number;
      readonly batchSize: number;
    },
  ) => Promise<readonly QueueMessage[]>;
  /** Removes the message. Called only after the work is durably committed. */
  readonly remove: (queue: string, msgId: number) => Promise<void>;
  /** Moves the message to pgmq's archive, keeping it readable as history. */
  readonly archive: (queue: string, msgId: number) => Promise<void>;
  /** Re-hides a message for a backoff delay instead of retrying immediately. */
  readonly delayVisibility: (
    queue: string,
    msgId: number,
    seconds: number,
  ) => Promise<void>;
};

export function createPgmqQueueClient(sql: DatabaseExecutor): QueueClient {
  return {
    send: async (queue, message, delaySeconds) => {
      const rows =
        delaySeconds === undefined
          ? await sql`select pgmq.send(${queue}, ${JSON.stringify(message)}::text::jsonb) as msg_id`
          : await sql`select pgmq.send(${queue}, ${JSON.stringify(message)}::text::jsonb, ${delaySeconds}::integer) as msg_id`;
      return z
        .object({ msg_id: z.union([z.number(), z.string()]).transform(Number) })
        .parse(rows[0]).msg_id;
    },
    read: async (queue, options) => {
      const rows = await sql`
        select msg_id, read_ct, enqueued_at, message
          from pgmq.read(${queue}, ${options.visibilityTimeoutSeconds}::integer, ${options.batchSize}::integer)`;
      return rows.map((row) => {
        const parsed = MessageRow.parse(row);
        return {
          msgId: parsed.msg_id,
          readCount: parsed.read_ct,
          enqueuedAt: parsed.enqueued_at,
          message: parsed.message,
        };
      });
    },
    remove: async (queue, msgId) => {
      await sql`select pgmq.delete(${queue}, ${msgId}::bigint)`;
    },
    archive: async (queue, msgId) => {
      await sql`select pgmq.archive(${queue}, ${msgId}::bigint)`;
    },
    delayVisibility: async (queue, msgId, seconds) => {
      await sql`select pgmq.set_vt(${queue}, ${msgId}::bigint, ${seconds}::integer)`;
    },
  };
}
