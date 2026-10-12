import { describe, expect, it } from "vitest";

import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import { ActorContextSchema } from "@capital-q/security";

import type {
  MemoryBundle,
  MemoryItem,
  MemoryRehearsalDigest,
} from "../src/memory/contracts.js";
import type { MemoryRepository } from "../src/memory/postgres-memory-repository.js";
import { asksAboutRehearsal } from "../src/memory/recall-terms.js";
import {
  MEMORY_TEXT_MAX,
  NO_REHEARSALS_LINE,
  REHEARSALS_LABEL,
  RELEVANT_LABEL,
  renderMemoryBundle,
} from "../src/memory/render.js";
import {
  createMemoryService,
  RECALLED_REHEARSALS,
  type MemoryRehearsalPort,
} from "../src/memory/service.js";

/**
 * Rehearsal recall: "You helped me prepare my pitch last week. What did I
 * struggle with?" reaches the person's own rehearsal reviews, dated and
 * labelled as Q's coaching on practice; a turn about anything else reads
 * none of it; none on record is said as such, and a failed read is silence.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  actorType: "HUMAN",
});
const ASKED =
  "You helped me prepare my pitch last week. What did I struggle with, and what should I practise before tomorrow's investor meeting?";

const emptyRepository = {
  listLive: () => Promise.resolve([] as MemoryItem[]),
  markUsed: () => Promise.resolve(),
} as unknown as MemoryRepository;
const tx = {
  sql: Object.assign(() => Promise.resolve([]), {}),
} as unknown as TransactionContext;
const transactions: TransactionManager = { run: (work) => work(tx) };

function rehearsal(
  overrides: Partial<MemoryRehearsalDigest> = {},
): MemoryRehearsalDigest {
  return {
    rehearsalId: "r-1",
    at: "2026-10-05T14:00:00.000Z",
    counterpartName: "Amara Okafor",
    difficulty: "TOUGH",
    outcome: "STRONG_LATER",
    score: 58,
    overall: "Promising, but the numbers wobbled under pressure.",
    needsWork: ["EVIDENCE", "THE_ASK"],
    strong: ["CLARITY"],
    wentWrong: [
      {
        moment: "When asked for churn, you gave a range then changed it.",
        why: "A moving number reads as not knowing it.",
        better: "State the trailing-twelve-month figure and its source.",
      },
    ],
    wentRight: ["The opening problem story landed."],
    tips: ["Rehearse the ask in one sentence with the amount and use."],
    ...overrides,
  };
}

function serviceWith(port: MemoryRehearsalPort | undefined) {
  const warnings: string[] = [];
  const logger = {
    warn: (_o: unknown, message: string) => warnings.push(message),
    debug: () => undefined,
    info: () => undefined,
    error: () => undefined,
  } as never;
  return {
    warnings,
    memory: createMemoryService({
      sql: tx.sql,
      transactions,
      repository: emptyRepository,
      rehearsals: port,
      logger,
    }),
  };
}

describe("a turn about pitch practice is recognised by code", () => {
  it("matches pitching, rehearsal and practice words", () => {
    expect(asksAboutRehearsal(ASKED)).toBe(true);
    expect(asksAboutRehearsal("How did my rehearsal go?")).toBe(true);
    expect(asksAboutRehearsal("Can we do a mock meeting?")).toBe(true);
    expect(asksAboutRehearsal("I want to practice the ask")).toBe(true);
  });

  it("does not match unrelated turns or look-alike words", () => {
    expect(asksAboutRehearsal("What is Tensorgate's runway?")).toBe(false);
    expect(asksAboutRehearsal("Is that practical for a pitcher?")).toBe(false);
    expect(asksAboutRehearsal("")).toBe(false);
  });
});

describe("recall reads rehearsals only when asked about them", () => {
  it("reads the owner's own last rehearsals with the actor and the bound", async () => {
    const asked: { userId: string; tenantId: string; limit: number }[] = [];
    const { memory } = serviceWith({
      recentForOwner: (who, limit) => {
        asked.push({ userId: who.userId, tenantId: who.tenantId, limit });
        return Promise.resolve([rehearsal()]);
      },
    });
    const bundle = await memory.recall({ actor, utterance: ASKED });
    expect(asked).toEqual([
      { userId: actor.userId, tenantId: TENANT, limit: RECALLED_REHEARSALS },
    ]);
    expect(bundle.rehearsals).toHaveLength(1);
  });

  it("never reads them for a turn about something else, or without an utterance", async () => {
    let reads = 0;
    const { memory } = serviceWith({
      recentForOwner: () => {
        reads += 1;
        return Promise.resolve([rehearsal()]);
      },
    });
    const other = await memory.recall({
      actor,
      utterance: "What changed at Tensorgate?",
    });
    const none = await memory.recall({ actor });
    expect(reads).toBe(0);
    expect(other.rehearsals).toBeUndefined();
    expect(renderMemoryBundle(other)).toBe("");
    expect(none.rehearsals).toBeUndefined();
  });

  it("never reads them for a non-human actor", async () => {
    let reads = 0;
    const { memory } = serviceWith({
      recentForOwner: () => {
        reads += 1;
        return Promise.resolve([rehearsal()]);
      },
    });
    const service = ActorContextSchema.parse({
      userId: actor.userId,
      tenantId: TENANT,
      actorType: "SYSTEM",
    });
    const bundle = await memory.recall({ actor: service, utterance: ASKED });
    expect(reads).toBe(0);
    expect(bundle.rehearsals).toBeUndefined();
  });

  it("says none on record when there are none, and nothing when the read fails", async () => {
    const empty = serviceWith({ recentForOwner: () => Promise.resolve([]) });
    const bundle = await empty.memory.recall({ actor, utterance: ASKED });
    expect(bundle.rehearsals).toEqual([]);
    expect(renderMemoryBundle(bundle)).toBe(NO_REHEARSALS_LINE);

    const failing = serviceWith({
      recentForOwner: () => Promise.reject(new Error("db down")),
    });
    const failed = await failing.memory.recall({ actor, utterance: ASKED });
    expect(failed.rehearsals).toBeUndefined();
    expect(renderMemoryBundle(failed)).toBe("");
    expect(failing.warnings).toContain("rehearsals were not read for recall");
  });

  it("keeps at most three even if the port returns more", async () => {
    const { memory } = serviceWith({
      recentForOwner: () =>
        Promise.resolve(
          Array.from({ length: 5 }, (_, i) =>
            rehearsal({ rehearsalId: `r-${String(i)}` }),
          ),
        ),
    });
    const bundle = await memory.recall({ actor, utterance: ASKED });
    expect(bundle.rehearsals).toHaveLength(RECALLED_REHEARSALS);
  });
});

describe("the rehearsal section renders struggles, dated and labelled", () => {
  const base: MemoryBundle = {
    person: [],
    company: [],
    thisConversation: null,
    relevant: [],
    otherConversations: [],
  };

  it("shows what went wrong, what went well, practice focus and the date, labelled as coaching", () => {
    const text = renderMemoryBundle({
      ...base,
      rehearsals: [
        rehearsal(),
        rehearsal({
          rehearsalId: "r-0",
          at: "2026-09-28T09:00:00.000Z",
          score: 41,
          needsWork: ["CLARITY"],
          strong: [],
        }),
      ],
    });
    expect(text.startsWith(REHEARSALS_LABEL)).toBe(true);
    expect(REHEARSALS_LABEL).toContain("not verified facts about the company");
    expect(text).toContain(
      "- 2026-10-05, practice meeting with Amara Okafor, tough difficulty, ended strong later, score 58/100",
    );
    expect(text).toContain("- 2026-09-28,");
    expect(text).toContain("score 41/100");
    expect(text).toContain("Needed work: evidence, the ask");
    expect(text).toContain(
      "Struggled: When asked for churn, you gave a range then changed it.",
    );
    expect(text).toContain(
      "Better: State the trailing-twelve-month figure and its source.",
    );
    expect(text).toContain("Went well: The opening problem story landed.");
    expect(text).toContain(
      "Practise: Rehearse the ask in one sentence with the amount and use.",
    );
  });

  it("comes before relevant conversations and stays inside the memory budget", () => {
    const long = "x".repeat(1_400);
    const text = renderMemoryBundle({
      ...base,
      rehearsals: Array.from({ length: 3 }, (_, i) =>
        rehearsal({
          rehearsalId: `r-${String(i)}`,
          overall: long,
          wentWrong: Array.from({ length: 6 }, () => ({
            moment: long,
            why: long,
            better: long,
          })),
          wentRight: [long, long, long],
          tips: [long, long, long, long],
        }),
      ),
      relevant: [
        {
          conversationId: "c-1",
          title: null,
          summary: "Pitch narrative work.",
          lastMessageAt: "2026-10-01T00:00:00Z",
        },
      ],
    });
    expect(text.length).toBeLessThanOrEqual(MEMORY_TEXT_MAX);
    expect(text.indexOf(REHEARSALS_LABEL)).toBe(0);
    // Three clipped rehearsals leave room for the next section.
    expect(text).toContain(RELEVANT_LABEL);
  });
});
