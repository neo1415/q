import { z } from "zod";

import {
  isWorkforceAnalysisRequest,
  WorkforceDocumentRequestSchema,
  type WorkforceDocumentRequest,
  type QAgentExecutor,
  type QAgentRole,
} from "@capital-q/contracts";

import {
  REQUIRED_TOOLS,
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
  /**
   * The planner's document request (its NAMED_COMPANY form carries no
   * company: code binds it), or an approved payload's, already bound.
   */
  readonly document?: unknown;
  /** Why the lead planned it (plain words). */
  readonly why?: string | undefined;
  /** Situation facts it rests on, already grounded by code. */
  readonly evidence?: readonly string[] | undefined;
  /** A contingency for an earlier step (wf 2026-10-16). */
  readonly fallbackFor?: string | undefined;
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
  readonly document?: WorkforceDocumentRequest | undefined;
  readonly budgetUsd: number;
  /** It reaches the other side: every draft is written and reviewed inside. */
  readonly outward: boolean;
  readonly spawned: boolean;
  readonly why?: string | undefined;
  readonly evidence?: readonly string[] | undefined;
  /**
   * Runs only if this earlier step did not finish; what waited on that step
   * then takes this one's result. Approved with the plan, so recovery never
   * runs work the person did not approve.
   */
  readonly fallbackFor?: string | undefined;
};

export const STEP_REFUSALS = [
  "UNKNOWN_ROLE",
  "LEAD_IS_NOT_A_STEP",
  /** A real role with no executor here (incl. WRITER and REVIEWER, which run inside the sender). */
  "NO_EXECUTOR",
  "NO_PERMITTED_TOOL",
  /** The step lacks the one tool its executor acts through (e.g. CONVERSATION without chat.message.send). */
  "MISSING_REQUIRED_TOOL",
  "INVALID_DOCUMENT_REQUEST",
  /** A memo about "the company the job names" when it names none, or several. */
  "NO_NAMED_COMPANY",
  /** A critique of a step that is not an earlier, awaited preparation. */
  "INVALID_CRITIQUE_SOURCE",
  "WAITS_ON_MISSING_STEP",
  /**
   * A fallback for a step that is not an earlier, ordinary kept step; a
   * second fallback for one step; a fallback that waits on its own step;
   * or a step that waits on a fallback rather than the step it covers.
   */
  "INVALID_FALLBACK",
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
  /**
   * The one company the goal names, resolved under the person's own reach
   * (`goalSubjects`). Null or absent: a NAMED_COMPANY document is refused.
   */
  readonly namedCompanyId?: string | null | undefined;
  /** Deep work's step budgets; default DEEP_WORK_STEP_BUDGETS_USD. */
  readonly deepWork?: DeepWorkStepBudgets | undefined;
};

/**
 * Owner 2026-10-23: deep work is budgeted for what it does. A RESEARCH
 * step plans and runs a dozen focused searches and reads their pages; an
 * ANALYSIS document is written, critiqued and revised until it passes. A
 * tenth of a dollar each (the role's default) bought one keyword search
 * and a generic brief. The job's own cap still bounds the whole plan.
 */
export type DeepWorkStepBudgets = {
  readonly researchUsd: number;
  readonly analysisUsd: number;
};
export const DEEP_WORK_STEP_BUDGETS_USD: DeepWorkStepBudgets = {
  researchUsd: 0.6,
  analysisUsd: 1.2,
};

/** What one step may spend: its role's, or deep work's for research and analysis. */
export function stepBudgetUsd(
  role: QAgentRole,
  document: WorkforceDocumentRequest | undefined,
  deepWork: DeepWorkStepBudgets = DEEP_WORK_STEP_BUDGETS_USD,
): number {
  if (role === "RESEARCH") return deepWork.researchUsd;
  if (document !== undefined && isWorkforceAnalysisRequest(document))
    return deepWork.analysisUsd;
  return AGENT_REGISTRY[STORED_ROLE[role]].budgetUsd;
}

/** The planner's NAMED_COMPANY request, before code binds the company. */
const PlannedNamedCompany = z
  .object({
    operation: z.literal("PREPARE"),
    kind: z.enum(["MEMO", "ONE_PAGER", "INVESTMENT_BRIEF", "ANALYSIS"]),
    scope: z.literal("NAMED_COMPANY"),
  })
  .strict();

