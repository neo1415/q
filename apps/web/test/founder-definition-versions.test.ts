import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";
import {
  FOUNDER_DEFINITION_CURRENT,
  FOUNDER_FINANCIAL_STEPS,
  FOUNDER_PROFILE_STEPS,
  FOUNDER_STEPS,
} from "@capital-q/founder-onboarding/definition";

import {
  groupById,
  isSupportedVersion,
  toPresentation,
} from "../src/features/founder-onboarding/models/journey";

/**
 * Live 2026-10-01: founder definition v3 was published and every new
 * founder saw "Founder setup isn't available right now", because this
 * screen accepted v2 only. v3 is v2 plus two options; v1 stays refused.
 * Live 2026-10-15: the same again for v4 (published 2026-10-07; v3 plus
 * the optional financials block), until the screen named v4.
 */
const KNOWN_PATH: readonly string[] = [
  FOUNDER_STEPS.intent,
  FOUNDER_STEPS.companyName,
  FOUNDER_STEPS.country,
  FOUNDER_FINANCIAL_STEPS.cash,
  FOUNDER_FINANCIAL_STEPS.minCheque,
];
const viewAt = (definitionVersion: number, stepKeys = KNOWN_PATH) =>
  ({
    session: { definitionVersion },
    progress: {
      eligibleSteps: stepKeys.map((stepKey) => ({ stepKey })),
    },
  }) as unknown as OnboardingSessionView;

describe("the founder setup screen's definition versions", () => {
  it("renders v2, v3, v4 and the version new sessions pin to", () => {
    for (const v of [2, 3, 4, FOUNDER_DEFINITION_CURRENT.version]) {
      expect(isSupportedVersion(viewAt(v))).toBe(true);
    }
  });

  it("renders a later version that only adds options (v5: Gulf countries) without a code change", () => {
    expect(isSupportedVersion(viewAt(5))).toBe(true);
  });

  it("refuses v1 only", () => {
    expect(isSupportedVersion(viewAt(1))).toBe(false);
  });

  it("never refuses a session for a step it has no screen for (live 2026-10-16: v6 took setup down)", () => {
    expect(
      isSupportedVersion(viewAt(6, [...KNOWN_PATH, "F99.new_question"])),
    ).toBe(true);
    // The real v6 path, profile sections included.
    expect(
      isSupportedVersion(
        viewAt(
          6,
          FOUNDER_DEFINITION_CURRENT.steps.map((step) => step.stepKey),
        ),
      ),
    ).toBe(true);
  });
});

/** A session on `current`, with these steps on its path, for the screen. */
const sessionOn = (current: string, path: readonly string[]) =>
  ({
    session: {
      id: "a0000000-0000-4000-8000-000000000001",
      status: "ACTIVE",
      definitionVersion: 6,
      currentStepKey: current,
      subject: null,
    },
    progress: {
      eligibleSteps: path.map((stepKey) => ({
        stepKey,
        required: false,
        status: stepKey === current ? "PENDING" : "COMPLETED",
      })),
    },
    currentStep: {
      stepKey: current,
      prompt: "What will the world look like in ten years?",
      required: false,
    },
    responses: [],
    pendingQuestions: [],
  }) as unknown as OnboardingSessionView;

describe("founder v6 profile sections and steps the screen does not know", () => {
  const source = { adapter: "test", synthetic: true };

  it("draws a profile section as its own optional text section, titled as the template", () => {
    const view = toPresentation(
      sessionOn(FOUNDER_PROFILE_STEPS.problem, [
        ...KNOWN_PATH,
        FOUNDER_PROFILE_STEPS.problem,
      ]),
      source,
    );
    expect(view.step).toMatchObject({
      kind: "narrative",
      title: "The Problem",
      optional: true,
    });
    expect(view.steps.map((step) => step.title)).toContain("The Problem");
  });

  it("draws an unknown step as its question and a text field, and saves their words", () => {
    const view = toPresentation(
      sessionOn("F99.vision_ten_years", [
        ...KNOWN_PATH,
        "F99.vision_ten_years",
      ]),
      source,
    );
    expect(view.step).toMatchObject({
      kind: "narrative",
      prompt: "What will the world look like in ten years?",
    });
    const group = groupById(view.currentStepId);
    expect(group?.stepKeys).toEqual(["F99.vision_ten_years"]);
  });
});
