import { describe, expect, it } from "vitest";

import type { AnalysisDocumentResult } from "@capital-q/q-core";

import {
  analysisContent,
  SET_ASIDE_HEADING,
  withoutNamesakeCitations,
  type AnalysisFact,
  type AnalysisSource,
} from "../src/composition/workforce/analysis.js";
import { namesakeSources } from "../src/composition/workforce/subject-identity.js";

/**
 * Live 2026-10-31 (production 656719a90, investor "Write me an IC memo on
 * Clearwater Assurance"): the research found only two pages, both about
 * namesakes -- Clearwater UW Limited at Companies House (S1) and a
 * Clearwater Underwriting page (S2). The filed memo listed both under
 * "Public sources this document cites" (labelled not used), and its first
 * risk read "The relationship to Clearwater Assurance is unknown." -- the
 * sentence that named the namesakes had been removed from under it.
 */
const subject = { name: "Clearwater Assurance" };

const S1: AnalysisSource = {
  index: 1,
  url: "https://find-and-update.company-information.service.gov.uk/company/14814511",
  domain: "find-and-update.company-information.service.gov.uk",
  title:
    "CLEARWATER UW LIMITED overview - Find and update company information - GOV.UK",
  publishedAt: null,
  tier: "PRIMARY",
  tierKind: null,
};
const S2: AnalysisSource = {
  index: 2,
  url: "https://whowritesthis.co.uk/market/clearwater-underwriting",
  domain: "whowritesthis.co.uk",
  title: "Clearwater Underwriting: how to trade | Who writes this?",
  publishedAt: "2026-10-13",
  tier: "OTHER",
  tierKind: null,
};

function fact(
  at: AnalysisSource,
  entity: string,
  statement: string,
): AnalysisFact {
  return {
    id: `F${String(at.index)}`,
    statement,
    figure: null,
    asOf: null,
    source: at.index,
    lane: "COMPANY",
    kind: "FACT",
    domain: at.domain,
    title: at.title,
    url: at.url,
    publishedAt: at.publishedAt,
    measure: null,
    entity,
    tier: at.tier,
    tierKind: at.tierKind,
    evidenceStatus: "DOCUMENT_SUPPORTED",
    lifecycleStatus: "CURRENT",
    corroboratedBy: [],
    contradicts: [],
  };
}

const FACTS = [
  fact(
    S1,
    "Clearwater UW Limited",
    "Clearwater UW Limited is an active private limited company incorporated in 2023.",
  ),
  fact(
    S2,
    "Clearwater Underwriting",
    "Clearwater Underwriting writes specialist insurance lines.",
  ),
];

// As the writer put it (the identity point opened the Risks list).
const RISKS = [
  "1. Entity-identity risk: Companies House lists Clearwater UW Limited [S1], and a Clearwater Underwriting business trades under a similar name [S2]. The relationship to Clearwater Assurance is unknown. The exact contracting entity must be verified before relying on any commercial claim.",
  "2. Evidence-quality risk: seven customers, £2.4m ARR and 132% NRR are company claims rather than independently evidenced figures (company record, self-reported). Their accuracy and calculation basis cannot currently be assessed.",
].join("\n");

describe("namesake citations removed whole (Clearwater memo, live 2026-10-31)", () => {
  const namesakes = namesakeSources(FACTS, subject);

  it("treats both pages as namesakes", () => {
    expect([...namesakes].sort()).toEqual([1, 2]);
  });

  it("drops a list item whose opening sentence rested on a namesake, never leaving its remainder", () => {
    const out = withoutNamesakeCitations(RISKS, namesakes);
    expect(out.text).not.toContain(
      "The relationship to Clearwater Assurance is unknown",
    );
    expect(out.text).not.toContain("exact contracting entity");
    expect(out.text).not.toMatch(/\[S[12]\]/u);
    expect(out.text).toBe(
      "2. Evidence-quality risk: seven customers, £2.4m ARR and 132% NRR are company claims rather than independently evidenced figures (company record, self-reported). Their accuracy and calculation basis cannot currently be assessed.",
    );
    expect(out.removed).toBe(1);
    expect([...out.cut].sort()).toEqual([1, 2]);
  });

  it("drops a labelled line the same way, and in a paragraph the sentence that leans on the removed one", () => {
    expect(
      withoutNamesakeCitations(
        "Identity risk: Clearwater UW Limited is registered in London [S1]. The relationship to Clearwater Assurance is unknown.",
        namesakes,
      ).text,
    ).toBe("");
    expect(
      withoutNamesakeCitations(
        "Clearwater states seven UK customers (company record, self-reported). Clearwater Underwriting writes insurance lines [S2]. This is a different business. Verify the contracting entity.",
        namesakes,
      ).text,
    ).toBe(
      "Clearwater states seven UK customers (company record, self-reported). Verify the contracting entity.",
    );
  });
});

