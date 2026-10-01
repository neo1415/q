import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import {
  createDefaultPromptRegistry,
  TURN_READER_V20,
  TURN_READER_V21,
} from "../src/index.js";

/** TURN_READER v21 (DAILY, on DOCS's v20): The Q Daily is a destination. */
describe("TURN_READER v21", () => {
  it("is the active reader", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("TURN_READER").definition.version).toBe(23);
  });

  it("names every contract destination exactly once", () => {
    // RESULTS arrives with v24.
    for (const destination of Q_NAVIGATE_DESTINATIONS.filter(
      (name) => name !== "RESULTS",
    )) {
      expect(
        TURN_READER_V21.template.split(
          new RegExp(`(?<![A-Z_])${destination} \\(`),
        ).length - 1,
        destination,
      ).toBe(1);
    }
  });

  it("keeps the rest of v20 and adds only the destination", () => {
    expect(TURN_READER_V21.output).toBe(TURN_READER_V20.output);
    expect(
      TURN_READER_V21.template.replace(/, DAILY \(The Q Daily:[^)]*\)/, ""),
    ).toBe(TURN_READER_V20.template);
  });
});
