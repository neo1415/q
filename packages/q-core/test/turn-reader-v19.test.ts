import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import {
  createDefaultPromptRegistry,
  TURN_READER_V18,
  TURN_READER_V19,
} from "../src/index.js";

/** TURN_READER v19 (REHEARSE, on HARDEN's v18): the Rehearsals screen is a destination. */
describe("TURN_READER v19", () => {
  it("is the active reader", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("TURN_READER").definition.version).toBe(19);
  });

  it("names every contract destination exactly once", () => {
    for (const destination of Q_NAVIGATE_DESTINATIONS) {
      expect(
        TURN_READER_V19.template.split(
          new RegExp(`(?<![A-Z_])${destination} \\(`),
        ).length - 1,
        destination,
      ).toBe(1);
    }
  });

  it("keeps the rest of v18", () => {
    expect(TURN_READER_V19.template).toContain(
      "NAMED RECORDS: NAVIGATE is only for a whole screen",
    );
    expect(TURN_READER_V19.output).toBe(TURN_READER_V18.output);
  });
});
