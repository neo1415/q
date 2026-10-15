import type { QAgentRole } from "@capital-q/contracts";

import { signalsOf } from "./goal-plan.js";
import type { BoundStep } from "./plan.js";
import { AGENT_REGISTRY, type AgentRole } from "./registry.js";

/**
 * Running a bounded plan (founder brief J1, J4, J9; recovery D1, D3).
 *
 * The lead Q's run opens the job; each step becomes one agent run, spawned
 * by the lead. A step waits for the steps it names; when one
 * of those did not finish, it is skipped with the reason rather than run
 * on a guess. Every hand-off (lead to agent, agent to the agent that waits
 * on it) is recorded, so the workforce page shows who did what and why.
 *
 * Steps run as soon as what they wait on has settled; outward steps keep
 * plan order among themselves.
 *
 * Executors are ports by registered role (`executors.ts`). A step with no
 * executor goes to the person. A job resumed after a restart skips the
 * steps that already finished (the recorder's `prior`): every side effect
 * a step has is idempotent by key, so re-running an interrupted step is
 * safe, but a finished one is never run twice.
 */

export type StepStatus = "DONE" | "HELD" | "FAILED" | "SKIPPED";

export type StepResult = {
  readonly status: Exclude<StepStatus, "SKIPPED">;
  /** One line for the timeline, in plain words. */
  readonly summary: string;
  /** What later steps may read (ids, counts), never free text from a model. */
  readonly outputs?: Readonly<Record<string, unknown>> | undefined;
};

export type AgentContext = {
  readonly jobId: string;
  readonly runId: string;
  /** Finished steps' results by key. */
  readonly results: ReadonlyMap<string, StepResult>;
};

export type AgentExecutor = (
  step: BoundStep,
  context: AgentContext,
) => Promise<StepResult>;

export type JobRecorder = {
  readonly startRun: (input: {
    readonly jobId: string;
    readonly role: AgentRole;
    readonly agentName: string;
    readonly goal: string;
    readonly tools: readonly string[];
    readonly budgetUsd: number;
    readonly stepKey: string | null;
    readonly spawnedByRunId: string | null;
  }) => Promise<string>;
  readonly endRun: (
    runId: string,
    status: StepStatus,
    summary: string,
  ) => Promise<void>;
  readonly handoff: (input: {
    readonly jobId: string;
    readonly fromRunId: string;
    readonly toRunId: string;
    readonly note: string;
  }) => Promise<void>;
  /**
   * D3 (resume): this job's earlier run of a step, when one finished. A
   * run a restart left RUNNING is ended (FAILED, "interrupted") by the
   * recorder and reported as null, so the step runs again.
   */
  readonly prior?:
    ((jobId: string, stepKey: string) => Promise<PriorRun | null>) | undefined;
};

export type PriorRun = {
  /** The finished step's own run, when known (hand-offs name it). */
  readonly runId: string | null;
  readonly status: Exclude<StepStatus, "SKIPPED">;
  readonly summary: string;
  /** What later steps may read (a shortlist), kept with the job. */
  readonly outputs?: Readonly<Record<string, unknown>> | undefined;
};

export type JobRunResult = {
  readonly leadRunId: string;
  readonly steps: readonly {
    readonly key: string;
    readonly runId: string;
    readonly status: StepStatus;
    readonly summary: string;
    /**
     * False for a fallback that was not needed, and for a step that did
     * not finish but whose fallback did: neither decides the job's status.
     */
    readonly counts?: boolean | undefined;
  }[];
};

/** The registered executor that runs a step; null: the person's. */
export function executorFor(
  step: BoundStep,
  executors: Partial<Record<QAgentRole, AgentExecutor>>,
): AgentExecutor | null {
  return step.executor === null ? null : (executors[step.executor] ?? null);
}

