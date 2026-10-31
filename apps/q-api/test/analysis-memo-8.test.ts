import { describe, expect, it } from "vitest";

import type { AnalysisDocumentResult } from "@capital-q/q-core";

import {
  analysisContent,
  type AnalysisFact,
  type AnalysisSource,
} from "../src/composition/workforce/analysis.js";
import { namesakeSources } from "../src/composition/workforce/subject-identity.js";

/**
 * Live 2026-10-31 (production d6f606053, fresh investor "Nordlicht Saatgut
 * Capital", IC memo on "Nixo"): the memo cited "Nixo | 24/7 Pest
 * Protection" on nixo-official.com three times as Nixo's traction, and
 * cited [S57], a source its Sources list did not hold. The S32 facts are
 * the live dossier's, as stored.
 */

const NIXO = {
  name: "Nixo",
  site: "https://withnixo.com",
  profile:
    "Nixo helps AI companies improve the margins and operational visibility of custom deployments and services work through software for forward-deployed engineering teams.",
};

function source(index: number, domain: string, title: string): AnalysisSource {
  return {
    index,
    url: `https://${domain}/`,
    domain,
    title,
    publishedAt: null,
    tier: "OTHER",
    tierKind: null,
  };
}

const S11 = source(
  11,
  "startupintros.com",
  "Nixo: Funding, Team & Investors | Startup Intros",
);
const S32 = source(32, "nixo-official.com", "Nixo | 24/7 Pest Protection");
const S48 = source(
  48,
  "linkedin.com",
  "Priya Khandelwal - Nixo (YC S25) | LinkedIn",
);
const S60 = source(60, "withnixo.com", "Nixo | Operations for FDE teams");
const SOURCES = [S11, S32, S48, S60];

function fact(
  id: string,
  at: AnalysisSource,
  entity: string | null,
  statement: string,
  extra: Partial<AnalysisFact> = {},
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
    tierKind: null,
    evidenceStatus: "DOCUMENT_SUPPORTED",
    lifecycleStatus: "CURRENT",
    corroboratedBy: [],
    contradicts: [],
    ...extra,
  };
}

const PEST = [
  fact(
    "F4",
    S32,
    "Nixo device",
    "Nixo's supplied website says one device covers up to 1,600 sq. ft. per unit.",
  ),
  fact(
    "F15",
    S32,
    "Nixo",
    "Nixo's supplied website displays a rating of 4.8/5 based on 117,243+ reviews.",
  ),
];
const FACTS = [
  fact(
    "F1",
    S11,
    "Nixo",
    "Startup Intros describes Nixo as an operations platform for forward-deployed engineering teams.",
  ),
  ...PEST,
  fact("F9", S48, "Priya Khandelwal", "Priya Khandelwal founded Nixo."),
  fact(
    "F20",
    S60,
    "Nixo",
    "Nixo runs deployments for forward-deployed engineering teams.",
  ),
];

const DRAFT: AnalysisDocumentResult = {
  title: "Nixo — Investment Committee Memo",
  summary: "Nixo is an early-stage operations platform [S11].",
  sections: [
    {
      heading: "Traction",
      body: "No revenue is evidenced. A 4.8/5 rating from 117,243+ reviews appears on a same-name site [S32]. Startup Intros lists the founders [S11].",
    },
    {
      heading: "Market",
      body: "Nordic countries share an electricity market [S11], while renewables supplied 55.1% of German consumption [S57]. Germany's grid is large [S57].",
    },
  ],
  topRecommendations: ["Verify the entity."],
  gaps: [],
};

const sourcesOf = (content: ReturnType<typeof analysisContent>) =>
  content.sections.find((section) => section.heading === "Sources")?.body ?? "";
const bodyOf = (content: ReturnType<typeof analysisContent>) =>
  content.sections
    .filter((section) => section.heading !== "Sources")
    .map((section) => section.body)
    .join("\n");

