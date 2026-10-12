import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import type { ModelGateway } from "@capital-q/model-gateway";
import {
  createMemoryService,
  createPostgresMemoryRepository,
  MemoryItemSchema,
  type MemoryItem,
  type MemoryOwner,
  type MemoryRepository,
  type MemoryBundle,
  type MemoryService,
  type RememberCommand,
} from "@capital-q/q-knowledge";
import type {
  QConversation,
  QConversationMessage,
  QOrchestrator,
  QRunRecord,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createMemoryLearner,
  withLearning,
} from "../src/composition/memory-learner.js";

/**
 * Q learning after a run (ADR 0012): the extractor's proposals go through
 * the memory service with the person's own turns for quote verification,
 * the conversation's title and summary are written back, and all of it
 * hangs off the orchestrator without delaying the handle a caller gets.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const RUN = "f0000000-0000-4000-8000-000000000001";
const CONVERSATION = "f0000000-0000-4000-8000-000000000002";
const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  actorType: "HUMAN",
});

describe("voice pronunciation context", () => {
  const now = "2026-10-12T00:00:00.000Z";
  function item(key: string, overrides: Partial<MemoryItem> = {}): MemoryItem {
    return MemoryItemSchema.parse({
      id: randomUUID(),
      tenantId: TENANT,
      ownerContextType: "user",
      ownerContextId: USER,
      subject: null,
      memoryType: "pronunciation",
      memoryKey: key,
      content: "A name the person taught Q to hear",
      structuredValue: {},
      quote: "Say the name this way",
      contentSha256: "a".repeat(64),
      sourceConversationId: null,
      sourceRunId: null,
      writeMode: "USER_CONFIRMED",
      status: "active",
      supersededBy: null,
      validFrom: now,
      validTo: null,
      lastUsedAt: null,
      useCount: 0,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  }
  function pronunciationWorld(rows: readonly MemoryItem[]) {
    const listLive = vi.fn<MemoryRepository["listLive"]>(
      (_sql, tenantId, owner: MemoryOwner, limit) =>
        Promise.resolve(
          rows
            .filter(
              (row) =>
                row.tenantId === tenantId &&
                row.ownerContextType === owner.ownerContextType &&
                row.ownerContextId === owner.ownerContextId &&
                (row.status === "active" || row.status === "confirmed") &&
                (row.validTo === null ||
                  Date.parse(row.validTo) > Date.parse(now)),
            )
            .slice(0, limit),
        ),
    );
    const markUsed = vi.fn<MemoryRepository["markUsed"]>(() =>
      Promise.resolve(),
    );
    const sql = vi.fn(() => Promise.resolve([])) as unknown as DatabaseExecutor;
    const conversations = {
      digestOf: vi.fn(() => Promise.resolve(null)),
      recentDigests: vi.fn(() => Promise.resolve([])),
      relevantDigests: vi.fn(() => Promise.resolve([])),
    };
    const memory = createMemoryService({
      sql,
      transactions: { run: (work) => work({ sql }) },
      repository: { ...createPostgresMemoryRepository(), listLive, markUsed },
      conversations,
      now: () => Date.parse(now),
    });
    return {
      ...world(null, memory),
      memory,
      sql,
      listLive,
      markUsed,
      conversations,
    };
  }

  it("returns the same names without reading conversations or marking unrelated memory used", async () => {
    const rows = [
      item("pronunciation.nem_salvage"),
      item("pronunciation.nem-salvage"),
      item("pronunciation.kora", {
        subject: { subjectType: "PERSON", subjectId: USER },
      }),
      item("pronunciation.company_secret", {
        subject: { subjectType: "COMPANY", subjectId: RUN },
      }),
      item("preference.concise", { memoryType: "preference" }),
      item("pronunciation.forgotten", { status: "forgotten" }),
      item("pronunciation.expired", { validTo: "2026-10-11T00:00:00.000Z" }),
    ];
    const expected = ["nem salvage", "kora"];
    const baseline = pronunciationWorld(rows);
    const recalled = await baseline.memory.recall({ actor, limit: 60 });
    expect(
      recalled.person
        .filter((row) => row.memoryType === "pronunciation")
        .map((row) => row.memoryKey),
    ).toEqual([
      "pronunciation.nem_salvage",
      "pronunciation.nem-salvage",
      "pronunciation.kora",
    ]);
    const test = pronunciationWorld(rows);
    expect(await test.learner.termsFor(actor)).toEqual(expected);
    expect(test.markUsed).not.toHaveBeenCalled();
    expect(test.conversations.recentDigests).not.toHaveBeenCalled();
    expect(test.listLive).toHaveBeenCalledTimes(1);
    expect(test.listLive).toHaveBeenCalledWith(
      test.sql,
      actor.tenantId,
      { ownerContextType: "user", ownerContextId: actor.userId },
      200,
    );
    expect(test.conversations.digestOf).not.toHaveBeenCalled();
    expect(test.conversations.relevantDigests).not.toHaveBeenCalled();
  });

  it.each([
    { userId: "b0000000-0000-4000-8000-000000000002", tenantId: TENANT },
    { userId: USER, tenantId: "c0000000-0000-4000-8000-000000000002" },
  ])(
    "uses only the requesting owner and tenant ($userId / $tenantId)",
    async (identity) => {
      const test = pronunciationWorld([item("pronunciation.private_name")]);
      const other = ActorContextSchema.parse({
        ...identity,
        actorType: "HUMAN",
      });
      expect(await test.learner.termsFor(other)).toEqual([]);
      expect(test.listLive).toHaveBeenCalledWith(
        test.sql,
        other.tenantId,
        { ownerContextType: "user", ownerContextId: other.userId },
        200,
      );
    },
  );

  it("keeps the first 60 live items and the 20 deduplicated name cap", async () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      item(`preference.item${String(i)}`, { memoryType: "preference" }),
    );
    rows.push(item("pronunciation.outside_window"));
    expect(await pronunciationWorld(rows).learner.termsFor(actor)).toEqual([]);
    const names = Array.from({ length: 25 }, (_, i) =>
      item(`pronunciation.name${String(i)}`),
    );
    expect(await pronunciationWorld(names).learner.termsFor(actor)).toEqual(
      names.slice(0, 20).map((row) => row.memoryKey.split(".").at(-1)),
    );
  });
});
const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => logger,
} as never;

function world(extractorOutput: unknown, memoryOverride?: MemoryService) {
  const remembered: RememberCommand[] = [];
  const digests: unknown[] = [];
  const conversation = {
    id: CONVERSATION,
    tenantId: TENANT,
    userId: USER,
    organisationId: null,
    contextType: "PERSONAL",
    subjects: [],
    title: null,
    summary: "Earlier they asked about runway.",
    summaryThrough: "2026-09-17T09:00:00.000Z",
    lastMessageAt: "2026-09-17T10:00:00.000Z",
    createdAt: "2026-09-17T08:00:00.000Z",
    archivedAt: null,
  } as unknown as QConversation;
  const run = {
    id: RUN,
    tenantId: TENANT,
    actorUserId: USER,
    conversationId: CONVERSATION,
    subjects: [],
    status: "COMPLETED",
  } as unknown as QRunRecord;
  const messages = [
    {
      id: "m1",
      runId: RUN,
      conversationId: CONVERSATION,
      role: "USER",
      content: "Actually, call me Dan.",
      createdAt: "2026-09-17T10:00:00.000Z",
    },
    {
      id: "m2",
      runId: RUN,
      conversationId: CONVERSATION,
      role: "Q",
      content: "Dan it is.",
      createdAt: "2026-09-17T10:00:01.000Z",
    },
  ] as unknown as QConversationMessage[];
  const empty: MemoryBundle = {
    person: [],
    company: [],
    thisConversation: null,
    relevant: [],
    otherConversations: [],
  };
  const memory: MemoryService = {
    recall: () => Promise.resolve(empty),
    list: () => Promise.resolve([]),
    remember: (command) => {
      remembered.push(command);
      return Promise.resolve({
        outcome: "REMEMBERED",
        reason: "RECORDED",
        item: {} as never,
      });
    },
    forget: () => Promise.resolve(null),
  };
  const gateway = {
    execute: () =>
      Promise.resolve({
        output: { kind: "STRUCTURED", value: extractorOutput },
      }),
  } as unknown as ModelGateway;
  const learner = createMemoryLearner({
    gateway,
    memory: memoryOverride ?? memory,
    repositories: {
      runs: { findForActor: () => Promise.resolve(run) },
      conversations: {
        findForOwner: () => Promise.resolve(conversation),
        setDigest: (
          _tx: unknown,
          _t: unknown,
          _id: unknown,
          digest: unknown,
        ) => {
          digests.push(digest);
          return Promise.resolve();
        },
        listForOwner: () => Promise.resolve([]),
      },
      messages: {
        listRecentForConversation: () => Promise.resolve(messages),
      },
    } as never,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    people: { displayNameFor: () => Promise.resolve("Daniel") },
    logger,
  });
  return { learner, remembered, digests };
}

describe("the memory learner", () => {
  it("hands each proposal to the gate with the person's turns, and writes the digest back", async () => {
    const { learner, remembered, digests } = world({
      title: "Name change",
      summary: "They asked to be called Dan.",
      items: [
        {
          type: "PREFERENCE",
          key: "preference.address_as",
          content: "Address them as Dan.",
          quote: "call me Dan",
        },
      ],
    });
    await learner.learn({ actor, runId: RUN });
    expect(remembered).toHaveLength(1);
    expect(remembered[0]).toMatchObject({
      actor,
      writeMode: "Q_PROPOSED",
      userTurns: ["Actually, call me Dan."],
      candidate: {
        memoryType: "preference",
        memoryKey: "preference.address_as",
      },
      source: { conversationId: CONVERSATION, runId: RUN },
    });
    expect(digests).toEqual([
      {
        title: "Name change",
        summary: "They asked to be called Dan.",
        summaryThrough: "2026-09-17T10:00:01.000Z",
      },
    ]);
  });

  it("writes nothing when the extractor's shape is refused, and never throws", async () => {
    const { learner, remembered, digests } = world({ nonsense: true });
    await expect(learner.learn({ actor, runId: RUN })).resolves.toBeUndefined();
    expect(remembered).toHaveLength(0);
    expect(digests).toHaveLength(0);
  });

  it("hangs off the orchestrator after start and resume, without delaying the handle", async () => {
    const learned: string[] = [];
    const handle = { runId: RUN, status: "COMPLETED", createdAt: "x" };
    const inner = {
      start: () => Promise.resolve(handle),
      resume: () => Promise.resolve(handle),
      cancel: () => Promise.resolve(handle),
    } as unknown as QOrchestrator;
    const wrapped = withLearning(inner, {
      learn: ({ runId }) => {
        learned.push(runId);
        return Promise.resolve();
      },
    });
    const input = { actor, runId: RUN, correlationId: "cor_x" } as never;
    expect(await wrapped.start(input)).toBe(handle);
    expect(await wrapped.resume(input)).toBe(handle);
    await wrapped.cancel(input);
    expect(learned).toEqual([RUN, RUN]);
  });
});
