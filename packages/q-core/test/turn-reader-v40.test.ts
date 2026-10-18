import { describe, expect, it } from "vitest";

import { READER_DESTINATIONS as Q_NAVIGATE_DESTINATIONS } from "./reader-destinations.js";

import {
  createDefaultPromptRegistry,
  TURN_READER_V39,
  TURN_READER_V38_DESTINATIONS,
  TURN_READER_V40,
  TURN_READER_V40_DESTINATIONS,
  TURN_READER_V40_REFERENCES,
  TurnReaderV40ResultSchema,
} from "../src/index.js";

/**
 * TURN_READER v40 (follow-55, Zino live 2026-10-04): the one record a turn
 * asks to open, and a request to repeat Q's last action.
 */
describe("TURN_READER v40", () => {
  it("v39 is deprecated (v41 is active)", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBeGreaterThanOrEqual(40);
    expect(TURN_READER_V39.status).toBe("DEPRECATED");
  });

  it("names every contract destination exactly once, YOUR_COMPANIES included", () => {
    // WORK arrived with v41.
    for (const destination of [
      ...Q_NAVIGATE_DESTINATIONS.filter((name) => name !== "WORK"),
      "RESULTS",
    ]) {
      expect(
        TURN_READER_V40.template.split(
          new RegExp(`(?<![A-Z_])${destination} \\(`),
        ).length - 1,
        destination,
      ).toBe(1);
    }
  });

  it("adds only the REFERENCE words and the YOUR_COMPANIES screen, in the static prefix before every per-turn value", () => {
    expect(
      TURN_READER_V40.template
        .replace(TURN_READER_V40_REFERENCES, "")
        .replace(TURN_READER_V40_DESTINATIONS, TURN_READER_V38_DESTINATIONS),
    ).toBe(TURN_READER_V39.template);
    expect(TURN_READER_V40.template.indexOf("YOUR_COMPANIES (")).toBeLessThan(
      TURN_READER_V40.template.indexOf("{{"),
    );
    expect(TURN_READER_V40.template.indexOf("REFERENCE (")).toBeLessThan(
      TURN_READER_V40.template.indexOf("{{"),
    );
    // The founder's own phrasings are in it.
    for (const said of [
      "open the questions for Priya",
      "try again",
      "same for X",
    ]) {
      expect(TURN_READER_V40_REFERENCES).toContain(said);
    }
  });

  it("reads a reference, and an older reading without one still parses", () => {
    const base = {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
    };
    expect(TurnReaderV40ResultSchema.parse(base).reference).toBeNull();
    const read = TurnReaderV40ResultSchema.parse({
      ...base,
      reference: { open: "DOCUMENT", shown: 1, retryLast: false },
    });
    expect(read.reference).toEqual({
      open: "DOCUMENT",
      name: null,
      shown: 1,
      retryLast: false,
      sameFor: null,
    });
    expect(
      TurnReaderV40ResultSchema.safeParse({
        ...base,
        reference: { open: "SCREEN" },
      }).success,
    ).toBe(false);
  });
});
