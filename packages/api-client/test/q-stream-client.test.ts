import { describe, expect, it } from "vitest";

import { QStreamEventSchema, type QStreamEvent } from "@capital-q/contracts";

import { ApiProblemError } from "../src/problem.js";
import {
  streamQRunEvents,
  type QStreamTransportStatus,
} from "../src/q-stream.js";

/**
 * The fetch-based stream client (CQ-Q-009 §75-§77, §80): bearer header,
 * Last-Event-ID on reconnect, bounded backoff, durable dedupe, deltas
 * that never move the cursor, and refusals that stop the loop.
 */

const RUN = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";
const MSG = "123e4567-e89b-12d3-a456-426614174000";
const NOW = "2026-09-06T10:00:00.000Z";

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

const frame = (e: QStreamEvent, withId = true) =>
  `event: ${e.type}\n${withId ? `id: ${e.sequence}\n` : ""}data: ${JSON.stringify(e)}\n\n`;

const started = event("q.run.started", 1, {
  capability: "INVESTIGATE",
  status: "RECEIVED",
});
const stage2 = event("q.stage.changed", 2, { stage: "UNDERSTANDING_REQUEST" });
const stage3 = event("q.stage.changed", 3, { stage: "REVIEWING_COMPANY" });
const delta = event("q.message.delta", 3, { messageId: MSG, text: "Runway " });
const completed = event("q.message.completed", 4, {
  message: {
    messageId: MSG,
    runId: RUN,
    role: "Q",
    text: "Runway is 14 months.",
    createdAt: NOW,
  },
});
const done = event("q.run.completed", 5, {
  status: "COMPLETED",
  completedAt: NOW,
});

type Script = readonly {
  readonly status?: number;
  readonly body?: readonly string[];
  readonly problem?: Record<string, unknown>;
  readonly hang?: boolean;
  readonly reject?: boolean;
}[];

/** A fetch that serves scripted responses in order and records each request. */
function scriptedFetch(script: Script) {
  const requests: { headers: Record<string, string>; url: string }[] = [];
  let call = 0;
  const doFetch: typeof fetch = (input, init) => {
    const step = script[call] ?? script[script.length - 1];
    call += 1;
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(
        ([k, v]) => [k.toLowerCase(), v],
      ),
    );
    requests.push({
      headers,
      url:
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
    });
    if (step === undefined || step.reject === true) {
      return Promise.reject(new TypeError("network down"));
    }
    if (step.problem !== undefined) {
      return Promise.resolve(
        new Response(JSON.stringify(step.problem), {
          status: step.status ?? 500,
          headers: { "content-type": "application/problem+json" },
        }),
      );
    }
    const chunks = step.body ?? [];
    const signal = init?.signal ?? null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        if (step.hang !== true) {
          controller.close();
        } else {
          // A real fetch rejects the pending read when the signal aborts.
          signal?.addEventListener(
            "abort",
            () => controller.error(new Error("aborted")),
            { once: true },
          );
        }
      },
    });
    return Promise.resolve(
      new Response(stream, {
        status: step.status ?? 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      }),
    );
  };
  return { doFetch, requests };
}

const session = (doFetch: typeof fetch) => ({
  baseUrl: "https://q.test",
  accessToken: "token-value",
  organisationId: "org-1",
  fetch: doFetch,
});

const NO_WAIT = { initialMs: 1, maxMs: 2, jitter: () => 0 };

