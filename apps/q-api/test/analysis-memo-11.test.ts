import { describe, expect, it } from "vitest";

import type { AnalysisDocumentResult } from "@capital-q/q-core";

import {
  analysisContent,
  investigationGaps,
  investigationReduced,
  mandateLabels,
  type AnalysisFact,
  type AnalysisSource,
} from "../src/composition/workforce/analysis.js";
import type { InvestigationSummary } from "../src/composition/workforce/deep-research.js";
import {
  deliveryText,
  withoutSourceIds,
} from "../src/composition/workforce/delivery.js";
import {
  mandateAmounts,
  MANDATES_LINE,
} from "../src/composition/workforce/own-context.js";
import {
  isSubjectSite,
  namesakeSources,
} from "../src/composition/workforce/subject-identity.js";

/**
 * Live 2026-10-31 (production 857aa249a, investor Fjordlight Harbour
 * Capital: "Write me an IC memo on Ferrolith"). The record: Ferrolith,
 * ferrolith.example, sodium-ion cells for stationary storage. The memo
 * filed ferrolith.org (a C++/CUDA micromagnetics library) as "primary:
 * Ferrolith's own disclosure, its claim" and cited it in Team; cited the
 * Europe ferroalloys (S11) and Germany ferro-manganese (S16) market pages;
 * said four lines of enquiry "could not be searched" only in Not known;
 * labelled the investor's own cheque range "(company record)"; and Q's
 * chat line said "S9 source-association verification".
 */
const FERROLITH = {
  name: "Ferrolith",
  site: "https://ferrolith.example",
  profile:
    "Ferrolith makes sodium-ion battery cells designed for stationary storage, where cost, safety and cycle life matter more than weight. Its cells use abundant materials, contain no lithium, cobalt or nickel, and are much harder to set on fire than lithium-ion cells. Cells have been validated past 4,000 cycles; a pilot line in Munich produces 40 MWh a year, and storage integrators have signed letters of intent for 1.2 GWh. Ferrolith sells cells and licenses its process to storage integrators, and is raising €25m to build its first production line.",
};

const S9: AnalysisSource = {
  index: 9,
  url: "https://www.ferrolith.org/",
  domain: "ferrolith.org",
  title: "Ferrolith | ferrolith",
  publishedAt: null,
  tier: "PRIMARY",
  tierKind: "COMPANY_DISCLOSURE",
};
const S11: AnalysisSource = {
  index: 11,
  url: "https://www.marketdataforecast.com/market-reports/europe-ferroalloys-market",
  domain: "marketdataforecast.com",
  title: "Europe Ferroalloys Market Size, Share & Growth Report, 2034",
  publishedAt: "2025-12-11",
  tier: "OTHER",
  tierKind: null,
};
const S12: AnalysisSource = {
  index: 12,
  url: "https://www.bmp.com/en/2026/03/03/decarbonising-the-lime-and-cement-industry-litherm-closes-e6-5-million-seed-financing-round/",
  domain: "bmp.com",
  title: "Litherm – €6.5 Million Seed Financing",
  publishedAt: "2026-03-03",
  tier: "OTHER",
  tierKind: null,
};
const S16: AnalysisSource = {
  index: 16,
  url: "https://www.grandviewresearch.com/horizon/outlook/ferro-manganese-market/germany",
  domain: "grandviewresearch.com",
  title: "Germany Ferro Manganese Market Outlook, 2033",
  publishedAt: "2026-07-06",
  tier: "OTHER",
  tierKind: null,
};
const S1: AnalysisSource = {
  index: 1,
  url: "https://www.linkedin.com/company/ferroli",
  domain: "linkedin.com",
  title: "Ferroli Group | LinkedIn",
  publishedAt: null,
  tier: "OTHER",
  tierKind: null,
};

let id = 0;
function fact(
  at: AnalysisSource,
  entity: string,
  statement: string,
  figure: string | null = null,
): AnalysisFact {
  id += 1;
  return {
    id: `F${String(id)}`,
    statement,
    figure,
    asOf: null,
    source: at.index,
    lane: "FOUNDERS_TEAM",
    kind: figure === null ? "FACT" : "FIGURE",
    domain: at.domain,
    title: at.title,
    url: at.url,
    publishedAt: at.publishedAt,
    measure: null,
    entity,
    tier: at.tier,
    tierKind: at.tierKind,
    evidenceStatus:
      at.tierKind === "COMPANY_DISCLOSURE"
        ? "SELF_REPORTED"
        : "DOCUMENT_SUPPORTED",
    lifecycleStatus: "CURRENT",
    corroboratedBy: [],
    contradicts: [],
  };
}

