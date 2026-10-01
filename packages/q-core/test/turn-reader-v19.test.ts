import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import {
  createDefaultPromptRegistry,
  TURN_READER_V18,
  TURN_READER_V19,
} from "../src/index.js";

/** TURN_READER v19 (REHEARSE, on HARDEN's v18): the Rehearsals screen is a destination. */
describe("TURN_READER v19", () => {
  it("stays resolvable by its exact version once v20 replaces it", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.get("TURN_READER", 19)?.definition.status).toBe(
      "DEPRECATED",
    );
  });

  it("names every contract destination of its time exactly once", () => {
    // DOCUMENTS arrived with v20.
    for (const destination of Q_NAVIGATE_DESTINATIONS.filter(
      (name) => name !== "DOCUMENTS",
    )) {
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
