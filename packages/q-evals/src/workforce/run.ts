import type {
  WorkforceJobReasoning,
  WorkforceJobStartPayload,
  WorkforcePlanProgress,
} from "@capital-q/contracts";
import type { JobPlanResultV6 } from "@capital-q/q-core";
import {
  boundPlan,
  executorRoleOf,
  executorRosterText,
  groundReasoning,
  groundStepEvidence,
  planProgress,
  registeredExecutors,
  runJob,
  situationFrom,
  situationText,
  type AgentExecutor,
  type JobRecorder,
  type StepOutcome,
  type StepResult,
} from "@capital-q/q-orchestrator";

import type { WorkforceScenario } from "./scenarios.js";

/**
 * Drives one scenario through the real workforce engine: the situation
 * code writes, the planner (scripted or live), grounding, bounding, the
 * dependency-aware runner with fallbacks and contradiction holds, and the
 * derived progress and next steps. Executors are fakes that report what
 * the scenario says each step reports; nothing reaches a provider.
 */

export type PlannerVariables = {
  readonly goal: string;
  readonly roster: string;
  readonly allowed: string;
  readonly situation: string;
};

/** A plan as the grader reads it, from a run or from an approval card. */
export type PlanUnderTest = {
  readonly steps: readonly {
    readonly key: string;
    /** The executor role (DILIGENCE, SCHEDULING ...). */
    readonly role: string;
    readonly dependsOn: readonly string[];
    readonly fallbackFor: string | null;
    readonly evidence: readonly string[];
    readonly outward: boolean;
  }[];
  readonly reasoning: WorkforceJobReasoning | undefined;
  readonly refused: number;
  /** Invented references dropped by code; null: not known (a card). */
  readonly droppedRefs: number | null;
};

export type WorkforceScenarioRun = {
  readonly plan: PlanUnderTest;
  readonly progress: WorkforcePlanProgress;
  readonly outward: readonly {
    readonly key: string;
    readonly status: string;
    readonly summary: string;
  }[];
  readonly jobStatus: "DONE" | "HELD";
  readonly fallbackStoodIn: boolean;
};

const OUTWARD = new Set([
  "chat.message.send",
  "schedule.meeting.book",
  "relationship.interest.express",
]);

export function plannerVariables(
  scenario: WorkforceScenario,
): PlannerVariables {
  const permitted = new Set(scenario.permitted);
  const executors = registeredExecutors({
    research: true,
    documents: true,
    diligence: true,
  });
  const situation = situationFrom({
    briefs: scenario.briefs,
    overview: scenario.overview,
    waiting: scenario.waiting,
  });
  return {
    goal: scenario.goal,
    roster: executorRosterText(executors, permitted),
    allowed: `Tools and actions: ${[...permitted].join(", ")}. Budget for the whole job: $0.50.${
      scenario.namedCompanyId === null
        ? " The job names no single company on record, so a NAMED_COMPANY document cannot be planned."
        : " The company the job names is on record."
    }`,
    situation: situationText(situation),
  };
}

function recorder(): JobRecorder {
  let next = 0;
  return {
    startRun: (input) => {
      next += 1;
      return Promise.resolve(input.stepKey ?? `lead-${String(next)}`);
    },
    endRun: () => Promise.resolve(),
    handoff: () => Promise.resolve(),
  };
}

