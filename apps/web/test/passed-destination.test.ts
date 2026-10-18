import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import { destinationPath } from "../src/features/voice/destinations";

/** TURN_READER v29 PASSED, end to end: the contract, then the route. */
describe("PASSED navigation", () => {
  it("is a contract destination and opens /discover/passed", () => {
    expect(Q_NAVIGATE_DESTINATIONS).toContain("PASSED");
    expect(destinationPath("PASSED")).toBe("/discover/passed");
  });
});
