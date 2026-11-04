import type {
  QVisibleStage,
  WorkforceLive,
  WorkforceLiveStageName,
} from "@capital-q/contracts";

import type { QWorkingStage } from "./stage-line";
import { liveLine } from "./work-live";

/**
 * Owner 2026-11-04 (N2): whenever Q is researching, analysing, drafting,
 * reviewing or preparing a document, one quiet component says where each
 * piece of work really is, from the runtime's own records:
 *
 * - an answer being worked out: the run's durable stage events, in the
 *   order of their sequence (they replay after a refresh or reconnect);
 * - deep work Q took on (a document, research, a plan): the job's row,
 *   whose stage and the stages it has passed are recorded by code as each
 *   one begins, read as its owner.
 *
 * Pure: events and reads in, what to show out. Only stages that occurred
 * are shown (never a fixed pipeline filled in ahead of the work), there is
 * no percentage, no estimate and no agent: approved high-level stages
 * only. Several pieces of work at once are separate streams, each with
 * its own state.
 */

export type WorkStepState = "DONE" | "CURRENT" | "FAILED";

export type WorkStep = {
  /** Stable within its stream: the stage and where it fell. */
  readonly key: string;
  /** English, approved words; the screen translates them. */
  readonly label: string;
  readonly state: WorkStepState;
};

export type WorkStatus =
  | "WORKING"
  | "AWAITING_APPROVAL"
  | "AWAITING_REPLY"
  | "WAITING"
  | "FAILED"
  | "STOPPED"
  | "READY";

export type WorkAction = {
  readonly kind: "OPEN" | "DOWNLOAD";
  readonly label: string;
  readonly artifactId: string;
  /** A download in this format; otherwise the document's first one. */
  readonly format?: "xlsx" | undefined;
};

export type WorkStream = {
  readonly id: string;
  readonly source: "RUN" | "JOB";
  /** What the work is (a job's title); null for an answer being worked out. */
  readonly title: string | null;
  readonly steps: readonly WorkStep[];
  readonly status: WorkStatus;
  /** One plain line beside the status: why it waits or failed. */
  readonly note: string | null;
  /** What the person can do with what it made. Only when READY. */
  readonly actions: readonly WorkAction[];
};

/** The words for a status, beside the work (English; translated on screen). */
export const WORK_STATUS_WORDS: Readonly<Record<WorkStatus, string>> = {
  WORKING: "Working",
  AWAITING_APPROVAL: "Waiting for your approval",
  AWAITING_REPLY: "Waiting for your reply",
  WAITING: "Waiting for you",
  FAILED: "Couldn't finish",
  STOPPED: "Stopped",
  READY: "Ready",
};

/** Waiting on the person is a status, never a step of the work. */
const WAITING_STAGES: ReadonlySet<QVisibleStage> = new Set([
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_REPLY",
]);

/** At most this many steps are listed; the newest are kept. */
export const WORK_STEPS_SHOWN_MAX = 8;

function settle(
  steps: readonly { readonly key: string; readonly label: string }[],
  last: WorkStepState,
): readonly WorkStep[] {
  const shown = steps.slice(-WORK_STEPS_SHOWN_MAX);
  return shown.map((step, index) => ({
    ...step,
    state: index === shown.length - 1 ? last : "DONE",
  }));
}

/** A stage said twice running is one step. */
function collapse<T>(items: readonly T[], same: (a: T, b: T) => boolean): T[] {
  const out: T[] = [];
  for (const item of items) {
    const prior = out.at(-1);
    if (prior === undefined || !same(prior, item)) out.push(item);
  }
  return out;
}

export type RunProgressInput = {
  readonly runId: string | null;
  /** The run's stages so far, oldest first (its durable events). */
  readonly stages: readonly QWorkingStage[];
  /** The run is working (submitted, or streaming and not waiting on them). */
  readonly working: boolean;
  readonly awaitingApproval: boolean;
  readonly awaitingReply: boolean;
  /** The run's public failure line, when it ended without completing. */
  readonly failure: string | null;
  /** The approved words for each stage (the wire's labels, or the line). */
  readonly label: (stage: QWorkingStage) => string;
};

/**
 * An answer being worked out. Null when nothing is happening: a finished
 * answer is its own artifact (its cards carry their actions), so the
 * stream ends with it rather than saying "Ready" over it.
 */
export function runProgress(input: RunProgressInput): WorkStream | null {
  const status: WorkStatus | null =
    input.failure !== null
      ? "FAILED"
      : input.awaitingApproval
        ? "AWAITING_APPROVAL"
        : input.awaitingReply
          ? "AWAITING_REPLY"
          : input.working
            ? "WORKING"
            : null;
  if (status === null) return null;
  const real = collapse(
    input.stages.filter((one) => !WAITING_STAGES.has(one.stage)),
    (a, b) => a.stage === b.stage,
  ).map((one, index) => ({
    key: `${String(index)}:${one.stage}`,
    label: input.label(one),
  }));
  if (real.length === 0 && status !== "WORKING") {
    return {
      id: input.runId ?? "run",
      source: "RUN",
      title: null,
      steps: [],
      status,
      note: input.failure,
      actions: [],
    };
  }
  const last: WorkStepState =
    status === "FAILED" ? "FAILED" : status === "WORKING" ? "CURRENT" : "DONE";
  return {
    id: input.runId ?? "run",
    source: "RUN",
    title: null,
    steps: settle(real, last),
    status,
    note: input.failure,
    actions: [],
  };
}

