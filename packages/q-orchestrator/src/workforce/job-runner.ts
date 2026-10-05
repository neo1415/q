import type { BoundStep } from "./plan.js";
import { AGENT_REGISTRY, type AgentRole } from "./registry.js";

/**
 * Running a bounded plan (founder brief J1, J4, J9).
 *
 * The lead Q's run opens the job; each step becomes one agent run, spawned
 * by the lead, in plan order. A step waits for the steps it names; when one
 * of those did not finish, it is skipped with the reason rather than run
 * on a guess. Every hand-off (lead to agent, agent to the agent that waits
 * on it) is recorded, so the workforce page shows who did what and why.
 *
 * Executors are ports by role. An ad-hoc agent is run by the executor of a
 * role whose tools cover its own, with only its own tools: the spawn is a
 * narrower agent, never a wider one. No executor for a step's tools means
 * the step goes to the person.
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
};

export type JobRunResult = {
  readonly leadRunId: string;
  readonly steps: readonly {
    readonly key: string;
    readonly runId: string;
    readonly status: StepStatus;
    readonly summary: string;
  }[];
};

/** The executor that runs a step: its role's, or for a spawn a covering role's. */
export function executorFor(
  step: BoundStep,
  executors: Partial<Record<AgentRole, AgentExecutor>>,
): AgentExecutor | null {
  if (step.role !== "AD_HOC") return executors[step.role] ?? null;
  for (const [role, executor] of Object.entries(executors) as [
    AgentRole,
    AgentExecutor,
  ][]) {
    if (role === "AD_HOC") continue;
    const tools = new Set(AGENT_REGISTRY[role].tools);
    if (step.tools.length > 0 && step.tools.every((tool) => tools.has(tool))) {
      return executor;
    }
  }
  return executors.AD_HOC ?? null;
}

export async function runJob(input: {
  readonly jobId: string;
  readonly goal: string;
  readonly steps: readonly BoundStep[];
  readonly executors: Partial<Record<AgentRole, AgentExecutor>>;
  readonly recorder: JobRecorder;
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
  const out: {
    key: string;
    runId: string;
    status: StepStatus;
    summary: string;
  }[] = [];
  for (const step of input.steps) {
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
      (key) => results.get(key)?.status !== "DONE",
    );
    let status: StepStatus;
    let summary: string;
    if (blocked !== undefined) {
      status = "SKIPPED";
      summary = `Waited on "${blocked}", which did not finish.`;
    } else {
      const executor = executorFor(step, input.executors);
      if (executor === null) {
        status = "HELD";
        summary = "No agent can do this step on its own; it needs you.";
      } else {
        const result = await executor(step, {
          jobId,
          runId,
          results,
        }).catch((): StepResult => ({
          status: "FAILED",
          summary: "This step failed; nothing was sent.",
        }));
        status = result.status;
        summary = result.summary;
        results.set(step.key, result);
      }
    }
    await recorder.endRun(runId, status, summary.slice(0, 500));
    out.push({ key: step.key, runId, status, summary });
  }
  const done = out.filter((step) => step.status === "DONE").length;
  await recorder.endRun(
    leadRunId,
    out.length > 0 && done === 0 ? "HELD" : "DONE",
    `${String(done)} of ${String(out.length)} steps done.`,
  );
  return { leadRunId, steps: out };
}
