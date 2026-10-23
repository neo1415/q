import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V60,
  TURN_READER_V61,
  TurnReaderV61ResultSchema,
  V49_TEAM_JOB,
  V61_DEEP_WORK,
} from "../src/index.js";

/**
 * Owner QA 2026-10-23 (QO-07): "Write me a 12-month plan" is deep work,
 * started at once; "yes" to Q's offer of it hands over that earlier work.
 */
describe("TURN_READER v61", () => {
  it("is active, keeps v60 whole and adds the deep-work rule right after TEAM JOB", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(61);
    expect(TURN_READER_V60.status).toBe("DEPRECATED");
    expect(TURN_READER_V61.template).toContain(
      `${V49_TEAM_JOB}${V61_DEEP_WORK}`,
    );
    expect(TURN_READER_V61.template.replace(V61_DEEP_WORK, "")).toBe(
      TURN_READER_V60.template,
    );
    expect(V61_DEEP_WORK).toMatch(/write me a 12-month plan/u);
    expect(V61_DEEP_WORK).toMatch(/workFromEarlier is true/u);
  });

  it("reads workFromEarlier, defaulting to false and never failing the reading", () => {
    const field = TurnReaderV61ResultSchema.shape.workFromEarlier;
    expect(field.parse(undefined)).toBe(false);
    expect(field.parse("maybe")).toBe(false);
    expect(field.parse(true)).toBe(true);
  });
});
