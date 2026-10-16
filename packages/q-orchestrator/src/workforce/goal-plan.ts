import { z } from "zod";

import {
  WorkforceSignalSchema,
  type WorkforceJobReasoning,
  type WorkforceNextAction,
  type WorkforcePlanProgress,
  type WorkforcePrerequisite,
  type WorkforceSignal,
  type WorkforceSituationFact,
} from "@capital-q/contracts";

import {
  movesAsNextActions,
  needsApproval,
  type JobSituation,
} from "./situation.js";

/**
 * The lead Q's goal model, checked by code (wf 2026-10-16).
 *
 * The planner proposes an outcome, prerequisites, a reason and evidence
 * for each step, and next actions. Code keeps only evidence that is a fact
 * in the situation it was shown (an invented reference is dropped and
 * counted), never lets a prerequisite read as MET without evidence, and
 * decides which next actions need approval from the tool's class. After
 * the job runs, `nextSteps` and `planProgress` are derived from the
 * approved plan and what its steps recorded -- no model at read time.
 */

export type ProposedReasoning = {
  readonly outcome: string;
  readonly prerequisites: readonly {
    readonly what: string;
    readonly status: "MET" | "MISSING" | "UNKNOWN";
    readonly blocking: boolean;
    readonly evidence: readonly string[];
    readonly resolvedBy: string | null;
  }[];
  readonly nextActions: readonly {
    readonly action: string;
    readonly why: string;
    readonly evidence: readonly string[];
    readonly tool: string | null;
  }[];
};

export type GroundedReasoning = {
  readonly reasoning: WorkforceJobReasoning;
  /** Evidence references the model gave that are not facts: dropped. */
  readonly droppedRefs: number;
};

const NEXT_ACTIONS_PLANNED_MAX = 6;

/** Facts that say something is still to happen, or is not known. */
const PENDING_KINDS: ReadonlySet<string> = new Set([
  "YOUR_MOVE",
  "THEIR_MOVE",
  "WAITING_APPROVAL",
  "MESSAGE_WAITING",
  "UNKNOWN",
]);
const NEXT_ACTIONS_MAX = 8;

function refsIn(
  refs: readonly string[],
  known: ReadonlySet<string>,
  dropped: { count: number },
): string[] {
  // A model may write "F3", "f3", "[F3]" or "F3 [OPEN_REQUEST] ...": the F
  // number is read out of it, and only a fact the lead was shown is kept.
  const asked = [
    ...new Set(
      refs.map((ref) => {
        const found = /\bF([1-9][0-9]?)\b/iu.exec(ref);
        return found === null ? ref : `F${found[1] ?? ""}`;
      }),
    ),
  ];
  const kept = asked.filter((ref) => known.has(ref));
  dropped.count += asked.length - kept.length;
  return kept.slice(0, 6);
}

/** Grounds the planner's reasoning in the situation and the kept steps. */
export function groundReasoning(
  proposed: ProposedReasoning,
  situation: JobSituation,
  steps: readonly {
    readonly key: string;
    readonly evidence?: readonly string[] | undefined;
  }[],
): GroundedReasoning {
  const known = new Set(situation.facts.map((fact) => fact.ref));
  const kinds = new Map(situation.facts.map((fact) => [fact.ref, fact.kind]));
  const keys = new Set(steps.map((step) => step.key));
  const dropped = { count: 0 };
  const prerequisites: WorkforcePrerequisite[] = proposed.prerequisites
    .slice(0, 8)
    .map((one) => {
      const evidence = refsIn(one.evidence, known, dropped);
      return {
        what: one.what.slice(0, 300),
        // Met is a claim about the record: without a fact that shows it
        // in place, it is not known (never presented as verified). A move
        // still to make, something waiting or an unread source never shows
        // anything in place (live 2026-10-16: "the call has been set up"
        // was marked MET from "your move: set up a call").
        status:
          one.status === "MET" &&
          !evidence.some(
            (ref) => !PENDING_KINDS.has(kinds.get(ref) ?? "UNKNOWN"),
          )
            ? "UNKNOWN"
            : one.status,
        blocking: one.blocking,
        evidence,
        resolvedBy:
          one.resolvedBy !== null && keys.has(one.resolvedBy)
            ? one.resolvedBy
            : null,
      };
    });
  const planned: WorkforceNextAction[] = proposed.nextActions
    .slice(0, NEXT_ACTIONS_PLANNED_MAX)
    .map((one) => ({
      action: one.action.slice(0, 300),
      why: one.why.slice(0, 300),
      evidence: refsIn(one.evidence, known, dropped),
      tool: one.tool,
      needsApproval: needsApproval(one.tool),
      source: "PLAN" as const,
    }));
  // The person's own moves the plan does not already take up, and the
  // lead did not already recommend.
  const cited = new Set([
    ...steps.flatMap((step) => step.evidence ?? []),
    ...planned.flatMap((one) => one.evidence),
  ]);
  const moves = movesAsNextActions(situation).filter(
    (one) => !one.evidence.some((ref) => cited.has(ref)),
  );
  return {
    reasoning: {
      outcome: proposed.outcome.slice(0, 400),
      prerequisites,
      nextActions: [...planned, ...moves].slice(0, NEXT_ACTIONS_PLANNED_MAX),
      situation: [...situation.facts],
    },
    droppedRefs: dropped.count,
  };
}

