import { describe, expect, it } from "vitest";

import type {
  OutboxPublisher,
  PublishBatchResult,
} from "@capital-q/eventing/publisher";

import {
  abortableSleep,
  createOutboxPublisherRunner,
  type RunnerLogger,
} from "../src/outbox-runner.js";

function batch(
  overrides: Partial<PublishBatchResult> = {},
): PublishBatchResult {
  return {
    claimed: 0,
    published: 0,
    failed: 0,
    exhausted: 0,
    records: [],
    ...overrides,
  };
}

function collectingLogger() {
  const lines: {
    level: string;
    message: string;
    fields: Record<string, unknown>;
  }[] = [];
  const logger: RunnerLogger = {
    info: (fields, message) => lines.push({ level: "info", message, fields }),
    warn: (fields, message) => lines.push({ level: "warn", message, fields }),
    error: (fields, message) => lines.push({ level: "error", message, fields }),
  };
  return { logger, lines };
}

/** A publisher that plays back scripted batches, then stops the loop. */
function scriptedPublisher(
  script: (() => PublishBatchResult | Error)[],
  controller: AbortController,
) {
  const calls: number[] = [];
  const publisher: OutboxPublisher = {
    publishAvailable: (options) => {
      calls.push(options?.limit ?? -1);
      const next = script.shift();
      if (next === undefined) {
        controller.abort();
        return Promise.resolve(batch());
      }
      const result = next();
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    },
  };
  return { publisher, calls };
}

describe("OutboxPublisherRunner", () => {
  it("polls with the configured batch size, sleeps only when idle, and stops on abort", async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    const { publisher, calls } = scriptedPublisher(
      [
        () => batch({ claimed: 2, published: 2 }), // busy: no sleep
        () => batch(), // idle: sleep
        () => batch({ claimed: 1, published: 1 }),
      ],
      controller,
    );
    const { logger, lines } = collectingLogger();

    await createOutboxPublisherRunner({
      publisher,
      batchSize: 7,
      pollIntervalMs: 500,
      logger,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    }).run(controller.signal);

    expect(calls).toEqual([7, 7, 7, 7]);
    // Only the idle tick slept; the busy ticks ran back to back, and the
    // final (aborting) tick did not sleep at all.
    expect(sleeps).toEqual([500]);
    expect(lines.at(-1)?.message).toBe("outbox publisher stopped");
    expect(controller.signal.aborted).toBe(true);
  });

  it("survives a failing batch: logs it without the payload and keeps polling", async () => {
    const controller = new AbortController();
    const { publisher } = scriptedPublisher(
      [
        () =>
          Object.assign(
            new Error('connection "postgresql://u:secret@h/d" refused'),
            { name: "DatabaseError" },
          ),
        () => batch({ claimed: 1, published: 1 }),
      ],
      controller,
    );
    const { logger, lines } = collectingLogger();
    const sleeps: number[] = [];

    await createOutboxPublisherRunner({
      publisher,
      batchSize: 1,
      pollIntervalMs: 250,
      logger,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    }).run(controller.signal);

    const failure = lines.find(
      (line) => line.message === "outbox batch failed",
    );
    expect(failure?.level).toBe("error");
    expect(failure?.fields).toEqual({ error: "DatabaseError" });
    expect(JSON.stringify(lines)).not.toContain("secret");
    // The failed tick backed off once; the busy tick did not, and nothing
    // sleeps after abort.
    expect(sleeps).toEqual([250]);
  });

  it("logs identifiers for each record and escalates exhausted rows", async () => {
    const controller = new AbortController();
    const { publisher } = scriptedPublisher(
      [
        () =>
          batch({
            claimed: 2,
            published: 1,
            failed: 1,
            exhausted: 1,
            records: [
              {
                eventId: "e1",
                eventType: "test.fixture.created",
                eventVersion: 1,
                tenantId: null,
                attempt: 1,
                outcome: "PUBLISHED",
                exhausted: false,
                error: undefined,
                durationMs: 3,
              },
              {
                eventId: "e2",
                eventType: "test.fixture.created",
                eventVersion: 1,
                tenantId: "t",
                attempt: 10,
                outcome: "INVALID",
                exhausted: true,
                error: "UNKNOWN_TYPE",
                durationMs: 1,
              },
            ],
          }),
      ],
      controller,
    );
    const { logger, lines } = collectingLogger();

    await createOutboxPublisherRunner({
      publisher,
      batchSize: 25,
      pollIntervalMs: 750,
      logger,
      sleep: () => Promise.resolve(),
    }).run(controller.signal);

    expect(lines.map((l) => [l.level, l.message])).toEqual([
      ["info", "outbox publisher started"],
      ["info", "outbox event published"],
      ["error", "outbox event exhausted its attempts"],
      ["info", "outbox batch complete"],
      ["info", "outbox publisher stopped"],
    ]);
  });

  it("does not start a tick once already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { publisher, calls } = scriptedPublisher([], controller);
    const { logger } = collectingLogger();

    await createOutboxPublisherRunner({
      publisher,
      batchSize: 1,
      pollIntervalMs: 250,
      logger,
    }).run(controller.signal);

    expect(calls).toEqual([]);
  });

  it("abortableSleep resolves early on abort and leaves no timer behind", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const sleeping = abortableSleep(10_000, controller.signal);
    controller.abort();
    await sleeping;
    expect(Date.now() - started).toBeLessThan(1_000);

    // Already-aborted signal resolves immediately.
    await abortableSleep(10_000, controller.signal);
  });
});
