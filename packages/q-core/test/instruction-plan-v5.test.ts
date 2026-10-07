import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  InstructionPlanV5ResultSchema,
} from "../src/index.js";

/**
 * Live QA (instruction 76d6f281): INSTRUCTION_PLAN v5 is the active plan
 * prompt; every rule it adds is really in its words (the template is built
 * by replacing v4's lines, so a line that no longer matches would vanish
 * silently), and each step carries the typed message reading.
 */
describe("INSTRUCTION_PLAN v5", () => {
  const registry = createDefaultPromptRegistry();
  const active = registry.getActive("INSTRUCTION_PLAN");

  // v6 (ADR 0050) is v5 plus the consider step: v5's rules all hold.
  it("is carried by the active version, with each new rule", () => {
    expect(active.definition.version).toBe(7);
    const template = active.definition.template;
    for (const rule of [
      "message: for every chat message, its kind and what its final sentence asks",
      'FIRST only where it says "no message from your side yet"',
      '"what times work to connect?" is MEETING',
      'never open with a fixed formula such as "Your profile says"',
      "outside your declared mandate, write no first message",
      "never a request for time",
      "write it word for word",
      "(v7, with request, each cannot's needs and each step's message)",
    ]) {
      expect(template, rule).toContain(rule);
    }
    expect(template).not.toContain(
      '("your profile says...", "in your pitch...")',
    );
  });

  it("each step says its message kind and final ask, or null for other actions", () => {
    const step = {
      action: "chat.message.send",
      argumentsJson: "{}",
      topic: "introductions",
      touchesTermsOrMoney: false,
      words: "Say hello.",
    };
    const plan = (message: unknown) => ({
      request: "EXECUTE",
      cannot: [],
      steps: [{ ...step, message }],
    });
    expect(
      InstructionPlanV5ResultSchema.safeParse(
        plan({ kind: "FIRST", asks: "QUESTION" }),
      ).success,
    ).toBe(true);
    expect(InstructionPlanV5ResultSchema.safeParse(plan(null)).success).toBe(
      true,
    );
    expect(
      InstructionPlanV5ResultSchema.safeParse(
        plan({ kind: "INTRO", asks: "QUESTION" }),
      ).success,
    ).toBe(false);
    expect(
      InstructionPlanV5ResultSchema.safeParse({
        request: "EXECUTE",
        cannot: [],
        steps: [step],
      }).success,
    ).toBe(false);
  });
});
