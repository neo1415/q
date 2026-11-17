import { describe, expect, it } from "vitest";

import { shapeCompanyFigures } from "@capital-q/q-tools";

import { revenueStateOf } from "../src/q/list-conditions.js";

/**
 * The claim shapes scripts/seed/evidence/revenue-claims.mjs writes, read
 * the way an investor's Q reads them: through read_company_figures'
 * shaping (network scopes only) and then revenueStateOf. The literals
 * below are the seed's exact output (pinned on the seed side by
 * apps/workers/test/demo-revenue-claims.test.ts).
 */
const COMPANY = "00000000-0000-4000-8000-0000000000e1";
const NETWORK = ["network_visible", "public_external"] as const;

function claim(
  claimKey: string,
  structuredValue: Readonly<Record<string, unknown>>,
  visibilityScope = "network_visible",
) {
  return {
    claimKey,
    statement: "Demo: revenue (Demonstration data).",
    structuredValue,
    validFrom: "2026-10-31T00:00:00+00:00",
    truthClass: "USER_CLAIM",
    evidenceStatus: "DOCUMENT_SUPPORTED",
    lifecycleStatus: "CURRENT",
    visibilityScope,
    sensitivityClass: "NETWORK_VISIBLE",
  };
}

const MONTHLY = claim("financial.monthly_revenue", {
  kind: "MONEY",
  amount: "10183680",
  currency: "NGN",
  asOf: "2026-10-31",
});
const PRE = claim("financial.revenue_status", {
  kind: "STATUS",
  code: "PRE_REVENUE",
  asOf: "2026-10-31",
});

const stateFor = (figures: readonly ReturnType<typeof claim>[]) =>
  revenueStateOf(
    shapeCompanyFigures(COMPANY, figures, NETWORK, "NETWORK_VISIBLE"),
  );

describe("seeded document revenue claims, as an investor's Q reads them", () => {
  it("a stated monthly revenue above zero is HAS_REVENUE", () => {
    expect(stateFor([MONTHLY])).toBe("HAS_REVENUE");
  });

  it("a stated pre-revenue status is PRE_REVENUE", () => {
    expect(stateFor([PRE])).toBe("PRE_REVENUE");
  });

  it("both at once contradict each other and stay UNKNOWN", () => {
    expect(stateFor([MONTHLY, PRE])).toBe("UNKNOWN");
  });

  it("the same figure held at the document's own private scope never reaches an investor", () => {
    expect(
      stateFor([
        claim(
          "financial.monthly_revenue",
          MONTHLY.structuredValue,
          "organisation_private",
        ),
        claim(
          "financial.revenue_status",
          PRE.structuredValue,
          "specifically_shared",
        ),
      ]),
    ).toBe("UNKNOWN");
  });
});
