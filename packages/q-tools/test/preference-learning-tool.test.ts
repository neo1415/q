import { describe, expect, it } from "vitest";

import { createSetPreferenceLearningTool } from "../src/index.js";

/** Lane ob1: the decision rests on the person's own words, said now. */
const actor = {
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
} as never;
const plan = {
  scopes: [
    {
      kind: "OWN_Q_CONVERSATION",
      filter: { userId: "b0000000-0000-4000-8000-000000000001" },
    },
  ],
} as never;

describe("set_preference_learning", () => {
  const decided: string[] = [];
  const tool = createSetPreferenceLearningTool({
    decide: (_a, choice) => {
      decided.push(choice);
      return Promise.resolve({ status: choice });
    },
  });
  const context = (latestUserText: string) =>
    ({ actor, plan, conversation: { latestUserText } }) as never;

  it("records a yes they just said", async () => {
    const grant = await tool.authorize(
      { choice: "ALLOW", quote: "yes, go ahead" },
      context("Yes, go ahead."),
    );
    expect(grant.outcome).toBe("ALLOW");
  });

  it("refuses words they did not say", async () => {
    const grant = await tool.authorize(
      { choice: "ALLOW", quote: "yes, go ahead" },
      context("Not now, thanks."),
    );
    expect(grant.outcome).not.toBe("ALLOW");
  });
});
