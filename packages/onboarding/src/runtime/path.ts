import type {
  OnboardingPathChanges,
  OnboardingProgress,
  OnboardingResponseValue,
  OnboardingStepProgressStatusSchema,
} from "@capital-q/contracts";
import type { z } from "zod";

import type {
  OnboardingResponse,
  OnboardingSession,
  OnboardingStepDefinition,
  OnboardingStepState,
} from "../contracts/index.js";
import { evaluateBranch } from "./branch.js";

/**
 * The active path: ordered definition -> currently eligible steps -> their
 * states. Computed in memory from one response snapshot; never a query per
 * step, never a model. Progress is reported over eligible steps only, so a
 * step that fell off the path after a revised answer neither counts nor
 * blocks, while its historical response stays untouched.
 */

type StepProgressStatus = z.infer<typeof OnboardingStepProgressStatusSchema>;

export type ActivePath = {
  /** Eligible steps in sequence order. */
  readonly eligible: readonly OnboardingStepDefinition[];
  readonly eligibleKeys: ReadonlySet<string>;
  /** Current responses of eligible steps, keyed by step key. */
  readonly snapshot: ReadonlyMap<string, OnboardingResponseValue>;
};

export function computeActivePath(
  steps: readonly OnboardingStepDefinition[],
  currentResponses: ReadonlyMap<string, OnboardingResponse>,
): ActivePath {
  const snapshot = new Map<string, OnboardingResponseValue>();
  const eligible: OnboardingStepDefinition[] = [];
  const eligibleKeys = new Set<string>();
  for (const step of steps) {
    const isEligible =
      step.branching === null || evaluateBranch(step.branching, snapshot);
    if (!isEligible) {
      continue;
    }
    eligible.push(step);
    eligibleKeys.add(step.stepKey);
    const response = currentResponses.get(step.stepKey);
    if (response !== undefined) {
      snapshot.set(step.stepKey, response.value);
    }
  }
  return { eligible, eligibleKeys, snapshot };
}

const isSettled = (state: OnboardingStepState | undefined): boolean =>
  state?.status === "COMPLETED" || state?.status === "SKIPPED";

/** The first eligible step that is neither completed nor skipped, or null. */
export function nextIncompleteStep(
  path: ActivePath,
  states: ReadonlyMap<string, OnboardingStepState>,
): OnboardingStepDefinition | null {
  for (const step of path.eligible) {
    if (!isSettled(states.get(step.stepKey))) {
      return step;
    }
  }
  return null;
}

/** The nearest earlier eligible step that has been visited, or null. */
export function previousVisitedStep(
  path: ActivePath,
  states: ReadonlyMap<string, OnboardingStepState>,
  currentStepKey: string | null,
): OnboardingStepDefinition | null {
  if (currentStepKey === null) {
    return null;
  }
  const currentIndex = path.eligible.findIndex(
    (step) => step.stepKey === currentStepKey,
  );
  if (currentIndex <= 0) {
    return null;
  }
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = path.eligible[index];
    if (candidate !== undefined && states.has(candidate.stepKey)) {
      return candidate;
    }
  }
  return null;
}

export function pathChanges(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
): OnboardingPathChanges {
  return {
    becameEligibleStepKeys: [...after].filter((key) => !before.has(key)),
    becameIneligibleStepKeys: [...before].filter((key) => !after.has(key)),
  };
}

export function requiredStepsComplete(
  path: ActivePath,
  states: ReadonlyMap<string, OnboardingStepState>,
): boolean {
  return path.eligible.every(
    (step) =>
      !step.required || states.get(step.stepKey)?.status === "COMPLETED",
  );
}

function progressStatus(
  state: OnboardingStepState | undefined,
  isCurrent: boolean,
): StepProgressStatus {
  if (state?.status === "COMPLETED") {
    return "COMPLETED";
  }
  if (state?.status === "SKIPPED") {
    return "SKIPPED";
  }
  return isCurrent || state?.status === "IN_PROGRESS"
    ? "IN_PROGRESS"
    : "PENDING";
}

export function computeProgress(
  session: OnboardingSession,
  path: ActivePath,
  states: ReadonlyMap<string, OnboardingStepState>,
): OnboardingProgress {
  const current = path.eligible.find(
    (step) => step.stepKey === session.currentStepKey,
  );
  const eligibleSteps = path.eligible.map((step) => ({
    stepKey: step.stepKey,
    ...(step.configuration.phaseKey === undefined
      ? {}
      : { phaseKey: step.configuration.phaseKey }),
    required: step.required,
    status: progressStatus(
      states.get(step.stepKey),
      step.stepKey === session.currentStepKey,
    ),
  }));
  const active = session.status === "ACTIVE";
  return {
    currentStepKey: session.currentStepKey,
    currentPhaseKey: current?.configuration.phaseKey ?? null,
    eligibleSteps,
    eligibleStepCount: path.eligible.length,
    completedEligibleStepCount: eligibleSteps.filter(
      (step) => step.status === "COMPLETED",
    ).length,
    canGoBack:
      active &&
      previousVisitedStep(path, states, session.currentStepKey) !== null,
    canSkipCurrentStep:
      active &&
      current !== undefined &&
      !current.required &&
      states.get(current.stepKey)?.status !== "COMPLETED",
    canComplete: active && requiredStepsComplete(path, states),
  };
}
