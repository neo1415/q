import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import {
  createDefaultPromptRegistry,
  TURN_READER_V28,
  TURN_READER_V29,
} from "../src/index.js";

/** TURN_READER v29 (QA 2026-10-02): PASSED, the Passed list, is a destination. */
describe("TURN_READER v29", () => {
  it("is superseded by v30, which adds askedAction", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(30);
  });

  it("names every contract destination exactly once, PASSED included", () => {
    expect(Q_NAVIGATE_DESTINATIONS).toContain("PASSED");
    for (const destination of [...Q_NAVIGATE_DESTINATIONS, "RESULTS"]) {
      expect(
        TURN_READER_V29.template.split(
          new RegExp(`(?<![A-Z_])${destination} \\(`),
        ).length - 1,
        destination,
      ).toBe(1);
    }
  });

  it("loses nothing of v28 but the destinations line it extends", () => {
    for (const line of TURN_READER_V28.template.split("\n")) {
      if (line.includes("RESULTS (")) continue;
      expect(TURN_READER_V29.template).toContain(line);
    }
  });
});