// The stored facts, as the live dossier holds them.
const FACTS: AnalysisFact[] = [
  fact(
    S9,
    "Ferrolith",
    "Ferrolith is described as a standalone C++17/CUDA library for computing the demagnetizing field on tetrahedral finite-element meshes; the page does not identify a German founding team or founders.",
  ),
  fact(
    S9,
    "Ferrolith",
    "Ferrolith implements the Fredkin-Koehler scalar potential decomposition with FEM-BEM coupling and is described as fully GPU-accelerated via cuSPARSE and AMGCL.",
  ),
  fact(
    S9,
    "Ferrolith",
    "Ferrolith provides a Python interface via pybind11 with NumPy array interoperation.",
  ),
  fact(
    S11,
    "Europe ferroalloys market",
    "Europe's ferroalloys market is estimated at USD 19.08 billion in 2026, according to Market Data Forecast.",
    "USD 19.08 billion",
  ),
  fact(
    S11,
    "Europe ferroalloys market",
    "Europe's ferroalloys market growth is described as driven by demand for high-performance steel, industrial manufacturing, and investments in automotive, construction and energy infrastructure.",
  ),
  fact(
    S16,
    "Germany ferro manganese market",
    "Germany's ferro manganese market revenue was estimated at $759.6 million in 2026.",
    "$759.6 million",
  ),
  fact(
    S12,
    "Litherm",
    "Litherm closed a €6.5 million seed financing round to decarbonise the lime and cement industry.",
    "€6.5 million",
  ),
  fact(S1, "Ferroli Group", "Ferroli Group makes heating and boilers."),
];

describe("only the record's site is the company's own (Ferrolith, live 2026-10-31)", () => {
  it("ferrolith.org is not Ferrolith's site: its record names ferrolith.example", () => {
    expect(isSubjectSite("ferrolith.org", FERROLITH)).toBe(false);
    expect(isSubjectSite("www.ferrolith.example", FERROLITH)).toBe(true);
    // Without a recorded site, the name is all there is (unchanged).
    expect(isSubjectSite("ferrolith.org", { name: "Ferrolith" })).toBe(true);
  });

  it("judges the same-name software page, the ferro-alloy market pages and Ferroli as not about Ferrolith; keeps a competitor", () => {
    const namesakes = namesakeSources(FACTS, FERROLITH);
    expect([...namesakes].sort((a, b) => a - b)).toEqual([1, 9, 11, 16]);
    expect(namesakes.has(12)).toBe(false);
  });

  it("unknown stays unknown: no recorded site or description, no judgement of those pages", () => {
    const loose = namesakeSources(FACTS, { name: "Ferrolith" });
    expect(loose.has(9)).toBe(false);
    expect(loose.has(11)).toBe(false);
    expect(loose.has(16)).toBe(false);
  });

  it("a market page whose name-like word the subject's own description uses stays", () => {
    const market: AnalysisSource = {
      ...S11,
      index: 30,
      title: "Europe Solar Market Size Report",
      domain: "example-research.com",
    };
    const solar = {
      name: "Solarix",
      site: "https://solarix.example",
      profile: "Solarix installs rooftop solar systems for small businesses.",
    };
    expect(
      namesakeSources(
        [fact(market, "Europe solar market", "Europe's solar market grew.")],
        solar,
      ).size,
    ).toBe(0);
  });

  const draft: AnalysisDocumentResult = {
    title: "Ferrolith — Investment Committee Due-Diligence Memo",
    summary:
      "Ferrolith should not proceed to investment approval at this stage.",
    sections: [
      {
        heading: "Team",
        body: "The company record names no founders (company record, self-reported). A Capital Q record describes Ferrolith as a sodium-ion cell company (Capital Q record). The page does not identify a German founding team or battery-company leadership [S9].",
      },
      {
        heading: "Market",
        body: "The relevant market is sodium-ion cells for stationary energy storage. Europe’s ferroalloys market is estimated at USD 19.08 billion in 2026 [S11]; Germany’s ferro-manganese market is estimated at $759.6 million in 2026 [S16]. Litherm raised €6.5 million [S12].",
      },
    ],
    topRecommendations: [],
    gaps: [],
  };
  const content = analysisContent({
    draft,
    review: { passes: true, score: 90, drafts: 1, found: [], open: [] },
    sources: [S1, S9, S11, S12, S16],
    facts: FACTS,
    seed: "job:ferrolith",
    sourcesAlways: true,
    subject: FERROLITH,
  });
  const all = content.sections.map((section) => section.body).join("\n");
  const body = (heading: string) =>
    content.sections.find((section) => section.heading === heading)?.body ?? "";

  it("never files ferrolith.org as Ferrolith's own disclosure, nor cites it or the ferro-alloy pages", () => {
    expect(all).not.toContain("Ferrolith's own disclosure");
    expect(body("Team")).not.toContain("[S9]");
    expect(body("Market")).not.toMatch(/\[S1[16]\]/u);
    expect(body("Market")).toContain("Litherm raised €6.5 million [S12].");
    expect(body("Sources")).toContain("[S12]");
    expect(body("Sources")).not.toMatch(/\[S9\]|\[S11\]|\[S16\]/u);
  });
});

