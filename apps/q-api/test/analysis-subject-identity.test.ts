import { describe, expect, it } from "vitest";

import type { AnalysisDocumentResult } from "@capital-q/q-core";

import {
  analysisContent,
  type AnalysisFact,
  type AnalysisSource,
} from "../src/composition/workforce/analysis.js";
import {
  namesakeSources,
  nameWords,
} from "../src/composition/workforce/subject-identity.js";

/**
 * Live 2026-10-31 (production 2e79954fd, fresh investor "Lauwersmeer
 * Capital", IC memo on "Silo Credit"): the memo said the public research
 * concerned unrelated Silo-branded businesses and excluded them, yet every
 * finding it listed came from their pages, each labelled "user claim ·
 * self reported" -- read as Silo Credit's own claims. The facts and
 * sources below are the live dossier's (entities, domains, tiers and
 * statements as stored), plus a page on the subject's own site and a
 * competitor's, which the live run did not find.
 */

type Tier = "PRIMARY" | "SECONDARY" | "OTHER";

function source(
  index: number,
  domain: string,
  title: string,
  tier: Tier,
  own = false,
): AnalysisSource {
  return {
    index,
    url: `https://${domain}/`,
    domain,
    title,
    publishedAt: null,
    tier,
    tierKind: own ? "COMPANY_DISCLOSURE" : null,
  };
}

let next = 0;
function fact(
  at: AnalysisSource,
  entity: string | null,
  statement: string,
  lane: string,
): AnalysisFact {
  next += 1;
  const own = at.tierKind === "COMPANY_DISCLOSURE";
  return {
    id: `F${String(next)}`,
    statement,
    figure: null,
    asOf: null,
    source: at.index,
    lane,
    kind: "FACT",
    domain: at.domain,
    title: at.title,
    url: at.url,
    publishedAt: null,
    measure: null,
    entity,
    tier: at.tier,
    tierKind: at.tierKind,
    evidenceStatus: own ? "SELF_REPORTED" : "DOCUMENT_SUPPORTED",
    lifecycleStatus: "CURRENT",
    corroboratedBy: [],
    contradicts: [],
  };
}

const S3 = source(
  3,
  "silo.finance",
  "Silo v3: Isolated Lending, Higher Yield & Lender Protection",
  "PRIMARY",
  true,
);
const S10 = source(
  10,
  "startupintros.com",
  "Silo: Funding, Team & Investors",
  "OTHER",
);
const S16 = source(
  16,
  "silogroup.co",
  "Institutional Partners — SILO Group",
  "PRIMARY",
  true,
);
const S33 = source(
  33,
  "defillama.com",
  "Silo Finance Protocol TVL, Revenue, & Fees - DefiLlama",
  "OTHER",
);
const S34 = source(
  34,
  "linkedin.com",
  "Akhsheiy T. - Silo Markets | LinkedIn",
  "OTHER",
);
const S36 = source(
  36,
  "silo-market.com",
  "Silomarket - Zero Waste Supermarket",
  "PRIMARY",
  true,
);
// Not in the live run: the subject's own site, a competitor, the press.
const S40 = source(
  40,
  "silocredit.ng",
  "Silo Credit — How it works",
  "PRIMARY",
  true,
);
const S41 = source(
  41,
  "afex.africa",
  "AFEX — Commodities exchange",
  "PRIMARY",
  true,
);
const S42 = source(
  42,
  "techcabal.com",
  "Grain finance in Nigeria",
  "SECONDARY",
);

const SOURCES = [S3, S10, S16, S33, S34, S36, S40, S41, S42];