/**
 * A job's step, as a short approved name ("Researching sources"); the
 * step in progress also carries its live line with the job's real counts
 * ("Read 9 public sources, kept 4 sourced facts").
 */
export const JOB_STEP_WORDS: Readonly<Record<WorkforceLiveStageName, string>> =
  {
    PLANNING_RESEARCH: "Planning the research",
    SEARCHING: "Researching sources",
    READING: "Reading sources",
    CROSS_CHECKING: "Cross-checking findings",
    DRAFTING: "Drafting",
    REVIEWING: "Reviewing evidence",
    REVISING: "Revising",
    FILING: "Preparing the document",
    GATHERING: "Gathering your situation",
    READING_DOCUMENTS: "Reading your documents",
    PLANNING: "Drafting the plan",
    REVIEWING_PLAN: "Reviewing the plan",
  };

/** What the person can do with a finished job's document, by its type. */
export function documentActions(
  document: NonNullable<WorkforceLive["document"]>,
): readonly WorkAction[] {
  const id = document.artifactId;
  switch (document.type) {
    case "SPREADSHEET":
      return [
        { kind: "OPEN", label: "Open spreadsheet", artifactId: id },
        {
          kind: "DOWNLOAD",
          label: "Download spreadsheet",
          artifactId: id,
          format: "xlsx",
        },
      ];
    case "PITCH_DECK":
      return [
        { kind: "OPEN", label: "Open deck", artifactId: id },
        { kind: "DOWNLOAD", label: "Download", artifactId: id },
      ];
    default:
      return [
        { kind: "OPEN", label: "Open document", artifactId: id },
        { kind: "DOWNLOAD", label: "Download", artifactId: id },
      ];
  }
}

export type JobProgressInput = {
  readonly jobId: string;
  /** The plan's words for the work, until the document has a title. */
  readonly title: string;
  /** The job's latest read; null until the first read lands. */
  readonly live: WorkforceLive | null;
  /** The job is not theirs to read, or no longer exists. */
  readonly missing: boolean;
};

/** Deep work Q took on, from the job's own row. Null: nothing to show. */
export function jobProgress(input: JobProgressInput): WorkStream | null {
  if (input.missing) return null;
  const { live } = input;
  const title =
    live?.document?.title ?? live?.stage?.title ?? input.title.trim();
  if (live === null) {
    // Accepted, not read yet: the work, with no step claimed.
    return {
      id: input.jobId,
      source: "JOB",
      title,
      steps: [],
      status: "WORKING",
      note: null,
      actions: [],
    };
  }
  const stage = live.stage;
  const names: readonly WorkforceLiveStageName[] =
    stage === null
      ? []
      : collapse([...(stage.passed ?? []), stage.stage], (a, b) => a === b);
  const steps = names.map((name, index) => ({
    key: `${String(index)}:${name}`,
    label: JOB_STEP_WORDS[name],
  }));
  const status: WorkStatus =
    live.state === "WORKING"
      ? "WORKING"
      : live.state === "WAITING"
        ? "WAITING"
        : live.state === "FAILED"
          ? "FAILED"
          : live.state === "STOPPED"
            ? "STOPPED"
            : "READY";
  const last: WorkStepState =
    status === "WORKING"
      ? "CURRENT"
      : status === "FAILED" || status === "STOPPED"
        ? "FAILED"
        : "DONE";
  return {
    id: input.jobId,
    source: "JOB",
    title,
    steps: settle(steps, last),
    status,
    note:
      status === "WORKING" || status === "READY" ? null : (live.reason ?? null),
    actions:
      status === "READY" && live.document !== null
        ? documentActions(live.document)
        : [],
  };
}

/** The live line under a job's step in progress, with its real counts. */
export function jobStepDetail(live: WorkforceLive | null): string | null {
  if (live?.state !== "WORKING" || live.stage === null) return null;
  const line = liveLine(live.stage);
  return line === JOB_STEP_WORDS[live.stage.stage] ? null : line;
}

/**
 * Every stream on screen, the answer being worked out first and then the
 * jobs, newest first as given; a finished job leaves once its document's
 * own card has arrived (`delivered`).
 */
export function workStreams(
  run: WorkStream | null,
  jobs: readonly (WorkStream | null)[],
  delivered: ReadonlySet<string> = new Set(),
): readonly WorkStream[] {
  const out: WorkStream[] = [];
  if (run !== null) out.push(run);
  for (const job of jobs) {
    if (job === null || delivered.has(job.id)) continue;
    out.push(job);
  }
  return out;
}