describe("reduced research is raised when lines of enquiry could not be searched", () => {
  const live: InvestigationSummary = {
    rounds: 2,
    stop: "NO_NEW_QUERIES",
    open: [
      "TRACTION: could not be searched (the search provider did not answer)",
      "NEWS: could not be searched (the search provider did not answer)",
      "COMPETITORS: could not be searched (the search provider did not answer)",
      "MARKET_SIZE: could not be searched (the search provider did not answer)",
    ],
    couldNotRun: ["TRACTION", "NEWS", "COMPETITORS", "MARKET_SIZE"],
    searches: 21,
    modelCalls: 7,
    ms: 35_084,
    scope: "Scope: Germany (from F8).",
  };

  it("says so in the person's words, from the typed field", () => {
    const reduced = investigationReduced(live);
    expect(reduced).toBe(
      "This investigation ran in a reduced form: 4 lines of enquiry (traction, news, competitors and market size) could not be searched, so what only they could tell is not known. Ask again for the full investigation.",
    );
    expect((reduced ?? "").length).toBeLessThanOrEqual(400);
    expect(investigationGaps([live])[0]).toBe(reduced);
  });

  it("a plan-less reduction keeps its own reason; a full run is not reduced", () => {
    expect(investigationReduced({ ...live, reduced: "No plan." })).toBe(
      "No plan.",
    );
    expect(investigationReduced({ ...live, couldNotRun: [] })).toBeUndefined();
  });

  it("the memo's top and Q's chat line say so", () => {
    const reduced = investigationReduced(live) ?? "";
    const content = analysisContent({
      draft: {
        title: "Ferrolith — Investment Committee Due-Diligence Memo",
        summary: "No investment approval now.",
        sections: [
          { heading: "Summary & recommendation", body: "No approval now." },
        ],
        topRecommendations: [],
        gaps: [],
      },
      review: { passes: true, score: 90, drafts: 1, found: [], open: [] },
      sources: [],
      facts: [],
      seed: "job:reduced",
      subject: FERROLITH,
      reducedResearch: reduced,
    });
    expect(content.sections[0]?.body.startsWith(reduced)).toBe(true);
    const line = deliveryText({
      artifactId: "8a4f3f8e-2d47-4b55-9f3b-6f1b1e0a7c11",
      delivery: {
        title: "Ferrolith — Investment Committee Due-Diligence Memo",
        artifactType: "ANALYSIS",
        summary: "No investment approval now.",
        topRecommendations: [],
        passed: true,
        openIssues: 0,
        reducedResearch: reduced,
      },
    });
    expect(line).toContain(
      "is ready, from reduced research rather than a full investigation",
    );
    expect(line).toContain("4 lines of enquiry");
  });
});

