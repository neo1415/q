import { z } from "zod";

import {
  WorkforceJobStartPayloadSchema,
  workforceExpected,
  type WorkforceLiveExpected,
  type WorkforcePlanProgress,
} from "@capital-q/contracts";
import {
  planProgress,
  type PlanStepRecord,
  type StepOutcome,
} from "@capital-q/q-orchestrator";

import { isPlanJobPayload } from "./plan-job.js";
import type { WorkRow } from "./queue.js";

/**
 * Where an approved job's plan stands (wf 2026-10-16), derived by code from
 * the durable work row (the exact approved plan and each step's recorded
 * result) and the job's agent runs. Nothing is generated at read time.
 */

const RecordedSchema = z
  .object({
    status: z.enum(["DONE", "HELD", "FAILED", "SKIPPED"]),
    summary: z.string().optional(),
    outputs: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const LIVE_STATES: ReadonlySet<string> = new Set([
  "QUEUED",
  "RUNNING",
  "RECOVERING",
]);

export type RunByStep = {
  readonly step_key: string | null;
  readonly status: string;
  readonly summary: string | null;
};

export function progressOf(
  work: Pick<WorkRow, "plan" | "results" | "state"> | undefined,
  runs: readonly RunByStep[] = [],
): WorkforcePlanProgress | undefined {
  if (work === undefined) return undefined;
  const plan = WorkforceJobStartPayloadSchema.safeParse(work.plan);
  if (!plan.success) return undefined;
  const steps: PlanStepRecord[] = plan.data.steps.map((step) => ({
    key: step.key,
    who: step.agentName,
    goal: step.goal,
    tools: step.tools,
    dependsOn: step.dependsOn,
    why: step.why,
    evidence: step.evidence,
    fallbackFor: step.fallbackFor,
  }));
  const outcomes = new Map<string, StepOutcome>();
  // A run the runner ended (SKIPPED and HELD-for-you included), latest last.
  for (const run of runs) {
    if (run.step_key === null) continue;
    const parsed = RecordedSchema.safeParse({
      status: run.status,
      summary: run.summary ?? undefined,
    });
    if (parsed.success) {
      outcomes.set(run.step_key, {
        status: parsed.data.status,
        summary: parsed.data.summary ?? null,
      });
    }
  }
  // What the step itself recorded, with its outputs, wins.
  for (const [key, value] of Object.entries(work.results)) {
    const parsed = RecordedSchema.safeParse(value);
    if (!parsed.success) continue;
    outcomes.set(key, {
      status: parsed.data.status,
      summary: parsed.data.summary ?? outcomes.get(key)?.summary ?? null,
      outputs: parsed.data.outputs,
    });
  }
  return planProgress({
    reasoning: plan.data.reasoning,
    steps,
    outcomes,
    finished: !LIVE_STATES.has(work.state),
  });
}

/**
 * Owner 2026-10-28: how long this job usually takes, from the approved
 * plan's tools (a step that files a document, else one that searches the
 * public web), so the card can say "usually 2-4 minutes". Classified by
 * tool, never by words; null when no usual length is known.
 */
export function expectedOf(
  work: Pick<WorkRow, "plan"> | undefined,
): WorkforceLiveExpected | null {
  if (work === undefined) return null;
  // Situation-first planning: a plan job's usual length (1-2 minutes).
  if (isPlanJobPayload(work.plan)) return workforceExpected("PLAN");
  const plan = WorkforceJobStartPayloadSchema.safeParse(work.plan);
  if (!plan.success) return null;
  const tools = new Set(plan.data.steps.flatMap((step) => step.tools));
  if (tools.has("documents.own.prepare")) return workforceExpected("DOCUMENT");
  if (tools.has("public_web.search")) return workforceExpected("RESEARCH");
  return null;
}
