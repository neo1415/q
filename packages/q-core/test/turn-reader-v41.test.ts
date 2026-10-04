import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import {
  TURN_READER_V40,
  TURN_READER_V40_DESTINATIONS,
  TURN_READER_V41,
  TURN_READER_V41_DESTINATIONS,
  TurnReaderV40ResultSchema,
} from "../src/index.js";

/** TURN_READER v41 (WORK-58): "show my work" opens Q's work page. */
describe("TURN_READER v41", () => {
  it("v40 is deprecated (v42 is the active reader since voiceq-63)", () => {
    expect(TURN_READER_V40.status).toBe("DEPRECATED");
  });

  it("names every contract destination exactly once, WORK included", () => {
    for (const destination of [...Q_NAVIGATE_DESTINATIONS, "RESULTS"]) {
      expect(
        TURN_READER_V41.template.split(
          new RegExp(`(?<![A-Z_])${destination} \\(`),
        ).length - 1,
        destination,
      ).toBe(1);
    }
  });

  it("adds only the WORK screen, in the static prefix, with the founder's phrasings", () => {
    expect(
      TURN_READER_V41.template.replace(
        TURN_READER_V41_DESTINATIONS,
        TURN_READER_V40_DESTINATIONS,
      ),
    ).toBe(TURN_READER_V40.template);
    expect(TURN_READER_V41.template.indexOf("WORK (")).toBeLessThan(
      TURN_READER_V41.template.indexOf("{{"),
    );
    for (const said of ["show my work", "what's Q doing"]) {
      expect(TURN_READER_V41_DESTINATIONS).toContain(said);
    }
  });

  it("reads WORK as a navigation", () => {
    const read = TurnReaderV40ResultSchema.parse({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: { kind: "NAVIGATE", destination: "WORK" },
    });
    expect(read.tool?.destination).toBe("WORK");
  });
});