describe("the investor's own mandate is labelled theirs", () => {
  const context = [
    'Their investor organisation (their own record, as declared): {"name":"Fjordlight Harbour Capital"}',
    `${MANDATES_LINE}{"items":[{"id":"cc53034f-fb0a-4625-abd9-7fefa3ed6cd9","name":"Primary mandate","status":"ACTIVE"}],"inForce":[{"declared":true,"cheque":{"min":"300000","max":"1500000","currency":"EUR"},"stage":{"min":"seed","max":"series_a"}}]}`,
  ].join("\n");
  const mandate = {
    amounts: mandateAmounts(context),
    subject: "Ferrolith",
  };

  it("reads the cheque amounts from the mandate line only", () => {
    expect([...mandate.amounts].sort((a, b) => a - b)).toEqual([
      300_000, 1_500_000,
    ]);
    expect(mandateAmounts(null)).toEqual([]);
  });

  it("relabels the live sentences; keeps the company's own figures as its record", () => {
    expect(
      mandateLabels(
        "The proposed financing need is €25 million (company record, self-reported), versus Fjordlight’s declared €300,000–€1.5 million cheque range and strong preference for co-investment (company record).",
        mandate,
      ),
    ).toBe(
      "The proposed financing need is €25 million (company record, self-reported), versus Fjordlight’s declared €300,000–€1.5 million cheque range and strong preference for co-investment (your mandate).",
    );
    expect(
      mandateLabels(
        "Reopen Fjordlight’s role only if a feasible co-investment allocation exists within its declared €300,000–€1.5 million range (company record).",
        mandate,
      ),
    ).toBe(
      "Reopen Fjordlight’s role only if a feasible co-investment allocation exists within its declared €300,000–€1.5 million range (your mandate).",
    );
    expect(
      mandateLabels("A cheque of €300k–€1.5m (company record).", mandate),
    ).toBe("A cheque of €300k–€1.5m (your mandate).");
    // A clause mixing the company's raise with the cheque stays as written.
    const mixed =
      "The claimed €25 million financing need exceeds the declared €300,000–€1.5 million cheque range (company record).";
    expect(mandateLabels(mixed, mandate)).toBe(mixed);
    // The subject named in the clause: its record, never relabelled.
    const named = "Ferrolith raised €300,000 in 2021 (company record).";
    expect(mandateLabels(named, mandate)).toBe(named);
    // No figure: nothing to tie it to.
    const plain = "Fjordlight prefers Germany (company record).";
    expect(mandateLabels(plain, mandate)).toBe(plain);
  });

  it("is applied to the filed memo", () => {
    const content = analysisContent({
      draft: {
        title: "Ferrolith — Investment Committee Due-Diligence Memo",
        summary: "No approval now.",
        sections: [
          {
            heading: "Summary & recommendation",
            body: "The proposed financing need is €25 million (company record, self-reported), versus Fjordlight’s declared €300,000–€1.5 million cheque range and strong preference for co-investment (company record).",
          },
        ],
        topRecommendations: [],
        gaps: [],
      },
      review: { passes: true, score: 90, drafts: 1, found: [], open: [] },
      sources: [],
      facts: [],
      seed: "job:mandate",
      subject: FERROLITH,
      mandateAmounts: mandate.amounts,
    });
    expect(content.sections[0]?.body).toContain(
      "co-investment (your mandate).",
    );
    expect(content.sections[0]?.body).toContain(
      "€25 million (company record, self-reported)",
    );
  });
});

describe("Q's chat line carries no source ids", () => {
  it("the live recommendation", () => {
    expect(
      withoutSourceIds(
        "Make no investment approval now; authorise only a limited diligence process led by the investment lead, beginning with legal-entity, domain, ownership and S9 source-association verification.",
      ),
    ).toBe(
      "Make no investment approval now; authorise only a limited diligence process led by the investment lead, beginning with legal-entity, domain, ownership and source-association verification.",
    );
  });

  it("citation groups and pointed-at ids go; words that merely contain S and digits stay", () => {
    expect(withoutSourceIds("Margins are thin [S11][S16].")).toBe(
      "Margins are thin.",
    );
    expect(withoutSourceIds("Resolve the software profile at S9 first.")).toBe(
      "Resolve the software profile first.",
    );
    expect(withoutSourceIds("Compare S11 and S16 before IC.")).toBe(
      "Compare before IC.",
    );
    expect(withoutSourceIds("Series A in 2026, 4,000 cycles.")).toBe(
      "Series A in 2026, 4,000 cycles.",
    );
  });

  it("deliveryText strips them from summary and recommendations", () => {
    const line = deliveryText({
      artifactId: "8a4f3f8e-2d47-4b55-9f3b-6f1b1e0a7c11",
      delivery: {
        title: "Ferrolith — Investment Committee Due-Diligence Memo",
        artifactType: "ANALYSIS",
        summary: "No approval until the S9 attribution is explained [S9].",
        topRecommendations: [
          "Begin with legal-entity, domain, ownership and S9 source-association verification.",
        ],
        passed: false,
        openIssues: 8,
      },
    });
    expect(line).not.toMatch(/\bS\d+\b/u);
    expect(line).toContain("ownership and source-association verification.");
  });
});
