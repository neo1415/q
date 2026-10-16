import type {
  OnboardingResponseValue,
  OnboardingSessionView,
} from "@capital-q/contracts";
import {
  evaluateBranch,
  type OnboardingDefinitionManifest,
} from "@capital-q/onboarding";

/**
 * A session view as the runtime would project it, for coverage tests in
 * the journey packages: eligibility by the definition's own branching.
 */
const SESSION = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-16T10:00:00.000Z");
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export function viewOf(
  definition: OnboardingDefinitionManifest,
  answers: Readonly<Record<string, OnboardingResponseValue>>,
  extra: {
    readonly suggestions?: readonly {
      stepKey: string;
      value: OnboardingResponseValue;
      sourceType: string;
    }[];
    readonly contradictions?: readonly {
      stepKey: string;
      readings: string[];
    }[];
    readonly skipped?: readonly string[];
  } = {},
): OnboardingSessionView {
  const snapshot = new Map<string, OnboardingResponseValue>();
  const eligible: {
    stepKey: string;
    required: boolean;
    status: "PENDING" | "COMPLETED" | "SKIPPED";
  }[] = [];
  for (const step of [...definition.steps].sort(
    (a, b) => a.sequenceOrder - b.sequenceOrder,
  )) {
    if (step.branching !== null && !evaluateBranch(step.branching, snapshot))
      continue;
    const value = answers[step.stepKey];
    if (value !== undefined) snapshot.set(step.stepKey, value);
    eligible.push({
      stepKey: step.stepKey,
      required: step.required,
      status:
        value !== undefined
          ? "COMPLETED"
          : (extra.skipped ?? []).includes(step.stepKey)
            ? "SKIPPED"
            : "PENDING",
    });
  }
  const canComplete = eligible.every(
    (s) => !s.required || s.status === "COMPLETED",
  );
  return {
    session: {
      id: SESSION,
      journeyType: definition.journeyType,
      definitionVersionId: "00000000-0000-4000-8000-0000000000aa",
      definitionVersion: definition.version,
      status: "ACTIVE",
      subject: null,
      currentStepKey: null,
      version: 3,
      startedAt: NOW.toISOString(),
      lastActivityAt: NOW.toISOString(),
      completedAt: null,
    },
    phases: [],
    currentStep: null,
    progress: {
      currentStepKey: null,
      currentPhaseKey: null,
      eligibleSteps: eligible,
      eligibleStepCount: eligible.length,
      completedEligibleStepCount: eligible.filter(
        (s) => s.status === "COMPLETED",
      ).length,
      canGoBack: false,
      canSkipCurrentStep: false,
      canComplete,
    },
    pendingSuggestions: (extra.suggestions ?? []).map((s) => ({
      id: uuid(),
      stepKey: s.stepKey,
      targetField: "x",
      suggestedValue: s.value,
      confidence: null,
      status: "PENDING" as const,
      createdAt: NOW.toISOString(),
      sourceRefs: [{ sourceType: s.sourceType, sourceId: "ref-1" }],
    })),
    responses: Object.entries(answers)
      .filter(([key]) => snapshot.has(key))
      .map(([stepKey, value]) => ({
        id: uuid(),
        stepKey,
        responseType: value.type,
        value,
        sourceModality: "VOICE_TRANSCRIPT" as const,
        note: null,
        channel: null,
        createdAt: NOW.toISOString(),
      })),
    pendingQuestions: (extra.contradictions ?? []).map((c) => ({
      id: uuid(),
      stepKey: c.stepKey,
      factKey: c.stepKey,
      question: "Which is right?",
      why: null,
      reason: "CONTRADICTION" as const,
      readings: c.readings,
      options: [],
      createdAt: NOW.toISOString(),
    })),
  };
}
