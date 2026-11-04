import { describe, expect, it } from "vitest";

import { streamQRunEvents } from "@capital-q/api-client";
import { QStreamEventSchema, type QStreamEvent } from "@capital-q/contracts";

import { oversizedEnvelope } from "../src/http/q-events.js";
import { formatSseFrame } from "../src/http/sse.js";

/**
 * A5 (audit D9): a durable event over the stream's frame bound -- a long
 * answer with its cards -- used to be skipped, and the answer vanished
 * until a reload. Only its envelope is sent now, under its resume id: no
 * content, nothing a client can render, so the client moves past it and
 * re-reads the run's durable record when the run ends.
 */

const RUN = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";
const NOW = "2026-11-04T10:00:00.000Z";

function event(
  type: QStreamEvent["type"],
  sequence: number,
  data: Record<string, unknown>,
): QStreamEvent {
  return QStreamEventSchema.parse({
    contractVersion: 1,
    eventId: `${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
    runId: RUN,
    sequence,
    occurredAt: NOW,
    type,
    data,
  });
}

// Long, as an answer with its cards can be past the 64 KB frame bound.
const SECRET_TEXT = "Runway is 14 months. ".repeat(1_500);
const completed = event("q.message.completed", 2, {
  message: {
    messageId: "123e4567-e89b-12d3-a456-426614174000",
    runId: RUN,
    role: "Q",
    text: SECRET_TEXT,
    createdAt: NOW,
  },
});
const done = event("q.run.completed", 3, {
  status: "COMPLETED",
  completedAt: NOW,
});

const sse = (e: QStreamEvent) =>
  formatSseFrame({
    event: e.type,
    id: String(e.sequence),
    data: JSON.stringify(e),
  });

describe("A5: an oversized durable frame", () => {
  it("is sent as its envelope only: no content, and no Q event schema accepts it", () => {
    const envelope = oversizedEnvelope(completed);
    expect(envelope).toEqual({
      contractVersion: 1,
      eventId: completed.eventId,
      runId: RUN,
      sequence: 2,
      occurredAt: NOW,
      type: "q.message.completed",
      data: null,
      oversized: true,
    });
    expect(JSON.stringify(envelope)).not.toContain("Runway");
    expect(QStreamEventSchema.safeParse(envelope).success).toBe(false);
  });

  it("reaches the client as an unread durable frame: the cursor moves past it, and the run still ends", async () => {
    const body = [
      sse(
        event("q.run.started", 1, { capability: "ANSWER", status: "RECEIVED" }),
      ),
      formatSseFrame({
        event: completed.type,
        id: "2",
        data: JSON.stringify(oversizedEnvelope(completed)),
      }),
      sse(done),
    ].join("");
    const doFetch: typeof fetch = () =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        }),
      );
    const unread: unknown[] = [];
    const seen: string[] = [];
    const result = await streamQRunEvents(
      { baseUrl: "https://q.test", accessToken: "t", fetch: doFetch },
      RUN,
      {
        onEvent: (e) => seen.push(e.type),
        onUnreadable: (frame) => unread.push(frame),
        backoff: { initialMs: 1, maxMs: 2, maxAttempts: 1 },
      },
    );
    expect(seen).toEqual(["q.run.started", "q.run.completed"]);
    expect(unread).toEqual([
      { type: "q.message.completed", sequence: 2, durable: true },
    ]);
    expect(result).toMatchObject({
      reason: "TERMINAL",
      lastEventId: 3,
      unreadable: 1,
    });
  });
});
