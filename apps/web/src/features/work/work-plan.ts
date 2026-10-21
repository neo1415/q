import type {
  QApprovalView,
  WorkforceInstructionDto,
  WorkforceJobDetailDto,
  WorkforceJobSummaryDto,
} from "@capital-q/contracts";

import { jobTitle } from "./workforce-view";

/**
 * "How Q is handling it", option 2: the plan (owner 2026-10-21; prototype
 * workteam-2). Code turns what the server recorded -- each job's approved
 * plan and its progress, its approval cards, and each standing
 * instruction's steps -- into one plan per piece of work: what it works
 * towards, each step with its worker, state, what it did and what it rests
 * on, the step that waits for the person's yes, contradictions the steps
 * found, and what is missing or not known. Nothing here is generated: a
 * step with no recorded result says so.
 */

export type PlanStepState = "done" | "now" | "next" | "held";

export type PlanStep = {
  readonly key: string;
  readonly title: string;
  /** The worker on it, in plain words (a role's name or a helper's). */
  readonly who: string | null;
  readonly state: PlanStepState;
  /** "09:04", "Mon", "Now", "Next": when, or where it stands. */
  readonly at: string | null;
  readonly did: string | null;
  readonly why: string | null;
  readonly based: readonly string[];
  /** The approval this step waits on: open it to decide. */
  readonly approvalId: string | null;
  /** A word for a step that did not run as planned. */
  readonly note: string | null;
};

export type PlanMissing = {
  readonly what: string;
  readonly status: "MISSING" | "UNKNOWN";
  readonly words: string;
};

export type PlanEntry = {
  readonly id: string;
  readonly kind: "JOB" | "INSTRUCTION";
  readonly title: string;
  readonly goal: string;
  readonly state: string;
  readonly waiting: boolean;
  readonly forWords: string;
  readonly spentUsd: string | null;
  readonly contradictions: readonly string[];
  readonly steps: readonly PlanStep[];
  readonly missing: readonly PlanMissing[];
  /** The approvals the plan waits on, read in full where the server had them. */
  readonly approvals: ReadonlyMap<string, QApprovalView>;
};

const FOR_WORDS: Readonly<Record<WorkforceJobSummaryDto["source"], string>> = {
  JOB: "A task you gave Q",
  INSTRUCTION: "Your standing instruction",
  DELEGATED_WORK: "Work you handed to Q",
  ERRAND: "An errand you asked for",
  MEETING_FOLLOW_UP: "After your meeting",
  EMAIL_DRAFT: "An email Q drafted for you",
};

const JOB_STATE: Readonly<Record<WorkforceJobSummaryDto["status"], string>> = {
  PLANNING: "Planning",
  RUNNING: "Running",
  DONE: "Done",
  HELD: "Waiting for you",
  STOPPED: "Stopped",
  FAILED: "Did not finish",
};

const STEP_NOTE = {
  FAILED: "Did not finish",
  SKIPPED: "Did not run",
  NOT_NEEDED: "Not needed",
} as const;