export async function runWorkforceScenario(
  scenario: WorkforceScenario,
  planner: (variables: PlannerVariables) => Promise<JobPlanResultV6 | null>,
): Promise<WorkforceScenarioRun | null> {
  const situation = situationFrom({
    briefs: scenario.briefs,
    overview: scenario.overview,
    waiting: scenario.waiting,
  });
  const planned = await planner(plannerVariables(scenario));
  if (planned === null) return null;
  const executors = registeredExecutors({
    research: true,
    documents: true,
    diligence: true,
  });
  let dropped = 0;
  const bound = boundPlan(
    planned.steps.map((step) => {
      const grounded = groundStepEvidence(step.evidence, situation);
      dropped += grounded.dropped;
      return {
        key: step.key,
        role: step.role,
        agentName: null,
        goal: step.goal,
        tools: step.tools,
        dependsOn: step.dependsOn,
        ...(step.document === undefined ? {} : { document: step.document }),
        why: step.why,
        evidence: grounded.evidence,
        ...(step.fallbackFor === null ? {} : { fallbackFor: step.fallbackFor }),
      };
    }),
    {
      permitted: new Set(scenario.permitted),
      // The deployed job cap (Q_WORKFORCE_JOB_CAP_USD, $2.50) less the lead's
      // own planning; deep research and analysis are budgeted for what they do.
      budgetUsd: 2.4,
      executors,
      namedCompanyId: scenario.namedCompanyId,
    },
  );
  const grounded = groundReasoning(planned, situation, bound.steps);
  const outputs = new Map<string, StepResult>();
  const fake: AgentExecutor = (step) => {
    const result: StepResult = scenario.behaviour[step.key] ?? {
      status: "DONE",
      summary: "Done.",
      ...(step.document?.operation === "PREPARE"
        ? {
            outputs: {
              artifactId: `artifact-${step.key}`,
              companyId: "company",
            },
          }
        : {}),
    };
    outputs.set(step.key, result);
    return Promise.resolve(result);
  };
  const result = await runJob({
    jobId: `eval-${scenario.id}`,
    goal: planned.summary,
    steps: bound.steps,
    executors: {
      CONVERSATION: fake,
      OUTREACH: fake,
      SCHEDULING: fake,
      DISCOVERY: fake,
      RESEARCH: fake,
      DOCUMENTS: fake,
      DILIGENCE: fake,
    },
    recorder: recorder(),
  });
  const outcomes = new Map<string, StepOutcome>(
    result.steps.map((step) => [
      step.key,
      {
        status: step.status,
        summary: step.summary,
        outputs: outputs.get(step.key)?.outputs,
      },
    ]),
  );
  const progress = planProgress({
    reasoning: grounded.reasoning,
    steps: bound.steps.map((step) => ({
      key: step.key,
      who: step.agentName,
      goal: step.goal,
      tools: step.tools,
      dependsOn: step.dependsOn,
      why: step.why,
      evidence: step.evidence,
      fallbackFor: step.fallbackFor,
    })),
    outcomes,
    finished: true,
  });
  const counted = result.steps.filter((step) => step.counts !== false);
  return {
    plan: {
      steps: bound.steps.map((step) => ({
        key: step.key,
        role: step.executor ?? step.role,
        dependsOn: step.dependsOn,
        fallbackFor: step.fallbackFor ?? null,
        evidence: step.evidence ?? [],
        outward: step.outward,
      })),
      reasoning: grounded.reasoning,
      refused: bound.refused.length,
      droppedRefs: dropped + grounded.droppedRefs,
    },
    progress,
    outward: result.steps.filter(
      (step) =>
        bound.steps.find((one) => one.key === step.key)?.outward === true,
    ),
    jobStatus:
      counted.length > 0 && counted.every((step) => step.status === "DONE")
        ? "DONE"
        : "HELD",
    fallbackStoodIn: result.steps.some(
      (step) =>
        step.status === "DONE" &&
        bound.steps.find((one) => one.key === step.key)?.fallbackFor !==
          undefined,
    ),
  };
}

/** The plan on an approval card (a live run), as the grader reads it. */
export function planFromPayload(
  payload: WorkforceJobStartPayload,
): PlanUnderTest {
  return {
    steps: payload.steps.map((step) => ({
      key: step.key,
      role: step.tools.includes("diligence.questions.prepare")
        ? "DILIGENCE"
        : (executorRoleOf(step.role) ?? step.role),
      dependsOn: step.dependsOn,
      fallbackFor: step.fallbackFor ?? null,
      evidence: step.evidence ?? [],
      outward: step.tools.some((tool) => OUTWARD.has(tool)),
    })),
    reasoning: payload.reasoning,
    refused: 0,
    droppedRefs: null,
  };
}
