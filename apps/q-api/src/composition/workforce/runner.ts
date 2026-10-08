import { randomUUID } from "node:crypto";

import {
  WorkforceJobStartPayloadSchema,
  type WorkforceJobStartPayload,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { PriorRun } from "@capital-q/q-orchestrator";
import type { ActorContext } from "@capital-q/security";
import { z } from "zod";

import { plannedFrom } from "./job-actions.js";
import type { WorkforceJobs } from "./jobs.js";
import type { AgentWorkQueue, EndState, WorkRow } from "./queue.js";
import type { Owner, WorkforceStore } from "./store.js";

/**
 * The durable runner of approved workforce jobs (recovery D3, audit D-08).
 *
 * Each pass claims live rows from the work queue under a lease, renews the
 * lease while a job runs, and ends every row in a terminal work state. A
 * job whose worker died (restart, deploy) is reclaimed once its lease
 * lapses and resumed: finished steps are read back from the row, never
 * redone; step runs the restart left RUNNING are ended with why. Nothing
 * here needs the person's browser or voice session: a job finishes
 * whether or not anyone is connected.
 *
 * The job runs as the person who approved it, resolved afresh at each
 * claim: someone who can no longer act here gets BLOCKED with the reason,
 * never a run on stale authority.
 */

export const WORK_LEASE_MS = 2 * 60_000;
const CLAIM_PER_PASS = 2;

const PriorSchema = z
  .object({
    status: z.enum(["DONE", "HELD", "FAILED"]),
    summary: z.string(),
    outputs: z.record(z.string(), z.unknown()).optional(),
    runId: z.string().uuid().optional(),
  })
  .passthrough();

/** A finished run's state from the job's own result. */
export function endStateOf(
  outcome: "STARTED" | "NOT_PLANNED" | "PLAN_LIMIT",
  jobStatus: "DONE" | "HELD" | "FAILED",
): EndState {
  if (outcome === "PLAN_LIMIT") return "BLOCKED";
  if (outcome === "NOT_PLANNED") return "BLOCKED";
  if (jobStatus === "DONE") return "COMPLETED";
  return jobStatus === "FAILED" ? "FAILED" : "NEEDS_DECISION";
}

export function createAgentWorkRunner(dependencies: {
  readonly queue: AgentWorkQueue;
  readonly store: Pick<WorkforceStore, "endInterrupted" | "setJobStatus">;
  /** The approver, resolved now; null when they can no longer act. */
  readonly actorFor: (
    owner: Owner,
    organisationId: string | null,
  ) => Promise<ActorContext | null>;
  readonly jobsFor: (actor: ActorContext) => WorkforceJobs;
  readonly workerId?: string | undefined;
  readonly leaseMs?: number | undefined;
  readonly logger?: Logger | undefined;
}) {
  const { queue, store, logger } = dependencies;
  const workerId = dependencies.workerId ?? `q-api:${randomUUID()}`;
  const leaseMs = dependencies.leaseMs ?? WORK_LEASE_MS;
  let running: Promise<number> | null = null;

  async function runOne(row: WorkRow): Promise<void> {
    const owner: Owner = { tenantId: row.tenant_id, userId: row.user_id };
    const finish = async (state: EndState, reason: string | null) => {
      const ended = await queue.finish(row.job_id, workerId, state, reason);
      if (ended && state === "FAILED") {
        await store
          .setJobStatus(owner, row.job_id, "FAILED")
          .catch(() => undefined);
      }
      if (!ended) {
        // Not ours any more: stopped by the person meanwhile, so the job
        // says so (never "held" for something they stopped).
        const [now] = await queue.forOwner(owner, [row.job_id]);
        if (now?.state === "CANCELLED") {
          await store
            .setJobStatus(owner, row.job_id, "STOPPED")
            .catch(() => undefined);
        }
      }
    };
    const plan = WorkforceJobStartPayloadSchema.safeParse(row.plan);
    if (!plan.success || plan.data.ownerUserId !== row.user_id) {
      await finish(
        "FAILED",
        "The approved plan couldn't be read, so nothing ran.",
      );
      return;
    }
    const actor = await dependencies
      .actorFor(owner, row.trace.organisationId ?? null)
      .catch(() => null);
    if (actor === null || actor.userId !== row.user_id) {
      await finish(
        "BLOCKED",
        "You can no longer act where this job was approved, so Q stopped it.",
      );
      return;
    }
    // The lease is renewed while the job runs; losing it (cancelled, or
    // reclaimed after a stall) stops the next step from starting.
    let lost = false;
    const beat = setInterval(
      () => {
        void queue
          .heartbeat(row.job_id, workerId, leaseMs)
          .then((kept) => {
            if (!kept) lost = true;
          })
          .catch(() => undefined);
      },
      Math.max(1_000, Math.floor(leaseMs / 3)),
    );
    beat.unref?.();
    try {
      if (row.attempts > 1) {
        await store.endInterrupted(
          owner,
          row.job_id,
          "Interrupted when Q restarted; this step runs again.",
        );
      }
      const results = new Map<string, PriorRun>();
      for (const [key, value] of Object.entries(row.results)) {
        const prior = PriorSchema.safeParse(value);
        if (prior.success) {
          results.set(key, {
            runId: prior.data.runId ?? null,
            status: prior.data.status,
            summary: prior.data.summary,
            ...(prior.data.outputs === undefined
              ? {}
              : { outputs: prior.data.outputs }),
          });
        }
      }
      const jobs = dependencies.jobsFor(actor);
      const payload: WorkforceJobStartPayload = plan.data;
      const result = await jobs.run(
        owner,
        {
          goal: payload.goal,
          budgetUsd: Number(payload.budgetUsd),
          source: { kind: "JOB", id: row.trace.actionId ?? row.job_id },
          planned: plannedFrom(payload),
        },
        undefined,
        {
          // Metered once, when first claimed: a resumed job is not a new one.
          gated: row.attempts > 1,
          durable: {
            prior: async (key) => {
              if (lost || !(await queue.live(row.job_id))) {
                // Stopped by the person, or no longer ours: nothing more runs.
                return {
                  runId: null,
                  status: "HELD",
                  summary: "Stopped before this step.",
                };
              }
              return results.get(key) ?? null;
            },
            record: (key, step, runId) =>
              queue.recordStep(row.job_id, workerId, key, step, runId),
          },
        },
      );
      if (result.outcome !== "STARTED") {
        await finish(
          endStateOf(result.outcome, "HELD"),
          result.outcome === "PLAN_LIMIT"
            ? "Your plan's limit for Q's work is reached; raise it to go on."
            : "The approved plan couldn't be run.",
        );
        return;
      }
      const statuses = result.steps.map((step) => step.status);
      const jobStatus = statuses.every((status) => status === "DONE")
        ? "DONE"
        : statuses.some((status) => status === "HELD")
          ? "HELD"
          : statuses.some((status) => status === "FAILED")
            ? "FAILED"
            : "HELD";
      const waiting = result.steps.find((step) => step.status !== "DONE");
      await finish(
        endStateOf("STARTED", jobStatus),
        waiting === undefined ? null : waiting.summary,
      );
    } catch (error: unknown) {
      logger?.warn(
        { err: error, jobId: row.job_id, attempt: row.attempts },
        "workforce job step threw; it goes back to the queue",
      );
      // Back to the queue for the next claim; out of attempts, the sweep
      // ends it FAILED with the reason.
      await queue.release(
        row.job_id,
        workerId,
        "Something went wrong part-way; Q will try again.",
      );
    } finally {
      clearInterval(beat);
    }
  }

  const pass = async (): Promise<number> => {
    const swept = await queue.sweep();
    for (const failed of swept.failed) {
      await store
        .setJobStatus(
          { tenantId: failed.tenant_id, userId: failed.user_id },
          failed.job_id,
          "FAILED",
        )
        .catch(() => undefined);
    }
    const claimed = await queue.claim(workerId, leaseMs, CLAIM_PER_PASS);
    for (const row of claimed) await runOne(row);
    return claimed.length;
  };

  return {
    workerId,
    /** One pass at a time per instance; a call during one joins it. */
    pass: (): Promise<number> => {
      running ??= pass().finally(() => {
        running = null;
      });
      return running;
    },
  };
}

export type AgentWorkRunner = ReturnType<typeof createAgentWorkRunner>;
