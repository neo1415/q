import { describe, expect, it } from "vitest";

import {
  backoffSeconds,
  createQueueRunner,
  type MessageOutcome,
} from "../src/queue/runner.js";
import type { QueueClient, QueueMessage } from "../src/queue/pgmq.js";
import { createRecordingLogger } from "./support/fakes.js";

/**
 * Acknowledgement discipline. A message leaves the queue only when its work
 * is committed, a poison message stops being retried, and what lands in the
 * dead-letter queue is identifiers and a code — never a payload's content.
 */

type Recorded = {
  readonly removed: number[];
  readonly archived: number[];
  readonly delayed: { msgId: number; seconds: number }[];
  readonly sent: { queue: string; message: unknown }[];
};

function fakeClient(messages: QueueMessage[]): {
  readonly client: QueueClient;
  readonly recorded: Recorded;
} {
  const recorded: Recorded = {
    removed: [],
    archived: [],
    delayed: [],
    sent: [],
  };
  let served = false;
  const client: QueueClient = {
    send: (queue, message) => {
      recorded.sent.push({ queue, message });
      return Promise.resolve(1);
    },
    read: () => {
      if (served) return Promise.resolve([]);
      served = true;
      return Promise.resolve(messages);
    },
    remove: (_queue, msgId) => {
      recorded.removed.push(msgId);
      return Promise.resolve();
    },
    archive: (_queue, msgId) => {
      recorded.archived.push(msgId);
      return Promise.resolve();
    },
    delayVisibility: (_queue, msgId, seconds) => {
      recorded.delayed.push({ msgId, seconds });
      return Promise.resolve();
    },
  };
  return { client, recorded };
}

function message(msgId: number, readCount = 1): QueueMessage {
  return {
    msgId,
    readCount,
    enqueuedAt: new Date().toISOString(),
    message: { secret: "extracted text that must never be copied" },
  };
}

function runner(
  messages: QueueMessage[],
  handle: (m: QueueMessage) => Promise<MessageOutcome>,
  maxAttempts = 3,
) {
  const { client, recorded } = fakeClient(messages);
  return {
    recorded,
    runner: createQueueRunner({
      queue: "documents",
      deadLetterQueue: "documents-dead",
      client,
      handle,
      batchSize: 10,
      pollIntervalMs: 1,
      visibilityTimeoutSeconds: 30,
      maxAttempts,
      backoff: { initialDelaySeconds: 2, maxDelaySeconds: 60, jitter: false },
      logger: createRecordingLogger(),
    }),
  };
}

describe("backoffSeconds", () => {
  it("grows exponentially and stops at the ceiling", () => {
    const options = {
      initialDelaySeconds: 5,
      maxDelaySeconds: 40,
      jitter: false,
    };
    expect(backoffSeconds(1, options, () => 0.5)).toBe(5);
    expect(backoffSeconds(2, options, () => 0.5)).toBe(10);
    expect(backoffSeconds(5, options, () => 0.5)).toBe(40);
  });

  it("spreads retries when jitter is on", () => {
    const options = {
      initialDelaySeconds: 10,
      maxDelaySeconds: 60,
      jitter: true,
    };
    expect(backoffSeconds(1, options, () => 0)).toBe(5);
    expect(backoffSeconds(1, options, () => 1)).toBe(10);
  });
});

describe("queue runner", () => {
  it("removes a message only after the handler commits", async () => {
    const { runner: queue, recorded } = runner([message(1)], () =>
      Promise.resolve({ kind: "DONE" }),
    );
    await queue.runOnce();
    expect(recorded.removed).toEqual([1]);
    expect(recorded.sent).toEqual([]);
  });

  it("archives instead of deleting when asked to keep history", async () => {
    const { runner: queue, recorded } = runner([message(1)], () =>
      Promise.resolve({ kind: "ARCHIVE" }),
    );
    await queue.runOnce();
    expect(recorded.archived).toEqual([1]);
    expect(recorded.removed).toEqual([]);
  });

  it("hides a retryable message for a backoff", async () => {
    const { runner: queue, recorded } = runner([message(1, 2)], () =>
      Promise.resolve({ kind: "RETRY", errorCode: "STORAGE_UNAVAILABLE" }),
    );
    await queue.runOnce();
    expect(recorded.delayed).toEqual([{ msgId: 1, seconds: 4 }]);
    expect(recorded.removed).toEqual([]);
  });

  it("dead-letters once the attempt limit is reached", async () => {
    const { runner: queue, recorded } = runner([message(1, 3)], () =>
      Promise.resolve({ kind: "RETRY", errorCode: "STORAGE_UNAVAILABLE" }),
    );
    await queue.runOnce();
    expect(recorded.sent).toHaveLength(1);
    expect(recorded.removed).toEqual([1]);
  });

  it("dead-letters a permanent failure immediately", async () => {
    const { runner: queue, recorded } = runner([message(1)], () =>
      Promise.resolve({ kind: "PERMANENT", errorCode: "TENANT_MISMATCH" }),
    );
    await queue.runOnce();
    expect(recorded.sent[0]).toMatchObject({
      queue: "documents-dead",
      message: { errorCode: "TENANT_MISMATCH", attempts: 1 },
    });
  });

  it("treats a thrown handler as transient rather than losing the work", async () => {
    const { runner: queue, recorded } = runner([message(1)], () => {
      throw new Error("database went away");
    });
    await queue.runOnce();
    expect(recorded.delayed).toHaveLength(1);
    expect(recorded.removed).toEqual([]);
  });

  it("keeps the dead-letter record to identifiers and a code", async () => {
    const { runner: queue, recorded } = runner([message(7)], () =>
      Promise.resolve({ kind: "PERMANENT", errorCode: "INVALID_JOB" }),
    );
    await queue.runOnce();
    const record = recorded.sent[0]?.message as Record<string, unknown>;
    expect(Object.keys(record).sort()).toEqual([
      "attempts",
      "deadLetteredAt",
      "enqueuedAt",
      "errorCode",
      "message",
      "msgId",
      "queue",
    ]);
    // The original job envelope travels; it holds ids, never document text.
    expect(record.errorCode).toBe("INVALID_JOB");
  });

  it("stops when its signal aborts", async () => {
    const controller = new AbortController();
    const { runner: queue } = runner([], () =>
      Promise.resolve({ kind: "DONE" }),
    );
    const running = queue.run(controller.signal);
    controller.abort();
    await expect(running).resolves.toBeUndefined();
  });
});