const FACTS: readonly AnalysisFact[] = [
  fact(
    S10,
    "Silo",
    "Silo, headquartered in San Francisco, had raised $204.0M across 5 funding rounds by July 13, 2026, according to Startup Intros.",
    "FUNDING",
  ),
  fact(
    S16,
    "SILO Group",
    "SILО Group says it works with licensed firms, broker-dealers, private banks, legal advisors, accounting firms, and selected institutional counterparties.",
    "CUSTOMERS",
  ),
  fact(
    S3,
    "Silo v3",
    "Silo v3 describes itself as an on-chain money market where users can earn yield and borrow against tokens.",
    "COMPETITORS",
  ),
  fact(
    S36,
    "Silomarket",
    "Silomarket presents 100% zero-waste thinking as a core operating principle.",
    "FOUNDERS_TEAM",
  ),
  fact(
    S36,
    "Conventional packaged retail",
    "Silomarket identifies transport overload, energy use, shelf inefficiency as problems of conventional packaged retail.",
    "FOUNDERS_TEAM",
  ),
  fact(
    S33,
    "Silo Finance",
    "Silo Finance had total value locked of $9.94m on the DefiLlama page accessed for this research.",
    "TRACTION",
  ),
  fact(
    S34,
    "Silo Markets",
    "Silo Markets’ public LinkedIn page says Akhsheiy T. can be introduced to 7 people at Silo Markets.",
    "FOUNDERS_TEAM",
  ),
  fact(
    S34,
    "Akhsheiy T.",
    "Akhsheiy T.'s LinkedIn page shows 1K followers and 500+ connections.",
    "FOUNDERS_TEAM",
  ),
  fact(
    S40,
    "Silo",
    "Silo says grain is graded and insured on arrival at its warehouses.",
    "PRODUCT",
  ),
  fact(
    S41,
    "AFEX",
    "AFEX says it operates warehouses across northern Nigeria.",
    "COMPETITORS",
  ),
  fact(
    S42,
    "Silo Credit",
    "TechCabal reported that Silo Credit finances grain stored in certified warehouses in Kano.",
    "MARKET",
  ),
];

const DRAFT: AnalysisDocumentResult = {
  title: "Investment Committee Memo — Silo Credit",
  summary:
    "The public research concerns unrelated Silo-branded businesses [S3][S10][S16][S36].",
  sections: [
    {
      heading: "Summary & recommendation",
      body: "The public research supplied is not usable for company validation because it concerns multiple unrelated Silo-branded businesses, including a crypto lending protocol [S3], food-supply-chain software [S10], securities-backed credit [S16] and a zero-waste retailer [S36].",
    },
    {
      heading: "Team",
      body: "Public references to Akhsheiy T. and Silo Markets do not establish any connection to Silo Credit [S34].",
    },
    {
      heading: "Competition",
      body: "Silo Finance [S33] is unrelated. AFEX runs warehouses in the north [S41]. Silo Credit grades and insures grain on arrival [S40], as the press also reported [S42].",
    },
  ],
  topRecommendations: ["Verify the entity."],
  gaps: [],
};

const REVIEW = { passes: true, score: 90, drafts: 1, found: [], open: [] };

function filed(subject: { name: string } | null) {
  return analysisContent({
    draft: DRAFT,
    review: REVIEW,
    sources: SOURCES,
    facts: FACTS,
    seed: "job:memo",
    sourcesAlways: true,
    subject,
  });
}

const findingsOf = (content: ReturnType<typeof filed>) =>
  content.sections.flatMap((section) => section.findings);

const citedIn = (statement: string) =>
  Number(/\[S(\d+)\]$/u.exec(statement)?.[1] ?? "0");

