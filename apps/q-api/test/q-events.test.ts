import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { createSseParser } from "@capital-q/api-client";
import { parseQApiConfig } from "@capital-q/config/q-api";
import {
  createInProcessQLiveDeltaBus,
  createInProcessQRunEventNotifier,
  createQRunStreamService,
  type QRunEventRecord,
  type QRunRecord,
  type QRuntimeRepositories,
} from "@capital-q/q-runtime";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";
import {
  formatSseComment,
  formatSseFrame,
  formatSseRetry,
} from "../src/http/sse.js";

/**
 * `GET /v1/q/runs/:runId/events` over a real listening socket (CQ-Q-009
 * §9-§13, §21, §43-§48, §51, §56, §68, §97-§98, §108). The run store is
 * in memory and the notifier is in-process; the stream core is the real
 * one, so what is proven here is the HTTP boundary: authentication before
 * any byte, strict Last-Event-ID, SSE framing with durable ids, heartbeat
 * comments, terminal close, connection hygiene, backpressure, cleanup and
 * the absence of every private marker.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const OTHER_USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000002");
const OTHER_TENANT = TenantIdSchema.parse(
  "c0000000-0000-4000-8000-000000000002",
);
const MEMBERSHIP = MembershipIdSchema.parse(
  "e0000000-0000-4000-8000-000000000001",
);
const OWNER: ActorContext = {
  userId: USER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: MEMBERSHIP,
  actorType: "HUMAN",
};
const RUN_ID = "f0000000-0000-4000-8000-000000000001";
const NOW = "2026-09-06T09:00:00.000Z";
const MARKERS = {
  message: "SSE-PRIVATE-MESSAGE-DO-NOT-LEAK",
  reasoning: "SSE-INTERNAL-REASONING-DO-NOT-LEAK",
  internalError: "SSE-INTERNAL-ERROR-DO-NOT-LEAK",
  approvalPayload: "SSE-APPROVAL-PAYLOAD-DO-NOT-LEAK",
} as const;

type Store = {
  events: QRunEventRecord[];
  run: QRunRecord;
  failListing: Error | null;
  append: (
    eventType: string,
    payload: Record<string, unknown>,
  ) => QRunEventRecord;
};

function createStore(status: QRunRecord["status"] = "PLANNING"): Store {
  const store: Store = {
    events: [],
    run: {
      id: RUN_ID,
      tenantId: TENANT,
      actorUserId: USER,
      actorOrganisationId: ORG,
      conversationId: "f0000000-0000-4000-8000-000000000002",
      objective: `Objective ${MARKERS.message} ${MARKERS.reasoning}`,
      capability: "INVESTIGATE",
      consequenceClass: "MODERATE",
      status,
      subjects: [],
      orchestrationVersion: "q-orchestrator-v5",
      promptBundleVersion: null,
      modelPolicyVersion: null,
      correlationId: "cor_00000000-0000-4000-8000-000000000001",
      createdAt: NOW,
      startedAt: NOW,
      completedAt: null,
      failureCode: null,
      version: 1,
      lastEventSequence: 0,
    } as unknown as QRunRecord,
    failListing: null,
    append: (eventType, payload) => {
      const record = {
        id: randomUUID(),
        tenantId: TENANT,
        runId: RUN_ID,
        sequence: store.events.length + 1,
        eventType,
        visibleStage: null,
        payload,
        occurredAt: NOW,
      } as unknown as QRunEventRecord;
      store.events.push(record);
      store.run = { ...store.run, lastEventSequence: record.sequence };
      return record;
    },
  };
  return store;
}

function repositories(store: Store): QRuntimeRepositories {
  return {
    runs: {
      findForActor: (
        _e: unknown,
        tenantId: string,
        userId: string,
        runId: string,
      ) =>
        Promise.resolve(
          tenantId === TENANT && userId === USER && runId === RUN_ID
            ? store.run
            : null,
        ),
      findOwnership: (_e: unknown, runId: string) =>
        Promise.resolve(
          runId === RUN_ID ? { tenantId: TENANT, actorUserId: USER } : null,
        ),
    },
    runEvents: {
      listForRun: (
        _e: unknown,
        tenantId: string,
        runId: string,
        page: { afterSequence?: number; limit?: number } = {},
      ) => {
        if (store.failListing !== null) {
          return Promise.reject(store.failListing);
        }
        const after = page.afterSequence ?? 0;
        return Promise.resolve(
          tenantId === TENANT && runId === RUN_ID
            ? store.events
                .filter((e) => e.sequence > after)
                .slice(0, page.limit ?? 200)
            : [],
        );
      },
    },
  } as unknown as QRuntimeRepositories;
}

type Harness = {
  readonly app: FastifyInstance;
  readonly baseUrl: string;
  readonly store: Store;
  readonly notifier: ReturnType<typeof createInProcessQRunEventNotifier>;
  readonly deltas: ReturnType<typeof createInProcessQLiveDeltaBus>;
  readonly current: {
    principal: AuthenticatedPrincipal | null;
    context: ActorContext | undefined;
  };
  readonly streams: () => number;
  readonly stats: () => {
    noticeSubscribers: number;
    deltaSubscribers: number;
    deltasDropped: number;
  };
  readonly notify: (record: QRunEventRecord) => void;
  readonly close: () => Promise<void>;
};

const harnesses: Harness[] = [];

async function harness(
  options: {
    status?: QRunRecord["status"];
    heartbeatIntervalMs?: number;
    safetyPollMs?: number;
    maxStreamsPerUserRun?: number;
    maxStreamsPerUser?: number;
    drainTimeoutMs?: number;
  } = {},
): Promise<Harness> {
  const store = createStore(options.status);
  const notifier = createInProcessQRunEventNotifier();
  const deltas = createInProcessQLiveDeltaBus();
  const service = createQRunStreamService({
    sql: {} as never,
    transactions: {} as never,
    subjects: {} as never,
    repositories: repositories(store),
    notifier,
    deltas,
    options: { safetyPollMs: options.safetyPollMs ?? 60_000 },
  });
  const current = {
    principal: PRINCIPAL as AuthenticatedPrincipal | null,
    context: OWNER as ActorContext | undefined,
  };
  const security: QApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(current.principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve(
          current.context === undefined
            ? { status: "CONTEXT_REQUIRED" }
            : { status: "RESOLVED", context: current.context },
        ),
    },
  };
  const { app, streams } = createApp(
    parseQApiConfig({ NODE_ENV: "test" }),
    security,
    {
      qStream: {
        service,
        options: {
          heartbeatIntervalMs: options.heartbeatIntervalMs ?? 60_000,
          retryHintMs: 250,
          maxStreamsPerUserRun: options.maxStreamsPerUserRun ?? 4,
          maxStreamsPerUser: options.maxStreamsPerUser ?? 8,
          drainTimeoutMs: options.drainTimeoutMs ?? 30_000,
        },
      },
    },
    { shutdownGraceMs: 200 },
  );
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("no address");
  }
  const h: Harness = {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    store,
    notifier,
    deltas,
    current,
    streams: () => streams?.activeStreams() ?? -1,
    stats: () => service.stats(),
    notify: (record) =>
      notifier.publish({ runId: RUN_ID as never, sequence: record.sequence }),
    close: () => app.close(),
  };
  harnesses.push(h);
  return h;
}

afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    await h.close();
  }
});

const started = (store: Store) =>
  store.append("q.run.started", {
    capability: "INVESTIGATE",
    status: "RECEIVED",
  });
const stage = (store: Store, name: string) =>
  store.append("q.stage.changed", { stage: name });
const completedMessage = (store: Store, text: string) =>
  store.append("q.message.completed", {
    message: {
      messageId: randomUUID(),
      runId: RUN_ID,
      role: "Q",
      text,
      createdAt: NOW,
    },
  });
const runCompleted = (store: Store) =>
  store.append("q.run.completed", { status: "COMPLETED", completedAt: NOW });

type Frame = { event: string; id: string; data: string; raw: string };

/** Opens the stream and collects frames until `until` or the server closes. */
async function openStream(
  h: Harness,
  options: {
    lastEventId?: string | undefined;
    until?: ((frames: Frame[], rawText: string) => boolean) | undefined;
    signal?: AbortSignal | undefined;
    headers?: Record<string, string> | undefined;
    runId?: string | undefined;
  } = {},
): Promise<{
  response: Response;
  frames: Frame[];
  rawText: string;
  closed: boolean;
}> {
  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  const response = await fetch(
    `${h.baseUrl}/v1/q/runs/${options.runId ?? RUN_ID}/events`,
    {
      headers: {
        ...(options.lastEventId === undefined
          ? {}
          : { "last-event-id": options.lastEventId }),
        ...options.headers,
      },
      signal,
    },
  );
  const frames: Frame[] = [];
  let rawText = "";
  let closed = false;
  if (!response.ok || response.body === null) {
    return { response, frames, rawText, closed };
  }
  const parser = createSseParser();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        closed = true;
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      rawText += chunk;
      for (const message of parser.feed(chunk)) {
        frames.push({
          event: message.event,
          id: message.lastEventId,
          data: message.data,
          raw: chunk,
        });
      }
      if (options.until?.(frames, rawText) === true) {
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    controller.abort();
  }
  return { response, frames, rawText, closed };
}

