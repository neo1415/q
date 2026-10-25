import { describe, expect, it } from "vitest";

import type { ModelGateway } from "@capital-q/model-gateway";

import {
  createWorkforceModels,
  PLAN_BUDGET,
} from "../src/composition/workforce/models.js";

/**
 * Production 2026-10-25 (run 341b8d61, investor.equator-line): "Do market
 * research on Silo Credit's market and save it to my board" -- the plan was
 * cut off at its 2,800-token ceiling ("structured output refused … JSON,
 * truncated"), the retry kept no step, and the person was told "I couldn't
 * turn that into a plan". A plan that comes back with every step dropped
 * is asked again, never offered empty; the ceiling fits a whole plan.
 */

const step = {
  key: "research",
  role: "RESEARCH",
  goal: "Research Silo Credit's market.",
  tools: ["public_web.search"],
  dependsOn: [],
  why: "The analysis needs the market's shape.",
  evidence: [],
  fallbackFor: null,
};

const plan = (steps: readonly unknown[]) => ({
  summary: "Research Silo Credit's market and write it up for your board.",
  outcome: "A market note on your board.",
  steps,
  prerequisites: [],
  nextActions: [],
  cannot: [],
  firstRead: null,
});

/** A gateway that answers JOB_PLAN from a script, one answer per call. */
function scripted(
  answers: readonly {
    readonly steps: readonly unknown[];
    readonly dropped?: readonly string[];
  }[],
) {
  const seen: { maxOutputTokens: number }[] = [];
  const gateway = {
    execute: (request: { budget: { maxOutputTokens: number } }) => {
      const answer = answers[seen.length] ?? answers.at(-1);
      seen.push({ maxOutputTokens: request.budget.maxOutputTokens });
      return Promise.resolve({
        cost: { currency: "USD", amount: 0.01, basis: "ESTIMATED" },
        output: {
          kind: "STRUCTURED",
          value: plan(answer?.steps ?? []),
          ...(answer?.dropped === undefined ? {} : { dropped: answer.dropped }),
        },
      });
    },
  };
  return { gateway: gateway as unknown as ModelGateway, seen };
}

const who = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
};
const variables = {
  goal: "Do market research on Silo Credit's market and save it to my board",
  roster:
    "- RESEARCH (Research): reads public sources. Tools: public_web.search.",
  allowed: "public_web.search, documents.own.prepare",
  situation: "",
};

describe("a cut-off plan is never a 0-step plan", () => {
  it("a plan whose every step was dropped is asked again, and the whole plan kept", async () => {
    const g = scripted([
      { steps: [], dropped: ["steps.0.role:invalid_value"] },
      { steps: [step] },
    ]);
    const models = createWorkforceModels({ gateway: g.gateway });
    const planned = await models.plan(who, null, variables);
    expect(g.seen).toHaveLength(2);
    expect(planned?.steps.map((one) => one.key)).toEqual(["research"]);
  });

  it("twice emptied: refused (null), never offered with no step", async () => {
    const g = scripted([{ steps: [], dropped: ["steps.0:invalid_type"] }]);
    const models = createWorkforceModels({ gateway: g.gateway });
    expect(await models.plan(who, null, variables)).toBeNull();
    expect(g.seen).toHaveLength(2);
  });

  it("a plan that truly has no step (nothing to do) is not asked again", async () => {
    const g = scripted([{ steps: [] }]);
    const models = createWorkforceModels({ gateway: g.gateway });
    const planned = await models.plan(who, null, variables);
    expect(g.seen).toHaveLength(1);
    expect(planned?.steps).toEqual([]);
  });

  it("the ceiling fits a whole plan, with money for a third attempt at it", () => {
    expect(PLAN_BUDGET.maxOutputTokens).toBeGreaterThanOrEqual(6_000);
    expect(PLAN_BUDGET.maxAttempts).toBe(3);
    const g = scripted([{ steps: [step] }]);
    const models = createWorkforceModels({ gateway: g.gateway });
    return models.plan(who, null, variables).then(() => {
      expect(g.seen[0]?.maxOutputTokens).toBe(PLAN_BUDGET.maxOutputTokens);
    });
  });
});
