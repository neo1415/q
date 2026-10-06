import { describe, expect, it } from "vitest";

import {
  CompanyClaimRequestSchema,
  DiscoverFiltersSchema,
  parseStartupDescription,
} from "../src/index.js";

describe("reading an investor's description of a startup (F3)", () => {
  it("turns the mockup's sentence into visible chips and Discover filters, deterministically", () => {
    const query = parseStartupDescription(
      "Seed fintech in Nigeria or Ghana with at least $30k monthly revenue, raising under $2M",
      [{ nodeId: "00000000-0000-4000-8000-0000000000f1", label: "Fintech" }],
    );
    expect(query.chips.map((c) => c.label)).toEqual([
      "Seed",
      "Fintech",
      "Nigeria or Ghana",
      "Raising under $2M",
      "Revenue $30k+ a month",
    ]);
    expect(query.filters.stageCodes).toEqual(["seed"]);
    expect(query.filters.countryCodes).toEqual(["NG", "GH"]);
    expect(query.filters.raise).toEqual({ max: "2000000", currency: "USD" });
    expect(query.filters.sectorNodeIds).toEqual([
      "00000000-0000-4000-8000-0000000000f1",
    ]);
    // Revenue is said back, honestly marked as something it cannot check.
    expect(query.chips.find((c) => c.dimension === "revenue")?.checkable).toBe(
      false,
    );
    expect(DiscoverFiltersSchema.safeParse(query.filters).success).toBe(true);
  });

  it("does not read pre-seed as seed, and expands a region into its countries", () => {
    const query = parseStartupDescription("pre-seed climate in East Africa");
    expect(query.filters.stageCodes).toEqual(["pre_seed"]);
    expect(query.filters.countryCodes).toEqual(["KE", "UG", "TZ", "RW", "ET"]);
    expect(query.words).toEqual(["climate"]);
  });
});

describe("a claim request (F3)", () => {
  it("names a work email exactly when that is the method", () => {
    const base = { clientRequestId: "claim-0000001" };
    expect(
      CompanyClaimRequestSchema.safeParse({
        ...base,
        method: "WORK_EMAIL",
        workEmail: "Amara@KoraHealth.ng",
      }).data?.workEmail,
    ).toBe("amara@korahealth.ng");
    expect(
      CompanyClaimRequestSchema.safeParse({ ...base, method: "WORK_EMAIL" })
        .success,
    ).toBe(false);
    expect(
      CompanyClaimRequestSchema.safeParse({
        ...base,
        method: "ASK_MEMBERS",
        workEmail: "a@b.co",
      }).success,
    ).toBe(false);
    expect(
      CompanyClaimRequestSchema.safeParse({ ...base, method: "ASK_MEMBERS" })
        .success,
    ).toBe(true);
  });
});
