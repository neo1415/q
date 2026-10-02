import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import {
  createDefaultPromptRegistry,
  TURN_READER_V19,
  TURN_READER_V20,
} from "../src/index.js";

// PASSED arrives with v29.
const DESTINATIONS_BEFORE_V29 = Q_NAVIGATE_DESTINATIONS.filter(
  (name) => name !== "PASSED",
);

/** TURN_READER v20 (DOCS, on REHEARSE's v19): Documents is a destination. */
describe("TURN_READER v20", () => {
  it("stays resolvable by its exact version once v21 replaces it", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.get("TURN_READER", 20)?.definition.status).toBe(
      "DEPRECATED",
    );
  });

  it("names every contract destination of its time exactly once", () => {
    // DAILY arrived with v21.
    for (const destination of DESTINATIONS_BEFORE_V29.filter(
      // RESULTS arrives with v24.
      (name) => name !== "DAILY" && name !== "RESULTS",
    )) {
      expect(
        TURN_READER_V20.template.split(
          new RegExp(`(?<![A-Z_])${destination} \\(`),
        ).length - 1,
        destination,
      ).toBe(1);
    }
  });

  it("keeps the rest of v19", () => {
    expect(TURN_READER_V20.template).toContain(
      "NAMED RECORDS: NAVIGATE is only for a whole screen",
    );
    expect(TURN_READER_V20.output).toBe(TURN_READER_V19.output);
    expect(TURN_READER_V20.template.length).toBeGreaterThan(
      TURN_READER_V19.template.length,
    );
  });
});
