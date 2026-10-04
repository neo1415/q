import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ModelGateway } from "@capital-q/model-gateway";

import { createInstructionPlanner } from "../src/composition/instructions/planner.js";

/** ADR 0043 S5: the planner's spend belongs to the instruction. No provider. */

const variables = {
  principalName: "Ada",
  goal: "Handle all the work for me",
  grant: "- chat.message.send: AUTO",
  actions: "chat.message.send: Sends a message.",
  now: "2026-10-07T09:00:00Z (their zone UTC)",
  people: "No one yet.",
  history: "Nothing yet.",
  refusals: "None.",
  sender:
    "An investor writing to founders about their companies.\n- stages: Seed (source: your declared mandate)",
};

describe("the instruction planner", () => {
  it("caps the call at what is left, carries the instruction id, and returns the cost", async () => {
    const requests: {
      budget: { maxEstimatedCostUsd: number };
      attribution: { correlationId: string };
      messages: { content: unknown }[];
    }[] = [];
    const gateway = {
      execute: (request: (typeof requests)[number]) => {
        requests.push(request);
        return Promise.resolve({
          cost: { currency: "USD", amount: 0.012, basis: "ESTIMATED" },
          output: {
            kind: "STRUCTURED",
            value: { steps: [], cannot: [], request: "EXECUTE" },
          },
        });
      },
    } as unknown as ModelGateway;
    const instructionId = randomUUID();
    const plan = createInstructionPlanner({ gateway });
    const outcome = await plan(
      { tenantId: randomUUID(), userId: randomUUID(), instructionId },
      variables,
      { maxCostUsd: 0.05 },
    );
    expect(outcome).toEqual({
      plan: { steps: [], cannot: [], request: "EXECUTE" },
      costUsd: 0.012,
    });
    expect(requests[0]?.budget.maxEstimatedCostUsd).toBe(0.05);
    // QA run 8a1d57b9 (v4): the planner reads who it writes as, and the
    // rules code holds every message to.
    const prompt = JSON.stringify(requests[0]?.messages);
    expect(prompt).toContain("WHO YOU WRITE AS");
    expect(prompt).toContain("stages: Seed (source: your declared mandate)");
    expect(prompt).toContain("Never claim history you do not have");
    expect(prompt).toContain("only when schedule.meeting.book is AUTO");
    expect(requests[0]?.attribution.correlationId).toContain(
      `cor_instr_${instructionId}_`,
    );
  });

  it("a refused or failed call plans nothing", async () => {
    const gateway = {
      execute: () => Promise.reject(new Error("BUDGET_EXCEEDED")),
    } as unknown as ModelGateway;
    const outcome = await createInstructionPlanner({ gateway })(
      {
        tenantId: randomUUID(),
        userId: randomUUID(),
        instructionId: randomUUID(),
      },
      variables,
      { maxCostUsd: 0.08 },
    );
    expect(outcome).toEqual({ plan: null, costUsd: 0 });
  });
});
