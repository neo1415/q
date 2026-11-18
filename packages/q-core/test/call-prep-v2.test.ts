import { describe, expect, it } from "vitest";

import {
  CALL_PREP_V1,
  CALL_PREP_V2,
  CALL_PREP_V3,
  CallPrepResultV2Schema,
  CallPrepResultV3Schema,
  createDefaultPromptRegistry,
} from "../src/index.js";

/** Owner QA O-I12 (2026-10-24): the prep follows the asker's side. */
describe("CALL_PREP v2 (superseded by v3)", () => {
  it("v3 is active; v1 and v2 are deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("CALL_PREP").definition.version,
    ).toBe(3);
    expect(CALL_PREP_V1.status).toBe("DEPRECATED");
    expect(CALL_PREP_V2.status).toBe("DEPRECATED");
  });

  it("v3 never says where a fact was found, and reads agreed times with their words", () => {
    const t = CALL_PREP_V3.template;
    expect(t).not.toMatch(/profile and material/u);
    expect(t).toMatch(/Never say where a fact was found/u);
    expect(t).toMatch(/AGREED IN MESSAGES/u);
    expect(
      CallPrepResultV3Schema.shape.agreedInMessages.parse(undefined),
    ).toEqual([]);
  });

  it("writes a founder's and an investor's prep differently", () => {
    const t = CALL_PREP_V2.template;
    expect(t).toContain("When the person is a FOUNDER (meeting an investor)");
    expect(t).toContain(
      "When the person is an INVESTOR (meeting a founder or company)",
    );
    expect(t).toMatch(/Never answer as the founder/u);
    expect(t).toMatch(/what to verify afterwards/u);
    expect(t).toMatch(/red flags/u);
    expect(t).toMatch(
      /THEY WANT: one or two sentences, what the founder will most likely want from them/u,
    );
    // v1's rules stay: no invented numbers, unknown stays unknown.
    expect(t).toMatch(/never guess an investor's cheque size/u);
  });

  it("theyWant is optional (null for a founder)", () => {
    const shape = CallPrepResultV2Schema.shape.theyWant;
    expect(shape.parse(undefined)).toBeNull();
    expect(shape.parse("A cheque and intros")).toBe("A cheque and intros");
  });
});