export async function runJob(input: {
  readonly jobId: string;
  readonly goal: string;
  readonly steps: readonly BoundStep[];
  readonly executors: Partial<Record<QAgentRole, AgentExecutor>>;
  readonly recorder: JobRecorder;
  /** A step's executor threw: the cause, for the operator's log. */
  readonly onStepError?:
    | ((failure: {
        readonly jobId: string;
        readonly stepKey: string;
        readonly runId: string;
        readonly error: unknown;
      }) => void)
    | undefined;
}): Promise<JobRunResult> {
  const { recorder, jobId } = input;
  const leadRunId = await recorder.startRun({
    jobId,
    role: "LEAD",
    agentName: AGENT_REGISTRY.LEAD.title,
    goal: input.goal.slice(0, 400),
    tools: [],
    budgetUsd: AGENT_REGISTRY.LEAD.budgetUsd,
    stepKey: null,
    spawnedByRunId: null,
  });
  const results = new Map<string, StepResult>();
  const runs = new Map<string, string>();
  const out: ({
    key: string;
    runId: string;
    status: StepStatus;
    summary: string;
  } | null)[] = input.steps.map(() => null);
  /** Steps that do not decide the job's status (see JobRunResult). */
  const counts = new Map<string, boolean>();

  const fallbacksOf = (key: string) =>
    input.steps.filter((one) => one.fallbackFor === key);
  /** A step's result, or its fallback's when the step did not finish. */
  const effective = (key: string): StepResult | undefined => {
    const own = results.get(key);
    if (own?.status === "DONE") return own;
    const covered = fallbacksOf(key)
      .map((one) => results.get(one.key))
      .find((one) => one?.status === "DONE");
    return covered ?? own;
  };
  /** What a step reads: each dependency's effective result. */
  const viewFor = (step: BoundStep): ReadonlyMap<string, StepResult> => {
    const view = new Map(results);
    for (const key of step.dependsOn) {
      const one = effective(key);
      if (one !== undefined) view.set(key, one);
    }
    return view;
  };
  /** Every step this one waits on, directly or through others. */
  const upstream = (step: BoundStep): ReadonlySet<string> => {
    const seen = new Set<string>();
    const visit = (key: string) => {
      if (seen.has(key)) return;
      seen.add(key);
      for (const fallback of fallbacksOf(key)) visit(fallback.key);
      const found = input.steps.find((one) => one.key === key);
      for (const next of found?.dependsOn ?? []) visit(next);
    };
    for (const key of step.dependsOn) visit(key);
    return seen;
  };

  const runStep = async (step: BoundStep, index: number): Promise<void> => {
    const before = await recorder.prior?.(jobId, step.key);
    if (before != null && before.status !== "FAILED") {
      // Finished before a restart: its result stands, never redone.
      if (before.runId !== null) runs.set(step.key, before.runId);
      results.set(step.key, {
        status: before.status,
        summary: before.summary,
        outputs: before.outputs,
      });
      if (before.status === "DONE" && step.fallbackFor !== undefined) {
        counts.set(step.fallbackFor, false);
      }
      out[index] = {
        key: step.key,
        runId: before.runId ?? "",
        status: before.status,
        summary: before.summary,
      };
      return;
    }
    const runId = await recorder.startRun({
      jobId,
      role: step.role,
      agentName: step.agentName,
      goal: step.goal,
      tools: step.tools,
      budgetUsd: step.budgetUsd,
      stepKey: step.key,
      spawnedByRunId: leadRunId,
    });
    runs.set(step.key, runId);
    await recorder.handoff({
      jobId,
      fromRunId: leadRunId,
      toRunId: runId,
      note: step.spawned
        ? `Spawned ${step.agentName} for: ${step.goal}`.slice(0, 500)
        : `Assigned: ${step.goal}`.slice(0, 500),
    });
    for (const key of step.dependsOn) {
      const from = runs.get(key);
      if (from !== undefined) {
        await recorder.handoff({
          jobId,
          fromRunId: from,
          toRunId: runId,
          note: (results.get(key)?.summary ?? "Handed on.").slice(0, 500),
        });
      }
    }
    const blocked = step.dependsOn.find(
      (key) => effective(key)?.status !== "DONE",
    );
    // An outward step never goes out on top of a contradiction an earlier
    // step found: contradictions coexist until the person reconciles them.
    const contradiction = step.outward
      ? [...upstream(step)]
          .flatMap((key) => signalsOf(results.get(key)?.outputs))
          .find((signal) => signal.kind === "CONTRADICTION")
      : undefined;
    const covered =
      step.fallbackFor === undefined
        ? undefined
        : results.get(step.fallbackFor);
    let status: StepStatus;
    let summary: string;
    if (covered?.status === "DONE") {
      status = "SKIPPED";
      const name =
        input.steps.find((one) => one.key === step.fallbackFor)?.agentName ??
        "the step it covers";
      summary = `Not needed: ${name} finished.`;
      counts.set(step.key, false);
    } else if (blocked !== undefined) {
      status = "SKIPPED";
      // Plain words: the step's own agent, never its plan key.
      const waitedOn =
        input.steps.find((one) => one.key === blocked)?.agentName ??
        "an earlier step";
      summary = `Waited on ${waitedOn}, which did not finish.`;
    } else if (contradiction !== undefined) {
      status = "HELD";
      summary =
        `Held before anything went out: an earlier step found a contradiction (${contradiction.note}). It needs your eye first.`.slice(
          0,
          500,
        );
    } else {
      const executor = executorFor(step, input.executors);
      if (executor === null) {
        status = "HELD";
        summary = "No agent can do this step on its own; it needs you.";
      } else {
        const result = await executor(step, {
          jobId,
          runId,
          results: viewFor(step),
        }).catch((error: unknown): StepResult => {
          // Kept for whoever operates the job; the person sees plain words.
          input.onStepError?.({ jobId, stepKey: step.key, runId, error });
          return {
            status: "FAILED",
            summary: "This step failed; nothing was sent.",
          };
        });
        status = result.status;
        summary = result.summary;
        results.set(step.key, result);
        // A fallback that finished stands in for the step it covers.
        if (status === "DONE" && step.fallbackFor !== undefined) {
          counts.set(step.fallbackFor, false);
        }
      }
    }
    await recorder.endRun(runId, status, summary.slice(0, 500));
    out[index] = { key: step.key, runId, status, summary };
  };

  // Steps start as soon as the steps they wait on have settled, so
  // independent work (research beside a shortlist) runs side by side.
  // Steps that reach the other side still go one at a time, in plan
  // order: two sends or bookings never race on the same thread. A step
  // also waits on the fallbacks of what it waits on, and a fallback on the
  // step it covers, so recovery is settled before anything reads it.
  const settled = new Map<string, { promise: Promise<void>; resolve: () => void }>();
  for (const step of input.steps) {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    settled.set(step.key, { promise, resolve });
  }
  const waitOn = (key: string) => settled.get(key)?.promise ?? Promise.resolve();
  const all: Promise<void>[] = [];
  let outwardTail: Promise<void> = Promise.resolve();
  for (const [index, step] of input.steps.entries()) {
    const ready = Promise.all([
      ...step.dependsOn.flatMap((key) => [
        waitOn(key),
        ...fallbacksOf(key).map((one) => waitOn(one.key)),
      ]),
      ...(step.fallbackFor === undefined ? [] : [waitOn(step.fallbackFor)]),
    ]);
    let running: Promise<void>;
    if (step.outward) {
      running = Promise.all([ready, outwardTail]).then(() =>
        runStep(step, index),
      );
      outwardTail = running.catch(() => undefined);
    } else {
      running = ready.then(() => runStep(step, index));
    }
    const own = settled.get(step.key);
    void running.then(
      () => own?.resolve(),
      () => own?.resolve(),
    );
    all.push(running);
  }
  // A recorder failure still ends the pass, as it did when steps ran in
  // a line: the queue takes the job back and resumes it.
  await Promise.all(all);
  const finished: JobRunResult["steps"][number][] = out
    .filter((one): one is NonNullable<typeof one> => one !== null)
    .map((one) =>
      counts.get(one.key) === false ? { ...one, counts: false } : one,
    );
  const counted = finished.filter((step) => step.counts !== false);
  const done = counted.filter((step) => step.status === "DONE").length;
  // The lead's run says DONE only when every step is done: a job with a
  // failed or held step is not finished, whatever else got through. A
  // fallback that was not needed, or a step a fallback stood in for, is
  // not counted either way.
  await recorder.endRun(
    leadRunId,
    counted.length > 0 && done === counted.length ? "DONE" : "HELD",
    `${String(done)} of ${String(counted.length)} steps done.`,
  );
  return { leadRunId, steps: finished };
}
