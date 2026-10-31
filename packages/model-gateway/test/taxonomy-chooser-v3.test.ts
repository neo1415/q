import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import type { ModelGateway } from "../src/index.js";
import { createTaxonomyChooser } from "../src/q/index.js";

/**
 * Live check 2026-10-31 on production 656719a90: the chooser was given no
 * idea who an investor's customers are ("recurring revenue" from a B2B
 * investor read as Consumer Subscription), and a founder's "40 lockers live
 * in 12 towns" was lost when their words were read as "Paying customers".
 */
const logger = createLogger(
  { serviceName: "model-gateway-test", environment: "test" },
  { level: "silent" },
);
const who = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  userId: null,
} as const;

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

const MODELS = [
  ["b1000000-0000-4000-8000-000000000001", "B2B SaaS"],
  ["b1000000-0000-4000-8000-000000000002", "Consumer Subscription"],
] as const;

describe("the category chooser v3", () => {
  it("is given what else they said (their customers) as their words", async () => {
    const { gateway, seen } = recording({ chosen: [], beyond: null });
    const choose = createTaxonomyChooser({ gateway, logger });
    const result = await choose({
      who,
      field: "What business models do you back?",
      phrase: "recurring revenue",
      sentence: "Mostly B2B with recurring revenue.",
      context: "Customer types: B2B",
      candidates: MODELS.map(([nodeId, displayName]) => ({
        nodeId,
        displayName,
        vocabularyCode: "business_model",
      })),
    });
    expect(result).toEqual([]);
    expect(seen[0]).toContain("Customer types: B2B");
    expect(seen[0]).toContain("WHAT ELSE THEY SAID FOR THIS PROFILE");
  });

  it("says when nothing else is known, rather than an empty section", async () => {
    const { gateway, seen } = recording({ chosen: ["c1"] });
    const choose = createTaxonomyChooser({ gateway, logger });
    const result = await choose({
      who,
      field: "What business models do you back?",
      phrase: "software subscriptions for companies",
      sentence: "software subscriptions for companies",
      candidates: MODELS.map(([nodeId, displayName]) => ({
        nodeId,
        displayName,
        vocabularyCode: "business_model",
      })),
    });
    // A reading without `beyond` (older shape) still counts.
    expect(result).toEqual([MODELS[0][0]]);
    expect(result?.beyond).toBeUndefined();
    expect(seen[0]).toContain("Nothing else yet.");
  });

  it("gives back their words beyond the chosen ones", async () => {
    const { gateway } = recording({
      chosen: ["c2"],
      beyond: "40 lockers live in 12 towns",
    });
    const choose = createTaxonomyChooser({ gateway, logger });
    const result = await choose({
      who,
      field: "What early traction do you have?",
      phrase: "40 lockers live in 12 towns and 3 courier companies paying us",
      sentence:
        "We have 40 lockers live in 12 towns and 3 courier companies paying us.",
      candidates: [
        {
          nodeId: "pilots",
          displayName: "Pilots running",
          vocabularyCode: "F5.signal",
        },
        {
          nodeId: "paying",
          displayName: "Paying customers",
          vocabularyCode: "F5.signal",
        },
      ],
    });
    expect([...(result ?? [])]).toEqual(["paying"]);
    expect(result?.beyond).toBe("40 lockers live in 12 towns");
  });
});
