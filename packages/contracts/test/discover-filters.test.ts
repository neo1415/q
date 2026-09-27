import { describe, expect, it } from "vitest";

import {
  activeDiscoverFilterCount,
  canonicalDiscoverFilters,
  DiscoveredCompanyDtoSchema,
  DiscoverFiltersQuerySchema,
  discoverFiltersToQuery,
  DiscoveryNoteDtoSchema,
  isEmptyDiscoverFilters,
  NO_DISCOVER_FILTERS,
  QClientActionIntentSchema,
  Q_CLIENT_ACTION_TOOLS,
} from "../src/index.js";

const FINTECH = "eacf7107-9af3-5b76-91a2-3c169e396347";
const BANKING = "dfcf9a70-f561-5411-bc2e-3cd3b2606425";

describe("Discover filter query parameters", () => {
  it("parses nothing to no filters", () => {
    const parsed = DiscoverFiltersQuerySchema.parse({});
    expect(parsed).toEqual(NO_DISCOVER_FILTERS);
    expect(isEmptyDiscoverFilters(parsed)).toBe(true);
  });

  it("parses lists, flags and a raise range, canonically", () => {
    const parsed = DiscoverFiltersQuerySchema.parse({
      sector: `${FINTECH},${BANKING},${FINTECH}`,
      stage: "seed,pre_seed",
      country: "ng,KE",
      raiseMin: "250000",
      raiseMax: "2000000.50",
      raiseCurrency: "USD",
      raiseDisclosedOnly: "false",
      verifiedOnly: "true",
      hasPitch: "true",
    });
    expect(parsed).toEqual({
      sectorNodeIds: [BANKING, FINTECH].sort(),
      stageCodes: ["pre_seed", "seed"],
      countryCodes: ["KE", "NG"],
      raise: { min: "250000", max: "2000000.50", currency: "USD" },
      raiseDisclosedOnly: false,
      verifiedOnly: true,
      hasPitch: true,
    });
    expect(activeDiscoverFilterCount(parsed)).toBe(6);
  });

  it("refuses a raise bound without a currency, a float, or a bad id", () => {
    expect(
      DiscoverFiltersQuerySchema.safeParse({ raiseMin: "100" }).success,
    ).toBe(false);
    expect(
      DiscoverFiltersQuerySchema.safeParse({
        raiseMin: "1e6",
        raiseCurrency: "USD",
      }).success,
    ).toBe(false);
    expect(
      DiscoverFiltersQuerySchema.safeParse({ sector: "fintech" }).success,
    ).toBe(false);
    expect(
      DiscoverFiltersQuerySchema.safeParse({ country: "NGA" }).success,
    ).toBe(false);
  });

  it("round-trips through the query it serialises to", () => {
    const filters = canonicalDiscoverFilters({
      ...NO_DISCOVER_FILTERS,
      sectorNodeIds: [FINTECH],
      countryCodes: ["NG"],
      raise: { min: "100000", currency: "NGN" },
      raiseDisclosedOnly: true,
    });
    const query = discoverFiltersToQuery(filters);
    expect(query).toEqual({
      sector: FINTECH,
      country: "NG",
      raiseMin: "100000",
      raiseCurrency: "NGN",
      raiseDisclosedOnly: "true",
    });
    expect(DiscoverFiltersQuerySchema.parse(query)).toEqual(filters);
    expect(discoverFiltersToQuery(NO_DISCOVER_FILTERS)).toEqual({});
  });
});

describe("the page and the Q intent carry filters", () => {
  it("a card may say which filters it was not checked against", () => {
    const card = DiscoveredCompanyDtoSchema.parse({
      companyId: FINTECH,
      canonicalName: "Acme",
      websiteUrl: null,
      headquartersCountry: null,
      currentStageCode: null,
      shortDescription: null,
      reasons: [],
      reasonCodes: [],
      filterUnknown: ["raise", "country"],
    });
    expect(card.filterUnknown).toEqual(["raise", "country"]);
    expect(DiscoveryNoteDtoSchema.parse("NONE_MATCH_FILTERS")).toBe(
      "NONE_MATCH_FILTERS",
    );
  });

  it("set_discover_filters is a client action with a strict intent", () => {
    expect(Q_CLIENT_ACTION_TOOLS).toContain("set_discover_filters");
    const intent = {
      kind: "SET_DISCOVER_FILTERS",
      sectorCodes: ["fintech"],
      stageCodes: [],
      countryCodes: ["NG"],
      raise: null,
      raiseDisclosedOnly: false,
      verifiedOnly: false,
      hasPitch: false,
    };
    expect(QClientActionIntentSchema.parse(intent)).toEqual(intent);
    expect(
      QClientActionIntentSchema.safeParse({
        ...intent,
        sectorCodes: ["Fin Tech"],
      }).success,
    ).toBe(false);
  });
});
