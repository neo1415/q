import { describe, expect, it } from "vitest";

import {
  deriveOnboardingCoverage,
  knownFactsFromRegistration,
} from "@capital-q/onboarding";

import { viewOf } from "../../onboarding/test/support/coverage-view.js";
import {
  INVESTOR_COVERAGE_PROFILE,
  INVESTOR_DEFINITION_CURRENT,
  INVESTOR_DOCUMENT_FIELDS,
  INVESTOR_UPLOAD_DOCUMENT_TYPES,
  INVESTOR_STEPS,
} from "../src/definition/index.js";

const NOW = new Date("2026-10-16T10:00:00.000Z");

describe("investor coverage", () => {
  it("is a mandate interview: no founder or fundraising concept appears", () => {
    const c = deriveOnboardingCoverage({
      profile: INVESTOR_COVERAGE_PROFILE,
      definition: INVESTOR_DEFINITION_CURRENT,
      view: viewOf(INVESTOR_DEFINITION_CURRENT, {}),
      now: NOW,
    });
    expect(c.journeyType).toBe("investor");
    for (const f of c.fields) {
      expect(f.concept, f.fieldKey).not.toMatch(
        /^(capital|traction|financials|company)\./,
      );
    }
    const keys = new Set(
      INVESTOR_DEFINITION_CURRENT.steps.map((s) => s.stepKey),
    );
    for (const key of Object.keys(INVESTOR_COVERAGE_PROFILE.fields)) {
      expect(keys.has(key), key).toBe(true);
    }
  });

  it("the firm named at registration is KNOWN, and stages come before nuance", () => {
    const c = deriveOnboardingCoverage({
      profile: INVESTOR_COVERAGE_PROFILE,
      definition: INVESTOR_DEFINITION_CURRENT,
      view: viewOf(INVESTOR_DEFINITION_CURRENT, {
        [INVESTOR_STEPS.investorType]: {
          type: "SINGLE_SELECT",
          optionKey: "vc",
        },
      }),
      known: knownFactsFromRegistration(INVESTOR_COVERAGE_PROFILE, {
        organisationName: "Savanna Seed Partners",
      }),
      now: NOW,
    });
    const firm = c.fields.find(
      (f) => f.fieldKey === INVESTOR_STEPS.organisationName,
    );
    expect(firm?.state).toBe("KNOWN");
    const next = c.next.map((n) => n.fieldKey);
    expect(next).not.toContain(INVESTOR_STEPS.organisationName);
    expect(next).not.toContain(INVESTOR_STEPS.investorType);
    expect(c.next.every((n) => n.reason === "ESSENTIAL_MISSING")).toBe(true);
    // Optional nuance (green flags) is deferrable, never pressed.
    expect(
      c.fields.find((f) => f.fieldKey === INVESTOR_STEPS.greenFlags)?.state,
    ).toBe("DEFERRABLE");
  });

  it("the optional investor upload settles its own coverage key, never a required one", () => {
    const without = deriveOnboardingCoverage({
      profile: INVESTOR_COVERAGE_PROFILE,
      definition: INVESTOR_DEFINITION_CURRENT,
      view: viewOf(INVESTOR_DEFINITION_CURRENT, {}),
      now: NOW,
    });
    const field = (c: typeof without) =>
      c.fields.find((f) => f.fieldKey === INVESTOR_DOCUMENT_FIELDS.materials);
    expect(field(without)).toMatchObject({
      state: "DEFERRABLE",
      required: false,
    });
    const withDeck = deriveOnboardingCoverage({
      profile: INVESTOR_COVERAGE_PROFILE,
      definition: INVESTOR_DEFINITION_CURRENT,
      view: viewOf(INVESTOR_DEFINITION_CURRENT, {}),
      documents: [{ documentType: INVESTOR_UPLOAD_DOCUMENT_TYPES.FUND_DECK }],
      now: NOW,
    });
    expect(field(withDeck)).toMatchObject({
      state: "CONFIRMED_SAVED",
      source: "DOCUMENT",
    });
    for (const documentType of [
      "INVESTMENT_THESIS",
      "LP_LETTER",
      "COMPANY_PROFILE",
    ]) {
      expect(
        field(
          deriveOnboardingCoverage({
            profile: INVESTOR_COVERAGE_PROFILE,
            definition: INVESTOR_DEFINITION_CURRENT,
            view: viewOf(INVESTOR_DEFINITION_CURRENT, {}),
            documents: [{ documentType }],
            now: NOW,
          }),
        )?.state,
        documentType,
      ).toBe("CONFIRMED_SAVED");
    }
    const informs =
      INVESTOR_COVERAGE_PROFILE.documentFields?.[
        INVESTOR_DOCUMENT_FIELDS.materials
      ]?.informs ?? [];
    for (const key of informs) {
      expect(
        INVESTOR_DEFINITION_CURRENT.steps.some((s) => s.stepKey === key),
        key,
      ).toBe(true);
    }
  });

  it("never asks which mandate is being defined: the journey resolves it (live 2026-10-16)", () => {
    expect(
      INVESTOR_COVERAGE_PROFILE.fields[INVESTOR_STEPS.mandateContext],
    ).toBeUndefined();
    expect(
      INVESTOR_COVERAGE_PROFILE.fields[INVESTOR_STEPS.businessTitle]?.priority,
    ).toBe("IMPORTANT");
  });

  describe("an accepted document proposal keeps its provenance (ob2)", () => {
    const geography = {
      [INVESTOR_STEPS.geography]: {
        type: "RESOURCE_REFERENCE" as const,
        resourceType: "TAXONOMY_NODE" as const,
        resourceIds: ["00000000-0000-4000-8000-0000000000ke"],
      },
    };
    const sourceOf = (
      modality: "SUGGESTION_ACCEPT" | "SUGGESTION_EDIT",
      accepted?: readonly { sourceType: string }[],
    ) =>
      deriveOnboardingCoverage({
        profile: INVESTOR_COVERAGE_PROFILE,
        definition: INVESTOR_DEFINITION_CURRENT,
        view: viewOf(INVESTOR_DEFINITION_CURRENT, geography, {
          modalities: { [INVESTOR_STEPS.geography]: modality },
        }),
        ...(accepted === undefined
          ? {}
          : {
              acceptedSuggestions: [
                { stepKey: INVESTOR_STEPS.geography, sourceRefs: accepted },
              ],
            }),
        now: NOW,
      }).fields.find((f) => f.fieldKey === INVESTOR_STEPS.geography)?.source;

    it("accepted from the person's document: from the document", () => {
      expect(
        sourceOf("SUGGESTION_ACCEPT", [{ sourceType: "EVIDENCE_DOCUMENT" }]),
      ).toBe("DOCUMENT");
    });

    it("accepted from Q's own recommendation, or unknown provenance: Q's suggestion", () => {
      expect(
        sourceOf("SUGGESTION_ACCEPT", [{ sourceType: "Q_RECOMMENDATION" }]),
      ).toBe("Q_RECOMMENDATION");
      expect(sourceOf("SUGGESTION_ACCEPT")).toBe("Q_RECOMMENDATION");
    });

    it("edited by the person: still reached through Q's suggestion", () => {
      expect(
        sourceOf("SUGGESTION_EDIT", [{ sourceType: "EVIDENCE_DOCUMENT" }]),
      ).toBe("Q_RECOMMENDATION");
    });

    it("a pending proposal carries its note (names not matched)", () => {
      const c = deriveOnboardingCoverage({
        profile: INVESTOR_COVERAGE_PROFILE,
        definition: INVESTOR_DEFINITION_CURRENT,
        view: viewOf(
          INVESTOR_DEFINITION_CURRENT,
          {},
          {
            suggestions: [
              {
                stepKey: INVESTOR_STEPS.geography,
                value: geography[INVESTOR_STEPS.geography],
                sourceType: "EVIDENCE_DOCUMENT",
                rationale:
                  "Not matched to Capital Q's list, so not included: Atlantis.",
              },
            ],
          },
        ),
        now: NOW,
      });
      const proposal = c.fields.find(
        (f) => f.fieldKey === INVESTOR_STEPS.geography,
      )?.proposals[0];
      expect(proposal).toMatchObject({
        source: "DOCUMENT",
        note: "Not matched to Capital Q's list, so not included: Atlantis.",
      });
    });
  });
});
