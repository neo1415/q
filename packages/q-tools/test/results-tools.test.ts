import { describe, expect, it } from "vitest";

import type { ResultsDto } from "@capital-q/contracts";

import { resultsReportLinks, summariseResults } from "../src/index.js";

const WINDOW = { from: "2026-09-02", to: "2026-10-01", label: "Last 30 days" };

describe("get_my_results", () => {
  it("says a founder's raise from the read model, unknown as Not stated", () => {
    const founder: ResultsDto = {
      side: "FOUNDER",
      organisationName: "Nixo",
      window: WINDOW,
      raise: {
        target: null,
        totals: [{ currencyCode: "USD", confirmed: "250000.00", soft: "0" }],
        remaining: null,
        inConversation: 2,
        committedInvestors: [],
      },
      pipeline: {
        byState: [{ state: "CONNECTED", count: 1 }],
        rows: [
          {
            investorName: "Voltron",
            state: "CONNECTED",
            since: "2026-09-20T10:00:00.000Z",
          },
        ],
      },
      engagement: {
        interestsReceived: 1,
        connections: 1,
        meetingsHeld: 0,
        profileOpens: { value: null, belowFloor: true },
        pitchWatches: { value: 0, belowFloor: false },
      },
      rehearsals: [],
      documents: [{ type: "PITCH_DECK", count: 2 }],
    };
    const summary = summariseResults(founder);
    expect(summary.figures).toEqual(
      expect.arrayContaining([
        { label: "Target", value: "Not stated" },
        { label: "Confirmed (USD)", value: "250000.00" },
        {
          label: "Investor firms that opened the profile",
          value: "Fewer than 3",
        },
        { label: "Documents made", value: "2" },
      ]),
    );
    expect(summary.pipeline).toEqual([
      { name: "Voltron", stage: "Connected", detail: "since 2026-09-20" },
    ]);
  });

  it("never calls an unmatched pipeline company a poor fit", () => {
    const investor: ResultsDto = {
      side: "INVESTOR",
      organisationName: "Ventures Platform",
      window: WINDOW,
      funnel: {
        seen: 3,
        saved: 1,
        interest: 1,
        connected: 1,
        met: 0,
        committed: 0,
      },
      meetings: { held: 0, upcoming: [] },
      qWork: { runs: [], errands: 0, documents: 0 },
      pipelineFit: [
        {
          companyName: "Chowdeck",
          state: "CONNECTED",
          excluded: false,
          reasons: [],
        },
      ],
      hasMandate: true,
    };
    expect(summariseResults(investor).pipeline[0]?.detail).toBe(
      "no declared overlap with the mandate yet",
    );
    expect(summariseResults({ side: "NONE" }).figures).toEqual([]);
  });
});

describe("get_my_results_report", () => {
  it("links the app's own download for the asked period", () => {
    expect(resultsReportLinks({ range: "90d" })).toEqual({
      pdf: "/results/report?format=pdf&range=90d",
      csv: "/results/report?format=csv&range=90d",
    });
    expect(
      resultsReportLinks({ from: "2026-01-01", to: "2026-03-31" }).pdf,
    ).toBe("/results/report?format=pdf&from=2026-01-01&to=2026-03-31");
  });
});
