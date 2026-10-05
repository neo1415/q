import {
  AGENT_REGISTRY,
  ALL_ROLE_TOOLS,
  OUTWARD_TOOLS,
  isAgentRole,
  type AgentRole,
} from "./registry.js";

/**
 * The lead Q's plan, bounded by code (founder brief J1, J4).
 *
 * A model proposes the steps; this decides which may run. A step keeps
 * only tools that are (a) real, (b) its role's, or for an ad-hoc agent any
 * role's, and (c) in what the person allowed for this job. A step whose
 * tools are all refused, that waits on a step that does not exist or was
 * refused, or that does not fit in the job's budget, is refused with the
 * reason, and the person sees it. Nothing here widens a grant: the grant
 * and the approval engine still decide every consequential action when it
 * runs.
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
  readonly role: AgentRole;
  /** The spawned agent's name (AD_HOC), else the role's title. */
  readonly agentName: string;
  readonly goal: string;
  readonly tools: readonly string[];
  readonly dependsOn: readonly string[];
  readonly budgetUsd: number;
  /** It sends something outward: the writer and reviewer run first. */
  readonly outward: boolean;
  readonly spawned: boolean;
};

export const STEP_REFUSALS = [
  "UNKNOWN_ROLE",
  "LEAD_IS_NOT_A_STEP",
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
};

export const MAX_JOB_STEPS = 12;

/** Roles that only work on drafts: no tools needed to be useful. */
const DRAFT_ROLES: ReadonlySet<AgentRole> = new Set(["WRITER", "REVIEWER"]);

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
    if (!isAgentRole(step.role)) {
      refuse("UNKNOWN_ROLE");
      continue;
    }
    const role = step.role;
    if (role === "LEAD") {
      refuse("LEAD_IS_NOT_A_STEP");
      continue;
    }
    if (kept.length >= maxSteps) {
      refuse("TOO_MANY_STEPS");
      continue;
    }
    const roleTools: ReadonlySet<string> =
      role === "AD_HOC" ? ALL_ROLE_TOOLS : new Set(AGENT_REGISTRY[role].tools);
    const tools = [...new Set(step.tools)].filter(
      (tool) => roleTools.has(tool) && bounds.permitted.has(tool),
    );
    if (tools.length === 0 && !DRAFT_ROLES.has(role)) {
      refuse("NO_PERMITTED_TOOL");
      continue;
    }
    // Only steps already kept can be waited on: a plan runs in order.
    if (step.dependsOn.some((key) => !kept.some((one) => one.key === key))) {
      refuse("WAITS_ON_MISSING_STEP");
      continue;
    }
    const budgetUsd = AGENT_REGISTRY[role].budgetUsd;
    if (spent + budgetUsd > bounds.budgetUsd + 1e-9) {
      refuse("OVER_BUDGET");
      continue;
    }
    spent += budgetUsd;
    kept.push({
      key: step.key,
      role,
      agentName:
        role === "AD_HOC"
          ? (step.agentName ?? "Agent").slice(0, 60)
          : AGENT_REGISTRY[role].title,
      goal: step.goal,
      tools,
      dependsOn: [...step.dependsOn],
      budgetUsd,
      outward: tools.some((tool) => OUTWARD_TOOLS.has(tool)),
      spawned: role === "AD_HOC",
    });
  }
  return { steps: kept, refused, budgetUsd: spent };
}
