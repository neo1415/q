import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import {
  createDefaultPromptRegistry,
  TURN_READER_V23,
  TURN_READER_V24,
  TurnReaderV24ResultSchema,
} from "../src/index.js";

// PASSED arrives with v29.
const DESTINATIONS_BEFORE_V29 = Q_NAVIGATE_DESTINATIONS.filter(
  (name) => name !== "PASSED",
);

/**
 * TURN_READER v24 (founder live 2026-10-01): speech never meant for Q --
 * a dictation to someone else, a name said to another person -- and the
 * person saying "wasn't talking to you" about what came before.
 */
describe("TURN_READER v24", () => {
  it("is the active reader and v23 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(37);
    expect(TURN_READER_V23.status).toBe("DEPRECATED");
    expect(TURN_READER_V24.status).toBe("DEPRECATED");
  });

  it("adds dictation and earlierNotForQ to the addressed line, and loses nothing of v23", () => {
    const template = TURN_READER_V24.template;
    expect(template).toContain(
      "Dictating or drafting a message for someone else",
    );
    expect(template).toContain("EARLIER NOT FOR Q: earlierNotForQ is true");
    // Everything v23 said is still said (the addressed line and the
    // destinations line only grow).
    for (const line of TURN_READER_V23.template.split("\n")) {
      if (line.startsWith("ADDRESSED:") || line.includes("DAILY (")) continue;
      expect(template).toContain(line);
    }
  });

  it("reads earlierNotForQ as false when a model leaves it out", () => {
    const parsed = TurnReaderV24ResultSchema.parse({
      kind: "SMALL_TALK",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
    });
    expect(parsed.earlierNotForQ).toBe(false);
    expect(parsed.addressedToQ).toBe(true);
  });

  it("names every contract destination exactly once, and RESULTS", () => {
    for (const destination of new Set<string>([
      ...DESTINATIONS_BEFORE_V29,
      "RESULTS",
    ])) {
      expect(
        TURN_READER_V24.template.split(
          new RegExp(`(?<![A-Z_])${destination} \\(`),
        ).length - 1,
        destination,
      ).toBe(1);
    }
  });
});
