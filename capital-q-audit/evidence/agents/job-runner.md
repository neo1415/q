# Evidence: packages/q-orchestrator/src/workforce/job-runner.ts lines 1-192

- Original path: `packages/q-orchestrator/src/workforce/job-runner.ts`
- Line range: 1-192 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Job runner: a step with no executor is HELD; dependants SKIPPED. Complete module.

```ts
    1  import type { BoundStep } from "./plan.js";
    2  import { AGENT_REGISTRY, type AgentRole } from "./registry.js";
    3
    4  /**
    5   * Running a bounded plan (founder brief J1, J4, J9).
    6   *
    7   * The lead Q's run opens the job; each step becomes one agent run, spawned
    8   * by the lead, in plan order. A step waits for the steps it names; when one
    9   * of those did not finish, it is skipped with the reason rather than run
   10   * on a guess. Every hand-off (lead to agent, agent to the agent that waits
   11   * on it) is recorded, so the workforce page shows who did what and why.
   12   *
   13   * Executors are ports by role. An ad-hoc agent is run by the executor of a
   14   * role whose tools cover its own, with only its own tools: the spawn is a
   15   * narrower agent, never a wider one. No executor for a step's tools means
   16   * the step goes to the person.
   17   */
   18
   19  export type StepStatus = "DONE" | "HELD" | "FAILED" | "SKIPPED";
   20
   21  export type StepResult = {
   22    readonly status: Exclude<StepStatus, "SKIPPED">;
   23    /** One line for the timeline, in plain words. */
   24    readonly summary: string;
   25    /** What later steps may read (ids, counts), never free text from a model. */
   26    readonly outputs?: Readonly<Record<string, unknown>> | undefined;
   27  };
   28
   29  export type AgentContext = {
   30    readonly jobId: string;
   31    readonly runId: string;
   32    /** Finished steps' results by key. */
   33    readonly results: ReadonlyMap<string, StepResult>;
   34  };
   35
   36  export type AgentExecutor = (
   37    step: BoundStep,
   38    context: AgentContext,
   39  ) => Promise<StepResult>;
   40
   41  export type JobRecorder = {
   42    readonly startRun: (input: {
   43      readonly jobId: string;
   44      readonly role: AgentRole;
   45      readonly agentName: string;
   46      readonly goal: string;
   47      readonly tools: readonly string[];
   48      readonly budgetUsd: number;
   49      readonly stepKey: string | null;
   50      readonly spawnedByRunId: string | null;
   51    }) => Promise<string>;
   52    readonly endRun: (
   53      runId: string,
   54      status: StepStatus,
   55      summary: string,
   56    ) => Promise<void>;
   57    readonly handoff: (input: {
   58      readonly jobId: string;
   59      readonly fromRunId: string;
   60      readonly toRunId: string;
   61      readonly note: string;
   62    }) => Promise<void>;
   63  };
   64
   65  export type JobRunResult = {
   66    readonly leadRunId: string;
   67    readonly steps: readonly {
   68      readonly key: string;
   69      readonly runId: string;
   70      readonly status: StepStatus;
   71      readonly summary: string;
   72    }[];
   73  };
   74
   75  /** The executor that runs a step: its role's, or for a spawn a covering role's. */
   76  export function executorFor(
   77    step: BoundStep,
   78    executors: Partial<Record<AgentRole, AgentExecutor>>,
   79  ): AgentExecutor | null {
   80    if (step.role !== "AD_HOC") return executors[step.role] ?? null;
   81    for (const [role, executor] of Object.entries(executors) as [
   82      AgentRole,
   83      AgentExecutor,
   84    ][]) {
   85      if (role === "AD_HOC") continue;
   86      const tools = new Set(AGENT_REGISTRY[role].tools);
   87      if (step.tools.length > 0 && step.tools.every((tool) => tools.has(tool))) {
   88        return executor;
   89      }
   90    }
   91    return executors.AD_HOC ?? null;
   92  }
   93
   94  export async function runJob(input: {
   95    readonly jobId: string;
   96    readonly goal: string;
   97    readonly steps: readonly BoundStep[];
   98    readonly executors: Partial<Record<AgentRole, AgentExecutor>>;
   99    readonly recorder: JobRecorder;
  100  }): Promise<JobRunResult> {
  101    const { recorder, jobId } = input;
  102    const leadRunId = await recorder.startRun({
  103      jobId,
  104      role: "LEAD",
  105      agentName: AGENT_REGISTRY.LEAD.title,
  106      goal: input.goal.slice(0, 400),
  107      tools: [],
  108      budgetUsd: AGENT_REGISTRY.LEAD.budgetUsd,
  109      stepKey: null,
  110      spawnedByRunId: null,
  111    });
  112    const results = new Map<string, StepResult>();
  113    const runs = new Map<string, string>();
  114    const out: {
  115      key: string;
  116      runId: string;
  117      status: StepStatus;
  118      summary: string;
  119    }[] = [];
  120    for (const step of input.steps) {
  121      const runId = await recorder.startRun({
  122        jobId,
  123        role: step.role,
  124        agentName: step.agentName,
  125        goal: step.goal,
  126        tools: step.tools,
  127        budgetUsd: step.budgetUsd,
  128        stepKey: step.key,
  129        spawnedByRunId: leadRunId,
  130      });
  131      runs.set(step.key, runId);
  132      await recorder.handoff({
  133        jobId,
  134        fromRunId: leadRunId,
  135        toRunId: runId,
  136        note: step.spawned
  137          ? `Spawned ${step.agentName} for: ${step.goal}`.slice(0, 500)
  138          : `Assigned: ${step.goal}`.slice(0, 500),
  139      });
  140      for (const key of step.dependsOn) {
  141        const from = runs.get(key);
  142        if (from !== undefined) {
  143          await recorder.handoff({
  144            jobId,
  145            fromRunId: from,
  146            toRunId: runId,
  147            note: (results.get(key)?.summary ?? "Handed on.").slice(0, 500),
  148          });
  149        }
  150      }
  151      const blocked = step.dependsOn.find(
  152        (key) => results.get(key)?.status !== "DONE",
  153      );
  154      let status: StepStatus;
  155      let summary: string;
  156      if (blocked !== undefined) {
  157        status = "SKIPPED";
  158        // Plain words: the step's own agent, never its plan key.
  159        const waitedOn =
  160          input.steps.find((one) => one.key === blocked)?.agentName ??
  161          "an earlier step";
  162        summary = `Waited on ${waitedOn}, which did not finish.`;
  163      } else {
  164        const executor = executorFor(step, input.executors);
  165        if (executor === null) {
  166          status = "HELD";
  167          summary = "No agent can do this step on its own; it needs you.";
  168        } else {
  169          const result = await executor(step, {
  170            jobId,
  171            runId,
  172            results,
  173          }).catch((): StepResult => ({
  174            status: "FAILED",
  175            summary: "This step failed; nothing was sent.",
  176          }));
  177          status = result.status;
  178          summary = result.summary;
  179          results.set(step.key, result);
  180        }
  181      }
  182      await recorder.endRun(runId, status, summary.slice(0, 500));
  183      out.push({ key: step.key, runId, status, summary });
  184    }
  185    const done = out.filter((step) => step.status === "DONE").length;
  186    await recorder.endRun(
  187      leadRunId,
  188      out.length > 0 && done === 0 ? "HELD" : "DONE",
  189      `${String(done)} of ${String(out.length)} steps done.`,
  190    );
  191    return { leadRunId, steps: out };
  192  }
```
