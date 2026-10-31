import { describe, expect, it } from "vitest";

import type { AnalysisDocumentResult } from "@capital-q/q-core";

import {
  analysisContent,
  SET_ASIDE_HEADING,
  type AnalysisFact,
  type AnalysisSource,
} from "../src/composition/workforce/analysis.js";
import { namesakeSources } from "../src/composition/workforce/subject-identity.js";

/**
 * Live 2026-10-31 (production f42b28f7b, IC memo on "Nixo"): a Risks bullet
 * named "unrelated entities named Nexo, ... Nixo Pest, Nixo.top" and cited
 * [S2][S7][S11][S13][S21]. S2 (a pest-device review), S11 (a Nixo.top scam
 * report) and S21 (nexo.com) are about other organisations; each named
 * "Nixo"/"Nexo" in its title, so none was judged not about the subject.
 * Titles and domains are the live Sources list's; statements are of the
 * kind those pages carry.
 */

const NIXO = {
  name: "Nixo",
  site: "https://withnixo.com",
  profile:
    "Nixo helps AI companies improve the margins and operational visibility of custom deployments and services work through software for forward-deployed engineering teams.",
};

function source(
  index: number,
  domain: string,
  title: string,
  tierKind: string | null = null,
): AnalysisSource {
  return {
    index,
    url: `https://${domain}/`,
    domain,
    title,
    publishedAt: null,
    tier: "OTHER",
    tierKind,
  } as AnalysisSource;
}

const S2 = source(
  2,
  "thebuyersreviews.com",
  "Nixo Pest Reviews 2026: A Smart Pest Solution",
);
const S4 = source(
  4,
  "startupintros.com",
  "Nixo: Funding, Team & Investors | Startup Intros",
);
const S11 = source(
  11,
  "forensiclogicinc.com",
  "Nixo.top Review: Scam Report and How to Recover Your Money - Forensic Logic Inc",
);
const S13 = source(
  13,
  "tracxn.com",
  "Nixo - 2026 Company Profile, Team & Competitors - Tracxn",
);
const S21 = source(
  21,
  "nexo.com",
  "Nexo Reaffirms EU Compliance",
  "COMPANY_DISCLOSURE",
);
const S48 = source(
  48,
  "linkedin.com",
  "Priya Khandelwal - Nixo (YC S25) | LinkedIn",
);
const SOURCES = [S2, S4, S11, S13, S21, S48];

function fact(
  id: string,
  at: AnalysisSource,
  entity: string | null,
  statement: string,
): AnalysisFact {
  return {
    id,
    statement,
    figure: null,
    asOf: null,
    source: at.index,
    lane: "CUSTOMERS",
    kind: "FACT",
    domain: at.domain,
    title: at.title,
    url: at.url,
    publishedAt: null,
    entity,
    tier: "OTHER",
    tierKind: at.tierKind,
    evidenceStatus: "DOCUMENT_SUPPORTED",
    lifecycleStatus: "CURRENT",
    corroboratedBy: [],
    contradicts: [],
  };
}

const FACTS = [
  fact(
    "F1",
    S2,
    "Nixo Pest",
    "The Nixo Pest repeller uses ultrasonic waves to drive away rodents and insects.",
  ),
  fact(
    "F2",
    S4,
    "Nixo",
    "Startup Intros describes Nixo as software for forward-deployed engineering teams.",
  ),
  fact("F3", S4, "Nixo", "Nixo raised $500,000 in one seed round."),
  fact(
    "F4",
    S11,
    "Nixo.top",
    "Nixo.top is reported as a fraudulent trading website that withheld investor withdrawals.",
  ),
  fact("F5", S13, "Nixo", "Tracxn lists Priya Khandelwal as founder of Nixo."),
  fact(
    "F6",
    S21,
    "Nexo",
    "Nexo reaffirmed its regulatory compliance for crypto lending in the EU.",
  ),
  fact("F7", S48, "Priya Khandelwal", "Priya Khandelwal founded Nixo."),
];

const DRAFT: AnalysisDocumentResult = {
  title: "Nixo — Investment Committee Memo",
  summary: "Nixo builds software for forward-deployed engineering teams [S4].",
  sections: [
    {
      heading: "Risks",
      body: [
        "- Entity disambiguation and evidence-quality risk. Public sources disagree on headquarters [S4][S13]. The research also contains unrelated entities named Nexo, Nixo Pest and Nixo.top [S2][S11][S13][S21]. None should be attributed to Nixo.",
        "- A smart pest device claims wide coverage [S2].",
      ].join("\n"),
    },
    {
      heading: "Competition",
      body: "| Company | Note |\n| --- | --- |\n| Nexo | EU-compliant lender [S21] |\n| Nixo | FDE software [S4] |",
    },
  ],
  topRecommendations: ["Verify the entity."],
  gaps: [],
};

const filed = () =>
  analysisContent({
    draft: DRAFT,
    review: { passes: true, score: 80, drafts: 1, found: [], open: [] },
    sources: SOURCES,
    facts: FACTS,
    seed: "job:memo-9",
    sourcesAlways: true,
    subject: NIXO,
    codeSections: [
      {
        heading: "Contradictions",
        body: '- [S2] thebuyersreviews.com: "covers 1,600 sq. ft." against [S4] startupintros.com: "seed round".\n- [S11] forensiclogicinc.com: "scam" against [S21] nexo.com: "compliant".',
      },
    ],
  });

const bodyOf = (content: ReturnType<typeof analysisContent>) =>
  content.sections
    .filter(
      (section) =>
        section.heading !== "Sources" && section.heading !== SET_ASIDE_HEADING,
    )
    .map((section) => section.body)
    .join("\n");

describe("namesake pages on other sites (live 2026-10-31, Nixo memo)", () => {
  it("are judged not about the subject from stored fields", () => {
    expect([...namesakeSources(FACTS, NIXO)].sort((a, b) => a - b)).toEqual([
      2, 11, 21,
    ]);
  });

  it("the directory, the tracker, the founder's profile stay", () => {
    const judged = namesakeSources(FACTS, NIXO);
    for (const kept of [4, 13, 48]) expect(judged.has(kept)).toBe(false);
  });

  it("unknown stays unknown: no recorded site or description, no judgement", () => {
    expect(namesakeSources(FACTS, { ...NIXO, site: null }).size).toBe(0);
    expect(namesakeSources(FACTS, { ...NIXO, profile: null }).size).toBe(0);
  });

  it("a page about the subject itself under a qualified name is kept", () => {
    const own = [
      fact(
        "F9",
        source(9, "techcrunch.com", "Nixo Raises Seed for Deployment Software"),
        "Nixo",
        "Nixo sells software that helps forward-deployed engineering teams run deployments.",
      ),
    ];
    expect(namesakeSources(own, NIXO).size).toBe(0);
  });

  it("the delivered memo cites none of them anywhere; the note stays uncited", () => {
    const content = filed();
    const body = bodyOf(content);
    expect(body).not.toMatch(/\[S(?:2|11|21)\]/u);
    expect(body).not.toMatch(/S(?:2|11|21)\b[^0-9]/u);
    expect(body).toContain(
      "The research also contains unrelated entities named Nexo, Nixo Pest and Nixo.top.",
    );
    expect(body).toContain(
      "Public sources disagree on headquarters [S4][S13].",
    );
    expect(body).not.toContain("smart pest device");
    expect(body).not.toContain("EU-compliant lender");
    expect(body).toContain("| Nixo | FDE software [S4] |");
    expect(body).not.toContain("forensiclogicinc");
    expect(content.gaps.join(" ")).toMatch(/S2, S11, S21/u);
  });
});