describe("namesake pages listed apart from the sources a document cites", () => {
  const draft: AnalysisDocumentResult = {
    title: "Investment Committee Memo: Clearwater Assurance",
    summary: "Do not advance yet (company record).",
    sections: [{ heading: "Risks & red flags", body: RISKS }],
    topRecommendations: ["Verify the contracting entity."],
    gaps: [],
  };
  const content = analysisContent({
    draft,
    review: { passes: true, score: 90, drafts: 1, found: [], open: [] },
    sources: [S1, S2],
    facts: FACTS,
    seed: "job:clearwater",
    sourcesAlways: true,
    subject,
  });
  const body = (heading: string) =>
    content.sections.find((section) => section.heading === heading)?.body ?? "";

  it("never under 'sources this document cites'; under its own plain heading, right after Sources", () => {
    expect(body("Sources")).toBe("No public source is cited in this document.");
    expect(body("Sources")).not.toContain("this document cites");
    const setAside = body(SET_ASIDE_HEADING);
    expect(setAside).toMatch(
      /^Pages Q read about other organisations or subjects with names like Clearwater Assurance\. They are not evidence about Clearwater Assurance, and nothing in this document rests on them\./u,
    );
    expect(setAside).toContain("[S1] CLEARWATER UW LIMITED overview");
    expect(setAside).toContain("[S2] Clearwater Underwriting: how to trade");
    expect(setAside).not.toContain("not used as evidence");
    const headings = content.sections.map((section) => section.heading);
    expect(headings.indexOf(SET_ASIDE_HEADING)).toBe(
      headings.indexOf("Sources") + 1,
    );
    expect(body("Risks & red flags")).not.toContain(
      "The relationship to Clearwater Assurance",
    );
  });

  it("has no set-aside section when no namesake was looked at", () => {
    const plain = analysisContent({
      draft: {
        ...draft,
        sections: [{ heading: "Risks", body: "Tariffs rose [S1]." }],
      },
      review: { passes: true, score: 90, drafts: 1, found: [], open: [] },
      sources: [S1],
      facts: FACTS,
      seed: "job:none",
      subject: null,
    });
    expect(plain.sections.map((section) => section.heading)).not.toContain(
      SET_ASIDE_HEADING,
    );
  });
});

describe("research that ran reduced is said first, by code", () => {
  it("opens the first section with code's own words", () => {
    const reduced =
      "This investigation ran in a reduced form: the research plan could not be written, so it searched the request's own words as a single query instead of planned lines of enquiry. Ask again for the full investigation.";
    const content = analysisContent({
      draft: {
        title: "Investment Committee Memo: Clearwater Assurance",
        summary: "Do not advance yet.",
        sections: [
          {
            heading: "Summary & recommendation",
            body: "Do not advance yet (company record).",
          },
          {
            heading: "Team",
            body: "Claimed experience (company record, self-reported).",
          },
        ],
        topRecommendations: [],
        gaps: [],
      },
      review: { passes: true, score: 90, drafts: 1, found: [], open: [] },
      sources: [],
      facts: [],
      seed: "job:reduced",
      subject,
      reducedResearch: reduced,
    });
    expect(content.sections[0]?.body).toBe(
      `${reduced}\n\nDo not advance yet (company record).`,
    );
    expect(content.sections[1]?.body).not.toContain("reduced form");
  });
});
