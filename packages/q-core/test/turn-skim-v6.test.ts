import { describe, expect, it } from "vitest";

import {
  TURN_SKIM_V5,
  TURN_SKIM_V6,
  TurnSkimV6ResultSchema,
  V6_SUBJECT,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Owner 2026-10-23: Q's first words name whom it is looking into at skim
 * time, from the skim's understanding -- never a name guessed from capital
 * letters or a list of question words.
 */
describe("TURN_SKIM v6: the skim says whom the turn is about", () => {
  it("is v5 kept whole plus the subject rule (v7 is active)", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_SKIM");
    expect(active.definition.version).toBe(9);
    expect(TURN_SKIM_V5.status).toBe("DEPRECATED");
    expect(TURN_SKIM_V6.template.replace(V6_SUBJECT, "")).toBe(
      TURN_SKIM_V5.template,
    );
  });

  it("asks for the subject by meaning, from the last two turns, never a reply word", () => {
    expect(V6_SUBJECT).toMatch(/^subject \(every kind\)/u);
    expect(V6_SUBJECT).toMatch(/the last two turns/u);
    expect(V6_SUBJECT).toMatch(/a yes to Q's offer about them/u);
    expect(V6_SUBJECT).toMatch(/Never a word of a reply/u);
  });

  it("a malformed subject costs only the subject", () => {
    const base = { kind: "OTHER", confidence: "HIGH" };
    expect(
      TurnSkimV6ResultSchema.parse({
        ...base,
        subject: { name: "Zino Aviation", kind: "COMPANY" },
      }).subject,
    ).toEqual({ name: "Zino Aviation", kind: "COMPANY" });
    const malformed = TurnSkimV6ResultSchema.parse({
      ...base,
      subject: { name: "Z", kind: "SHIP" },
    });
    expect(malformed.subject).toBeNull();
    expect(malformed.kind).toBe("OTHER");
  });
});
