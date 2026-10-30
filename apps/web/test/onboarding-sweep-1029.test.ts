import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  reviewLines,
  uploadAnswer,
} from "../src/features/onboarding-conversation/conversation";
import { investorTypeLabel } from "../src/features/investors/investor-labels";

/**
 * Live onboarding sweep 2026-10-29 (production ed9be6cc4): the screen's
 * side of D1 (the read-back's confirm button) and D4 (where finishing goes).
 */

const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, path), "utf8");

describe("D1: the confirm button under Q's read-back", () => {
  it("goes to Q as their yes with the review it confirms, never as a bare step save", () => {
    const source = read(
      "../src/features/onboarding-conversation/q-onboarding-workspace.tsx",
    );
    const submitChip = source.slice(
      source.indexOf("const submitChip = useCallback("),
      source.indexOf("await tap();"),
    );
    const confirm = submitChip.slice(
      submitChip.indexOf('chip.value.type === "CONFIRMATION"'),
    );
    expect(confirm).toContain(
      "await sayOne(spoken ?? chip.label, true, prompt.stepKey);",
    );
    // The confirmation returns before the direct step save below it.
    expect(confirm.indexOf("return;")).toBeLessThan(
      confirm.indexOf("actions.submitValue"),
    );
  });

  it("carries the tapped review through every hop to the interviewer", () => {
    expect(read("../src/features/onboarding-kit/controller.ts")).toContain(
      "...(confirmReview === undefined ? {} : { confirmReview }),",
    );
    expect(read("../src/features/onboarding-kit/runtime-port.ts")).toContain(
      "confirmReview: input.confirmReview",
    );
    expect(read("../src/features/onboarding-kit/api-actions.ts")).toContain(
      "confirmReview: input.confirmReview",
    );
    expect(read("../app/api/onboarding-say/[sessionId]/route.ts")).toContain(
      "confirmReview: OnboardingStepKeySchema.optional()",
    );
  });
});

describe("D4: where finishing goes", () => {
  it("a founder finished in the conversation goes to verification, then the profile, as the form does", () => {
    const screen = read(
      "../src/features/founder-onboarding/founder-onboarding-screen.tsx",
    );
    const finished = screen.slice(screen.indexOf("onFinished={"));
    expect(finished.slice(0, 300)).toContain(
      'router.push("/verification?from=setup&next=profile")',
    );
    const workspace = read(
      "../src/features/onboarding-conversation/q-onboarding-workspace.tsx",
    );
    expect(workspace).toContain(
      "if (turn.completed === true && onFinished !== undefined) {",
    );
    expect(read("../src/features/onboarding-kit/controller.ts")).toContain(
      'completed: outcome.view.status === "complete"',
    );
  });

  it("the investor screen passes no override, so Q's Discover destination stands", () => {
    expect(
      read(
        "../src/features/investor-onboarding/investor-onboarding-screen.tsx",
      ),
    ).not.toContain("onFinished=");
  });

  it("the form's last button says where it goes", () => {
    const screen = read(
      "../src/features/founder-onboarding/founder-onboarding-screen.tsx",
    );
    expect(screen).toContain(
      'label: finishing ? "Preparing your analysis…" : "Continue",',
    );
    expect(
      read("../src/features/founder-onboarding/models/journey.ts"),
    ).toContain('primaryActionLabel: "Continue",');
  });
});

describe("D7: Keep all answers the line it is under", () => {
  it("moves Q's live line into the thread before saying it is kept, then asks what the session moved to", () => {
    const source = read(
      "../src/features/onboarding-conversation/q-onboarding-workspace.tsx",
    );
    const keepAll = source.slice(
      source.indexOf("const keepAll = async () => {"),
      source.indexOf("/** A gap answered in place"),
    );
    const live = keepAll.indexOf('push("Q", shownQuestion)');
    const reset = keepAll.indexOf("answeredByTap();");
    const kept = keepAll.indexOf('push("Q", said)');
    expect(live).toBeGreaterThan(-1);
    expect(live).toBeLessThan(reset);
    expect(reset).toBeLessThan(kept);
  });
});

describe("D5: a document uploaded while talking to Q", () => {
  const stepTypeOf = (key: string) =>
    key === "F2.materials" ? "document_upload" : "confirmation";
  const view = (held?: readonly string[]) => ({
    progress: {
      eligibleSteps: [
        { stepKey: "F1.company_name" },
        { stepKey: "F2.materials" },
      ],
    },
    responses:
      held === undefined
        ? []
        : [
            {
              stepKey: "F2.materials",
              value: {
                type: "RESOURCE_REFERENCE" as const,
                resourceType: "EVIDENCE_DOCUMENT" as const,
                resourceIds: [...held],
              },
            },
          ],
  });
  const DECK = "d0000000-0000-4000-8000-000000000001";
  const MODEL = "d0000000-0000-4000-8000-000000000002";

  it("answers the journey's own upload step, adding to what it holds", () => {
    expect(uploadAnswer(view() as never, stepTypeOf, DECK)).toEqual({
      stepKey: "F2.materials",
      value: {
        type: "RESOURCE_REFERENCE",
        resourceType: "EVIDENCE_DOCUMENT",
        resourceIds: [DECK],
      },
    });
    expect(
      uploadAnswer(view([DECK]) as never, stepTypeOf, MODEL)?.value,
    ).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "EVIDENCE_DOCUMENT",
      resourceIds: [DECK, MODEL],
    });
  });

  it("writes nothing when it is already held or there is no upload step", () => {
    expect(uploadAnswer(view([DECK]) as never, stepTypeOf, DECK)).toBeNull();
    expect(uploadAnswer(view() as never, () => "text", DECK)).toBeNull();
    expect(uploadAnswer(undefined, stepTypeOf, DECK)).toBeNull();
  });
});

describe("D8: the review says what was saved, in plain words", () => {
  it('"Based in" shows their own words, not "Somewhere else"', () => {
    const lines = reviewLines(
      {
        progress: { eligibleSteps: [{ stepKey: "F1.country" }] },
        responses: [
          {
            stepKey: "F1.country",
            value: { type: "SINGLE_SELECT", optionKey: "other" },
            note: "Kampala, Uganda",
          },
        ],
      } as never,
      {
        reviewGroups: [{ label: "Company", stepKeys: ["F1.country"] }],
        stepTitle: () => "Based in",
        describe: () => "Somewhere else",
        editorFor: () => undefined,
        finalStepKeys: [],
        subject: "founder",
      },
    );
    expect(lines[0]?.items[0]?.value).toBe("Kampala, Uganda");
  });

  it("the investor review names the type in words, never its code", () => {
    expect(investorTypeLabel("SYNDICATE")).toBe("Syndicate");
    const source = read(
      "../src/features/investor-onboarding/steps/mandate-review-step.tsx",
    );
    expect(source).toContain("investorTypeLabel(review.investor.investorType)");
  });
});