function clock(iso: string | null | undefined): string | null {
  if (iso === null || iso === undefined) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

function pendingApprovals(
  detail: WorkforceJobDetailDto,
): readonly QApprovalView[] {
  return (detail.approvals ?? []).filter(
    (one) => one.status === "PENDING" && one.canDecide,
  );
}

function jobSteps(detail: WorkforceJobDetailDto): PlanStep[] {
  const plan = detail.plan;
  const running =
    detail.job.status === "RUNNING" || detail.job.status === "PLANNING";
  if (plan !== undefined && plan.steps.length > 0) {
    const done = new Set(
      plan.steps
        .filter((step) => step.status === "DONE")
        .map((step) => step.key),
    );
    let nowTaken = false;
    return plan.steps.map((step) => {
      // The run that did it, when the worker and goal match one.
      const run = detail.agents.find(
        (one) => one.agentName === step.who && one.goal === step.does,
      );
      let state: PlanStepState = "next";
      if (step.status === "DONE") state = "done";
      else if (step.status === "HELD") state = "held";
      else if (
        step.status === "WAITING" &&
        running &&
        !nowTaken &&
        step.dependsOn.every((key) => done.has(key))
      ) {
        state = "now";
        nowTaken = true;
      }
      const note =
        step.status === "FAILED" ||
        step.status === "SKIPPED" ||
        step.status === "NOT_NEEDED"
          ? STEP_NOTE[step.status]
          : step.status === "HELD"
            ? "Needs you"
            : null;
      return {
        key: step.key,
        title: step.does,
        who: step.who,
        state,
        at:
          state === "done"
            ? clock(run?.endedAt ?? run?.startedAt)
            : state === "now"
              ? "Now"
              : null,
        did: step.summary,
        why: step.why,
        based: step.evidence.map((fact) => fact.text),
        approvalId: null,
        note,
      };
    });
  }
  // An older job without a plan: its runs, as they ran.
  return detail.agents.map((run) => ({
    key: run.id,
    title: run.goal,
    who: run.agentName,
    state:
      run.status === "DONE"
        ? "done"
        : run.status === "RUNNING"
          ? "now"
          : run.status === "HELD"
            ? "held"
            : "next",
    at: run.status === "RUNNING" ? "Now" : clock(run.endedAt ?? run.startedAt),
    did: run.summary,
    why: null,
    based: [],
    approvalId: null,
    note:
      run.status === "FAILED"
        ? STEP_NOTE.FAILED
        : run.status === "SKIPPED"
          ? STEP_NOTE.SKIPPED
          : null,
  }));
}

/** One job's plan: its steps, with the yes it waits on placed after the done ones. */
export function jobPlan(detail: WorkforceJobDetailDto): PlanEntry {
  const waiting = pendingApprovals(detail);
  const steps = jobSteps(detail);
  if (waiting.length > 0) {
    const firstOpen = steps.findIndex((step) => step.state !== "done");
    const at = firstOpen === -1 ? steps.length : firstOpen;
    const yes: PlanStep[] = waiting.map((approval) => ({
      key: `yes:${approval.approvalId}`,
      title: "Your yes",
      who: null,
      state: "now",
      at: `since ${clock(approval.requestedAt) ?? ""}`.trim(),
      did: approval.action.summary,
      why: null,
      based: [],
      approvalId: approval.approvalId,
      note: null,
    }));
    // While a yes is waiting, nothing else is "now".
    const before = steps
      .slice(0, at)
      .map((step) => (step.state === "now" ? { ...step, state: "next" as const, at: null } : step));
    const after = steps
      .slice(at)
      .map((step) => (step.state === "now" ? { ...step, state: "next" as const, at: null } : step));
    steps.splice(0, steps.length, ...before, ...yes, ...after);
  }
  const plan = detail.plan;
  const missing: PlanMissing[] = [
    ...(plan?.prerequisites ?? [])
      .filter((one) => one.status !== "MET")
      .map((one) => ({
        what: one.what,
        status: one.status === "MISSING" ? ("MISSING" as const) : ("UNKNOWN" as const),
        words: one.blocking ? "Needed for the outcome" : "Not needed to go on",
      })),
    ...(plan?.signals ?? [])
      .filter((one) => one.kind === "MISSING_INFORMATION")
      .map((one) => ({
        what: one.note,
        status: "UNKNOWN" as const,
        words: "Found by a step",
      })),
  ];
  return {
    id: detail.job.id,
    kind: "JOB",
    title: jobTitle(detail.job.goal),
    goal: plan?.outcome ?? detail.job.goal,
    state: waiting.length > 0 ? "Waiting for your yes" : JOB_STATE[detail.job.status],
    waiting: waiting.length > 0 || detail.job.status === "HELD",
    forWords: FOR_WORDS[detail.job.source],
    spentUsd: detail.job.costUsd,
    contradictions: (plan?.signals ?? [])
      .filter((one) => one.kind === "CONTRADICTION")
      .map((one) => one.note),
    steps,
    missing,
    approvals: new Map(waiting.map((one) => [one.approvalId, one])),
  };
}

const INSTRUCTION_STEP_NOTE = {
  REFUSED: "Refused: outside what you allowed",
  FAILED: "Did not finish",
} as const;

/** A standing instruction's day: its steps, oldest first, and its next run. */
export function instructionPlan(
  instruction: WorkforceInstructionDto,
): PlanEntry {
  const steps: PlanStep[] = [...instruction.steps]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((step, index) => {
      const waits =
        step.status === "ASKED" && step.approvalStatus === "PENDING";
      return {
        key: `${step.at}:${String(index)}`,
        title: step.words,
        who: null,
        state: waits
          ? "now"
          : step.status === "DONE" || step.status === "NOTED"
            ? "done"
            : step.status === "ASKED"
              ? "done"
              : "next",
        at: waits ? "Needs your yes" : clock(step.at),
        did:
          step.status === "ASKED" && !waits
            ? step.approvalStatus === "APPROVED"
              ? "You approved it."
              : step.approvalStatus === "REJECTED"
                ? "You declined it."
                : step.approvalStatus === "EXPIRED"
                  ? "It lapsed before you decided."
                  : null
            : null,
        why: null,
        based: [],
        approvalId: waits ? step.approvalId : null,
        note:
          step.status === "REFUSED" || step.status === "FAILED"
            ? INSTRUCTION_STEP_NOTE[step.status]
            : null,
      };
    });
  if (instruction.status === "ACTIVE" && instruction.nextRunAt !== null) {
    steps.push({
      key: "next-run",
      title: "Next run",
      who: null,
      state: "next",
      at: clock(instruction.nextRunAt),
      did: null,
      why: null,
      based: [],
      approvalId: null,
      note: null,
    });
  }
  const waiting = steps.some((step) => step.approvalId !== null);
  return {
    id: instruction.id,
    kind: "INSTRUCTION",
    title: jobTitle(instruction.goal),
    goal: instruction.goal,
    state:
      instruction.status === "PAUSED"
        ? "Paused"
        : waiting
          ? "Waiting for your yes"
          : "Running",
    waiting,
    forWords: "Your standing instruction",
    spentUsd: null,
    contradictions: [],
    steps,
    missing: [],
    approvals: new Map(),
  };
}

/** Every piece of work, what waits for the person first, then the newest. */
export function planEntries(input: {
  readonly jobs: readonly WorkforceJobDetailDto[];
  readonly instructions: readonly WorkforceInstructionDto[];
}): readonly PlanEntry[] {
  const all = [
    ...input.jobs.map(jobPlan),
    ...input.instructions.map(instructionPlan),
  ];
  return [...all.filter((one) => one.waiting), ...all.filter((one) => !one.waiting)];
}