/** Step evidence kept only when it is a fact the lead was shown. */
export function groundStepEvidence(
  evidence: readonly string[] | undefined,
  situation: JobSituation,
): { readonly evidence: readonly string[]; readonly dropped: number } {
  const known = new Set(situation.facts.map((fact) => fact.ref));
  const dropped = { count: 0 };
  return {
    evidence: refsIn(evidence ?? [], known, dropped),
    dropped: dropped.count,
  };
}

// ---------------------------------------------------------------------------
// Signals: what a step found that changes what should happen next.
// ---------------------------------------------------------------------------

const SignalsSchema = z.array(WorkforceSignalSchema).max(12);

/** The signals a step recorded in its outputs (typed, never free text). */
export function signalsOf(
  outputs: Readonly<Record<string, unknown>> | undefined,
): readonly WorkforceSignal[] {
  const parsed = SignalsSchema.safeParse(outputs?.["signals"]);
  return parsed.success ? parsed.data : [];
}

/** A document critique's findings as signals (CONTRADICTION, MISSING_INFORMATION). */
export function reviewSignals(
  review:
    | {
        readonly issues: readonly {
          readonly kind: string;
          readonly section: string;
          readonly problem: string;
        }[];
      }
    | undefined,
  stepKey: string,
): readonly WorkforceSignal[] {
  return (review?.issues ?? [])
    .flatMap((issue): WorkforceSignal[] =>
      issue.kind === "CONTRADICTION" || issue.kind === "MISSING_INFORMATION"
        ? [
            {
              kind: issue.kind,
              note: `${issue.section}: ${issue.problem}`.slice(0, 300),
              stepKey: stepKey.slice(0, 40),
            },
          ]
        : [],
    )
    .slice(0, 12);
}

// ---------------------------------------------------------------------------
// After the job: what is most valuable next, and where the plan stands.
// ---------------------------------------------------------------------------

export type PlanStepRecord = {
  readonly key: string;
  readonly who: string;
  readonly goal: string;
  readonly tools: readonly string[];
  readonly dependsOn: readonly string[];
  readonly why?: string | undefined;
  readonly evidence?: readonly string[] | undefined;
  readonly fallbackFor?: string | undefined;
};

export type StepOutcome = {
  readonly status: "DONE" | "HELD" | "FAILED" | "SKIPPED";
  readonly summary: string | null;
  readonly outputs?: Readonly<Record<string, unknown>> | undefined;
};

function settledBy(
  step: PlanStepRecord,
  steps: readonly PlanStepRecord[],
  outcomes: ReadonlyMap<string, StepOutcome>,
): boolean {
  if (outcomes.get(step.key)?.status === "DONE") return true;
  return steps.some(
    (one) =>
      one.fallbackFor === step.key && outcomes.get(one.key)?.status === "DONE",
  );
}

/**
 * The next valuable actions, from the job's own record: contradictions to
 * reconcile and missing information to ask for (what steps found), work
 * that did not finish, then the lead's planned next actions and the
 * person's own moves the job did not take up. Deterministic.
 */
