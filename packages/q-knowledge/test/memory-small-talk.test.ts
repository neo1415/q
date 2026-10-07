import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import { ActorContextSchema } from "@capital-q/security";

import type { MemoryCandidate, MemoryItem } from "../src/memory/contracts.js";
import type {
  MemoryRepository,
  NewMemoryItem,
} from "../src/memory/postgres-memory-repository.js";
import { renderMemoryBundle } from "../src/memory/render.js";
import { createMemoryService } from "../src/memory/service.js";

/**
 * ADR 0062: small talk through the memory Write Gate. Proven here: it is
 * written only from the person's own quoted words, lapses after 90 days,
 * never enters `recall` (so no prompt or other purpose reads it), comes
 * back as one thread at a time for its owner only, and can be forgotten.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const person = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  actorType: "HUMAN",
});
const someoneElse = ActorContextSchema.parse({
  userId: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
  tenantId: TENANT,
  actorType: "HUMAN",
});

const DAY = 86_400_000;
const START = Date.parse("2026-10-06T12:00:00.000Z");

function repositoryFor(clock: { at: number }): MemoryRepository & {
  readonly rows: MemoryItem[];
} {
  const rows: MemoryItem[] = [];
  const live = (item: MemoryItem) =>
    ["active", "confirmed", "candidate"].includes(item.status);
  const owned = (
    item: MemoryItem,
    tenantId: string,
    owner: { ownerContextType: string; ownerContextId: string },
  ) =>
    item.tenantId === tenantId &&
    item.ownerContextType === owner.ownerContextType &&
    item.ownerContextId === owner.ownerContextId;
  return {
    rows,
    listLive: (_e, tenantId, owner, limit) =>
      Promise.resolve(
        rows
          .filter(
            (r) =>
              owned(r, tenantId, owner) &&
              (r.status === "active" || r.status === "confirmed") &&
              // As the SQL does: a lapsed row is not live.
              (r.validTo === null || Date.parse(r.validTo) > clock.at),
          )
          .slice(0, limit),
      ),
    findLiveByKey: (_e, tenantId, owner, type, key) =>
      Promise.resolve(
        rows.find(
          (r) =>
            owned(r, tenantId, owner) &&
            live(r) &&
            r.memoryType === type &&
            r.memoryKey === key,
        ) ?? null,
      ),
    findLiveByHash: (_e, tenantId, owner, hash) =>
      Promise.resolve(
        rows.find(
          (r) =>
            owned(r, tenantId, owner) && live(r) && r.contentSha256 === hash,
        ) ?? null,
      ),
    insert: (_tx, input: NewMemoryItem) => {
      const now = new Date(clock.at).toISOString();
      const item: MemoryItem = {
        id: randomUUID(),
        tenantId: input.tenantId,
        ownerContextType: input.owner.ownerContextType,
        ownerContextId: input.owner.ownerContextId,
        subject: null,
        memoryType: input.memoryType,
        memoryKey: input.memoryKey,
        content: input.content,
        structuredValue: input.structuredValue,
        quote: input.quote,
        contentSha256: input.contentSha256,
        sourceConversationId: input.sourceConversationId,
        sourceRunId: input.sourceRunId,
        writeMode: input.writeMode,
        status: input.status,
        supersededBy: null,
        validFrom: now,
        validTo: input.validTo ?? null,
        lastUsedAt: null,
        useCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.unshift(item);
      return Promise.resolve(item);
    },
    supersede: () => Promise.resolve(),
    forget: (_tx, tenantId, owner, id) => {
      const index = rows.findIndex(
        (r) => r.id === id && owned(r, tenantId, owner) && live(r),
      );
      const row = rows[index];
      if (row === undefined) return Promise.resolve(null);
      rows[index] = { ...row, status: "forgotten" };
      return Promise.resolve(rows[index] ?? null);
    },
    markUsed: () => Promise.resolve(),
  };
}

const tx = {
  sql: Object.assign(() => Promise.resolve([]), {}),
} as unknown as TransactionContext;
const transactions: TransactionManager = { run: (work) => work(tx) };

function setup() {
  const clock = { at: START };
  const repository = repositoryFor(clock);
  const memory = createMemoryService({
    sql: tx.sql,
    transactions,
    repository,
    now: () => clock.at,
  });
  return { clock, repository, memory };
}

const TURNS = ["I'm off to Lagos on Friday for my sister's wedding."];

const lagos: MemoryCandidate = {
  memoryType: "small_talk",
  memoryKey: "small_talk.lagos_trip",
  content: "They were going to Lagos on Friday for their sister's wedding.",
  quote: "I'm off to Lagos on Friday",
  subject: null,
  structuredValue: { followUp: "how was Lagos?" },
};

const remember = (
  memory: ReturnType<typeof setup>["memory"],
  candidate: MemoryCandidate = lagos,
  overrides: { writeMode?: "Q_PROPOSED" | "AUTOMATIC_SYSTEM" } = {},
) =>
  memory.remember({
    actor: person,
    candidate,
    writeMode: overrides.writeMode ?? "Q_PROPOSED",
    userTurns: TURNS,
    source: { conversationId: null, runId: null },
  });

describe("small-talk memory through the Write Gate", () => {
  it("is remembered from the person's own words and lapses after 90 days", async () => {
    const { memory } = setup();
    const result = await remember(memory);
    expect(result.outcome).toBe("REMEMBERED");
    if (result.outcome !== "REMEMBERED") return;
    expect(result.item.memoryType).toBe("small_talk");
    expect(result.item.validTo).toBe(new Date(START + 90 * DAY).toISOString());
  });

  it("refuses a quote the person never said", async () => {
    const { memory } = setup();
    const result = await remember(memory, {
      ...lagos,
      quote: "I'm going to Abuja",
    });
    expect(result).toEqual({
      outcome: "REFUSED",
      reason: "QUOTE_NOT_IN_TURNS",
    });
  });

  it("refuses a platform write, a company subject or a missing question", async () => {
    const { memory } = setup();
    expect(
      (await remember(memory, lagos, { writeMode: "AUTOMATIC_SYSTEM" }))
        .outcome,
    ).toBe("REFUSED");
    expect(
      (
        await remember(memory, {
          ...lagos,
          subject: {
            subjectType: "COMPANY",
            subjectId: "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
          },
        })
      ).outcome,
    ).toBe("REFUSED");
    expect(
      (await remember(memory, { ...lagos, structuredValue: {} })).outcome,
    ).toBe("REFUSED");
  });

  it("never enters recall, so no prompt or other purpose reads it", async () => {
    const { memory } = setup();
    await remember(memory);
    const bundle = await memory.recall({ actor: person });
    expect(bundle.person).toEqual([]);
    expect(renderMemoryBundle(bundle)).not.toContain("Lagos");
  });

  it("comes back as one thread, for its owner only, and not twice", async () => {
    const { memory } = setup();
    const result = await remember(memory);
    if (result.outcome !== "REMEMBERED") throw new Error("not remembered");
    const thread = await memory.smallTalkThread?.(person, new Set());
    expect(thread).toEqual({
      memoryItemId: result.item.id,
      followUp: "how was Lagos?",
    });
    expect(await memory.smallTalkThread?.(someoneElse, new Set())).toBeNull();
    expect(
      await memory.smallTalkThread?.(person, new Set([result.item.id])),
    ).toBeNull();
  });

  it("is gone after 90 days, and gone at once when forgotten", async () => {
    const { clock, memory } = setup();
    const result = await remember(memory);
    if (result.outcome !== "REMEMBERED") throw new Error("not remembered");
    clock.at = START + 91 * DAY;
    expect(await memory.smallTalkThread?.(person, new Set())).toBeNull();
    expect(await memory.list(person)).toEqual([]);

    clock.at = START;
    expect((await memory.list(person)).map((item) => item.id)).toEqual([
      result.item.id,
    ]);
    await memory.forget({ actor: person, memoryItemId: result.item.id });
    expect(await memory.smallTalkThread?.(person, new Set())).toBeNull();
  });
});
