import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { QStreamEvent } from "@capital-q/contracts";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createInProcessQLiveDeltaBus,
  createInProcessQRunEventNotifier,
  createQRunStreamService,
  projectPublicStreamEvent,
  type QRunStreamItem,
} from "../src/application/stream.js";
import type { QRuntimeRepositories } from "../src/application/ports.js";
import type { QRunEventRecord, QRunRecord } from "../src/contracts/index.js";
import { QRunNotFoundError } from "../src/domain/errors.js";

/**
 * The stream core (CQ-Q-009 §22-§25, §43-§45, §53-§56) over an in-memory
 * event store: replay after a cursor, the replay/live race, per-run
 * ordering, deltas between durable boundaries, terminal close, the replay
 * cap, the safety poll, and subscriber cleanup. No transport here.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const OWNER = "b0000000-0000-4000-8000-000000000001";
const OTHER = "b0000000-0000-4000-8000-000000000002";
const RUN_ID = "f0000000-0000-4000-8000-000000000001";
const NOW = "2026-09-06T10:00:00.000Z";
const REASONING_MARKER = "SSE-INTERNAL-REASONING-DO-NOT-LEAK";

const actor: ActorContext = ActorContextSchema.parse({
  userId: OWNER,
  tenantId: TENANT,
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});

function run(overrides: Partial<QRunRecord> = {}): QRunRecord {
  return {
    id: RUN_ID,
    tenantId: TENANT,
    actorUserId: OWNER,
    actorOrganisationId: "d0000000-0000-4000-8000-000000000001",
    conversationId: "f0000000-0000-4000-8000-000000000002",
    objective: `Objective ${REASONING_MARKER}`,
    capability: "INVESTIGATE",
    consequenceClass: "MODERATE",
    status: "PLANNING",
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
    ...overrides,
  } as QRunRecord;
}

type Store = {
  readonly events: QRunEventRecord[];
  current: QRunRecord;
  reads: number;
  append: (
    eventType: string,
    payload: Record<string, unknown>,
    visibleStage?: string | null,
  ) => QRunEventRecord;
};

function store(initial: QRunRecord): Store {
  const events: QRunEventRecord[] = [];
  const s: Store = {
    events,
    current: initial,
    reads: 0,
    append: (eventType, payload, visibleStage = null) => {
      const record = {
        id: randomUUID(),
        tenantId: TENANT,
        runId: RUN_ID,
        sequence: events.length + 1,
        eventType,
        visibleStage,
        payload,
        occurredAt: NOW,
      } as unknown as QRunEventRecord;
      events.push(record);
      s.current = { ...s.current, lastEventSequence: record.sequence };
      return record;
    },
  };
  return s;
}

function repositories(s: Store): QRuntimeRepositories {
  return {
    runs: {
      findForActor: (
        _e: unknown,
        tenantId: string,
        userId: string,
        runId: string,
      ) =>
        Promise.resolve(
          tenantId === TENANT && userId === OWNER && runId === RUN_ID
            ? s.current
            : null,
        ),
      findOwnership: (_e: unknown, runId: string) =>
        Promise.resolve(
          runId === RUN_ID ? { tenantId: TENANT, actorUserId: OWNER } : null,
        ),
    },
    runEvents: {
      listForRun: (
        _e: unknown,
        tenantId: string,
        runId: string,
        page: { afterSequence?: number; limit?: number } = {},
      ) => {
        s.reads += 1;
        const after = page.afterSequence ?? 0;
        const limit = page.limit ?? 200;
        return Promise.resolve(
          tenantId === TENANT && runId === RUN_ID
            ? s.events.filter((e) => e.sequence > after).slice(0, limit)
            : [],
        );
      },
    },
  } as unknown as QRuntimeRepositories;
}

function world(
  initial: QRunRecord = run(),
  options: {
    safetyPollMs?: number;
    replayMaxEvents?: number;
    replayPageSize?: number;
  } = {},
) {
  const s = store(initial);
  const notifier = createInProcessQRunEventNotifier();
  const deltas = createInProcessQLiveDeltaBus();
  const service = createQRunStreamService({
    sql: {} as never,
    transactions: {} as never,
    subjects: {} as never,
    repositories: repositories(s),
    notifier,
    deltas,
    options: { safetyPollMs: 60_000, ...options },
  });
  const notify = (record: QRunEventRecord) =>
    notifier.publish({ runId: RUN_ID as never, sequence: record.sequence });
  return { s, notifier, deltas, service, notify };
}

const started = (s: Store) =>
  s.append("q.run.started", { capability: "INVESTIGATE", status: "RECEIVED" });
const stage = (s: Store, name: string) =>
  s.append("q.stage.changed", { stage: name }, name);
const completed = (s: Store) =>
  s.append("q.run.completed", { status: "COMPLETED", completedAt: NOW });

/** Collects items until `until` says stop or the generator ends. */
async function collect(
  iterator: AsyncGenerator<QRunStreamItem>,
  until: (items: QRunStreamItem[]) => boolean,
): Promise<QRunStreamItem[]> {
  const items: QRunStreamItem[] = [];
  for await (const item of iterator) {
    items.push(item);
    if (until(items)) {
      break;
    }
  }
  return items;
}

