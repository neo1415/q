import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V30,
  TURN_READER_V31,
  TURN_READER_V31_APP_ACTION,
  TurnReaderV31ResultSchema,
} from "../src/index.js";

/** TURN_READER v31 (QA, ADR 0040 parity eval): appAction. */
describe("TURN_READER v31", () => {
  it("v30 is deprecated (v32 is active)", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(46);
    expect(TURN_READER_V30.status).toBe("DEPRECATED");
  });

  it("adds the app-action line, pitch sharing over SET_VISIBILITY, and loses nothing of v30", () => {
    expect(TURN_READER_V31.template).toContain(TURN_READER_V31_APP_ACTION);
    expect(TURN_READER_V31.template).toContain(
      '"let investors play my pitch video" is set_pitch_sharing',
    );
    for (const line of TURN_READER_V30.template.split("\n")) {
      expect(TURN_READER_V31.template).toContain(line);
    }
  });

  it("reads appAction as null when left out, and keeps tool and arguments as said", () => {
    const base = {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
    };
    expect(TurnReaderV31ResultSchema.parse(base).appAction).toBe(null);
    expect(
      TurnReaderV31ResultSchema.parse({
        ...base,
        appAction: {
          tool: "set_pitch_sharing",
          arguments: { pitch: "my pitch video", sharing: "INVESTORS" },
        },
      }).appAction,
    ).toEqual({
      tool: "set_pitch_sharing",
      arguments: { pitch: "my pitch video", sharing: "INVESTORS" },
    });
    expect(
      TurnReaderV31ResultSchema.safeParse({
        ...base,
        appAction: { tool: "save_company" },
      }).success,
    ).toBe(false);
  });
});