describe("an IC memo on Silo Credit (live 2026-10-31)", () => {
  it("files no finding from a namesake's page", () => {
    const findings = findingsOf(filed({ name: "Silo Credit" }));
    const sources = new Set(findings.map((one) => citedIn(one.statement)));
    for (const namesake of [3, 10, 16, 33, 34, 36])
      expect(sources.has(namesake), `S${String(namesake)}`).toBe(false);
    // The subject's own page, the competitor and the press stay.
    expect([...sources].sort((a, b) => a - b)).toEqual([40, 41, 42]);
  });

  it("only the subject's own site is its claim; every other page is external", () => {
    const findings = findingsOf(filed({ name: "Silo Credit" }));
    const by = (index: number) =>
      findings.find((one) => citedIn(one.statement) === index);
    expect(by(40)).toMatchObject({
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      confidence: "LOW",
    });
    // A competitor's own site speaks for the competitor only.
    expect(by(41)).toMatchObject({
      truthClass: "UNKNOWN",
      evidenceStatus: "DOCUMENT_SUPPORTED",
      confidence: "LOW",
    });
    expect(by(42)).toMatchObject({
      truthClass: "UNKNOWN",
      evidenceStatus: "DOCUMENT_SUPPORTED",
      confidence: "MODERATE",
    });
  });

  it("names a namesake's page as not about the subject in Sources", () => {
    const content = filed({ name: "Silo Credit" });
    const sources =
      content.sections.find((section) => section.heading === "Sources")?.body ??
      "";
    expect(sources).toMatch(
      /\[S3\][^\n]*not about Silo Credit: a different organisation/u,
    );
    expect(sources).toMatch(/\[S36\][^\n]*not about Silo Credit/u);
    expect(sources).toMatch(/\[S40\][^\n]*Silo Credit's own disclosure/u);
    expect(sources).toMatch(
      /\[S41\][^\n]*the publisher's own disclosure, its claim about itself/u,
    );
    // Never "the company's own disclosure" for someone else's site.
    expect(sources).not.toContain("the company's own disclosure");
  });

  it("without a subject, no public page is filed as anyone's claim on record", () => {
    const findings = findingsOf(filed(null));
    expect(findings.length).toBeGreaterThan(0);
    for (const one of findings) {
      expect(one.truthClass).toBe("UNKNOWN");
      expect(one.evidenceStatus).not.toBe("SELF_REPORTED");
    }
  });
});

describe("namesakes are told apart by code, from the facts' typed fields", () => {
  it("folds lookalike letters and legal forms", () => {
    expect(nameWords("SILО Group")).toEqual(["silo", "group"]);
    expect(nameWords("Silo Credit Ltd")).toEqual(["silo", "credit"]);
  });

  it("a differently named company is a competitor, never a namesake", () => {
    expect(
      namesakeSources(
        [
          {
            source: 1,
            statement: "Paystack serves 200,000 merchants.",
            domain: "paystack.com",
            title: null,
            entity: "Paystack",
            tierKind: "COMPANY_DISCLOSURE",
          },
        ],
        { name: "Flutterwave" },
      ).size,
    ).toBe(0);
  });

  it("a page naming the subject in full is about the subject", () => {
    expect(
      namesakeSources(
        [
          {
            source: 7,
            statement: "Silo is a lender in Kano.",
            domain: "news.example",
            title: "Silo Credit raises a seed round",
            entity: "Silo",
          },
        ],
        { name: "Silo Credit" },
      ).size,
    ).toBe(0);
  });
});

/**
 * Live 2026-10-31 (production 84d8ede07, fresh investor "Halvmåne
 * Partners", IC memo on "Karoo Gridworks"): Sources said [S15] (Karoo
 * Bioscience) was "not about Karoo Gridworks ... not used as evidence", yet
 * the Competition table and Risks cited it; [S4]/[S9] are pages about
 * Gridworks, a different African grid investor whose name is a PART of the
 * subject's, labelled "(other)" and filed as a competitor row. Entities and
 * domains as stored on the live job.
 */
describe("an IC memo on Karoo Gridworks (live 2026-10-31)", () => {
  const K4 = source(4, "get-invest.eu", "Gridworks - GET.invest", "OTHER");
  const K9 = source(9, "gridworkspartners.com", "Home - Gridworks", "OTHER");
  const K12 = source(12, "nersa.org.za", "Tariff decision", "PRIMARY");
  const K15 = source(
    15,
    "forum.solarmd.com",
    "Case Study: Karoo Bioscience Project EPC",
    "OTHER",
  );
  const facts = [
    fact(
      K4,
      "Gridworks",
      "Gridworks lists ticket sizes per transaction of > 10 million EUR.",
      "COMPETITORS",
    ),
    fact(
      K9,
      "Gridworks",
      "Gridworks invests in and develops electricity networks across Africa.",
      "COMPETITORS",
    ),
    fact(K12, "Eskom", "Eskom's peak tariff rose 12% in 2026.", "MARKET"),
    fact(
      K15,
      "Karoo Bioscience",
      "The Karoo Bioscience project used 1.5 MWh of lithium-ion storage.",
      "TRACTION",
    ),
  ];
  const subject = { name: "Karoo Gridworks" };

  it("a namesake whose name is part of the subject's is told from the entity field", () => {
    expect([...namesakeSources(facts, subject)].sort((a, b) => a - b)).toEqual([
      4, 9, 15,
    ]);
    // The subject's whole name, or a page naming it in full, is the subject.
    expect(
      namesakeSources(
        [
          {
            source: 2,
            statement: "Karoo Gridworks installs batteries at cold stores.",
            domain: "news.example",
            title: null,
            entity: "Gridworks",
          },
        ],
        subject,
      ).size,
    ).toBe(0);
    // A short shared word is not a name.
    expect(
      namesakeSources(
        [
          {
            source: 3,
            statement: "Grid prices rose.",
            domain: "news.example",
            title: null,
            entity: "Grid",
          },
        ],
        { name: "Karoo Grid Storage" },
      ).size,
    ).toBe(0);
  });

  it("files no citation of a namesake's page; the Sources list names it as not used", () => {
    const content = analysisContent({
      draft: {
        title: "Investment Committee Memo: Karoo Gridworks",
        summary:
          "Public research does not substantiate Karoo Gridworks [S15]. Peak tariffs rose [S12].",
        sections: [
          {
            heading: "Competition",
            body: [
              "| Company | Offer | Source |",
              "| --- | --- | --- |",
              "| Solar MD | Storage for the Karoo Bioscience Project | [S15] |",
              "| Gridworks | Equity in African networks | [S4][S9] |",
              "Gridworks is not a direct competitor [S4][S9]. Peak tariffs drive demand [S12, S15].",
            ].join("\n"),
          },
          {
            heading: "Risks",
            body: "- Traction risk: the Karoo Bioscience case names Solar MD [S15].\n- Tariff risk: tariffs rose 12% [S12].",
          },
        ],
        topRecommendations: ["Verify the entity."],
        gaps: ["Nothing ties the company to Gridworks [S4]."],
      },
      review: REVIEW,
      sources: [K4, K9, K12, K15],
      facts,
      seed: "job:karoo",
      sourcesAlways: true,
      subject,
    });
    const body = (heading: string) =>
      content.sections.find((section) => section.heading === heading)?.body ??
      "";
    for (const heading of ["Competition", "Risks"]) {
      expect(body(heading)).not.toMatch(/S(?:4|9|15)\b/u);
    }
    expect(body("Competition")).toContain("| Company | Offer | Source |");
    expect(body("Competition")).not.toContain("Gridworks |");
    expect(body("Competition")).toContain("Peak tariffs drive demand [S12].");
    expect(body("Risks")).toBe("- Tariff risk: tariffs rose 12% [S12].");
    expect(content.gaps.join("\n")).not.toMatch(/\[S(?:4|9|15)\]/u);
    expect(content.gaps[0]).toMatch(
      /^Q removed 6 statements that rested on pages about a different organisation named like Karoo Gridworks \(S4, S9, S15\)/u,
    );
    const sources = body("Sources");
    expect(sources).toMatch(
      /\[S4\][^\n]*not about Karoo Gridworks[^\n]*not used as evidence/u,
    );
    expect(sources).toMatch(/\[S9\][^\n]*not about Karoo Gridworks/u);
    expect(sources).toMatch(/\[S15\][^\n]*not about Karoo Gridworks/u);
    expect(sources).toMatch(/\[S12\]/u);
    // No finding rests on a namesake's page.
    for (const finding of content.sections.flatMap((one) => one.findings))
      expect(finding.statement).toMatch(/\[S12\]$/u);
  });
});
