import { describe, expect, it } from "vitest";

import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import { ActorContextSchema } from "@capital-q/security";

import type { MemoryBundle } from "../src/memory/contracts.js";
import { figuresNotInQuote } from "../src/memory/figures.js";
import type { MemoryRepository } from "../src/memory/postgres-memory-repository.js";
import { recalledLineTruthClass } from "../src/memory/provenance.js";
import { createMemoryRecall } from "../src/memory/recall-port.js";
import { Q_SAID_EARLIER, renderMemoryBundle } from "../src/memory/render.js";
import { createMemoryService } from "../src/memory/service.js";

/**
 * Thames Arc, 16 Nov 2026 (conversations 8811f9c7, e7e3c866, 2a26d43b,
 * 28071f0c): Q said "4 public-sector account managers" and "five in Q1"
 * of Halyard Security's 2027 hiring plan; the plan's rows say 3 and Q1 =
 * 4. Those answers were folded into the conversations' summaries, which
 * recall rendered into later conversations reading as the plan's, and the
 * situation's memory section typed the line USER_CLAIM.
 *
 * Proven here: a figure that only Q's answer stated never becomes a
 * remembered fact (the Write Gate refuses it); a recalled summary is
 * labelled as what Q said earlier, line by line, and typed Q_INFERENCE;
 * and the recall hands the answer the other conversations' summaries so
 * their counts can be held to the document.
 */

const TENANT = "47677daa-109b-4b92-add7-a5a94f91ed9c";
const actor = ActorContextSchema.parse({
  userId: "fd9945d9-a463-4b01-949f-0be1aee9e5c8",
  tenantId: TENANT,
  actorType: "HUMAN",
});
const STALE =
  "Amelia asked how Halyard Security’s 2027 hiring plan breaks down by role and start quarter. The plan projects 15 hires if the seed round closes: 4 public-sector account managers and 1 information security and assurance manager in Q1; 6 deployment engineers and 4 product engineers in Q2; and 1 finance and operations manager in Q3.";
const EARLIER = "8811f9c7-9d7a-42f6-9cae-4ae22c069a08";
const NOW = "28071f0c-b1e1-45c6-b68c-2e089c5a385b";

const untouched = new Proxy({} as MemoryRepository, {
  get: () => () => Promise.reject(new Error("the gate refused first")),
});
const transactions: TransactionManager = {
  run: (work) => work({} as TransactionContext),
};

describe("the Write Gate: a figure from Q's own answer is never a remembered fact", () => {
  it("refuses a model's memory whose count the person's quote does not state", async () => {
    const memory = createMemoryService({
      sql: {} as never,
      transactions,
      repository: untouched,
    });
    const asked = "What hiring does Halyard Security have planned for 2027?";
    const result = await memory.remember({
      actor,
      candidate: {
        memoryType: "fact",
        memoryKey: "interest.halyard_hiring",
        content:
          "Halyard plans 4 public-sector account managers and five hires in Q1.",
        quote: asked,
        subject: null,
        structuredValue: {},
      },
      writeMode: "Q_PROPOSED",
      userTurns: [asked],
      source: { conversationId: EARLIER, runId: null },
    });
    expect(result).toEqual({ outcome: "REFUSED", reason: "UNGROUNDED_FIGURE" });
  });

  it("a figure the person's own quote states still grounds their memory", () => {
    expect(
      figuresNotInQuote(
        "Their minimum cheque is $750k.",
        "our minimum cheque is $750,000",
      ),
    ).toEqual([]);
    expect(
      figuresNotInQuote("They plan four hires.", "we're hiring 4 people"),
    ).toEqual([]);
    expect(
      figuresNotInQuote("They plan 4 account managers.", "what's the plan?"),
    ).toEqual(["4"]);
  });
});

describe("recall: a summary is what Q said earlier, never a fact", () => {
  const bundle: MemoryBundle = {
    person: [],
    company: [],
    thisConversation: {
      title: "Halyard Security 2027 hiring plan",
      summary: "Amelia asked about the plan.",
    },
    relevant: [
      {
        conversationId: EARLIER,
        title: "Halyard Security hiring plan",
        summary: STALE,
        lastMessageAt: "2026-11-16T18:20:33.000Z",
      },
    ],
    otherConversations: [],
  };

  it("labels every recalled summary line as Q's earlier statement", () => {
    const text = renderMemoryBundle(bundle);
    const line = text
      .split("\n")
      .find((candidate) =>
        candidate.includes("public-sector account managers"),
      );
    expect(line).toBeDefined();
    expect(line).toContain(`Halyard Security hiring plan: ${Q_SAID_EARLIER}`);
    expect(text).toContain(
      `\n${Q_SAID_EARLIER} (its summary, not a source) — Amelia asked about the plan.`,
    );
  });

  it("types a summary line and Q's own past turn Q_INFERENCE, their words USER_CLAIM", () => {
    const text = renderMemoryBundle(bundle);
    const summaryLine = text
      .split("\n")
      .find((candidate) => candidate.includes("account managers"));
    expect(recalledLineTruthClass(summaryLine ?? "")).toBe("Q_INFERENCE");
    expect(
      recalledLineTruthClass(
        '- 2026-11-16 (in "Halyard Security hiring plan"), Q said: "4 public-sector account managers"',
      ),
    ).toBe("Q_INFERENCE");
    expect(
      recalledLineTruthClass(
        '- 2026-11-16 (in "Halyard Security hiring plan"), they said: "What hiring is planned?"',
      ),
    ).toBe("USER_CLAIM");
    expect(
      recalledLineTruthClass("- They said (2026-11-01): Call me Amelia."),
    ).toBe("USER_CLAIM");
  });

  it("hands the answer the other conversations' summaries, never this one's", async () => {
    const recalled = await createMemoryRecall({
      recall: () =>
        Promise.resolve({
          ...bundle,
          otherConversations: [
            {
              conversationId: NOW,
              title: null,
              summary: "This conversation.",
              lastMessageAt: "2026-11-16T23:09:53.000Z",
            },
          ],
        }),
    }).recall({ actor, conversationId: NOW, subjects: [] });
    expect(recalled.earlierSummaries).toEqual([
      { conversationId: EARLIER, summary: STALE },
    ]);
  });
});
