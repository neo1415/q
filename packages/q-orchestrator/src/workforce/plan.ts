import type { QAgentExecutor, QAgentRole } from "@capital-q/contracts";

import {
  STORED_ROLE,
  isQAgentRole,
  registeredExecutors,
  roleTitle,
} from "./executors.js";
import {
  AGENT_REGISTRY,
  AGENT_ROLES,
  OUTWARD_TOOLS,
  type AgentRole,
} from "./registry.js";

/**
 * The lead Q's plan, bounded by code (founder brief J1, J4; recovery D1).
 *
 * A model proposes the steps; this decides which may run. A step's role
 * must have an executor registered in this deployment (`executors.ts`); it
 * keeps only tools that are its executor's and in what the person allowed
 * for this job. A step whose role has no executor, whose tools are all
 * refused, that waits on a step that does not exist or was refused, or that
 * does not fit in the job's budget, is refused with the reason. A plan with
 * any refused step is not offered for approval at all (`planIsValid`): a
 * partial plan approved as if whole is how jobs silently never sent (D-02).
 * Nothing here widens a grant: the grant and the approval engine still
 * decide every consequential action when it runs.
 */

export type ProposedStep = {
  readonly key: string;
  readonly role: string;
  readonly agentName: string | null;
  readonly goal: string;
  readonly tools: readonly string[];
  readonly dependsOn: readonly string[];
};

export type BoundStep = {
  readonly key: string;
  /** The role as stored on the workforce tables and the approved payload. */
  readonly role: AgentRole;
  /** The registered executor that carries it out; null only for an older approved step no executor covers. */
  readonly executor: QAgentRole | null;
  /** The role's title, which the person sees. */
  readonly agentName: string;
  readonly goal: string;
  readonly tools: readonly string[];
  readonly dependsOn: readonly string[];
  readonly budgetUsd: number;
  /** It reaches the other side: every draft is written and reviewed inside. */
  readonly outward: boolean;
  readonly spawned: boolean;
};

export const STEP_REFUSALS = [
  "UNKNOWN_ROLE",
  "LEAD_IS_NOT_A_STEP",
  /** A real role with no executor here (incl. WRITER and REVIEWER, which run inside the sender). */
  "NO_EXECUTOR",
  "NO_PERMITTED_TOOL",
  "WAITS_ON_MISSING_STEP",
  "DUPLICATE_KEY",
  "OVER_BUDGET",
  "TOO_MANY_STEPS",
] as const;
export type StepRefusal = (typeof STEP_REFUSALS)[number];

export type PlanBounds = {
  /** What the person allowed for this job (tool and action names). */
  readonly permitted: ReadonlySet<string>;
  /** What the whole job may spend, USD. */
  readonly budgetUsd: number;
  readonly maxSteps?: number | undefined;
  /** The executors registered here; default: those needing no provider. */
  readonly executors?:
    Readonly<Partial<Record<QAgentRole, QAgentExecutor>>> | undefined;
};

export const MAX_JOB_STEPS = 12;

export function boundPlan(
  steps: readonly ProposedStep[],
  bounds: PlanBounds,
): {
  readonly steps: readonly BoundStep[];
  readonly refused: readonly {
    readonly key: string;
    readonly reason: StepRefusal;
  }[];
  readonly budgetUsd: number;
} {
  const executors =
    bounds.executors ?? registeredExecutors({ research: false });
  const kept: BoundStep[] = [];
  const refused: { key: string; reason: StepRefusal }[] = [];
  const keys = new Set<string>();
  let spent = 0;
  const maxSteps = Math.min(bounds.maxSteps ?? MAX_JOB_STEPS, MAX_JOB_STEPS);
  for (const step of steps) {
    const refuse = (reason: StepRefusal) => {
      refused.push({ key: step.key, reason });
    };
    if (keys.has(step.key)) {
      refuse("DUPLICATE_KEY");
      continue;
    }
    keys.add(step.key);
    if (step.role === "LEAD") {
      refuse("LEAD_IS_NOT_A_STEP");
      continue;
    }
    if (!isQAgentRole(step.role)) {
      // An old roster name (WRITER, REVIEWER, AD_HOC ...) is a real role
      // with no executor; anything else is not a role at all.
      refuse(
        (AGENT_ROLES as readonly string[]).includes(step.role)
          ? "NO_EXECUTOR"
          : "UNKNOWN_ROLE",
      );
      continue;
    }
    const role = step.role;
    const executor = executors[role];
    if (executor === undefined) {
      refuse("NO_EXECUTOR");
      continue;
    }
    if (kept.length >= maxSteps) {
      refuse("TOO_MANY_STEPS");
      continue;
    }
    const own = new Set(executor.tools);
    const tools = [...new Set(step.tools)].filter(
      (tool) => own.has(tool) && bounds.permitted.has(tool),
    );
    if (tools.length === 0) {
      refuse("NO_PERMITTED_TOOL");
      continue;
    }
    // Only steps already kept can be waited on: a plan runs in order.
    if (step.dependsOn.some((key) => !kept.some((one) => one.key === key))) {
      refuse("WAITS_ON_MISSING_STEP");
      continue;
    }
    const stored = STORED_ROLE[role];
    const budgetUsd = AGENT_REGISTRY[stored].budgetUsd;
    if (spent + budgetUsd > bounds.budgetUsd + 1e-9) {
      refuse("OVER_BUDGET");
      continue;
    }
    spent += budgetUsd;
    kept.push({
      key: step.key,
      role: stored,
      executor: role,
      agentName: roleTitle(role),
      goal: step.goal,
      tools,
      dependsOn: [...step.dependsOn],
      budgetUsd,
      outward: executor.outward && tools.some((tool) => isOutwardTool(tool)),
      spawned: false,
    });
  }
  return { steps: kept, refused, budgetUsd: spent };
}

/** Tools that reach another person, beyond the messaging ones. */
const OUTWARD_ACTIONS: ReadonlySet<string> = new Set([
  "relationship.interest.express",
  "schedule.meeting.book",
]);

function isOutwardTool(tool: string): boolean {
  return OUTWARD_TOOLS.has(tool) || OUTWARD_ACTIONS.has(tool);
}

/**
 * Whether a bounded plan may be offered for approval: at least one step,
 * and no step refused. A refused step means the plan the model wrote is not
 * the plan that would run, so the person is never asked to approve it.
 */
export function planIsValid(bound: {
  readonly steps: readonly BoundStep[];
  readonly refused: readonly unknown[];
}): boolean {
  return bound.steps.length > 0 && bound.refused.length === 0;
}
