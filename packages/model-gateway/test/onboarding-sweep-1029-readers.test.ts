import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import type { ModelGateway } from "../src/index.js";
import {
  createOnboardingTranscriptReader,
  createTaxonomyChooser,
} from "../src/q/index.js";

/**
 * Live onboarding sweep 2026-10-29: what the readers are given. D5 "hoping
 * to close in Q1" needs today; D2 "Benelux" needs a small field's whole
 * list offered, and a region read as several of its members.
 */

const logger = createLogger(
  { serviceName: "model-gateway-test", environment: "test" },
  { level: "silent" },
);

function recording(value: unknown) {
  const seen: string[] = [];
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
    }) => {
      seen.push(request.messages.map((m) => m.content).join("\n"));
      return Promise.resolve({ output: { kind: "STRUCTURED", value } });
    },
  } as unknown as ModelGateway;
  return { gateway, seen };
}

describe("the transcript reader", () => {
  it("is told today's date, for the times they name", async () => {
    const { gateway, seen } = recording({ answers: [], declined: [] });
    const reader = createOnboardingTranscriptReader({
      gateway,
      logger,
      now: () => new Date("2026-10-29T12:00:00Z"),
    });
    await reader.read({
      journey: "founder",
      steps: [
        {
          stepKey: "F6.timeframe",
          question: "When do you hope to close?",
          kind: "ONE_OF",
          required: false,
          options: "under_3: Within 3 months; 3_6: 3–6 months",
          onRecord: "nothing",
        },
      ],
      turns: [{ role: "PERSON", text: "hoping to close in Q1" }],
      attribution: {
        tenantId: "c0000000-0000-4000-8000-000000000001",
        userId: "b0000000-0000-4000-8000-000000000001",
        correlationId: "cor_test",
      },
    });
    expect(seen[0]).toContain("Today's date is 2026-10-29.");
  });
});

describe("the category chooser", () => {
  it("is offered a whole small list and may choose several of it", async () => {
    const ids = Array.from(
      { length: 40 },
      (_, i) => `a1000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const chosen = ids.slice(0, 6);
    // The model names the offered ids (c1..c40), never the node ids.
    const { gateway, seen } = recording({
      chosen: ["c1", "c2", "c3", "c4", "c5", "c6"],
    });
    const choose = createTaxonomyChooser({ gateway, logger });
    const result = await choose({
      who: { tenantId: "c0000000-0000-4000-8000-000000000001", userId: null },
      field: "Where do you invest?",
      phrase: "the Nordics",
      sentence: "Benelux and the Nordics",
      candidates: ids.map((nodeId, i) => ({
        nodeId,
        displayName: `Country ${String(i)}`,
        vocabularyCode: "geography",
      })),
    });
    expect(result).toEqual(chosen);
    // All forty were offered, not the lookup's first twelve.
    expect(seen[0]).toContain("c40 | Country 39");
  });
});

/**
 * Live recheck 2026-10-30 (production 4d71bcf74): "Benelux and the
 * Nordics" saved as plain text though Netherlands is listed: two
 * TAXONOMY_MAPPING calls were served with nothing usable kept and no trace;
 * "We prefer to follow a lead" saved as `follow` ("Follow in later
 * rounds"). A model sees labels with opaque ids only; code maps them back.
 */
describe("readers never see a real id or key", () => {
  const GEOGRAPHY = [
    ["6d6366e0-bbb2-5a32-bad8-c747ca550c70", "Africa"],
    ["b6869c9c-b25c-5a8b-a1f1-38c2d3a5a994", "Europe"],
    ["20dc8cd8-bb51-517f-8fe0-1f6264e51a3b", "Netherlands"],
    ["ccace354-1437-5fb0-a46f-2c6f11ff21cf", "United Kingdom"],
  ] as const;

  it("Benelux: the chooser is shown c-ids, not node ids, and its c-id maps back to Netherlands", async () => {
    const { gateway, seen } = recording({ chosen: ["c3"] });
    const choose = createTaxonomyChooser({ gateway, logger });
    const result = await choose({
      who: { tenantId: "c0000000-0000-4000-8000-000000000001", userId: null },
      field: "Where do you invest?",
      phrase: "Benelux",
      sentence: "Benelux and the Nordics",
      candidates: GEOGRAPHY.map(([nodeId, displayName]) => ({
        nodeId,
        displayName,
        vocabularyCode: "geography",
      })),
    });
    expect(result).toEqual(["20dc8cd8-bb51-517f-8fe0-1f6264e51a3b"]);
    for (const [nodeId] of GEOGRAPHY) expect(seen[0]).not.toContain(nodeId);
    expect(seen[0]).toContain("c3 | Netherlands");
  });

  it("an id the model invents (a mangled node id) is dropped, never guessed", async () => {
    const { gateway } = recording({
      chosen: ["20dc8cd8-bb51-517f-8fe0-1f6264e51a3c"],
    });
    const choose = createTaxonomyChooser({ gateway, logger });
    const result = await choose({
      who: { tenantId: "c0000000-0000-4000-8000-000000000001", userId: null },
      field: "Where do you invest?",
      phrase: "Benelux",
      sentence: "Benelux",
      candidates: GEOGRAPHY.map(([nodeId, displayName]) => ({
        nodeId,
        displayName,
        vocabularyCode: "geography",
      })),
    });
    expect(result).toEqual([]);
  });

  it("an option step's keys never reach the chooser: 'follow' is not shown as a word", async () => {
    const { gateway, seen } = recording({ chosen: ["c2"] });
    const choose = createTaxonomyChooser({ gateway, logger });
    const result = await choose({
      who: { tenantId: "c0000000-0000-4000-8000-000000000001", userId: null },
      field: "What role do you usually take in a round?",
      phrase: "follow a lead",
      sentence: "We prefer to follow a lead",
      candidates: [
        { nodeId: "lead", displayName: "Lead the round", vocabularyCode: "x" },
        {
          nodeId: "co_invest",
          displayName: "Co-invest alongside a lead",
          vocabularyCode: "x",
        },
        {
          nodeId: "follow",
          displayName: "Follow in later rounds",
          vocabularyCode: "x",
        },
      ],
    });
    expect(result).toEqual(["co_invest"]);
    expect(seen[0]).not.toMatch(/\bco_invest\b|\bfollow \|/u);
    expect(seen[0]).toContain("c3 | Follow in later rounds");
  });
});