function bindDocument(
  raw: unknown,
  namedCompanyId: string | null,
):
  | { readonly ok: true; readonly document: WorkforceDocumentRequest }
  | { readonly ok: false; readonly reason: StepRefusal } {
  const planned = PlannedNamedCompany.safeParse(raw);
  if (planned.success) {
    return namedCompanyId === null
      ? { ok: false, reason: "NO_NAMED_COMPANY" }
      : {
          ok: true,
          document: { ...planned.data, companyId: namedCompanyId },
        };
  }
  const parsed = WorkforceDocumentRequestSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, document: parsed.data }
    : { ok: false, reason: "INVALID_DOCUMENT_REQUEST" };
}

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
    if (REQUIRED_TOOLS[role].some((tool) => !tools.includes(tool))) {
      refuse("MISSING_REQUIRED_TOOL");
      continue;
    }
    if (role !== "DOCUMENTS" && step.document !== undefined) {
      refuse("INVALID_DOCUMENT_REQUEST");
      continue;
    }
    const document =
      role === "DOCUMENTS"
        ? bindDocument(step.document, bounds.namedCompanyId ?? null)
        : null;
    if (document !== null && !document.ok) {
      refuse(document.reason);
      continue;
    }
    if (
      document?.ok === true &&
      document.document.operation === "CRITIQUE_AND_REVISE"
    ) {
      // The critic reads a document an earlier step prepared, after it.
      const source = document.document.sourceStep;
      const prepared = kept.find((one) => one.key === source);
      if (
        prepared?.document?.operation !== "PREPARE" ||
        !step.dependsOn.includes(source)
      ) {
        refuse("INVALID_CRITIQUE_SOURCE");
        continue;
      }
    }
    // Only steps already kept can be waited on: a plan runs in order.
    if (step.dependsOn.some((key) => !kept.some((one) => one.key === key))) {
      refuse("WAITS_ON_MISSING_STEP");
      continue;
    }
    if (!fallbackIsValid(step, kept)) {
      refuse("INVALID_FALLBACK");
      continue;
    }
    const stored = STORED_ROLE[role];
    const budgetUsd = stepBudgetUsd(
      role,
      document?.ok === true ? document.document : undefined,
      bounds.deepWork,
    );
    if (spent + budgetUsd > bounds.budgetUsd + 1e-9) {
      refuse("OVER_BUDGET");
      continue;
    }
    spent += budgetUsd;
    kept.push({
      key: step.key,
      role: stored,
      executor: role,
      // The critic is a second specialist, and the person sees it as one.
      agentName:
        document?.ok === true &&
        document.document.operation === "CRITIQUE_AND_REVISE"
          ? "Reviewer"
          : roleTitle(role),
      goal: step.goal,
      tools,
      dependsOn: [...step.dependsOn],
      budgetUsd,
      outward: executor.outward && tools.some((tool) => isOutwardTool(tool)),
      spawned: false,
      ...(document?.ok === true ? { document: document.document } : {}),
      ...(step.why === undefined ? {} : { why: step.why }),
      ...(step.evidence === undefined || step.evidence.length === 0
        ? {}
        : { evidence: [...step.evidence] }),
      ...(step.fallbackFor === undefined
        ? {}
        : { fallbackFor: step.fallbackFor }),
    });
  }
  return { steps: kept, refused, budgetUsd: spent };
}

/**
 * A fallback covers one earlier ordinary step, once, and never waits on it
 * (it runs because that step did not finish). Nothing waits on a fallback:
 * a step waits on the step it covers, and takes the fallback's result.
 */
function fallbackIsValid(
  step: ProposedStep,
  kept: readonly BoundStep[],
): boolean {
  if (
    step.dependsOn.some((key) =>
      kept.some((one) => one.key === key && one.fallbackFor !== undefined),
    )
  ) {
    return false;
  }
  const target = step.fallbackFor;
  if (target === undefined) return true;
  const covered = kept.find((one) => one.key === target);
  return (
    covered !== undefined &&
    covered.fallbackFor === undefined &&
    !step.dependsOn.includes(target) &&
    !kept.some((one) => one.fallbackFor === target)
  );
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
