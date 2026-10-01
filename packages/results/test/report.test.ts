import { describe, expect, it } from "vitest";

import type { FounderResults, InvestorResults } from "@capital-q/contracts";

import { resultsCsv, resultsPdf, resultsWindow } from "../src/index.js";

const WINDOW = { from: "2026-09-02", to: "2026-10-01", label: "Last 30 days" };

const FOUNDER: FounderResults = {
  side: "FOUNDER",
  organisationName: "=Nixo",
  window: WINDOW,
  raise: {
    target: { currencyCode: "USD", amount: "2000000.00" },
    totals: [{ currencyCode: "USD", confirmed: "250000.00", soft: "100000" }],
    remaining: "1750000.00",
    inConversation: 4,
    committedInvestors: [
      {
        investorName: "Ventures Platform",
        amount: "250000.00",
        currencyCode: "USD",
        bucket: "CONFIRMED",
      },
    ],
  },
  pipeline: {
    byState: [{ state: "CONNECTED", count: 2 }],
    rows: [
      {
        investorName: "Voltron",
        state: "CONNECTED",
        since: "2026-09-20T10:00:00.000Z",
      },
    ],
  },
  engagement: {
    interestsReceived: 3,
    connections: 2,
    meetingsHeld: 1,
    profileOpens: { value: null, belowFloor: true },
    pitchWatches: { value: 5, belowFloor: false },
  },
  rehearsals: [
    {
      at: "2026-09-25T10:00:00.000Z",
      counterpart: "Kola Aina",
      outcome: "STRONG_LATER",
      score: 72,
      ratings: [{ dimension: "THE_ASK", rating: "NEEDS_WORK" }],
    },
  ],
  documents: [{ type: "PITCH_DECK", count: 2 }],
};

const INVESTOR: InvestorResults = {
  side: "INVESTOR",
  organisationName: "Ventures Platform",
  window: WINDOW,
  funnel: {
    seen: 40,
    saved: 6,
    interest: 3,
    connected: 2,
    met: 1,
    committed: 0,
  },
  meetings: {
    held: 1,
    upcoming: [{ companyName: "Nixo", startsAt: "2026-10-03T09:00:00.000Z" }],
  },
  qWork: {
    runs: [{ capability: "ANSWER", runs: 12 }],
    errands: 1,
    documents: 2,
  },
  pipelineFit: [
    {
      companyName: "Nixo",
      state: "CONNECTED",
      excluded: false,
      reasons: [{ kind: "STAGE_IN_RANGE", detail: "seed" }],
    },
    {
      companyName: "Chowdeck",
      state: "INTEREST_EXPRESSED",
      excluded: false,
      reasons: [],
    },
  ],
  hasMandate: true,
};

describe("resultsWindow", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  it("reads presets as inclusive days ending today", () => {
    expect(resultsWindow({ range: "30d" }, now)).toEqual({
      from: "2026-09-02",
      to: "2026-10-01",
      label: "Last 30 days",
    });
    expect(resultsWindow({ range: "all" }, now)).toEqual({
      from: null,
      to: "2026-10-01",
      label: "All time",
    });
    expect(resultsWindow({}, now).from).toBe("2026-09-02");
  });
  it("takes a custom range and refuses an end before the start", () => {
    expect(
      resultsWindow({ from: "2026-01-01", to: "2026-03-31" }, now).to,
    ).toBe("2026-03-31");
    expect(
      resultsWindow({ from: "2026-05-01", to: "2026-01-01" }, now).to,
    ).toBe("2026-10-01");
  });
});

describe("resultsCsv", () => {
  it("neutralises spreadsheet formulas and never shows a floored count", () => {
    const text = resultsCsv(FOUNDER);
    expect(text).toContain(`"'=Nixo"`);
    expect(text).toContain(
      `"Investor firms that opened your profile","Fewer than 3"`,
    );
    expect(text).toContain(`"Confirmed","USD 250,000"`);
    expect(text).toContain(`"Ventures Platform","USD 250,000","Confirmed"`);
  });
  it("says why a pipeline company shows no fit, without calling it a poor fit", () => {
    const text = resultsCsv(INVESTOR);
    expect(text).toContain(`"Nixo","Connected","Stage in range: seed"`);
    expect(text).toContain(
      `"Chowdeck","Interest expressed","No declared overlap yet"`,
    );
  });
});

describe("resultsPdf", () => {
  it("renders a PDF for each side", async () => {
    for (const results of [FOUNDER, INVESTOR]) {
      const bytes = await resultsPdf(results, "1 October 2026");
      expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(1000);
    }
  });
});
