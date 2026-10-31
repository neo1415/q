import { describe, expect, it } from "vitest";

import type { AnalysisDocumentResult } from "@capital-q/q-core";

import {
  analysisContent,
  basisProblems,
  foundedIssues,
  reviewOpenPoint,
  writeAnalysisWithReview,
  type AnalysisIssue,
} from "../src/composition/workforce/analysis.js";
import { createSpend } from "../src/composition/workforce/deep-research.js";
import type { WorkforceModels } from "../src/composition/workforce/models.js";

/**
 * Re-recorded case A (2026-10-29): the filed report cited [S47] and [S55]
 * with 41 sources. The reviewer had read fact numbers F47 and F55 as
 * sources, told the writer a correct citation was wrong, and that point
 * was filed in the report's gaps. Every [S n] in a filed report resolves.
 */

const SOURCES = new Set([1, 2, 31]);

const draft = (over: Partial<AnalysisDocumentResult> = {}) =>
  ({
    title: "Nigerian B2B payments",
    summary: "Moniepoint processes 800 million transactions monthly [S31].",
    sections: [
      { heading: "Competitive landscape", body: "Moniepoint leads [S31]." },
    ],
    topRecommendations: ["Verify Moniepoint's scale [S31]."],
    gaps: ["Market size is not known."],
    ...over,
  }) satisfies AnalysisDocumentResult;

const unfounded: AnalysisIssue = {
  kind: "CONTRADICTION",
  section: "Competitive landscape",
  problem:
    "The funding claim is at [S55] and the transaction claim at [S47], not [S31].",
  fix: "Correct the citations.",
};
const founded: AnalysisIssue = {
  kind: "UNSUPPORTED",
  section: "Competitive landscape",
  problem: "The scale claim rests on one secondary source [S31].",
  fix: "Say it needs verification.",
};

describe("every [S n] in a filed report resolves", () => {
  it("sends back a draft whose gaps or recommendations cite a source that does not exist", () => {
    expect(basisProblems(draft(), SOURCES)).toEqual([]);
    const problems = basisProblems(
      draft({
        gaps: ["The funding claim [S55] is unverified."],
        topRecommendations: ["Check [S47]."],
      }),
      SOURCES,
    );
    expect(problems.map((one) => [one.section, one.problem])).toEqual([
      ["Gaps", "Cites sources that do not exist: S55."],
      ["Top recommendations", "Cites sources that do not exist: S47."],
    ]);
  });

  it("drops a reviewer finding that cites a source that does not exist", () => {
    expect(foundedIssues([unfounded, founded], SOURCES)).toEqual([founded]);
  });

  it("never sends an unfounded finding to the writer nor files it in the report", async () => {
    const revisions: string[] = [];
    const models: Pick<WorkforceModels, "writeAnalysis" | "critiqueAnalysis"> =
      {
        writeAnalysis: (_who, _trace, input) => {
          revisions.push(input.revision);
          return Promise.resolve({ costUsd: 0.01, output: draft() });
        },
        critiqueAnalysis: () =>
          Promise.resolve({
            costUsd: 0.01,
            output: {
              passes: false,
              score: 60,
              issues: [unfounded, founded],
              strengths: [],
            },
          }),
      };
    const written = await writeAnalysisWithReview({
      models,
      who: { tenantId: "t", userId: "u" },
      trace: null,
      spend: createSpend(5),
      canContinue: () => Promise.resolve(true),
      inputs: {
        principalName: "the investor",
        request: "Nigerian B2B payments",
        purpose: "A report.",
        today: "2026-10-29",
        company: "",
        research: "",
        sources: "",
        sourceIndices: SOURCES,
      },
    });
    if (written === null) throw new Error("no draft");
    expect(revisions.join("\n")).not.toMatch(/S47|S55/u);
    expect(written.review.open).toEqual([founded]);
    const content = analysisContent({
      draft: written.draft,
      review: written.review,
      sources: [...SOURCES].map((index) => ({
        index,
        url: `https://example.com/${String(index)}`,
        domain: "example.com",
        title: null,
        publishedAt: null,
      })),
      facts: [],
      seed: "s",
    });
    expect(JSON.stringify(content)).not.toMatch(/\[S(47|55)\]/u);
  });
});

describe("live 2026-10-31: a quoted figure reads as words", () => {
  it("files the review's point without the writer's markdown, the model's input unchanged", () => {
    const problems = basisProblems(
      draft({
        sections: [
          {
            heading: "Summary & recommendation",
            body: "**Mandate fit:**\n- **Cheque and role:** Potential fit only if the financing accommodates a €750k–€3m co-investment.",
          },
        ],
      }),
      SOURCES,
    );
    const quoted = problems.find((one) => one.problem.includes("e.g."));
    // The model reads the sentence as it was (recorded replays).
    expect(quoted?.problem).toContain('e.g. "- **Cheque and role:**');
    if (quoted === undefined) throw new Error("no point");
    const filed = reviewOpenPoint(quoted);
    expect(filed).toContain(
      "Reviewer's open point (Summary & recommendation): 1 figure without a basis, e.g. \"Cheque and role: Potential fit",
    );
    expect(filed).not.toContain("**");
    expect(filed).not.toContain('"- ');
  });
});
