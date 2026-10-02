import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import {
  createDefaultPromptRegistry,
  TURN_READER_V16,
  TURN_READER_V17,
} from "../src/index.js";

/**
 * TURN_READER v17 (founder direction 2026-09-30: "Q can take me
 * anywhere"): every screen of the app is a destination. Nothing of v16 is
 * lost.
 */
describe("TURN_READER v17", () => {
  it("is superseded by v18, which only adds a screen", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("TURN_READER").definition.version).toBe(25);
  });

  it("names every contract destination exactly once", () => {
    // REHEARSALS is named from v19 on.
    for (const destination of Q_NAVIGATE_DESTINATIONS.filter(
      (entry) =>
        entry !== "REHEARSALS" &&
        entry !== "DOCUMENTS" &&
        entry !== "DAILY" &&
        entry !== "RESULTS",
    )) {
      expect(
        // NEW_PITCH contains PITCH: a name counts only on its own.
        TURN_READER_V17.template.split(
          new RegExp(`(?<![A-Z_])${destination} \\(`),
        ).length - 1,
        destination,
      ).toBe(1);
    }
  });

  it("keeps v16's named-records rule and the rest of v16", () => {
    expect(TURN_READER_V17.template).toContain(
      "NAMED RECORDS: NAVIGATE is only for a whole screen",
    );
    expect(TURN_READER_V17.template.length).toBeGreaterThan(
      TURN_READER_V16.template.length,
    );
  });
});
