import { describe, expect, it } from "vitest";

import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolProposal,
} from "@capital-q/q-runtime";

import { namedCompanyFitLine } from "../src/q/named-fit-line.js";

import { fitFixture } from "./fit-fixture.js";

/**
 * Stress 2026-10-28 J3: "find eligible seed-stage B2B fintech
 * opportunities … and tell me whether LedgerBridge qualifies and why"
 * answered only the list. The named half is answered from Capital Q's fit.
 */
const LEDGERBRIDGE = "31633da0-87f9-4c5f-bd9a-a892a9251207";
const context = {} as QToolExecutionContext;

function toolsWith(fit: unknown) {
  const calls: string[] = [];
  return {
    calls,
    tools: {
      execute: (proposal: QToolProposal): Promise<QToolCallOutcome> => {
        calls.push(proposal.name);
        const data =
          proposal.name === "search_companies"
            ? {
                items: [
                  { companyId: LEDGERBRIDGE, canonicalName: "LedgerBridge" },
                  {
                    companyId: "deb2c676-8ef1-4411-abec-195faacc8837",
                    canonicalName: "Ledgerio Works",
                  },
                ],
              }
            : fit;
        return Promise.resolve({
          callId: proposal.callId,
          toolName: proposal.name,
          status: "SUCCEEDED",
          result: { ok: true, data },
        } as unknown as QToolCallOutcome);
      },
    },
  };
}

const available = new Set(["search_companies", "fit_profile"]);

describe("whether a named company qualifies", () => {
  it("says the criteria met, missed and unknown from Capital Q's fit", async () => {
    const { tools } = toolsWith(
      fitFixture(LEDGERBRIDGE, "LedgerBridge", {
        STAGE: "STRONG",
        SECTOR: "STRONG",
        GEOGRAPHY: "STRONG",
        BUSINESS_MODEL: "MISMATCH",
      }).result.data,
    );
    const line =
      (await namedCompanyFitLine({
        name: "LedgerBridge",
        tools,
        context,
        available,
      })) ?? "";
    expect(line).toMatch(/^LedgerBridge: Capital Q mandate fit/u);
    expect(line).toMatch(/It meets your mandate on stage, sector, geography/u);
    expect(line).toMatch(/It misses on business model \(/u);
    expect(line).toMatch(/Not known yet: .*unknown is not a mismatch/u);
  });

  it("says plainly when Capital Q has no fit it can show, never a guess", async () => {
    const { tools } = toolsWith({
      status: "NOT_FOUND",
      name: null,
      profile: null,
      text: "That company is not one you can see a fit for.",
      guidance: "",
    });
    const line =
      (await namedCompanyFitLine({
        name: "LedgerBridge",
        tools,
        context,
        available,
      })) ?? "";
    expect(line).toMatch(/LedgerBridge is not in this ranking/u);
    expect(line).toMatch(/can't be confirmed/u);
  });
});

// Stress 2026-10-28 (J3): not in Discover, so no ranked fit; the line is
// their declared mandate against its record, by code, with what is unknown.
describe("a named company with no ranked fit, against the declared mandate", () => {
  const MANDATE = {
    mandates: [
      {
        status: "ACTIVE",
        stage: { minStageCode: "seed", maxStageCode: "seed" },
        taxonomyPreferences: [
          {
            vocabularyCode: "geography",
            canonicalCode: "nigeria",
            isExclusion: false,
          },
          {
            vocabularyCode: "geography",
            canonicalCode: "kenya",
            isExclusion: false,
          },
          {
            vocabularyCode: "industry",
            canonicalCode: "fintech",
            isExclusion: false,
          },
          {
            vocabularyCode: "industry",
            canonicalCode: "payments",
            isExclusion: false,
          },
          {
            vocabularyCode: "industry",
            canonicalCode: "digital_lending",
            isExclusion: true,
          },
        ],
      },
    ],
  };
  const COMPANY_RECORD = {
    companyId: LEDGERBRIDGE,
    canonicalName: "LedgerBridge",
    currentStageCode: "seed",
    headquartersCountry: "NG",
  };
  function toolsFor(company: unknown) {
    const calls: string[] = [];
    return {
      calls,
      tools: {
        execute: (proposal: QToolProposal): Promise<QToolCallOutcome> => {
          calls.push(proposal.name);
          const data =
            proposal.name === "search_companies"
              ? {
                  items: [
                    { companyId: LEDGERBRIDGE, canonicalName: "LedgerBridge" },
                  ],
                }
              : proposal.name === "get_company"
                ? company
                : {
                    status: "NOT_FOUND",
                    name: null,
                    profile: null,
                    text: "",
                    guidance: "",
                  };
          return Promise.resolve({
            callId: proposal.callId,
            toolName: proposal.name,
            status: "SUCCEEDED",
            result: { ok: true, data },
          } as unknown as QToolCallOutcome);
        },
      },
    };
  }
  const withCompany = new Set([
    "search_companies",
    "fit_profile",
    "get_company",
  ]);

  it("checks stage and geography, and says sector is not known", async () => {
    const { tools, calls } = toolsFor(COMPANY_RECORD);
    const line =
      (await namedCompanyFitLine({
        name: "LedgerBridge",
        tools,
        context,
        available: withCompany,
        mandate: MANDATE,
      })) ?? "";
    expect(calls).toContain("get_company");
    expect(line).toMatch(/not in your ranked recommendations yet/u);
    expect(line).toMatch(
      /it meets stage \(seed\) and geography \(based in Nigeria\)/u,
    );
    expect(line).toMatch(
      /Not known: its sector against yours \(fintech, payments; your exclusion: digital lending\)/u,
    );
    expect(line).toMatch(/Unknown is not a mismatch/u);
    expect(line).not.toMatch(/\/10/u);
  });

  it("says what misses, never a score", async () => {
    const { tools } = toolsFor({
      ...COMPANY_RECORD,
      currentStageCode: "series_a",
      headquartersCountry: "ZA",
    });
    const line =
      (await namedCompanyFitLine({
        name: "LedgerBridge",
        tools,
        context,
        available: withCompany,
        mandate: MANDATE,
      })) ?? "";
    expect(line).toMatch(
      /It misses on stage \(series a; your mandate is seed\) and geography \(based in South Africa\)/u,
    );
  });

  it("keeps the plain line without their mandate", async () => {
    const { tools } = toolsFor(COMPANY_RECORD);
    const line =
      (await namedCompanyFitLine({
        name: "LedgerBridge",
        tools,
        context,
        available: withCompany,
      })) ?? "";
    expect(line).toMatch(/LedgerBridge is not in this ranking/u);
  });
});
