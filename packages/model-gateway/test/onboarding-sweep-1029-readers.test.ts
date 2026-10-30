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
    const { gateway, seen } = recording({ chosen });
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
    expect(seen[0]).toContain(ids[39]);
  });
});