const ids = (frames: Frame[]) =>
  frames.filter((f) => f.event !== "q.message.delta").map((f) => Number(f.id));

describe("GET /v1/q/runs/:runId/events", () => {
  it("refuses an unauthenticated caller before any stream byte, as a problem document", async () => {
    const h = await harness();
    h.current.principal = null;
    const { response } = await openStream(h);
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(h.streams()).toBe(0);
    expect(h.stats().noticeSubscribers).toBe(0);
  });

  it("answers a colleague in the same tenant and a foreign tenant with the same 404, without a stream", async () => {
    const h = await harness();
    started(h.store);
    for (const context of [
      { ...OWNER, userId: OTHER_USER },
      { ...OWNER, tenantId: OTHER_TENANT },
    ]) {
      h.current.context = context;
      const { response } = await openStream(h);
      expect(response.status).toBe(404);
      const problem = (await response.json()) as {
        code: string;
        detail?: string;
      };
      expect(problem.code).toBe("RESOURCE_NOT_FOUND");
      const text = JSON.stringify(problem);
      expect(text).not.toContain("sequence");
      expect(text).not.toContain("PLANNING");
      expect(text).not.toContain(MARKERS.message);
    }
    expect(h.streams()).toBe(0);
  });

  it("rejects a malformed run id and a malformed Last-Event-ID with 422, before authorization is consulted", async () => {
    const h = await harness();
    const bad = await openStream(h, { runId: "not-a-run" });
    expect(bad.response.status).toBe(422);
    for (const value of ["-1", "abc", "1.5", "99999999999", "1 or 1=1", "01"]) {
      const { response } = await openStream(h, { lastEventId: value });
      expect(response.status, value).toBe(422);
      const problem = (await response.json()) as { code: string };
      expect(problem.code).toBe("VALIDATION_FAILED");
    }
    expect(h.streams()).toBe(0);
  });

  it("streams durable events with their sequence as id, then closes on the terminal event", async () => {
    const h = await harness();
    started(h.store);
    stage(h.store, "UNDERSTANDING_REQUEST");
    completedMessage(h.store, `Runway is 14 months. ${MARKERS.message}`);
    runCompleted(h.store);
    const { response, frames, rawText, closed } = await openStream(h);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(
      "no-cache, no-transform",
    );
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(rawText.startsWith("retry: 250\n\n")).toBe(true);
    expect(frames.map((f) => f.event)).toEqual([
      "q.run.started",
      "q.stage.changed",
      "q.message.completed",
      "q.run.completed",
    ]);
    expect(ids(frames)).toEqual([1, 2, 3, 4]);
    // The owner sees their own message; it is theirs to see.
    expect(frames[2]?.data).toContain(MARKERS.message);
    expect(rawText).not.toContain(MARKERS.reasoning);
    expect(closed).toBe(true);
    await sleep(20);
    expect(h.streams()).toBe(0);
    expect(h.stats()).toMatchObject({
      noticeSubscribers: 0,
      deltaSubscribers: 0,
    });
  });

  it("replays after Last-Event-ID, continues live on a wake-up, and never re-sends the cursor", async () => {
    const h = await harness();
    started(h.store);
    stage(h.store, "UNDERSTANDING_REQUEST");
    stage(h.store, "REVIEWING_COMPANY");
    const collected = openStream(h, {
      lastEventId: "1",
      until: (frames) => frames.some((f) => f.event === "q.run.completed"),
    });
    await sleep(50);
    h.notify(completedMessage(h.store, "Done."));
    h.notify(runCompleted(h.store));
    const { frames } = await collected;
    expect(ids(frames)).toEqual([2, 3, 4, 5]);
  });

  it("treats a cursor beyond the run's last event as the run's last event", async () => {
    const h = await harness();
    started(h.store);
    stage(h.store, "UNDERSTANDING_REQUEST");
    const collected = openStream(h, {
      lastEventId: "999",
      until: (frames) => frames.length >= 1,
    });
    await sleep(50);
    h.notify(runCompleted(h.store));
    const { frames } = await collected;
    expect(ids(frames)).toEqual([3]);
  });

  it("replays a terminal run's remaining events and closes without waiting", async () => {
    const h = await harness({ status: "COMPLETED" });
    started(h.store);
    runCompleted(h.store);
    const { frames, closed } = await openStream(h);
    expect(ids(frames)).toEqual([1, 2]);
    expect(closed).toBe(true);
    const again = await openStream(h, { lastEventId: "2" });
    expect(again.frames).toEqual([]);
    expect(again.closed).toBe(true);
  });

  it("sends heartbeat comments that are not events and create no sequence", async () => {
    const h = await harness({ heartbeatIntervalMs: 30 });
    started(h.store);
    const before = h.store.events.length;
    const { frames, rawText } = await openStream(h, {
      until: (_frames, text) => (text.match(/: heartbeat/g) ?? []).length >= 3,
    });
    expect(frames.map((f) => f.event)).toEqual(["q.run.started"]);
    expect(rawText).toContain(": heartbeat\n\n");
    expect(h.store.events.length).toBe(before);
    expect(rawText).not.toMatch(/event: heartbeat/);
  });

  it("delivers live deltas without an id, so they never move the client's cursor", async () => {
    const h = await harness();
    started(h.store);
    const messageId = randomUUID();
    const collected = openStream(h, {
      until: (frames) => frames.some((f) => f.event === "q.run.completed"),
    });
    await sleep(50);
    h.deltas.publish({
      runId: RUN_ID as never,
      tenantId: TENANT,
      messageId: messageId as never,
      text: "Runway ",
    });
    h.deltas.publish({
      runId: RUN_ID as never,
      tenantId: TENANT,
      messageId: messageId as never,
      text: "is 14 months.",
    });
    await sleep(20);
    h.notify(completedMessage(h.store, "Runway is 14 months."));
    h.notify(runCompleted(h.store));
    const { frames, rawText } = await collected;
    const deltas = frames.filter((f) => f.event === "q.message.delta");
    expect(
      deltas.map(
        (f) => (JSON.parse(f.data) as { data: { text: string } }).data.text,
      ),
    ).toEqual(["Runway ", "is 14 months."]);
    // A delta frame carries no id line.
    for (const chunk of rawText.split("\n\n")) {
      if (chunk.includes("event: q.message.delta")) {
        expect(chunk).not.toMatch(/^id:/m);
      }
    }
    expect(ids(frames)).toEqual([1, 2, 3]);
  });

  it("does not cancel the run or keep any subscription when the client disconnects", async () => {
    const h = await harness();
    started(h.store);
    const controller = new AbortController();
    const collected = openStream(h, {
      signal: controller.signal,
      until: (frames) => frames.length >= 1,
    }).catch(() => undefined);
    await collected;
    await sleep(30);
    expect(h.streams()).toBe(0);
    expect(h.stats()).toMatchObject({
      noticeSubscribers: 0,
      deltaSubscribers: 0,
    });
    expect(h.store.run.status).toBe("PLANNING");
    expect(h.store.events.map((e) => e.eventType)).toEqual(["q.run.started"]);
  });

  it("returns listener and stream counts to baseline after many open/close cycles", async () => {
    const h = await harness();
    started(h.store);
    for (let i = 0; i < 25; i += 1) {
      await openStream(h, { until: (frames) => frames.length >= 1 });
    }
    await sleep(50);
    expect(h.streams()).toBe(0);
    expect(h.stats()).toMatchObject({
      noticeSubscribers: 0,
      deltaSubscribers: 0,
    });
  });

  it("bounds concurrent streams per person and run with a 429, never a stream", async () => {
    const h = await harness({ maxStreamsPerUserRun: 2 });
    started(h.store);
    const keep = new AbortController();
    const first = openStream(h, { signal: keep.signal, until: () => false });
    const second = openStream(h, { signal: keep.signal, until: () => false });
    await sleep(60);
    expect(h.streams()).toBe(2);
    const { response } = await openStream(h);
    expect(response.status).toBe(429);
    const problem = (await response.json()) as { code: string; detail: string };
    expect(problem.code).toBe("RATE_LIMITED");
    expect(problem.detail).toBe(
      "Too many open Q streams. Close one and try again.",
    );
    keep.abort();
    await Promise.allSettled([first, second]);
    await sleep(30);
    expect(h.streams()).toBe(0);
  });

  it("serves the same events to several authorised connections without touching the run", async () => {
    const h = await harness();
    started(h.store);
    const a = openStream(h, {
      until: (frames) => frames.some((f) => f.event === "q.run.completed"),
    });
    const b = openStream(h, {
      until: (frames) => frames.some((f) => f.event === "q.run.completed"),
    });
    await sleep(60);
    expect(h.streams()).toBe(2);
    h.notify(stage(h.store, "REVIEWING_COMPANY"));
    h.notify(runCompleted(h.store));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ids(ra.frames)).toEqual([1, 2, 3]);
    expect(ids(rb.frames)).toEqual([1, 2, 3]);
    expect(h.store.events).toHaveLength(3);
  });

  it("honours backpressure from a slow reader without growing the run store or blocking others", async () => {
    const h = await harness({ drainTimeoutMs: 500 });
    started(h.store);
    const messageId = randomUUID();
    // A reader that never reads: the socket fills, the server waits for a
    // drain, and gives up on this client within the timeout.
    const slow = await fetch(`${h.baseUrl}/v1/q/runs/${RUN_ID}/events`);
    expect(slow.status).toBe(200);
    await sleep(30);
    const big = "x".repeat(4000);
    for (let i = 0; i < 3000; i += 1) {
      h.deltas.publish({
        runId: RUN_ID as never,
        tenantId: TENANT,
        messageId: messageId as never,
        text: big,
      });
    }
    for (let i = 0; i < 40; i += 1) {
      h.notify(
        stage(h.store, i % 2 === 0 ? "REVIEWING_COMPANY" : "CHECKING_EVIDENCE"),
      );
    }
    // Meanwhile a healthy reader keeps receiving durable events.
    const healthy = await openStream(h, {
      until: (frames) => ids(frames).includes(41),
    });
    expect(ids(healthy.frames).at(-1)).toBe(41);
    await sleep(700);
    // The slow client has been disconnected, its subscriptions removed.
    expect(h.stats().deltasDropped).toBeGreaterThan(0);
    await slow.body?.cancel().catch(() => undefined);
    await sleep(50);
    expect(h.streams()).toBe(0);
  });

  it("closes an open stream on server shutdown with a comment, leaving the run untouched", async () => {
    const h = await harness();
    started(h.store);
    const collected = openStream(h, { until: () => false });
    await sleep(60);
    expect(h.streams()).toBe(1);
    await h.close();
    const { rawText, closed } = await collected;
    expect(closed).toBe(true);
    expect(rawText).toContain(": server-shutdown");
    expect(h.store.run.status).toBe("PLANNING");
  });

  it("ends with a comment and a clean close when replay fails after headers, leaking nothing", async () => {
    const h = await harness();
    started(h.store);
    const collected = openStream(h, { until: () => false });
    await sleep(60);
    h.store.failListing = new Error(
      `select * from q_runtime.run_events ${MARKERS.internalError}`,
    );
    h.notify(stage(h.store, "REVIEWING_COMPANY"));
    const { rawText, closed } = await collected;
    expect(closed).toBe(true);
    expect(rawText).toContain(": stream-error");
    expect(rawText).not.toContain(MARKERS.internalError);
    expect(rawText).not.toContain("select");
    expect(rawText).not.toContain("q.run.failed");
  });

  it("never frames an event the public contract refuses", async () => {
    const h = await harness();
    started(h.store);
    h.store.append("q.reasoning", { thought: MARKERS.reasoning });
    h.store.append("q.approval.required", {
      proposalId: randomUUID(),
      approvalId: randomUUID(),
      payload: { note: MARKERS.approvalPayload },
    });
    h.store.append("q.approval.required", {
      proposalId: randomUUID(),
      approvalId: randomUUID(),
    });
    runCompleted(h.store);
    const { frames, rawText } = await openStream(h);
    expect(frames.map((f) => f.event)).toEqual([
      "q.run.started",
      "q.approval.required",
      "q.run.completed",
    ]);
    expect(ids(frames)).toEqual([1, 4, 5]);
    expect(rawText).not.toContain(MARKERS.reasoning);
    expect(rawText).not.toContain(MARKERS.approvalPayload);
    expect(rawText).not.toContain("q.reasoning");
  });
});

describe("SSE framing", () => {
  it("formats frames, comments and retry hints exactly", () => {
    expect(
      formatSseFrame({ event: "q.stage.changed", id: "42", data: '{"a":1}' }),
    ).toBe('event: q.stage.changed\nid: 42\ndata: {"a":1}\n\n');
    expect(
      formatSseFrame({ event: "q.message.delta", data: "line1\nline2" }),
    ).toBe("event: q.message.delta\ndata: line1\ndata: line2\n\n");
    expect(formatSseComment("heartbeat")).toBe(": heartbeat\n\n");
    expect(formatSseRetry(3000)).toBe("retry: 3000\n\n");
    expect(() => formatSseFrame({ event: "x\ny", data: "" })).toThrow();
    expect(() =>
      formatSseFrame({ event: "x", id: "1\n2", data: "" }),
    ).toThrow();
  });
});