describe("streamQRunEvents", () => {
  it("authenticates with the bearer header, never the URL, and processes durable events and deltas", async () => {
    const { doFetch, requests } = scriptedFetch([
      {
        body: [
          "retry: 3000\n\n",
          frame(started),
          frame(stage2),
          ": heartbeat\n\n",
          frame(delta, false),
          frame(completed),
          frame(done),
        ],
      },
    ]);
    const seen: { type: string; durable: boolean; replayed: boolean }[] = [];
    const statuses: QStreamTransportStatus[] = [];
    const result = await streamQRunEvents(session(doFetch), RUN, {
      onEvent: (e, meta) => seen.push({ type: e.type, ...meta }),
      onStatus: (s) => statuses.push(s),
      backoff: NO_WAIT,
    });
    expect(result).toEqual({
      reason: "TERMINAL",
      lastEventId: 5,
      reconnects: 0,
    });
    expect(seen).toEqual([
      { type: "q.run.started", durable: true, replayed: false },
      { type: "q.stage.changed", durable: true, replayed: false },
      { type: "q.message.delta", durable: false, replayed: false },
      { type: "q.message.completed", durable: true, replayed: false },
      { type: "q.run.completed", durable: true, replayed: false },
    ]);
    expect(statuses).toEqual(["CONNECTING", "CONNECTED", "CLOSED"]);
    expect(requests[0]?.url).toBe(`https://q.test/v1/q/runs/${RUN}/events`);
    expect(requests[0]?.url).not.toContain("token");
    expect(requests[0]?.headers["authorization"]).toBe("Bearer token-value");
    expect(requests[0]?.headers["x-organisation-id"]).toBe("org-1");
    expect(requests[0]?.headers["last-event-id"]).toBeUndefined();
  });

  it("reconnects after a dropped connection with Last-Event-ID = last durable sequence, dedupes the overlap, and marks replays", async () => {
    const { doFetch, requests } = scriptedFetch([
      // First connection: two durable events and a delta, then the server drops.
      { body: [frame(started), frame(stage2), frame(delta, false)] },
      // Second connection: the server replays stage2 (overlap) and continues.
      { body: [frame(stage2), frame(stage3), frame(completed), frame(done)] },
    ]);
    const seen: { seq: number; type: string; replayed: boolean }[] = [];
    const statuses: QStreamTransportStatus[] = [];
    const result = await streamQRunEvents(session(doFetch), RUN, {
      onEvent: (e, meta) =>
        seen.push({ seq: e.sequence, type: e.type, replayed: meta.replayed }),
      onStatus: (s) => statuses.push(s),
      backoff: NO_WAIT,
    });
    expect(result).toEqual({
      reason: "TERMINAL",
      lastEventId: 5,
      reconnects: 1,
    });
    // The delta at sequence 3 did not move the cursor: the reconnect asks after 2.
    expect(requests[1]?.headers["last-event-id"]).toBe("2");
    expect(
      seen.filter((s) => s.type !== "q.message.delta").map((s) => s.seq),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(statuses).toContain("RECONNECTING");
  });

  it("resumes from a given cursor and reports replayed events as such", async () => {
    const { doFetch, requests } = scriptedFetch([
      { body: [frame(stage3), frame(completed), frame(done)] },
    ]);
    const seen: { seq: number; replayed: boolean }[] = [];
    await streamQRunEvents(session(doFetch), RUN, {
      lastEventId: 2,
      onEvent: (e, meta) =>
        seen.push({ seq: e.sequence, replayed: meta.replayed }),
      backoff: NO_WAIT,
    });
    expect(requests[0]?.headers["last-event-id"]).toBe("2");
    // Nothing beyond the cursor existed before this connection, so nothing
    // is a replay from the client's point of view.
    expect(seen).toEqual([
      { seq: 3, replayed: false },
      { seq: 4, replayed: false },
      { seq: 5, replayed: false },
    ]);
  });

  it("backs off with bounded attempts on connection failure and gives up honestly", async () => {
    const { doFetch, requests } = scriptedFetch([{ reject: true }]);
    const result = await streamQRunEvents(session(doFetch), RUN, {
      onEvent: () => undefined,
      backoff: { ...NO_WAIT, maxAttempts: 3 },
    });
    expect(result.reason).toBe("GAVE_UP");
    expect(requests).toHaveLength(4);
  });

  it("stops at once on an authentication or not-found refusal instead of looping", async () => {
    for (const status of [401, 403, 404]) {
      const { doFetch, requests } = scriptedFetch([
        {
          status,
          problem: {
            type: "https://capitalq.example/problems/x",
            title: "Refused",
            status,
            code:
              status === 404 ? "RESOURCE_NOT_FOUND" : "AUTHENTICATION_REQUIRED",
            requestId: "req_1",
          },
        },
      ]);
      await expect(
        streamQRunEvents(session(doFetch), RUN, {
          onEvent: () => undefined,
          backoff: NO_WAIT,
        }),
      ).rejects.toBeInstanceOf(ApiProblemError);
      expect(requests, String(status)).toHaveLength(1);
    }
  });

  it("stops on abort without reconnecting", async () => {
    const controller = new AbortController();
    const { doFetch, requests } = scriptedFetch([
      { body: [frame(started)], hang: true },
    ]);
    const promise = streamQRunEvents(session(doFetch), RUN, {
      signal: controller.signal,
      onEvent: () => {
        controller.abort();
      },
      backoff: NO_WAIT,
    });
    const result = await promise;
    expect(result.reason).toBe("ABORTED");
    expect(result.lastEventId).toBe(1);
    expect(requests).toHaveLength(1);
  });

  it("ignores frames that are not valid Q events or belong to another run", async () => {
    const other = { ...started, runId: "00000000-0000-4000-8000-000000000009" };
    const { doFetch } = scriptedFetch([
      {
        body: [
          'event: q.reasoning\ndata: {"thought":"secret"}\n\n',
          `event: q.run.started\nid: 1\ndata: ${JSON.stringify(other)}\n\n`,
          "event: q.stage.changed\nid: 2\ndata: not json\n\n",
          frame(started),
          frame(done),
        ],
      },
    ]);
    const seen: string[] = [];
    const result = await streamQRunEvents(session(doFetch), RUN, {
      onEvent: (e) => seen.push(e.type),
      backoff: NO_WAIT,
    });
    expect(seen).toEqual(["q.run.started", "q.run.completed"]);
    expect(result.reason).toBe("TERMINAL");
  });
});
