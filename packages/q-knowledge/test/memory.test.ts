import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import { ActorContextSchema } from "@capital-q/security";

import type { MemoryItem } from "../src/memory/contracts.js";
import type {
  MemoryRepository,
  NewMemoryItem,
} from "../src/memory/postgres-memory-repository.js";
import { renderMemoryBundle } from "../src/memory/render.js";
import {
  createMemoryService,
  looksLikeSecret,
  memoryContentHash,
} from "../src/memory/service.js";

/**
 * The memory write gate (doc 14 §57-§59; ADR 0012). What is proven here:
 * a model's proposal becomes a memory only when the quote is in the
 * person's own recorded turns; the same thing is never remembered twice;
 * a new value for a key retires the old one; a secret is refused even
 * when the person said it; and the owner is always the actor.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  actorType: "HUMAN",
});

function inMemoryRepository(): MemoryRepository & {
  readonly rows: MemoryItem[];
} {
  const rows: MemoryItem[] = [];
  const live = (item: MemoryItem) =>
    item.status === "active" ||
    item.status === "confirmed" ||
    item.status === "candidate";
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
          .filter((r) => owned(r, tenantId, owner) && live(r))
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
      const now = new Date().toISOString();
      const item: MemoryItem = {
        id: randomUUID(),
        tenantId: input.tenantId,
        ownerContextType: input.owner.ownerContextType,
        ownerContextId: input.owner.ownerContextId,
        subject:
          input.subject === null
            ? null
            : {
                subjectType: input.subject.subjectType as "COMPANY",
                subjectId: input.subject.subjectId,
              },
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
        validTo: null,
        lastUsedAt: null,
        useCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(item);
      return Promise.resolve(item);
    },
    supersede: (_tx, _tenant, _owner, id, by) => {
      const index = rows.findIndex((r) => r.id === id);
      const row = rows[index];
      if (row !== undefined) {
        rows[index] = { ...row, status: "superseded", supersededBy: by };
      }
      return Promise.resolve();
    },
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
  // The service retires the earlier row itself before inserting; the
  // in-memory repository above records the supersession that follows.
  sql: Object.assign(() => Promise.resolve([]), {}),
} as unknown as TransactionContext;
const transactions: TransactionManager = {
  run: (work) => work(tx),
};

function service(repository = inMemoryRepository()) {
  return {
    repository,
    memory: createMemoryService({
      sql: tx.sql,
      transactions,
      repository,
    }),
  };
}

const TURNS = [
  "Actually, call me Dan, not Daniel.",
  "It's NEM Salvage, N-E-M, not name salvage.",
];

describe("the memory write gate", () => {
  it("remembers a quote-verified reading of the person's own words, once", async () => {
    const { memory, repository } = service();
    const first = await memory.remember({
      actor,
      candidate: {
        memoryType: "preference",
        memoryKey: "preference.address_as",
        content: "Address them as Dan.",
        quote: "call me Dan",
        subject: null,
        structuredValue: {},
      },
      writeMode: "Q_PROPOSED",
      userTurns: TURNS,
      source: { conversationId: null, runId: null },
    });
    expect(first.outcome).toBe("REMEMBERED");
    if (first.outcome !== "REMEMBERED") return;
    expect(first.item.ownerContextType).toBe("user");
    expect(first.item.ownerContextId).toBe(actor.userId);
    expect(first.item.tenantId).toBe(TENANT);
    expect(first.item.writeMode).toBe("Q_PROPOSED");
    expect(first.item.status).toBe("active");

    const again = await memory.remember({
      actor,
      candidate: {
        memoryType: "preference",
        memoryKey: "preference.address_as",
        content: "address them as dan.",
        quote: "call me Dan",
        subject: null,
        structuredValue: {},
      },
      writeMode: "Q_PROPOSED",
      userTurns: TURNS,
      source: { conversationId: null, runId: null },
    });
    expect(again.outcome).toBe("UNCHANGED");
    expect(repository.rows).toHaveLength(1);
  });

  it("refuses a reading whose quote is not in the person's turns, and one with no quote", async () => {
    const { memory, repository } = service();
    const invented = await memory.remember({
      actor,
      candidate: {
        memoryType: "fact",
        memoryKey: "person.role",
        content: "They are the CFO.",
        quote: "I am the CFO",
        subject: null,
        structuredValue: {},
      },
      writeMode: "Q_PROPOSED",
      userTurns: TURNS,
      source: { conversationId: null, runId: null },
    });
    expect(invented).toEqual({
      outcome: "REFUSED",
      reason: "QUOTE_NOT_IN_TURNS",
    });
    const unquoted = await memory.remember({
      actor,
      candidate: {
        memoryType: "fact",
        memoryKey: "person.role",
        content: "They are the CFO.",
        quote: null,
        subject: null,
        structuredValue: {},
      },
      writeMode: "Q_PROPOSED",
      userTurns: TURNS,
      source: { conversationId: null, runId: null },
    });
    expect(unquoted).toEqual({ outcome: "REFUSED", reason: "QUOTE_REQUIRED" });
    expect(repository.rows).toHaveLength(0);
  });

  it("supersedes an earlier value for the same key, keeping one live row", async () => {
    const { memory, repository } = service();
    const remember = (content: string, quote: string) =>
      memory.remember({
        actor,
        candidate: {
          memoryType: "preference",
          memoryKey: "preference.address_as",
          content,
          quote,
          subject: null,
          structuredValue: {},
        },
        writeMode: "Q_PROPOSED",
        userTurns: [...TURNS, "On second thought, call me Daniel."],
        source: { conversationId: null, runId: null },
      });
    const first = await remember("Address them as Dan.", "call me Dan");
    const second = await remember("Address them as Daniel.", "call me Daniel");
    expect(first.outcome).toBe("REMEMBERED");
    expect(second).toMatchObject({
      outcome: "REMEMBERED",
      reason: "SUPERSEDED_EARLIER",
    });
    const live = repository.rows.filter((r) => r.status === "active");
    expect(live).toHaveLength(1);
    expect(live[0]?.content).toBe("Address them as Daniel.");
    const retired = repository.rows.find(
      (r) => r.content === "Address them as Dan.",
    );
    expect(retired?.status).toBe("superseded");
    expect(retired?.supersededBy).toBe(live[0]?.id);
  });

  it("refuses a secret even when the person said it, and refuses a non-person actor", async () => {
    const { memory, repository } = service();
    const secret = await memory.remember({
      actor,
      candidate: {
        memoryType: "fact",
        memoryKey: "person.bank",
        content: "Their account number is 0123456789012.",
        quote: "my account number is 0123456789012",
        subject: null,
        structuredValue: {},
      },
      writeMode: "Q_PROPOSED",
      userTurns: ["my account number is 0123456789012"],
      source: { conversationId: null, runId: null },
    });
    expect(secret).toEqual({ outcome: "REFUSED", reason: "SENSITIVE_CONTENT" });
    const system = await memory.remember({
      actor: { ...actor, actorType: "SYSTEM" },
      candidate: {
        memoryType: "preference",
        memoryKey: "preference.address_as",
        content: "Address them as Dan.",
        quote: "call me Dan",
        subject: null,
        structuredValue: {},
      },
      writeMode: "Q_PROPOSED",
      userTurns: TURNS,
      source: { conversationId: null, runId: null },
    });
    expect(system).toEqual({ outcome: "REFUSED", reason: "NOT_ALLOWED" });
    expect(repository.rows).toHaveLength(0);
    expect(looksLikeSecret("the password is hunter2")).toBe(true);
    expect(looksLikeSecret("we sell to insurers")).toBe(false);
  });

  it("recalls only the actor's own memory and renders it bounded, preferences first", async () => {
    const { memory } = service();
    const other = ActorContextSchema.parse({
      userId: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
      tenantId: TENANT,
      actorType: "HUMAN",
    });
    await memory.remember({
      actor: other,
      candidate: {
        memoryType: "fact",
        memoryKey: "person.role",
        content: "They are the CTO.",
        quote: "I'm the CTO",
        subject: null,
        structuredValue: {},
      },
      writeMode: "Q_PROPOSED",
      userTurns: ["I'm the CTO"],
      source: { conversationId: null, runId: null },
    });
    await memory.remember({
      actor,
      candidate: {
        memoryType: "pronunciation",
        memoryKey: "pronunciation.nem_salvage",
        content: "NEM Salvage is said as the letters N-E-M, then salvage.",
        quote: "It's NEM Salvage, N-E-M",
        subject: null,
        structuredValue: {},
      },
      writeMode: "Q_PROPOSED",
      userTurns: TURNS,
      source: { conversationId: null, runId: null },
    });
    await memory.remember({
      actor,
      candidate: {
        memoryType: "preference",
        memoryKey: "preference.address_as",
        content: "Address them as Dan.",
        quote: "call me Dan",
        subject: null,
        structuredValue: {},
      },
      writeMode: "Q_PROPOSED",
      userTurns: TURNS,
      source: { conversationId: null, runId: null },
    });
    const bundle = await memory.recall({ actor });
    expect(bundle.person.map((i) => i.memoryKey).sort()).toEqual([
      "preference.address_as",
      "pronunciation.nem_salvage",
    ]);
    expect(bundle.person.some((i) => i.content.includes("CTO"))).toBe(false);
    const text = renderMemoryBundle(bundle);
    expect(text.indexOf("Preference")).toBeLessThan(
      text.indexOf("Pronunciation"),
    );
    expect(text).toContain("Address them as Dan.");
    expect(renderMemoryBundle(bundle, 60).length).toBeLessThanOrEqual(60);
  });

  it("hashes content case- and space-insensitively so a restatement is the same memory", () => {
    const a = memoryContentHash({
      memoryType: "fact",
      memoryKey: "person.role",
      content: "They are the CTO.",
      quote: "x",
      subject: null,
      structuredValue: {},
    });
    const b = memoryContentHash({
      memoryType: "fact",
      memoryKey: "person.role",
      content: "  they are the cto. ",
      quote: "y",
      subject: null,
      structuredValue: {},
    });
    expect(a).toBe(b);
  });
});
