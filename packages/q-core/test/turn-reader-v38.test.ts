import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import {
  createDefaultPromptRegistry,
  TURN_READER_V37,
  TURN_READER_V38,
} from "../src/index.js";

/** TURN_READER v38 (lead 2026-10-03): USAGE, Settings → Usage, is a destination. */
describe("TURN_READER v38", () => {
  it("is the active reader", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(38);
  });

  it("names every contract destination exactly once, USAGE included", () => {
    expect(Q_NAVIGATE_DESTINATIONS).toContain("USAGE");
    for (const destination of [...Q_NAVIGATE_DESTINATIONS, "RESULTS"]) {
      expect(
        TURN_READER_V38.template.split(
          new RegExp(`(?<![A-Z_])${destination} \\(`),
        ).length - 1,
        destination,
      ).toBe(1);
    }
  });

  it("changes only the destinations line, in the static prefix", () => {
    const before = TURN_READER_V37.template.split("\n");
    const after = TURN_READER_V38.template.split("\n");
    expect(after).toHaveLength(before.length);
    const changed = after.filter((line, index) => line !== before[index]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("USAGE (");
    // Static prefix: the change sits before the first variable.
    const firstVariable = TURN_READER_V38.template.indexOf("{{");
    expect(TURN_READER_V38.template.indexOf("USAGE (")).toBeLessThan(
      firstVariable,
    );
  });
});
