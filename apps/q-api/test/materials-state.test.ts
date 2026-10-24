import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";
import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding/definition";

import { toOpenStep } from "../src/voice/interview-steps.js";

/**
 * QA F1/O1 (24 Oct): the panel showed "11 to confirm" from the founder's
 * deck while Q said the deck had not been read and pointed to the upload
 * button. Q reads the same state the panel shows.
 */
const materials = FOUNDER_DEFINITION_CURRENT.steps.find(
  (step) => step.configuration.stepType === "document_upload",
);

const view = (sourceType: string | null) =>
  ({
    currentStep: null,
    responses: [],
    pendingSuggestions:
      sourceType === null
        ? []
        : [
            {
              id: "a0000000-0000-4000-8000-000000000001",
              stepKey: "F1.stage",
              targetField: "stage",
              suggestedValue: { type: "SINGLE_SELECT", optionKey: "seed" },
              confidence: null,
              status: "PENDING",
              createdAt: "2026-10-24T10:00:00.000Z",
              sourceRefs: [{ sourceType, sourceId: "doc-1" }],
              rationale: null,
            },
          ],
  }) as unknown as OnboardingSessionView;

describe("the materials step as Q sees it", () => {
  it("says their material is read when facts from it wait on screen", () => {
    if (materials === undefined) throw new Error("no materials step");
    const note = toOpenStep(materials, view("EVIDENCE_DOCUMENT"))?.note ?? "";
    expect(note).toMatch(/already in and read: 1 fact/u);
    expect(note).not.toMatch(/upload button/u);
    expect(
      toOpenStep(materials, view("EVIDENCE_DOCUMENT_VERSION"))?.note,
    ).toMatch(/already in and read/u);
  });

  it("offers the upload button only when nothing of theirs has been read", () => {
    if (materials === undefined) throw new Error("no materials step");
    expect(toOpenStep(materials, view(null))?.note).toMatch(/upload button/u);
    // Q's own web research is not their material.
    expect(toOpenStep(materials, view("PUBLIC_PAGE"))?.note).toMatch(
      /upload button/u,
    );
  });
});
