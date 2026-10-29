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
import { mergeLive, type LiveReport } from "./live.js";
import { isPlanJobPayload } from "./plan-job.js";
import {
  checkpointKey,
  liveStageOf,
  type AgentWorkQueue,
  type EndState,
  type WorkRow,
} from "./queue.js";
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
  /**
   * Owner 2026-10-23: a finished job's document lands in the conversation
   * it was asked in (delivery.ts), read back from the job's own results.
   */
  readonly deliver?:
    ((owner: Owner, row: WorkRow) => Promise<unknown>) | undefined;
  /**
   * Situation-first planning (S4): a plan job (payload kind PLAN) is run
   * by the plan job, as the person, on the same queue, lease and delivery.
   * Its result is kept as the "plan" step so a resumed job is delivered,
   * never planned twice. Absent: a plan payload is not run here.
   */
  readonly plans?:
    | ((input: {
        readonly actor: ActorContext;
        readonly owner: Owner;
        readonly row: WorkRow;
        readonly progress: LiveReport;
      }) => Promise<{
        readonly state: EndState;
        readonly reason: string | null;
        readonly outputs?: Readonly<Record<string, unknown>> | undefined;
      }>)
    | undefined;
  /**
   * S6: the person's direction to work a plan started, from the plan's
   * team thread (entries after the job began), bounded. Absent: none.
   */
  readonly directions?:
    | ((owner: Owner, planId: string, since: Date) => Promise<string | null>)
    | undefined;
  readonly workerId?: string | undefined;
  readonly leaseMs?: number | undefined;
  readonly logger?: Logger | undefined;
}) {
  const { queue, store, logger } = dependencies;
  const workerId = dependencies.workerId ?? `q-api:${randomUUID()}`;
  const leaseMs = dependencies.leaseMs ?? WORK_LEASE_MS;
  let running: Promise<number> | null = null;

  /** The job's document, or one line on how it ended, in its conversation. */
  const deliverAfter = async (owner: Owner, jobId: string): Promise<void> => {
    if (dependencies.deliver === undefined) return;
    const [after] = await queue.forOwner(owner, [jobId]).catch(() => []);
    if (after === undefined) return;
    await dependencies.deliver(owner, after).catch((error: unknown) => {
      logger?.warn({ err: error, jobId }, "workforce delivery failed");
    });
  };

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
    if (isPlanJobPayload(row.plan) && dependencies.plans !== undefined) {
      await runPlan(row, owner, finish, dependencies.plans);
      return;
    }
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
      // Owner 2026-10-24: where the document work stands, kept on the row
      // (a resumed job carries on from what was shown). Writes are
      // chained so the latest lands last; a failed write is not the work's.
      const checkpoints = new Map<string, unknown>();
      let shown = liveStageOf(row);
      let writing: Promise<void> = Promise.resolve();
      const progress: LiveReport = (patch) => {
        if (lost) return;
        const next = mergeLive(shown, patch, new Date().toISOString());
        shown = next;
        writing = writing
          .then(() => queue.recordLive?.(row.job_id, workerId, next))
          .catch(() => undefined);
      };
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
          ...(row.trace.runId === undefined ||
          row.trace.organisationId === undefined
            ? {}
            : {
                documentContext: {
                  qRunId: row.trace.runId,
                  organisationId: row.trace.organisationId,
                  progress,
                  canContinue: async () => {
                    if (lost) return false;
                    const kept = await queue
                      .heartbeat(row.job_id, workerId, leaseMs)
                      .catch(() => false);
                    if (!kept) lost = true;
                    return kept;
                  },
                },
              }),
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
            // Investigation (2026-10-29): a step's checkpoint, read from
            // the row as claimed and kept as it is saved.
            ...(queue.recordCheckpoint === undefined
              ? {}
              : {
                  checkpoint: {
                    load: (key: string) =>
                      Promise.resolve(
                        checkpoints.get(key) ??
                          row.results[checkpointKey(key)] ??
                          null,
                      ),
                    save: async (key: string, value: unknown) => {
                      if (lost) return;
                      checkpoints.set(key, value);
                      await queue.recordCheckpoint?.(
                        row.job_id,
                        workerId,
                        key,
                        value,
                      );
                    },
                  },
                }),
            ...(row.trace.planId === undefined ||
            dependencies.directions === undefined
              ? {}
              : {
                  direction: () =>
                    dependencies.directions?.(
                      owner,
                      row.trace.planId ?? "",
                      row.created_at,
                    ) ?? Promise.resolve(null),
                }),
          },
        },
      );
      // The last stage lands before the row ends (an ended row takes none).
      await writing;
      if (result.outcome !== "STARTED") {
        await finish(
          endStateOf(result.outcome, "HELD"),
          result.outcome === "PLAN_LIMIT"
            ? "Your plan's limit for Q's work is reached; raise it to go on."
            : "The approved plan couldn't be run.",
        );
        // F11: said in the conversation too, never silently held.
        await deliverAfter(owner, row.job_id);
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
      // What the steps recorded, as stored: a document made before a
      // later step stopped is still theirs to read.
      await deliverAfter(owner, row.job_id);
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

  /**
   * A plan job: as the person, resolved now; its live stages kept on the
   * row; its result kept as the "plan" step (a resumed job whose plan was
   * already kept is delivered as it is), then delivered.
   */
  async function runPlan(
    row: WorkRow,
    owner: Owner,
    finish: (state: EndState, reason: string | null) => Promise<void>,
    plans: NonNullable<typeof dependencies.plans>,
  ): Promise<void> {
    const ownerOf = (row.plan as { readonly ownerUserId?: unknown })
      .ownerUserId;
    if (ownerOf !== row.user_id) {
      await finish(
        "FAILED",
        "The plan's request couldn't be read, so nothing ran.",
      );
      return;
    }
    const actor = await dependencies
      .actorFor(owner, row.trace.organisationId ?? null)
      .catch(() => null);
    if (actor === null || actor.userId !== row.user_id) {
      await finish(
        "BLOCKED",
        "You can no longer act where this was asked, so Q stopped it.",
      );
      return;
    }
    const done = PriorSchema.safeParse(row.results["plan"]);
    if (done.success && done.data.status === "DONE") {
      await finish("COMPLETED", null);
      await deliverAfter(owner, row.job_id);
      return;
    }
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
    let shown = liveStageOf(row);
    let writing: Promise<void> = Promise.resolve();
    const progress: LiveReport = (patch) => {
      if (lost) return;
      const next = mergeLive(shown, patch, new Date().toISOString());
      shown = next;
      writing = writing
        .then(() => queue.recordLive?.(row.job_id, workerId, next))
        .catch(() => undefined);
    };
    try {
      const ended = await plans({ actor, owner, row, progress });
      await writing;
      if (ended.state === "COMPLETED") {
        await queue.recordStep(row.job_id, workerId, "plan", {
          status: "DONE",
          summary: "Plan written and reviewed.",
          ...(ended.outputs === undefined ? {} : { outputs: ended.outputs }),
        });
        await store
          .setJobStatus(owner, row.job_id, "DONE")
          .catch(() => undefined);
      } else if (ended.state === "FAILED" && ended.outputs !== undefined) {
        // No plan was made: the step failed, and what Q could say from
        // what it holds is kept beside it for the delivery.
        await queue.recordStep(row.job_id, workerId, "plan", {
          status: "FAILED",
          summary: ended.reason ?? "The plan couldn't be finished.",
          outputs: ended.outputs,
        });
      }
      await finish(ended.state, ended.reason);
      await deliverAfter(owner, row.job_id);
    } catch (error: unknown) {
      logger?.warn(
        { err: error, jobId: row.job_id, attempt: row.attempts },
        "plan job threw; it goes back to the queue",
      );
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
      const owner = { tenantId: failed.tenant_id, userId: failed.user_id };
      await store
        .setJobStatus(owner, failed.job_id, "FAILED")
        .catch(() => undefined);
      // F11: out of attempts is said in the conversation, once.
      await deliverAfter(owner, failed.job_id);
    }
    const claimed = await queue.claim(workerId, leaseMs, CLAIM_PER_PASS);
    // Every claimed row already holds a lease. Start its run and heartbeat
    // without waiting behind another job; the claim count bounds concurrency.
    // Wait for all rows even if a queue operation escapes runOne's recovery,
    // so another pass cannot begin while this batch still has live work.
    const settled = await Promise.allSettled(claimed.map(runOne));
    const errors: unknown[] = [];
    for (const result of settled) {
      if (result.status === "rejected") errors.push(result.reason);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "A claimed workforce job failed.");
    }
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