export function nextSteps(input: {
  readonly reasoning: WorkforceJobReasoning | undefined;
  readonly steps: readonly PlanStepRecord[];
  readonly outcomes: ReadonlyMap<string, StepOutcome>;
}): readonly WorkforceNextAction[] {
  const { steps, outcomes } = input;
  const out: WorkforceNextAction[] = [];
  const signals = steps.flatMap((step) =>
    signalsOf(outcomes.get(step.key)?.outputs),
  );
  const asked = steps.some(
    (step) =>
      step.tools.includes("diligence.questions.prepare") &&
      outcomes.get(step.key)?.status === "DONE",
  );
  for (const signal of signals) {
    if (signal.kind === "CONTRADICTION") {
      out.push({
        action: `Reconcile before relying on it: ${signal.note}`.slice(0, 300),
        why: "Two sources disagree. Both are kept until you settle which holds.",
        evidence: [],
        tool: null,
        needsApproval: false,
        source: "RESULT",
      });
    } else if (signal.kind === "MISSING_INFORMATION" && !asked) {
      out.push({
        action: `Ask the founder: ${signal.note}`.slice(0, 300),
        why: "It is not known, and the work depends on it.",
        evidence: [],
        tool: "diligence.questions.prepare",
        needsApproval: true,
        source: "RESULT",
      });
    }
  }
  for (const step of steps) {
    if (step.fallbackFor !== undefined) continue;
    const outcome = outcomes.get(step.key);
    if (outcome === undefined || outcome.status === "DONE") continue;
    if (settledBy(step, steps, outcomes)) continue;
    const tool = step.tools[0] ?? null;
    out.push({
      action:
        outcome.status === "HELD"
          ? `Look at what ${step.who} held: ${step.goal}`.slice(0, 300)
          : `Try again: ${step.goal}`.slice(0, 300),
      why: (outcome.summary ?? "It did not finish.").slice(0, 300),
      evidence: [...(step.evidence ?? [])].slice(0, 6),
      tool: outcome.status === "HELD" ? null : tool,
      needsApproval: outcome.status === "HELD" ? false : needsApproval(tool),
      source: "RESULT",
    });
  }
  // The person's moves a finished step already took up are not next.
  const covered = new Set(
    steps
      .filter((step) => outcomes.get(step.key)?.status === "DONE")
      .flatMap((step) => step.evidence ?? []),
  );
  for (const one of input.reasoning?.nextActions ?? []) {
    if (
      one.source === "SITUATION" &&
      one.evidence.length > 0 &&
      one.evidence.every((ref) => covered.has(ref))
    )
      continue;
    out.push(one);
  }
  const seen = new Set<string>();
  return out
    .filter((one) => {
      const key = one.action.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, NEXT_ACTIONS_MAX);
}

/** Where the approved plan stands, step by step. */
export function planProgress(input: {
  readonly reasoning: WorkforceJobReasoning | undefined;
  readonly steps: readonly PlanStepRecord[];
  readonly outcomes: ReadonlyMap<string, StepOutcome>;
  /** The job has stopped: a step with no record did not run. */
  readonly finished: boolean;
}): WorkforcePlanProgress {
  const { steps, outcomes } = input;
  const facts = new Map(
    (input.reasoning?.situation ?? []).map((fact) => [fact.ref, fact]),
  );
  const shown = steps.slice(0, 12).map((step) => {
    const outcome = outcomes.get(step.key);
    const target =
      step.fallbackFor === undefined
        ? undefined
        : steps.find((one) => one.key === step.fallbackFor);
    // A fallback that did not run because its step finished, or is
    // waiting on the person, was never needed (it runs only on failure).
    const targetStatus =
      target === undefined ? undefined : outcomes.get(target.key)?.status;
    const notNeeded =
      (outcome === undefined || outcome.status === "SKIPPED") &&
      (targetStatus === "DONE" || targetStatus === "HELD");
    return {
      key: step.key.slice(0, 40),
      who: step.who.slice(0, 60),
      does: step.goal.slice(0, 400),
      why: step.why?.slice(0, 300) ?? null,
      status: notNeeded
        ? ("NOT_NEEDED" as const)
        : (outcome?.status ??
          (input.finished ? ("SKIPPED" as const) : ("WAITING" as const))),
      summary: outcome?.summary?.slice(0, 500) ?? null,
      dependsOn: [...step.dependsOn].slice(0, 8),
      fallbackFor: step.fallbackFor ?? null,
      evidence: (step.evidence ?? [])
        .flatMap((ref): WorkforceSituationFact[] => {
          const fact = facts.get(ref);
          return fact === undefined ? [] : [fact];
        })
        .slice(0, 6),
    };
  });
  const counted = shown.filter((step) => step.status !== "NOT_NEEDED");
  return {
    outcome: input.reasoning?.outcome ?? null,
    done: counted.filter((step) => step.status === "DONE").length,
    total: counted.length,
    steps: shown,
    prerequisites: [...(input.reasoning?.prerequisites ?? [])].slice(0, 8),
    signals: steps
      .flatMap((step) => signalsOf(outcomes.get(step.key)?.outputs))
      .slice(0, 12),
    nextActions: [...nextSteps(input)],
    situation: [...(input.reasoning?.situation ?? [])],
  };
}
