import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V48,
  TURN_READER_V49,
  TurnReaderV49ResultSchema,
  V49_TEAM_JOB,
} from "../src/index.js";

/** TURN_READER v49 (lead review 2026-10-12): a job for Q's team, read from meaning. */
describe("TURN_READER v49", () => {
  it("is the active reader and v48 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(61);
    expect(TURN_READER_V48.status).toBe("DEPRECATED");
  });

  it("adds the team-job rule once, before the profile rule, and keeps the rest of v48", () => {
    expect(TURN_READER_V49.template.split(V49_TEAM_JOB)).toHaveLength(2);
    expect(TURN_READER_V49.template.indexOf(V49_TEAM_JOB)).toBeLessThan(
      TURN_READER_V49.template.indexOf("SAVE TO OWN PROFILE: "),
    );
    expect(TURN_READER_V49.template.replace(V49_TEAM_JOB, "")).toBe(
      TURN_READER_V48.template,
    );
  });

  it("carries teamJob, and a reading without it is not a team job", () => {
    const base = {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
    };
    expect(
      TurnReaderV49ResultSchema.parse({ ...base, teamJob: true }).teamJob,
    ).toBe(true);
    expect(TurnReaderV49ResultSchema.parse(base).teamJob).toBe(false);
  });
});
