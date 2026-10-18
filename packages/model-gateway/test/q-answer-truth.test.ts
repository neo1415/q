import { describe, expect, it } from "vitest";

import type { PermittedContextPlan, QSubjectRef } from "@capital-q/contracts";

import { withoutActionTalk } from "../src/q/action-talk.js";
import {
  analystResultBlocks,
  askedSubjects,
  ownInvestorOrganisationIn,
  provenanceLine,
  withoutContradictedGaps,
} from "../src/q/result-blocks.js";

/**
 * Q's answers outside the interview are truthful, sourced and continuous
 * (CQ-QX-007). Each case is a failure seen in a real browser run.
 */

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const OWN_INVESTOR = "11111111-0000-4000-8000-000000000013";
const OTHER_INVESTOR = "11111111-0000-4000-8000-000000000099";

const company: QSubjectRef = { kind: "COMPANY", companyId: COMPANY };
const ownFirm: QSubjectRef = {
  kind: "INVESTOR_ORGANISATION",
  investorOrganisationId: OWN_INVESTOR,
};

/** Only the part of a plan these read. */
const planWith = (
  scopes: readonly { kind: string; subject?: QSubjectRef }[],
): Pick<PermittedContextPlan, "scopes"> =>
  ({ scopes }) as unknown as Pick<PermittedContextPlan, "scopes">;

describe("F1: a GAP never contradicts a supported FACT in the same answer", () => {
  const computedGap = {
    type: "GAP",
    dimension: "CUSTOMERS",
    derivation: "DETERMINISTIC",
    statement:
      "Capital Q holds no authorised understanding of customers for this company. This is missing information, not a negative finding.",
    confidence: "INSUFFICIENT_EVIDENCE",
    truthClass: "UNKNOWN",
    evidenceStatus: "NO_EVIDENCE",
  };
  const documentFact = {
    type: "FACT",
    dimension: "CUSTOMERS",
    derivation: "MODEL",
    statement:
      "Mombasa Grain Millers Cooperative is the anchor customer and moves 38% of loads.",
    confidence: "MODERATE",
    truthClass: "USER_CLAIM",
    evidenceStatus: "DOCUMENT_SUPPORTED",
    sources: ["kivu-one-pager.pdf, page 1"],
  };

  it("withdraws the whole-dimension gap when the answer stands on evidence for that dimension", () => {
    const blocks = analystResultBlocks({
      result: { findings: [computedGap, documentFact] },
      subjects: [company],
    });
    const findings = (blocks ?? []).flatMap((block) =>
      block.kind === "FINDING" ? [block.finding] : [],
    );
    expect(findings.map((finding) => finding.type)).toEqual(["FACT"]);
  });

  it("keeps the gap when nothing on that dimension stands on evidence", () => {
    const unsupported = { ...documentFact, evidenceStatus: "NO_EVIDENCE" };
    expect(withoutContradictedGaps([computedGap, unsupported])).toHaveLength(2);
    const elsewhere = { ...documentFact, dimension: "TRACTION" };
    expect(withoutContradictedGaps([computedGap, elsewhere])).toHaveLength(2);
  });

  it("keeps a narrower gap the analyst wrote beside the fact", () => {
    const narrower = {
      ...computedGap,
      derivation: "MODEL",
      statement:
        "The distribution of the remaining 62% of loads is not established.",
    };
    expect(withoutContradictedGaps([narrower, documentFact])).toHaveLength(2);
  });
});

