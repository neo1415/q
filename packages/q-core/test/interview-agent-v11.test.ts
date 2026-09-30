import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  INTERVIEW_AGENT_V10,
  INTERVIEW_AGENT_V11,
  InterviewAgentV11ResultSchema,
} from "../src/index.js";

/**
 * INTERVIEW_AGENT v11 (founder direction 2026-09-30): Q as a person --
 * personality, varied openings, small talk read for code to govern, and
 * answered-is-answered. Nothing of v10's rules is lost.
 */
describe("INTERVIEW_AGENT v11", () => {
  it("is the active interviewer", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("INTERVIEW_AGENT").definition.version).toBe(12);
  });

  it("keeps every v10 rule and adds who Q is, conduct and openings", () => {
    for (const line of INTERVIEW_AGENT_V10.template
      .split("\n")
      .filter((l) => l.startsWith("- "))) {
      expect(INTERVIEW_AGENT_V11.template).toContain(line);
    }
    expect(INTERVIEW_AGENT_V11.template).toContain("{{personality}}");
    expect(INTERVIEW_AGENT_V11.template).toContain("{{conduct}}");
    expect(INTERVIEW_AGENT_V11.template).toContain("{{openings}}");
    expect(INTERVIEW_AGENT_V11.template).toContain("Answered is answered.");
  });

  it("reads small talk and hurt, defaulting to none", () => {
    const plain = InterviewAgentV11ResultSchema.parse({
      reply: "Nice -- Lagos. What's the round?",
      asking: null,
      raised: [],
    });
    expect(plain.chatter).toBe("NONE");
    expect(plain.hurt).toBe(false);
    expect(
      InterviewAgentV11ResultSchema.safeParse({
        reply: "Ha!",
        chatter: "BANTER",
      }).success,
    ).toBe(false);
  });
});
