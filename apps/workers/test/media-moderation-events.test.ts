import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createEventRegistry } from "@capital-q/contracts";
import { MEDIA_EVENTS } from "@capital-q/media/events";

import { createDomainEventHandler } from "../src/events/document-processing-handler.js";
import type { QueueClient, QueueMessage } from "../src/queue/pgmq.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * The moderation hook on the domain-events consumer (CQ-MEDIA-013). What
 * is proven at this seam: a READY status change reaches the decision with
 * identifiers only; every other media event is archived untouched; a
 * failure retries; and redelivery calls the (idempotent) decision again
 * rather than pretending it already ran.
 */

const registry = createEventRegistry([...MEDIA_EVENTS]);

const queues: QueueClient = {
  send: () => Promise.resolve(1),
  read: () => Promise.resolve([]),
  remove: () => Promise.resolve(),
  archive: () => Promise.resolve(),
  delayVisibility: () => Promise.resolve(),
};

function statusChanged(
  status: string,
  overrides: Record<string, unknown> = {},
): QueueMessage {
  const mediaAssetId = randomUUID();
  return {
    msgId: 9,
    readCount: 1,
    enqueuedAt: new Date().toISOString(),
    message: {
      specVersion: "1.0",
      id: randomUUID(),
      type: "media.asset.status_changed",
      source: "capitalq://api/media",
      time: new Date().toISOString(),
      subject: `media_asset/${mediaAssetId}`,
      dataContentType: "application/json",
      eventVersion: 1,
      tenantId: TENANT_A,
      organisationId: randomUUID(),
      actor: { type: "HUMAN", id: randomUUID() },
      correlationId: `cor_${randomUUID()}`,
      aggregate: { type: "media_asset", id: mediaAssetId, version: 6 },
      data: {
        mediaAssetId,
        ownerType: "COMPANY",
        ownerId: randomUUID(),
        purpose: "FOUNDER_PITCH",
        previousStatus: "PROCESSING",
        status,
      },
      ...overrides,
    },
  };
}

function handlerWith(
  onReady: (event: {
    readonly tenantId: string;
    readonly mediaAssetId: string;
    readonly correlationId: string | undefined;
  }) => Promise<{ readonly kind: string }>,
) {
  const calls: unknown[] = [];
  const logger = createRecordingLogger();
  const handle = createDomainEventHandler({
    registry,
    queues,
    pipelineVersion: "evidence-processing-v1",
    mediaModeration: {
      onReady: (event) => {
        calls.push(event);
        return onReady(event);
      },
    },
    logger,
  });
  return { handle, calls, logger };
}

describe("domain events → automated pitch moderation", () => {
  it("hands a READY pitch to the decision with identifiers only, then archives the event", async () => {
    const { handle, calls } = handlerWith(() =>
      Promise.resolve({ kind: "DECIDED" }),
    );
    const message = statusChanged("READY");
    const data = (message.message as { data: { mediaAssetId: string } }).data;
    expect(await handle(message)).toEqual({ kind: "ARCHIVE" });
    expect(calls).toEqual([
      {
        tenantId: TENANT_A,
        mediaAssetId: data.mediaAssetId,
        correlationId: (message.message as { correlationId: string })
          .correlationId,
      },
    ]);
  });

  it("archives every media status that is not READY without calling the decision", async () => {
    for (const status of [
      "UPLOAD_PENDING",
      "PROCESSING",
      "PROCESSING_FAILED",
    ]) {
      const { handle, calls } = handlerWith(() =>
        Promise.reject(new Error("must not be called")),
      );
      expect(await handle(statusChanged(status))).toEqual({ kind: "ARCHIVE" });
      expect(calls).toHaveLength(0);
    }
  });

  it("archives a READY event when no moderation is composed", async () => {
    const handle = createDomainEventHandler({
      registry,
      queues,
      pipelineVersion: "evidence-processing-v1",
      logger: createRecordingLogger(),
    });
    expect(await handle(statusChanged("READY"))).toEqual({ kind: "ARCHIVE" });
  });

  it("retries when the decision could not be recorded, and replays into the idempotent decision", async () => {
    let attempts = 0;
    const { handle, calls } = handlerWith(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("database away"))
        : Promise.resolve({ kind: attempts === 2 ? "DECIDED" : "SKIPPED" });
    });
    const message = statusChanged("READY");
    expect(await handle(message)).toEqual({
      kind: "RETRY",
      errorCode: "MEDIA_MODERATION_FAILED",
    });
    expect(await handle({ ...message, readCount: 2 })).toEqual({
      kind: "ARCHIVE",
    });
    // A third delivery still reaches the decision, which answers SKIPPED
    // itself: the handler never keeps its own memory of what ran.
    expect(await handle({ ...message, readCount: 3 })).toEqual({
      kind: "ARCHIVE",
    });
    expect(calls).toHaveLength(3);
  });
});
