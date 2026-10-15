import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import { MemoryItemSchema, type MemoryItem } from "../src/memory/contracts.js";
import type { MemoryRepository } from "../src/memory/postgres-memory-repository.js";
import { createMemoryService } from "../src/memory/service.js";

/**
 * Lane S 2026-10-15 (memory audit): a correction of which thing a turn
 * meant settles its own conversation and is not recalled into others; a
 * correction of a name keeps applying everywhere. Fakes only.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const person = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  actorType: "HUMAN",
});
const HERE = randomUUID();
const BEFORE = randomUUID();

function item(
  memoryType: MemoryItem["memoryType"],
  memoryKey: string,
  content: string,
  sourceConversationId: string | null,
): MemoryItem {
  const now = new Date().toISOString();
  return MemoryItemSchema.parse({
    id: randomUUID(),
    tenantId: TENANT,
    ownerContextType: "user",
    ownerContextId: person.userId,
    subject: null,
    memoryType,
    memoryKey,
    content,
    structuredValue: {},
    quote: null,
    contentSha256: createHash("sha256").update(memoryKey).digest("hex"),
    sourceConversationId,
    sourceRunId: null,
    writeMode: "Q_PROPOSED",
    status: "active",
    supersededBy: null,
    validFrom: now,
    validTo: null,
    lastUsedAt: null,
    useCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}

const rows: MemoryItem[] = [
  item(
    "correction",
    "correction.chat_target",
    "The intended chat was Tensorgate, not Halyard Security.",
    BEFORE,
  ),
  item(
    "correction",
    "correction.open_item",
    "The intended item to open was the Tensorgate rehearsal.",
    HERE,
  ),
  item(
    "correction",
    "correction.company_name",
    "The intended company is Meditril, not Metru.",
    BEFORE,
  ),
  item(
    "preference",
    "preference.sector_interest.security",
    "Interested in security companies.",
    BEFORE,
  ),
];

const repository = {
  listLive: () => Promise.resolve(rows),
  markUsed: () => Promise.resolve(),
} as unknown as MemoryRepository;

const memory = createMemoryService({
  sql: Object.assign(() => Promise.resolve([]), {}) as never,
  transactions: { run: (work) => work({} as never) },
  repository,
});

describe("a correction of what a turn meant stays in its conversation", () => {
  it("is recalled in its own conversation and nowhere else; name corrections everywhere", async () => {
    const here = await memory.recall({ actor: person, conversationId: HERE });
    expect(here.person.map((m) => m.memoryKey).sort()).toEqual([
      "correction.company_name",
      "correction.open_item",
      "preference.sector_interest.security",
    ]);
    const elsewhere = await memory.recall({
      actor: person,
      conversationId: randomUUID(),
    });
    expect(elsewhere.person.map((m) => m.memoryKey).sort()).toEqual([
      "correction.company_name",
      "preference.sector_interest.security",
    ]);
    const unknown = await memory.recall({ actor: person });
    expect(unknown.person.map((m) => m.memoryKey)).not.toContain(
      "correction.chat_target",
    );
  });
});
