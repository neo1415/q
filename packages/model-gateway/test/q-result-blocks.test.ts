import { describe, expect, it } from "vitest";

import type { QSubjectRef } from "@capital-q/contracts";

import { analystResultBlocks } from "../src/q/result-blocks.js";

/**
 * What the analyst already produced, as blocks (QX-002/003 §C).
 *
 * The structure was there from the start and nothing surfaced it. These
 * pin the two things that make surfacing it safe: nothing is invented to
 * fill a card, and a reference names a subject the server authorised
 * rather than one a model mentioned.
 */

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const INVESTOR = "11111111-0000-4000-8000-000000000013";

const companySubject: QSubjectRef = { kind: "COMPANY", companyId: COMPANY };

const finding = (over: Record<string, unknown> = {}) => ({
  statement: "Revenue is recorded at USD 2.4m.",
  type: "FACT",
  confidence: "HIGH",
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  ...over,
});

describe("an answer with structure", () => {
  it("carries its findings, its gaps and its questions", () => {
    const blocks = analystResultBlocks({
      result: {
        findings: [finding()],
        missingEvidence: ["The burn rate is not on record."],
        contradictions: ["Two documents give different headcounts."],
        clarifyingQuestions: [{ question: "Which round did you mean?" }],
      },
      subjects: [companySubject],
    });
    expect(blocks?.map((block) => block.kind)).toEqual([
      "FINDING",
      "UNCERTAINTY",
      "UNCERTAINTY",
      "CLARIFICATION_REQUEST",
      "COMPANY_REFERENCE",
    ]);
  });

  it("says which kind of uncertainty each one is", () => {
    // Nothing found and two things disagreeing are different states, and
    // the contract has a word for each. Collapsing both to LOW would
    // throw away the only part a person can act on.
    const blocks = analystResultBlocks({
      result: {
        missingEvidence: ["Nothing on record about the team."],
        contradictions: ["The deck and the model disagree on ARR."],
      },
      subjects: [],
    });
    const uncertainties = blocks?.filter(
      (block) => block.kind === "UNCERTAINTY",
    );
    expect(uncertainties?.map((u) => u.confidence)).toEqual([
      "INSUFFICIENT_EVIDENCE",
      "CONFLICTING_EVIDENCE",
    ]);
  });
});

describe("what it will not do", () => {
  it("produces nothing when there is nothing to produce", () => {
    // A plain answer is a plain answer. The absence of a card is
    // information, not a gap to fill.
    expect(analystResultBlocks({ result: {}, subjects: [] })).toBeUndefined();
    expect(
      analystResultBlocks({
        result: { findings: [], missingEvidence: [] },
        subjects: [],
      }),
    ).toBeUndefined();
  });

  it("references only subjects the run was authorised against", () => {
    // A model that writes "Acme Corp is interesting" cannot cause a
    // reference to Acme: subjects are not something it is consulted on.
    const blocks = analystResultBlocks({
      result: { findings: [finding({ statement: "Acme Corp looks strong." })] },
      subjects: [
        { kind: "INVESTOR_ORGANISATION", investorOrganisationId: INVESTOR },
      ],
    });
    const references = blocks?.filter((block) =>
      block.kind.endsWith("_REFERENCE"),
    );
    expect(references).toHaveLength(1);
    expect(references?.[0]?.kind).toBe("INVESTOR_REFERENCE");
  });

  it("emits no subject card for a kind nothing can be done with", () => {
    // A relationship or a document has no card and no action, so a
    // rectangle for it would do nothing but take space.
    const blocks = analystResultBlocks({
      result: { findings: [finding()] },
      subjects: [
        { kind: "RELATIONSHIP", relationshipId: COMPANY },
        { kind: "DOCUMENT", documentId: COMPANY },
      ],
    });
    expect(blocks?.every((block) => block.kind === "FINDING")).toBe(true);
  });

  it("carries no evidence identifier into a client", () => {
    // The QX-001 finding: a reference is only ids, and whether somebody
    // may see the document behind one is disclosure's decision at render
    // time, not this projection's.
    const blocks = analystResultBlocks({
      result: { findings: [finding()] },
      subjects: [companySubject],
    });
    const found = blocks?.find((block) => block.kind === "FINDING");
    expect(
      found?.kind === "FINDING" ? found.finding.evidenceRefs : null,
    ).toEqual([]);
  });

  it("reads an unknown label as the weakest honest one", () => {
    // A claim whose standing cannot be read is a user claim with no
    // evidence. Never a fact, and never a guess at a stronger label.
    const blocks = analystResultBlocks({
      result: {
        findings: [
          finding({
            type: "SOMETHING_NEW",
            confidence: "VERY_SURE",
            truthClass: "TOTALLY_TRUE",
            evidenceStatus: "TRUST_ME",
          }),
        ],
      },
      subjects: [],
    });
    const found = blocks?.[0];
    if (found?.kind !== "FINDING") throw new Error("expected a finding");
    expect(found.finding.type).toBe("OBSERVATION");
    expect(found.finding.confidence).toBe("MODERATE");
    expect(found.finding.truthClass).toBe("USER_CLAIM");
    expect(found.finding.evidenceStatus).toBe("SELF_REPORTED");
  });
});

describe("a comparison as cards (v12)", () => {
  it("leads with the cards, in the order written, and adds nothing to them", () => {
    const blocks = analystResultBlocks({
      result: {
        comparisonCards: {
          title: null,
          items: [
            { name: "Zeta", subtitle: null, points: ["Not known"] },
            { name: "Alpha", subtitle: "Seed", points: ["USD 40k MRR"] },
          ],
        },
      },
      subjects: [],
    });
    expect(blocks?.[0]).toEqual({
      kind: "COMPARISON_CARDS",
      title: null,
      items: [
        { name: "Zeta", subtitle: null, points: ["Not known"] },
        { name: "Alpha", subtitle: "Seed", points: ["USD 40k MRR"] },
      ],
    });
  });

  it("produces no cards when the answer is not a comparison", () => {
    const blocks = analystResultBlocks({
      result: { comparisonCards: null, findings: [finding()] },
      subjects: [],
    });
    expect(blocks?.some((b) => b.kind === "COMPARISON_CARDS")).toBe(false);
  });
});
