import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_READINESS_MARKETPLACE_READY,
  MARKETPLACE_READINESS_NOT_ASSESSED,
} from "@capital-q/contracts";

import {
  KNOWN_MARKETPLACE_READINESS_STATES,
  marketplaceParticipationOf,
} from "../src/domain/marketplace-participation.js";

describe("marketplace participation (PADL #58)", () => {
  it("not_assessed is not marketplace eligible", () => {
    expect(marketplaceParticipationOf(MARKETPLACE_READINESS_NOT_ASSESSED)).toBe(
      "NOT_ELIGIBLE",
    );
  });

  it("only marketplace_ready is eligible", () => {
    expect(
      marketplaceParticipationOf(MARKETPLACE_READINESS_MARKETPLACE_READY),
    ).toBe("ELIGIBLE");
  });

  it("a state this domain does not know fails closed", () => {
    for (const state of ["ready", "assessed", "verified", "active", ""]) {
      expect(marketplaceParticipationOf(state)).toBe("NOT_ELIGIBLE");
    }
  });

  it("the known vocabulary is exactly the three states the readiness policy writes", () => {
    expect([...KNOWN_MARKETPLACE_READINESS_STATES]).toEqual([
      "not_assessed",
      "requirements_outstanding",
      "marketplace_ready",
    ]);
    expect(marketplaceParticipationOf("requirements_outstanding")).toBe(
      "NOT_ELIGIBLE",
    );
  });
});