function filed(
  subject: typeof NIXO | { name: string },
  open: { section: string; problem: string }[] = [],
) {
  return analysisContent({
    draft: DRAFT,
    review: {
      passes: open.length === 0,
      score: 80,
      drafts: 2,
      found: [],
      open: open.map((one) => ({
        kind: "UNSUPPORTED" as const,
        fix: "Cite only the numbered sources given.",
        ...one,
      })),
    },
    sources: SOURCES,
    facts: FACTS,
    seed: "job:memo-8",
    sourcesAlways: true,
    subject,
  });
}

describe("an exact-name stranger's site (live 2026-10-31, Nixo)", () => {
  it("is judged not about the subject from stored fields", () => {
    expect([...namesakeSources(FACTS, NIXO)]).toEqual([32]);
  });

  it("its citations are removed and Sources names it as not used", () => {
    const content = filed(NIXO);
    expect(bodyOf(content)).not.toContain("[S32]");
    expect(bodyOf(content)).not.toContain("117,243");
    expect(sourcesOf(content)).toMatch(
      /\[S32\][^\n]*not about Nixo: a different organisation/u,
    );
    expect(content.gaps.join(" ")).toMatch(/S32/u);
  });

  it("the directory, the founder's profile and the subject's own site stay", () => {
    expect(namesakeSources(FACTS, NIXO).has(11)).toBe(false);
    expect(namesakeSources(FACTS, NIXO).has(48)).toBe(false);
    expect(namesakeSources(FACTS, NIXO).has(60)).toBe(false);
  });

  it("unknown stays unknown: no recorded site or description, no judgement", () => {
    expect(namesakeSources(FACTS, { name: "Nixo" }).size).toBe(0);
    expect(namesakeSources(FACTS, { ...NIXO, site: null }).size).toBe(0);
    expect(namesakeSources(FACTS, { ...NIXO, profile: null }).size).toBe(0);
  });

  it("a page that says too little, or shares the subject's words, is not judged", () => {
    const bare = [
      fact("F30", source(70, "nixoapp.io", "Nixo | Home"), "Nixo", "Nixo."),
    ];
    expect(namesakeSources(bare, NIXO).size).toBe(0);
    const alike = [
      fact(
        "F31",
        source(
          71,
          "nixo.ai",
          "Nixo | Deployment software for engineering teams",
        ),
        "Nixo",
        "Nixo ships software.",
      ),
    ];
    expect(namesakeSources(alike, NIXO).size).toBe(0);
  });

  it("a page another source corroborates is not judged", () => {
    const corroborated = PEST.map((one) => ({
      ...one,
      corroboratedBy: ["F1"],
    }));
    expect(namesakeSources(corroborated, NIXO).has(32)).toBe(false);
  });
});

describe("a citation of a source not in the Sources list (live 2026-10-31)", () => {
  it("is removed before delivery, with a gap line", () => {
    const content = filed(NIXO);
    const body = bodyOf(content);
    expect(body).not.toMatch(/S57/u);
    // A statement resting only on it goes; one with another source stays.
    expect(body).not.toContain("Germany's grid is large");
    expect(body).toContain(
      "Nordic countries share an electricity market [S11]",
    );
    expect(sourcesOf(content)).not.toContain("S57");
    expect(content.gaps.join(" ")).toMatch(
      /Q removed citations of S57, which is not among this document's sources, and 1 statement that rested only on it/u,
    );
  });

  it("the review's 'sources that do not exist' point no longer stands", () => {
    const content = filed(NIXO, [
      { section: "Market", problem: "Cites sources that do not exist: S57." },
    ]);
    expect(content.gaps.join(" ")).not.toContain("do not exist");
  });

  it("every citation left in the document is listed in Sources", () => {
    const content = filed({ name: "Nixo" });
    const listed = new Set(
      [...sourcesOf(content).matchAll(/^\[S(\d+)\]/gmu)].map((m) =>
        Number(m[1]),
      ),
    );
    const cited = [
      ...[bodyOf(content), ...content.gaps].join("\n").matchAll(/\[S(\d+)\]/gu),
    ].map((m) => Number(m[1]));
    for (const index of cited) expect(listed.has(index)).toBe(true);
  });
});
