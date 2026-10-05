import { describe, expect, it } from "vitest";

import type { CapitalQEvent } from "@capital-q/contracts";

import { newlyReadyCompanyOf } from "../src/network/newly-ready-company.js";

/**
 * Founder 2026-10-05: Spheros became ready at 09:53 and Zino's "express
 * interest as soon as any company matches" instruction waited until its
 * next 4-hour run. Only a transition into ready wakes instructions.
 */
const COMPANY = "e1f07c6b-834b-4fbb-8cab-b5be170f91b6";
const eventOf = (type: string, data: unknown) =>
  ({ type, data }) as unknown as CapitalQEvent<unknown>;

describe("a company that became marketplace-ready", () => {
  it("names the company when it became ready", () => {
    expect(
      newlyReadyCompanyOf(
        eventOf("core.company.marketplace_readiness_changed", {
          companyId: COMPANY,
          readinessState: "marketplace_ready",
        }),
      ),
    ).toBe(COMPANY);
  });

  it("wakes nothing when it left the marketplace, or for any other event", () => {
    expect(
      newlyReadyCompanyOf(
        eventOf("core.company.marketplace_readiness_changed", {
          companyId: COMPANY,
          readinessState: "requirements_outstanding",
        }),
      ),
    ).toBeNull();
    expect(
      newlyReadyCompanyOf(
        eventOf("core.company.visibility_changed", {
          companyId: COMPANY,
          readinessState: "marketplace_ready",
        }),
      ),
    ).toBeNull();
    expect(
      newlyReadyCompanyOf(
        eventOf("core.company.marketplace_readiness_changed", {
          companyId: "not-an-id",
          readinessState: "marketplace_ready",
        }),
      ),
    ).toBeNull();
  });
});
