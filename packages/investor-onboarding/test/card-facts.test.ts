import { describe, expect, it } from "vitest";

import { createInvestorCardFacts } from "../src/card-facts.js";

/**
 * QA F-77 (batch 9): Q called every investor's fit unknown because the Q API
 * read cards without the mandate facts. The facts builder is now shared by
 * every process that reads a card; this pins what it hands the card.
 */
const INVESTOR = "4f7c3a1e-2b5d-4c6e-8f90-1a2b3c4d5e6f";
const TENANT = "8a1b2c3d-4e5f-4a6b-9c7d-0e1f2a3b4c5d";
const FINANCIAL_SERVICES = "31a21318-4936-5c6e-9e60-ed6b35c565b6";
const GLOBAL = "6dc7d6fa-ecf9-5c7e-84a8-fe18b594ae60";

describe("an investor's card facts", () => {
  it("names the active mandate's stages, sectors and geographies", async () => {
    const facts = createInvestorCardFacts({
      tenantOf: () => Promise.resolve(TENANT),
      mandates: {
        listActiveMandates: () => Promise.resolve([{ id: "m1" }]),
        getMandate: () =>
          Promise.resolve({
            constraints: [
              {
                dimension: "stage",
                isHardExclusion: false,
                importance: "REQUIRED",
                value: { kind: "codes", values: ["seed"] },
              },
            ],
            taxonomyPreferences: [
              {
                nodeId: FINANCIAL_SERVICES,
                isExclusion: false,
                preferenceStrength: "PREFERRED",
              },
              {
                nodeId: GLOBAL,
                isExclusion: false,
                preferenceStrength: "PREFERRED",
              },
            ],
            cheque: null,
          }),
      } as never,
    });
    const read = await facts(INVESTOR);
    expect(read.mandateStages).toBe("Seed");
    expect(read.mandateSectors).toBe("Financial Services");
    expect(read.mandateGeographies).toBe("Global");
  });

  it("is empty for an investor with no active mandate", async () => {
    const facts = createInvestorCardFacts({
      tenantOf: () => Promise.resolve(TENANT),
      mandates: {
        listActiveMandates: () => Promise.resolve([]),
      } as never,
    });
    expect(await facts(INVESTOR)).toEqual({});
  });
});

describe("an investor's cheque envelope and round role (owner 2026-11-19)", () => {
  const facts = (cheque: unknown, constraints: unknown[] = []) =>
    createInvestorCardFacts({
      tenantOf: () => Promise.resolve(TENANT),
      mandates: {
        listActiveMandates: () => Promise.resolve([{ id: "m1" }]),
        getMandate: () =>
          Promise.resolve({ constraints, taxonomyPreferences: [], cheque }),
      } as never,
    })(INVESTOR);

  it("keeps both ends exact, numeric strings plus currency, never through a float", async () => {
    const read = await facts({
      currency: "USD",
      min: "250000",
      max: "2000000.50",
    });
    expect(read.chequeRange).toEqual({
      currency: "USD",
      min: "250000",
      max: "2000000.50",
    });
    expect(read.mandateChequeRange).toBe("USD 250,000 to 2,000,000.50");
  });

  it("leaves an unstated end unknown, and states nothing when neither is", async () => {
    const onlyMax = await facts({ currency: "EUR", max: "500000" });
    expect(onlyMax.chequeRange).toEqual({
      currency: "EUR",
      min: null,
      max: "500000",
    });
    expect(onlyMax.mandateChequeRange).toBe("EUR up to 500,000");
    const typicalOnly = await facts({ currency: "EUR", typical: "100000" });
    expect(typicalOnly.chequeRange).toBeNull();
    expect(typicalOnly.mandateChequeRange).toBeNull();
    expect((await facts(null)).mandateChequeRange).toBeNull();
  });

  it("names the declared role in a round, and never an avoided or excluded one", async () => {
    const read = await facts(null, [
      {
        dimension: "investment_role",
        isHardExclusion: false,
        importance: "PREFERRED",
        value: { kind: "codes", values: ["lead", "co_invest"] },
      },
      {
        dimension: "investment_role",
        isHardExclusion: true,
        importance: "REQUIRED",
        value: { kind: "codes", values: ["follow"] },
      },
    ]);
    expect(read.mandateInvestmentRole).toBe(
      "Lead rounds; Co-invest alongside a lead",
    );
  });
});
