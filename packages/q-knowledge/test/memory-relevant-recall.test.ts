import { describe, expect, it } from "vitest";

import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import { ActorContextSchema } from "@capital-q/security";

import type {
  MemoryBundle,
  MemoryConversationDigest,
  MemoryItem,
} from "../src/memory/contracts.js";
import type { MemoryRepository } from "../src/memory/postgres-memory-repository.js";
import { recallTermsFrom } from "../src/memory/recall-terms.js";
import {
  MEMORY_TEXT_MAX,
  RELEVANT_LABEL,
  renderMemoryBundle,
} from "../src/memory/render.js";
import {
  createMemoryService,
  type MemoryConversationDigestPort,
} from "../src/memory/service.js";

/**
 * Relevant recall: an earlier conversation about what the person is
 * asking now reaches the prompt however long ago it was, found by the
 * run's companies or by a name they typed (read by code, not a model),
 * shown once, first, dated, and labelled as talk rather than evidence.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "d0000000-0000-4000-8000-000000000001";
const actor = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  actorType: "HUMAN",
});

const emptyRepository = {
  listLive: () => Promise.resolve([] as MemoryItem[]),
  markUsed: () => Promise.resolve(),
} as unknown as MemoryRepository;
const tx = {
  sql: Object.assign(() => Promise.resolve([]), {}),
} as unknown as TransactionContext;
const transactions: TransactionManager = { run: (work) => work(tx) };

function digest(
  id: string,
  summary: string,
  lastMessageAt: string,
  title: string | null = null,
): MemoryConversationDigest {
  return { conversationId: id, title, summary, lastMessageAt };
}

function serviceWith(conversations: MemoryConversationDigestPort) {
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
      conversations,
      logger,
    }),
  };
}

describe("recall terms are read from the question by code", () => {
  it("keeps capitalised names of four or more letters and drops common openers", () => {
    expect(
      recallTermsFrom(
        "Remember what we discussed about Tensorgate? Has anything changed?",
      ),
    ).toEqual(["Tensorgate"]);
    expect(
      recallTermsFrom(
        "What did Kora's founder say? Tell me about Lagos, and Kora again.",
      ),
    ).toEqual(["Kora", "Lagos"]);
  });

  it("is nothing for a question without a name, and never more than eight", () => {
    expect(recallTermsFrom("how are things going today?")).toEqual([]);
    expect(recallTermsFrom("")).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `Name${String(i)}`);
    expect(recallTermsFrom(many.join(" "))).toHaveLength(8);
  });
});

describe("recall bundles relevant conversations", () => {
  it("asks with the run's companies, the question's names and the current conversation excluded; dedups against recent", async () => {
    const asked: unknown[] = [];
    const shared = digest("c-2", "Tensorgate runway.", "2026-09-01T10:00:00Z");
    const { memory } = serviceWith({
      digestOf: () => Promise.resolve(null),
      recentDigests: () =>
        Promise.resolve([
          digest("c-9", "Something recent.", "2026-10-10T10:00:00Z"),
          shared,
        ]),
      relevantDigests: (_actor, query) => {
        asked.push(query);
        return Promise.resolve([
          shared,
          digest("c-current", "This one.", "2026-10-11T10:00:00Z"),
        ]);
      },
    });
    const bundle = await memory.recall({
      actor,
      conversationId: "c-current",
      companyIds: [COMPANY],
      utterance: "Has anything changed at Tensorgate?",
    });
    expect(asked).toEqual([
      {
        companyIds: [COMPANY],
        terms: ["Tensorgate"],
        except: ["c-current"],
        limit: 4,
      },
    ]);
    expect(bundle.relevant.map((c) => c.conversationId)).toEqual(["c-2"]);
    expect(bundle.otherConversations.map((c) => c.conversationId)).toEqual([
      "c-9",
    ]);
  });

  it("does not search when there is neither a company nor a name", async () => {
    let searched = false;
    const { memory } = serviceWith({
      digestOf: () => Promise.resolve(null),
      recentDigests: () => Promise.resolve([]),
      relevantDigests: () => {
        searched = true;
        return Promise.resolve([]);
      },
    });
    const bundle = await memory.recall({ actor, utterance: "how are you?" });
    expect(searched).toBe(false);
    expect(bundle.relevant).toEqual([]);
  });

  it("degrades to no relevant section when the search fails, keeping recent memory", async () => {
    const { memory, warnings } = serviceWith({
      digestOf: () => Promise.resolve(null),
      recentDigests: () =>
        Promise.resolve([digest("c-9", "Recent.", "2026-10-10T10:00:00Z")]),
      relevantDigests: () => Promise.reject(new Error("db down")),
    });
    const bundle = await memory.recall({
      actor,
      utterance: "And Tensorgate?",
    });
    expect(bundle.relevant).toEqual([]);
    expect(bundle.otherConversations).toHaveLength(1);
    expect(warnings).toContain(
      "relevant conversations were not read for recall",
    );
  });
});

describe("rendering the relevant section", () => {
  const base: MemoryBundle = {
    person: [],
    company: [],
    thisConversation: { title: null, summary: "Now: a greeting." },
    relevant: [],
    otherConversations: [
      digest("c-9", "Something recent.", "2026-10-10T10:00:00Z"),
    ],
  };

  it("renders first, dated, labelled as conversation memory and not evidence", () => {
    const text = renderMemoryBundle({
      ...base,
      relevant: [
        digest(
          "c-2",
          "Asked about Tensorgate's runway.",
          "2026-09-01T10:00:00Z",
          "Tensorgate runway",
        ),
      ],
    });
    expect(text.startsWith(RELEVANT_LABEL)).toBe(true);
    expect(RELEVANT_LABEL).toContain("not verified evidence");
    expect(text).toContain(
      "- 2026-09-01 Tensorgate runway: Asked about Tensorgate's runway.",
    );
    expect(text.indexOf(RELEVANT_LABEL)).toBeLessThan(
      text.indexOf("Earlier in this conversation"),
    );
    expect(text.indexOf("Earlier in this conversation")).toBeLessThan(
      text.indexOf("Other recent conversations"),
    );
  });

  it("stays inside the cap, clipping long summaries so later sections keep room", () => {
    const long = "x".repeat(3_000);
    const text = renderMemoryBundle({
      ...base,
      relevant: [1, 2, 3, 4].map((n) =>
        digest(`c-${String(n)}`, long, "2026-09-01T10:00:00Z"),
      ),
    });
    expect(text.length).toBeLessThanOrEqual(MEMORY_TEXT_MAX);
    expect(text).toContain("Earlier in this conversation");
    expect(renderMemoryBundle(base)).not.toContain(RELEVANT_LABEL);
  });
});