const sequences = (items: QRunStreamItem[]) =>
  items
    .filter(
      (i): i is { kind: "durable"; event: QStreamEvent } =>
        i.kind === "durable",
    )
    .map((i) => i.event.sequence);

describe("createQRunStreamService", () => {
  it("authorises the owner only and answers a stranger with not found", async () => {
    const { service } = world();
    await expect(
      service.authorize(actor, RUN_ID as never),
    ).resolves.toMatchObject({ id: RUN_ID });
    await expect(
      service.authorize({ ...actor, userId: OTHER as never }, RUN_ID as never),
    ).rejects.toBeInstanceOf(QRunNotFoundError);
    await expect(
      service.authorize(
        { ...actor, tenantId: "c0000000-0000-4000-8000-000000000009" as never },
        RUN_ID as never,
      ),
    ).rejects.toBeInstanceOf(QRunNotFoundError);
  });

  it("replays everything after the cursor in sequence order and ends on the terminal event", async () => {
    const { s, service } = world();
    started(s);
    stage(s, "UNDERSTANDING_REQUEST");
    stage(s, "REVIEWING_COMPANY");
    completed(s);
    s.current = { ...s.current, status: "COMPLETED", completedAt: NOW };
    const all = await collect(
      service.open({
        run: s.current,
        afterSequence: 0,
        signal: new AbortController().signal,
      }),
      () => false,
    );
    expect(sequences(all)).toEqual([1, 2, 3, 4]);
    expect(all.at(-1)).toEqual({ kind: "end", reason: "TERMINAL" });
    const fromTwo = await collect(
      service.open({
        run: s.current,
        afterSequence: 2,
        signal: new AbortController().signal,
      }),
      () => false,
    );
    expect(sequences(fromTwo)).toEqual([3, 4]);
    const beyond = await collect(
      service.open({
        run: s.current,
        afterSequence: 4,
        signal: new AbortController().signal,
      }),
      () => false,
    );
    expect(sequences(beyond)).toEqual([]);
    expect(beyond).toEqual([{ kind: "end", reason: "RUN_ENDED" }]);
  });

  it("delivers live events after replay and never skips one that commits during the switch", async () => {
    const s = store(run());
    started(s);
    stage(s, "UNDERSTANDING_REQUEST");
    const notifier = createInProcessQRunEventNotifier();
    const notify = (record: QRunEventRecord) =>
      notifier.publish({ runId: RUN_ID as never, sequence: record.sequence });
    // The store commits and announces a third event WHILE the first replay
    // read is in flight: the race a naive "query, then subscribe" loses.
    const base = repositories(s);
    let raced = false;
    const racing = {
      ...base,
      runEvents: {
        ...base.runEvents,
        listForRun: async (
          ...args: Parameters<typeof base.runEvents.listForRun>
        ) => {
          const result = await base.runEvents.listForRun(...args);
          if (!raced) {
            raced = true;
            notify(stage(s, "REVIEWING_COMPANY"));
          }
          return result;
        },
      },
    } as unknown as QRuntimeRepositories;
    const service = createQRunStreamService({
      sql: {} as never,
      transactions: {} as never,
      subjects: {} as never,
      repositories: racing,
      notifier,
      options: { safetyPollMs: 60_000 },
    });
    const controller = new AbortController();
    const seen: number[] = [];
    const items: QRunStreamItem[] = [];
    for await (const item of service.open({
      run: s.current,
      afterSequence: 0,
      signal: controller.signal,
    })) {
      items.push(item);
      if (item.kind === "durable") {
        seen.push(item.event.sequence);
        if (item.event.sequence === 3) {
          // And now a genuinely live event, announced after commit.
          notify(completed(s));
        }
      }
      if (item.kind === "end") {
        break;
      }
    }
    expect(seen).toEqual([1, 2, 3, 4]);
    expect(items.at(-1)).toEqual({ kind: "end", reason: "TERMINAL" });
  });

  it("emits deltas between durable boundaries, bounded per frame, and never as durable", async () => {
    const { s, service, deltas, notify } = world();
    started(s);
    const controller = new AbortController();
    const iterator = service.open({
      run: s.current,
      afterSequence: 0,
      signal: controller.signal,
    });
    const items: QRunStreamItem[] = [];
    const messageId = randomUUID();
    let published = false;
    for await (const item of iterator) {
      items.push(item);
      if (item.kind === "durable" && item.event.sequence === 1 && !published) {
        published = true;
        deltas.publish({
          runId: RUN_ID as never,
          tenantId: TENANT as never,
          messageId: messageId as never,
          text: "x".repeat(4000 + 10),
        });
        // A delta for another tenant's run of the same id is ignored.
        deltas.publish({
          runId: RUN_ID as never,
          tenantId: "c0000000-0000-4000-8000-000000000009" as never,
          messageId: messageId as never,
          text: "leak",
        });
      }
      if (items.filter((i) => i.kind === "delta").length === 2) {
        notify(completed(s));
      }
      if (item.kind === "end") {
        break;
      }
    }
    const deltaItems = items.filter((i) => i.kind === "delta");
    expect(deltaItems).toHaveLength(2);
    expect(
      deltaItems.map((i) => (i.kind === "delta" ? i.event.data : null)),
    ).toEqual([
      expect.objectContaining({ text: "x".repeat(4000) }),
      expect.objectContaining({ text: "x".repeat(10) }),
    ]);
    expect(
      deltaItems.every((i) => i.kind === "delta" && i.event.sequence === 1),
    ).toBe(true);
    expect(JSON.stringify(items)).not.toContain("leak");
    expect(sequences(items)).toEqual([1, 2]);
  });

  it("stops at the replay cap instead of loading a run's history without bound", async () => {
    const { s, service } = world(run(), {
      replayMaxEvents: 5,
      replayPageSize: 2,
    });
    started(s);
    for (let i = 0; i < 9; i += 1) {
      stage(s, i % 2 === 0 ? "REVIEWING_COMPANY" : "CHECKING_EVIDENCE");
    }
    const items = await collect(
      service.open({
        run: s.current,
        afterSequence: 0,
        signal: new AbortController().signal,
      }),
      () => false,
    );
    expect(sequences(items).length).toBeLessThanOrEqual(6);
    expect(items.at(-1)).toEqual({ kind: "end", reason: "REPLAY_LIMIT" });
  });

  it("skips a stored record the public contract refuses, and never emits it", async () => {
    const { s, service } = world();
    started(s);
    s.append("q.reasoning", { thought: REASONING_MARKER });
    s.append("q.stage.changed", {
      stage: "REVIEWING_COMPANY",
      internalNote: REASONING_MARKER,
    });
    completed(s);
    const items = await collect(
      service.open({
        run: s.current,
        afterSequence: 0,
        signal: new AbortController().signal,
      }),
      () => false,
    );
    expect(sequences(items)).toEqual([1, 4]);
    expect(JSON.stringify(items)).not.toContain(REASONING_MARKER);
    expect(projectPublicStreamEvent(s.events[1] as QRunEventRecord)).toBeNull();
    expect(projectPublicStreamEvent(s.events[2] as QRunEventRecord)).toBeNull();
  });

  it("ends a run that became terminal without a visible terminal event on the safety poll", async () => {
    const { s, service } = world(run(), { safetyPollMs: 20 });
    started(s);
    const items: QRunStreamItem[] = [];
    for await (const item of service.open({
      run: s.current,
      afterSequence: 0,
      signal: new AbortController().signal,
    })) {
      items.push(item);
      if (item.kind === "durable") {
        s.current = { ...s.current, status: "EXPIRED" };
      }
      if (item.kind === "end") {
        break;
      }
    }
    expect(items.at(-1)).toEqual({ kind: "end", reason: "RUN_ENDED" });
  });

  it("removes its subscriptions when the consumer aborts, and reads only on wake-ups", async () => {
    const { s, service, notifier, deltas } = world(run(), {
      safetyPollMs: 60_000,
    });
    started(s);
    const controller = new AbortController();
    const iterator = service.open({
      run: s.current,
      afterSequence: 0,
      signal: controller.signal,
    });
    const first = await iterator.next();
    expect(first.value).toMatchObject({ kind: "durable" });
    expect(notifier.subscriberCount()).toBe(1);
    expect(deltas.subscriberCount()).toBe(1);
    const readsBefore = s.reads;
    const pending = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(s.reads).toBe(readsBefore); // parked, not polling
    controller.abort();
    const last = await pending;
    expect(last.done).toBe(true);
    expect(notifier.subscriberCount()).toBe(0);
    expect(deltas.subscriberCount()).toBe(0);
    expect(service.stats()).toEqual({
      noticeSubscribers: 0,
      deltaSubscribers: 0,
      deltasDropped: 0,
    });
  });
});