describe("F1: provenance reaches the person as the source, never an id", () => {
  it("names the document the supported findings rest on", () => {
    expect(
      provenanceLine([
        {
          type: "FACT",
          evidenceStatus: "DOCUMENT_SUPPORTED",
          sources: ["kivu-one-pager.pdf, page 1"],
        },
      ]),
    ).toBe("Source: kivu-one-pager.pdf, page 1.");
  });

  it("names each source once, and a statement the person made as theirs", () => {
    expect(
      provenanceLine([
        {
          type: "FACT",
          evidenceStatus: "DOCUMENT_SUPPORTED",
          sources: ["kivu-one-pager.pdf, page 1"],
        },
        {
          type: "OBSERVATION",
          evidenceStatus: "SELF_REPORTED",
          sources: [
            "kivu-one-pager.pdf, page 1",
            "what you told me on 24 September 2026",
          ],
        },
      ]),
    ).toBe(
      "Sources: kivu-one-pager.pdf, page 1; what you told me on 24 September 2026.",
    );
  });

  it("says nothing when no named source supports the answer", () => {
    expect(provenanceLine([])).toBeNull();
    expect(
      provenanceLine([
        { type: "GAP", evidenceStatus: "NO_EVIDENCE", sources: ["x.pdf"] },
      ]),
    ).toBeNull();
    expect(
      provenanceLine([{ type: "FACT", evidenceStatus: "DOCUMENT_SUPPORTED" }]),
    ).toBeNull();
  });

  it("never lets an evidence identifier reach the blocks", () => {
    const blocks = analystResultBlocks({
      result: {
        findings: [
          {
            type: "FACT",
            statement: "Anchor customer moves 38% of loads.",
            evidenceStatus: "DOCUMENT_SUPPORTED",
            truthClass: "USER_CLAIM",
            confidence: "MODERATE",
          },
        ],
      },
      subjects: [company],
    });
    for (const block of blocks ?? []) {
      if (block.kind === "FINDING") {
        expect(block.finding.evidenceRefs).toEqual([]);
      }
      expect(block.kind).not.toBe("EVIDENCE");
    }
  });
});

describe("no action claim survives in the model's own prose", () => {
  it("removes exactly the sentences the analyst named as talk about acting", () => {
    const answer =
      "I have noted the update to your website URL as kivu-freight.example. This is ready for your approval.\n\nYour current website on record is kivufreight.example.";
    const stripped = withoutActionTalk(answer, [
      "I have noted the update to your website URL as kivu-freight.example.",
      "This is ready for your approval.",
    ]);
    expect(stripped.removed).toBe(2);
    expect(stripped.text).toBe(
      "Your current website on record is kivufreight.example.",
    );
  });

  it("leaves the answer alone when the named sentence is not in it, or nothing was named", () => {
    const answer = "Your biggest customer moves about 38% of loads.";
    expect(withoutActionTalk(answer, []).text).toBe(answer);
    expect(withoutActionTalk(answer, undefined).text).toBe(answer);
    expect(
      withoutActionTalk(answer, ["I've prepared the deck for you."]),
    ).toEqual({ text: answer, removed: 0 });
  });

  it("keeps paragraphs and list lines intact around a removal", () => {
    const answer =
      "Got it – I'll prepare a pitch deck for Kivu Freight. Here is what is on record:\n\n- GMV USD 412,000\n- 1,140 truckers";
    const stripped = withoutActionTalk(answer, [
      "Got it – I'll prepare a pitch deck for Kivu Freight.",
    ]);
    expect(stripped.text).toBe(
      "Here is what is on record:\n\n- GMV USD 412,000\n- 1,140 truckers",
    );
  });
});

describe("fit: the person's own firm is context, proved by the plan", () => {
  it("is the organisation an INVESTOR_MANDATE scope is bound to, and nothing else", () => {
    expect(
      ownInvestorOrganisationIn(
        planWith([
          { kind: "COMPANY_PROFILE", subject: company },
          { kind: "INVESTOR_MANDATE", subject: ownFirm },
        ]),
      ),
    ).toBe(OWN_INVESTOR);
    // A declared investor subject with no mandate scope is not proof.
    expect(
      ownInvestorOrganisationIn(
        planWith([{ kind: "INVESTOR_PROFILE", subject: ownFirm }]),
      ),
    ).toBeNull();
  });

  it("is not a second subject of the question or a card under the answer", () => {
    const plan = planWith([{ kind: "INVESTOR_MANDATE", subject: ownFirm }]);
    expect(askedSubjects([company, ownFirm], plan)).toEqual([company]);
    const blocks = analystResultBlocks({
      result: {},
      subjects: askedSubjects([company, ownFirm], plan),
    });
    expect(blocks?.map((block) => block.kind)).toEqual(["COMPANY_REFERENCE"]);
  });

  it("leaves somebody else's investor organisation where it is", () => {
    const other: QSubjectRef = {
      kind: "INVESTOR_ORGANISATION",
      investorOrganisationId: OTHER_INVESTOR,
    };
    const plan = planWith([{ kind: "INVESTOR_MANDATE", subject: ownFirm }]);
    expect(askedSubjects([company, other], plan)).toEqual([company, other]);
    // Without a company, their own firm IS the question.
    expect(askedSubjects([ownFirm], plan)).toEqual([ownFirm]);
  });
});
