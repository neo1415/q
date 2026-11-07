import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createEventRegistry } from "@capital-q/contracts";
import { ONBOARDING_EVENTS } from "@capital-q/onboarding/events";
import {
  PRESENCE_RESEARCH_QUEUE,
  presenceResearchJob,
} from "@capital-q/q-presence";

import { createDomainEventHandler } from "../src/events/document-processing-handler.js";
import type { PresenceResearchDispatch } from "../src/presence/dispatch.js";
import {
  createPresenceResearchJobHandler,
  createPresenceResearchRequester,
} from "../src/presence/research-job.js";
import type { QueueClient, QueueMessage } from "../src/queue/pgmq.js";
import { createRecordingLogger } from "./support/fakes.js";

/**
 * P1-4 (onboarding plan §7): onboarding research is a durable job. The
 * domain-event consumer only enqueues it, and returns at once (no other
 * event waits on a web read); a failed enqueue retries the event; the job
 * runner works it with its own retries, and only a build of the same
 * subject still running is worth retrying.
 */

const registry = createEventRegistry([...ONBOARDING_EVENTS]);

function committed(stepKey: string): QueueMessage {
  const sessionId = randomUUID();
  return {
    msgId: 9,
    readCount: 1,
    enqueuedAt: new Date().toISOString(),
    message: {
      specVersion: "1.0",
      id: randomUUID(),
      type: "onboarding.response.committed",
      source: "capitalq://api/onboarding",
      time: new Date().toISOString(),
      subject: `onboarding_session/${sessionId}`,
      dataContentType: "application/json",
      eventVersion: 1,
      correlationId: `cor_${randomUUID()}`,
      aggregate: { type: "onboarding_session", id: sessionId, version: 3 },
      data: {
        sessionId,
        stepKey,
        responseId: randomUUID(),
        sessionVersion: 3,
      },
    },
  };
}

function queuesSending(
  send: QueueClient["send"] = () => Promise.resolve(1),
): QueueClient {
  return {
    send,
    read: () => Promise.resolve([]),
    remove: () => Promise.resolve(),
    archive: () => Promise.resolve(),
    delayVisibility: () => Promise.resolve(),
  };
}

describe("onboarding research is enqueued, never run inside the event consumer", () => {
  it("a company name enqueues one research job and the event is done at once", async () => {
    const sent: { queue: string; message: unknown }[] = [];
    const queues = queuesSending((queue, message) => {
      sent.push({ queue, message });
      return Promise.resolve(1);
    });
    const handle = createDomainEventHandler({
      registry,
      queues,
      pipelineVersion: "evidence-processing-v1",
      presenceResearch: createPresenceResearchRequester({ queue: queues }),
      logger: createRecordingLogger(),
    });
    const message = committed("F1.company_name");

    expect(await handle(message)).toEqual({ kind: "ARCHIVE" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.queue).toBe(PRESENCE_RESEARCH_QUEUE);
    expect(sent[0]?.message).toMatchObject({
      type: "presence.onboarding.research",
      jobVersion: 1,
      data: { stepKey: "F1.company_name" },
    });
  });

  it("a website given after the name is enqueued too; other answers are not", async () => {
    const sent: unknown[] = [];
    const queues = queuesSending((_queue, message) => {
      sent.push(message);
      return Promise.resolve(1);
    });
    const handle = createDomainEventHandler({
      registry,
      queues,
      pipelineVersion: "evidence-processing-v1",
      presenceResearch: createPresenceResearchRequester({ queue: queues }),
      logger: createRecordingLogger(),
    });
    await handle(committed("F1.website"));
    await handle(committed("F1.stage"));
    expect(sent).toHaveLength(1);
  });

  it("a queue that refuses the job retries the event: nothing is lost", async () => {
    const queues = queuesSending(() => Promise.reject(new Error("queue down")));
    const handle = createDomainEventHandler({
      registry,
      queues,
      pipelineVersion: "evidence-processing-v1",
      presenceResearch: createPresenceResearchRequester({ queue: queues }),
      logger: createRecordingLogger(),
    });
    expect(await handle(committed("I0.organisation_name"))).toMatchObject({
      kind: "RETRY",
    });
  });
});

describe("the research job runner", () => {
  const job = (): QueueMessage => ({
    msgId: 3,
    readCount: 1,
    enqueuedAt: new Date().toISOString(),
    message: presenceResearchJob({
      sessionId: randomUUID(),
      stepKey: "F1.company_name",
      responseId: randomUUID(),
    }),
  });

  it("works the job and is done", async () => {
    const onResponseCommitted = vi.fn(() => Promise.resolve("DONE" as const));
    const handle = createPresenceResearchJobHandler({
      dispatch: { onResponseCommitted } as PresenceResearchDispatch,
      logger: createRecordingLogger(),
    });
    expect(await handle(job())).toEqual({ kind: "DONE" });
    expect(onResponseCommitted).toHaveBeenCalledTimes(1);
  });

  it("retries only while the same subject's build is still running", async () => {
    const handle = createPresenceResearchJobHandler({
      dispatch: {
        onResponseCommitted: () => Promise.resolve("RETRY" as const),
      },
      logger: createRecordingLogger(),
    });
    expect(await handle(job())).toEqual({
      kind: "RETRY",
      errorCode: "BUILD_IN_PROGRESS",
    });
  });

  it("dead-letters a message it cannot read", async () => {
    const handle = createPresenceResearchJobHandler({
      dispatch: {
        onResponseCommitted: () => Promise.resolve("DONE" as const),
      },
      logger: createRecordingLogger(),
    });
    expect(
      await handle({ ...job(), message: { type: "something.else" } }),
    ).toMatchObject({ kind: "PERMANENT" });
  });
});
