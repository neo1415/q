import { createHash } from "node:crypto";

import {
  QActionTypeSchema,
  Q_PLAN_EXECUTE,
  QPlanExecutePayloadSchema,
  QSituationDossierSchema,
  situationFacts,
  UuidSchema,
  WorkforceJobStartPayloadSchema,
  type QPlan,
  type QPlanCondition,
  type QPlanDecisionRequest,
  type QPlanDecisionResult,
  type QPlanExecutePayload,
  type QPlanStep,
  type QPlanView,
  type QSituationSide,
  type QSubjectRef,
  type WorkforceJobStartPayload,
} from "@capital-q/contracts";
import type { BoardService } from "@capital-q/board";
import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import { clipAtWord } from "@capital-q/q-core";
import { defineQAction, type AnyQActionDefinition } from "@capital-q/q-actions";
import { boardKey } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";
import { z } from "zod";

import type { WorkforceJobs } from "./jobs.js";
import type { LiveReport } from "./live.js";
import {
  PLAN_JOB_KIND,
  PlanJobPayloadSchema,
  runPlanJob,
  type PlanJobDependencies,
  type PlanJobPayload,
} from "./plan-job.js";
import type { PlanStore } from "./plan-store.js";
import {
  createPlanThread,
  runtimeOf,
  type StepRuntime,
} from "./plan-thread.js";
import type { AgentWorkQueue, EndState, WorkRow } from "./queue.js";
import type { Owner } from "./store.js";

/**
 * Situation-first planning, composed (S4-S6): starting a plan from a turn,
 * running it on the durable queue, the plan card's three affordances, the
 * ONE approval that executes a version, the person's direction to running
 * work, and conditions re-evaluated on any domain event of their tenant.
 *
 * Prepare -> Recommend -> Approve -> Execute throughout: Execute is one
 * approval card bound to {planId, version, body sha-256, steps}; then each
 * Q-owned step that sends anything to anyone or changes a record goes
 * through its own approval card; the person's steps go on their board
 * (with a reminder when dated). A changed plan is a new version, so the
 * old approval can never run it.
 */

export const PLAN_EXECUTE = QActionTypeSchema.parse(Q_PLAN_EXECUTE);
export const PLAN_JOB_BUDGET_USD = 0.5;

/** Which reader asks route to a plan (S5): readers decide meaning; code maps. */
export type PlanAskReading = {
  readonly kind: "IMPROVE" | "GOAL" | "UPLOADED" | "NONE";
  readonly research: "NONE" | "MARKET" | "SELF" | "BOTH";
  readonly side: "FOUNDER" | "INVESTOR" | null;
  readonly subject: "OWN" | "NAMED";
  readonly deliverable: "PLAN" | "DOCUMENT_REVIEW" | "ANALYSIS" | "DOCUMENT";
};

/**
 * A plan job takes the turn when the reader read a plan ask about the
 * person's OWN situation whose deliverable is a plan. A review of their
 * documents, an analysis or a document is that work, done by the team job
 * that makes documents -- never a plan whose first step is the ask (live
 * 2026-10-29, F03) -- as is work for someone they named.
 */
export function routesToPlan(
  planAsk: PlanAskReading | null | undefined,
): boolean {
  if (planAsk === null || planAsk === undefined) return false;
  if (planAsk.subject === "NAMED") return false;
  return planAsk.kind !== "NONE" && planAsk.deliverable === "PLAN";
}

export type PlanStartOutcome =
  | {
      readonly status: "STARTED";
      readonly jobId: string;
      readonly title: string;
    }
  /** Not their own company or mandate to plan for (no company, no mandate). */
  | { readonly status: "NOT_OWN" }
  | { readonly status: "PLAN_LIMIT"; readonly message: string | null }
  | { readonly status: "FAILED" };

export type PlanCardAsk = (
  actor: ActorContext,
  card: {
    readonly conversationId: string | null;
    readonly actionType: string;
    readonly payload: unknown;
    readonly words: string;
    readonly key: string;
  },
) => Promise<{ readonly qActionId: string } | null>;

export type PlansDependencies = {
  readonly sql: DatabaseExecutor;
  readonly store: PlanStore;
  readonly jobsFor: (actor: ActorContext) => Pick<WorkforceJobs, "file">;
  readonly queue: () => Pick<AgentWorkQueue, "enqueue">;
  readonly kick?: (() => void) | undefined;
  /** The plan's allowance for Q's work (consumed once per start). */
  readonly allowed?:
    | ((
        actor: ActorContext,
        idempotencyKey: string,
      ) => Promise<
        | { readonly allowed: true }
        | { readonly allowed: false; readonly message: string | null }
      >)
    | undefined;
  readonly release?:
    | ((actor: ActorContext, idempotencyKey: string) => Promise<void>)
    | undefined;
  readonly planJob: Omit<PlanJobDependencies, "store">;
  readonly board?: Pick<BoardService, "add"> | undefined;
  /** A reminder for the person at a moment, idempotent; its id or null. */
  readonly reminder?:
    | ((input: {
        readonly actor: ActorContext;
        readonly title: string;
        readonly dueAt: Date;
        readonly note: string;
        readonly idempotencyKey: string;
      }) => Promise<string | null>)
    | undefined;
  /** An approval card on a new run in the plan's conversation. */
  readonly ask?: PlanCardAsk | undefined;

  /** S6: the tenant's cached situations are dropped when its records change. */
  readonly invalidate?: ((tenantId: string) => void) | undefined;
  /** S6: the person, resolved now, for a condition that fires a step. */
  readonly actorFor?:
    ((owner: Owner) => Promise<ActorContext | null>) | undefined;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const TraceSchema = z
  .object({
    runId: z.string().uuid().optional(),
    conversationId: z.string().uuid().optional(),
  })
  .passthrough();

/** Q tools a specialist may hold, mapped to the executor tool that runs them. */
const SPECIALIST_EXECUTOR_TOOLS: Readonly<Record<string, string>> = {
  research_public_web: "public_web.search",
  extract_public_web: "public_web.search",
  lookup_public_profile: "public_web.search",
};

const OUTWARD_TOOLS: Readonly<Record<string, readonly string[]>> = {
  CONVERSATION: ["list_messages", "chat.message.send"],
  OUTREACH: ["list_my_relationships", "relationship.interest.express"],
  SCHEDULER: ["find_meeting_times", "list_schedule", "schedule.meeting.book"],
};

export function createPlans(dependencies: PlansDependencies) {
  const { sql, store, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const thread = createPlanThread(store);
  const planJobDependencies: PlanJobDependencies = {
    ...dependencies.planJob,
    store,
  };

  /** Addendum 3 rule 1: the subject is resolved by code from the actor. */
  const subjectOf = async (
    actor: ActorContext,
  ): Promise<PlanJobPayload["subject"] | null> => {
    if (actor.organisationId === undefined) return null;
    const rows = await sql<{ side: QSituationSide; id: string }[]>`
      select 'FOUNDER' as side, c.id from core.companies c
       where c.tenant_id = ${actor.tenantId} and c.organisation_id = ${actor.organisationId}
      union all
      select 'INVESTOR' as side, i.id from core.investor_organisations i
       where i.tenant_id = ${actor.tenantId} and i.organisation_id = ${actor.organisationId}
      limit 1`;
    const row = rows[0];
    if (row === undefined) return null;
    return row.side === "FOUNDER"
      ? { side: "FOUNDER", companyId: row.id }
      : { side: "INVESTOR", investorOrganisationId: row.id };
  };

  /** The conversation (and run) a plan's job was asked in. */
  const traceOf = async (owner: Owner, jobId: string | null) => {
    if (jobId === null) return { runId: null, conversationId: null };
    const rows = await sql<{ trace: unknown }[]>`
      select trace from q_runtime.agent_work_queue
       where job_id = ${jobId} and tenant_id = ${owner.tenantId} and user_id = ${owner.userId}`;
    const parsed = TraceSchema.safeParse(rows[0]?.trace);
    return {
      runId: parsed.success ? (parsed.data.runId ?? null) : null,
      conversationId: parsed.success
        ? (parsed.data.conversationId ?? null)
        : null,
    };
  };

  /** Files the plan job and puts it on the durable queue (one per key). */
  const enqueue = async (
    actor: ActorContext,
    runId: string,
    payload: PlanJobPayload,
    key: string,
  ): Promise<PlanStartOutcome> => {
    const owner: Owner = { tenantId: actor.tenantId, userId: actor.userId };
    const unit = `plan:${key}`;
    if (dependencies.allowed !== undefined) {
      const allowance = await dependencies
        .allowed(actor, unit)
        .catch(() => null);
      if (allowance === null) return { status: "FAILED" };
      if (!allowance.allowed) {
        return { status: "PLAN_LIMIT", message: allowance.message };
      }
    }
    try {
      const filed = await dependencies.jobsFor(actor).file(owner, {
        goal: payload.summary,
        budgetUsd: PLAN_JOB_BUDGET_USD,
        source: { kind: "JOB", id: key },
      });
      await dependencies.queue().enqueue(owner, {
        jobId: filed.jobId,
        plan: payload,
        trace: {
          actionId: key,
          runId,
          organisationId: actor.organisationId ?? undefined,
        },
      });
      dependencies.kick?.();
      return {
        status: "STARTED",
        jobId: filed.jobId,
        title: payload.summary.slice(0, 160),
      };
    } catch (error: unknown) {
      await dependencies.release?.(actor, unit).catch(() => undefined);
      logger?.warn({ err: error, qRunId: runId }, "plan job not started");
      return { status: "FAILED" };
    }
  };

  /** S4: a turn whose reading asks for a plan of their own starts one. */
  const start = async (
    actor: ActorContext,
    runId: string,
    input: {
      readonly ask: string;
      readonly planAsk: PlanAskReading;
      /** What the title quotes; absent: the ask; null: none. */
      readonly quote?: string | null | undefined;
    },
  ): Promise<PlanStartOutcome> => {
    if (actor.actorType !== "HUMAN") return { status: "NOT_OWN" };
    if (input.planAsk.subject === "NAMED") return { status: "NOT_OWN" };
    const subject = await subjectOf(actor).catch(() => null);
    if (subject === null) return { status: "NOT_OWN" };
    const ask = input.ask.trim().slice(0, 2_000);
    if (ask.length === 0) return { status: "FAILED" };
    const payload: PlanJobPayload = {
      kind: PLAN_JOB_KIND,
      ownerUserId: actor.userId,
      ask,
      summary: summaryOf(
        input.quote === undefined ? ask : input.quote,
        input.planAsk.deliverable,
      ),
      subject,
      research: input.planAsk.research,
      deliverable: input.planAsk.deliverable,
      mode: "NEW",
      planId: null,
      fromVersion: null,
      directionId: null,
    };
    // One plan per turn: a retried turn files the same job.
    return enqueue(actor, runId, payload, runId);
  };

  /** The durable runner's plan step (runner.ts `plans`). */
  const run = async (input: {
    readonly actor: ActorContext;
    readonly owner: Owner;
    readonly row: WorkRow;
    readonly progress: LiveReport;
  }): Promise<{
    readonly state: EndState;
    readonly reason: string | null;
    readonly outputs?: Readonly<Record<string, unknown>> | undefined;
  }> => {
    const payload = PlanJobPayloadSchema.safeParse(input.row.plan);
    if (!payload.success) {
      return { state: "FAILED", reason: "The request couldn't be read." };
    }
    const filed = await dependencies.jobsFor(input.actor).file(input.owner, {
      goal: payload.data.summary,
      budgetUsd: PLAN_JOB_BUDGET_USD,
      source: { kind: "JOB", id: input.row.trace.actionId ?? input.row.job_id },
    });
    const outcome = await runPlanJob(planJobDependencies, {
      actor: input.actor,
      owner: input.owner,
      jobId: input.row.job_id,
      leadRunId: filed.leadRunId,
      runId: input.row.trace.runId ?? input.row.job_id,
      payload: payload.data,
      progress: input.progress,
    });
    switch (outcome.status) {
      case "OFFERED":
        return {
          state: "COMPLETED",
          reason: null,
          outputs: { plan: { block: outcome.block, line: outcome.line } },
        };
      case "ANSWERED":
        // Live 2026-10-29: planning failed, yet the job ended DONE and its
        // card read "Two reviews · Ready · Filed". No plan was made, so the
        // job FAILED; the person still gets Q's answer from what it holds.
        return {
          state: "FAILED",
          reason: "The plan couldn't be finished",
          outputs: { answer: { line: outcome.line } },
        };
      case "FAILED":
        return { state: "FAILED", reason: outcome.reason };
    }
  };

  /** The plan as its owner reads it, with its status lines. */
  const view = async (
    owner: Owner,
    planId: string,
    version?: number,
  ): Promise<QPlanView | null> => {
    const [stored, lines, runtimes] = await Promise.all([
      store.read(owner, planId, version),
      store
        .readThread(owner, { planId }, { kinds: ["STATUS"] })
        .catch(() => []),
      thread
        .runtimes(owner, planId)
        .catch(() => new Map<string, StepRuntime>()),
    ]);
    if (stored === null) return null;
    return {
      plan: withRuntimes(stored.plan, runtimes),
      bodySha256: stored.bodySha256,
      current: stored.plan.version === stored.headVersion,
      headVersion: stored.headVersion,
      status: stored.status,
      lines: lines.map((entry) => ({ at: entry.createdAt, text: entry.text })),
      facts: citedFacts(stored.plan, stored.situation),
    };
  };

  const result = (
    outcome: QPlanDecisionResult["outcome"],
    message: string,
    version: number | null,
    extra: { readonly jobId?: string; readonly actionId?: string } = {},
  ): QPlanDecisionResult => ({
    outcome,
    message,
    version,
    jobId: extra.jobId ?? null,
    ...(extra.actionId === undefined ? {} : { actionId: extra.actionId }),
  });

  /** S5: one of the card's three affordances, by the person. */
  const decide = async (
    actor: ActorContext,
    planId: string,
    request: QPlanDecisionRequest,
  ): Promise<QPlanDecisionResult> => {
    const owner: Owner = { tenantId: actor.tenantId, userId: actor.userId };
    const head = await store.head(owner, planId);
    if (head === null || head.currentVersion === 0) {
      return result("NOT_FOUND", "That plan isn't one of yours.", null);
    }
    if (request.version !== head.currentVersion) {
      return result(
        "STALE",
        "This plan has changed since this card was shown; here is the newest version.",
        head.currentVersion,
      );
    }
    const stored = await store.read(owner, planId);
    if (stored === null) {
      return result("NOT_FOUND", "That plan isn't one of yours.", null);
    }
    const trace = await traceOf(owner, head.jobId);
    switch (request.affordance) {
      case "EXECUTE": {
        // Live e11: Execute stayed live on a plan already running. It runs
        // once; a second approval card would only repeat it.
        if (stored.status === "EXECUTING" || stored.status === "DONE") {
          return result(
            "EXECUTING",
            "This plan is already running; the card shows each step as it lands.",
            head.currentVersion,
          );
        }
        // The approval binds to the body the card showed: a different body
        // is a different plan.
        if (request.bodySha256 !== stored.bodySha256) {
          return result(
            "STALE",
            "This plan has changed since this card was shown; here is the newest version.",
            head.currentVersion,
          );
        }
        if (dependencies.ask === undefined) {
          return result(
            "FAILED",
            "I can't run plans just now.",
            head.currentVersion,
          );
        }
        const payload = executePayloadOf(
          actor.userId,
          stored.plan,
          stored.bodySha256,
        );
        const card = await dependencies
          .ask(actor, {
            conversationId: trace.conversationId,
            actionType: PLAN_EXECUTE,
            payload,
            // Q's own line on the card's run (the person pressed Execute).
            words: `Here is your plan to approve before anything runs: ${stored.plan.goal}`,
            key: `plan-execute:${planId}:${String(stored.plan.version)}`,
          })
          .catch((error: unknown) => {
            logger?.warn(
              { err: error, planId },
              "plan execute card not prepared",
            );
            return null;
          });
        if (card === null) {
          return result(
            "FAILED",
            "I couldn't prepare the approval for this plan. Try again in a moment.",
            head.currentVersion,
          );
        }
        return result(
          "AWAITING_APPROVAL",
          "Approve the plan once and I'll start my steps and put yours on your board. Anything that goes out to someone still comes to you first.",
          head.currentVersion,
          { actionId: card.qActionId },
        );
      }
      case "PUT_ON_BOARD": {
        const board = await putOnBoard(actor, stored.plan);
        // Live 2026-10-29: a failed write was reported as "already there".
        // Success is said only for rows the board returned; a failure is
        // said as a failure, and the plan stays where it was.
        if (board.failed > 0 && board.placed === 0) {
          return result("FAILED", boardMessage(board), head.currentVersion);
        }
        await store.setStatus(owner, planId, "ON_BOARD");
        return result("ON_BOARD", boardMessage(board), head.currentVersion);
      }
      case "CHANGE": {
        const direction = await thread.direct(
          owner,
          { planId },
          request.note,
          `change:${planId}:${String(head.currentVersion)}:${sha(request.note).slice(0, 16)}`,
        );
        if (direction === null) {
          return result(
            "FAILED",
            "I couldn't note that change. Try again.",
            head.currentVersion,
          );
        }
        const started = await enqueue(
          actor,
          trace.runId ?? planId,
          {
            kind: PLAN_JOB_KIND,
            ownerUserId: actor.userId,
            ask: `${stored.plan.goal}`.slice(0, 2_000),
            summary: `Changing your plan: ${request.note}`.slice(0, 400),
            subject: await subjectOf(actor).then(
              (subject) =>
                subject ??
                (stored.plan.side === "FOUNDER"
                  ? {
                      side: "FOUNDER" as const,
                      companyId: actor.organisationId ?? planId,
                    }
                  : {
                      side: "INVESTOR" as const,
                      investorOrganisationId: actor.organisationId ?? planId,
                    }),
            ),
            research: "NONE",
            deliverable: "PLAN",
            mode: "CHANGE",
            planId,
            fromVersion: head.currentVersion,
            directionId: direction.id,
          },
          `plan-change:${direction.id}`,
        );
        if (started.status !== "STARTED") {
          return result(
            "FAILED",
            started.status === "PLAN_LIMIT" && started.message !== null
              ? started.message
              : "I couldn't start on the change just now.",
            head.currentVersion,
          );
        }
        return result(
          "CHANGING",
          "Noted. I'm reworking the plan with that; the new version comes back here, and it needs your OK again before anything runs.",
          head.currentVersion,
          { jobId: started.jobId },
        );
      }
    }
  };

  /** The person's steps as board tasks (dated ones with a reminder); Q's wait. */
  const putOnBoard = async (
    actor: ActorContext,
    plan: QPlan,
  ): Promise<BoardPlacement> => {
    const owner: Owner = { tenantId: actor.tenantId, userId: actor.userId };
    const runtimes = await thread
      .runtimes(owner, plan.planId)
      .catch(() => new Map<string, StepRuntime>());
    const out = { placed: 0, already: 0, failed: 0, waiting: 0 };
    for (const step of plan.steps) {
      const runtime = runtimeOf(runtimes, step.key);
      if (step.owner === "Q") {
        if (runtime.status === "TODO") {
          // Nothing is prepared yet: it waits until they say go.
          await thread
            .move(owner, plan, step, "PROPOSED", { prepared: false })
            .catch(() => undefined);
        }
        out.waiting += 1;
        continue;
      }
      if (runtime.boardItemId !== null) {
        out.already += 1;
        continue;
      }
      const placed = await boardTask(actor, plan, step);
      if (placed === "PLACED") out.placed += 1;
      else if (placed === "ALREADY") out.already += 1;
      else out.failed += 1;
    }
    return out;
  };

  /** One board task (and its reminder when dated) for a step of theirs. */
  const boardTask = async (
    actor: ActorContext,
    plan: QPlan,
    step: QPlanStep,
  ): Promise<"PLACED" | "ALREADY" | "FAILED"> => {
    const owner: Owner = { tenantId: actor.tenantId, userId: actor.userId };
    if (dependencies.board === undefined) return "FAILED";
    const key = `plan:${plan.planId}:${String(plan.version)}:${step.key}`;
    const added = await dependencies.board
      .add(
        actor,
        {
          kind: "TASK",
          title: (step.owner === "TOGETHER"
            ? `Your part: ${step.title}`
            : step.title
          ).slice(0, 160),
          notes: [
            step.why,
            step.evidenceNeeded.length === 0
              ? null
              : `Done when: ${step.evidenceNeeded.join("; ")}`,
          ]
            .filter((line): line is string => line !== null)
            .join("\n\n")
            .slice(0, 8_000),
          ...(step.due === null ? {} : { dueOn: step.due }),
        },
        // The board's key is a UUID (workspace.board_items): derived from
        // this step and version, so a retried placement writes nothing new.
        { by: "Q", idempotencyKey: planBoardKey(key) },
      )
      .catch((error: unknown) => {
        logger?.warn(
          { err: error, planId: plan.planId, stepKey: step.key },
          "plan step not put on the board",
        );
        return null;
      });
    if (added === null) return "FAILED";
    if (added.outcome !== "OK") {
      logger?.warn(
        { planId: plan.planId, stepKey: step.key, code: added.code },
        "plan step not put on the board",
      );
      return "FAILED";
    }
    await thread.link(owner, plan, step.key, "board_item", added.value.id);
    if (step.due !== null && dependencies.reminder !== undefined) {
      const reminderId = await dependencies
        .reminder({
          actor,
          title: step.title.slice(0, 160),
          // The morning of the day it is due (UTC; the person's zone is
          // applied where reminders are shown).
          dueAt: new Date(`${step.due}T08:00:00Z`),
          note: step.why.slice(0, 500),
          idempotencyKey: `${key}:reminder`,
        })
        .catch(() => null);
      if (reminderId !== null) {
        await thread.link(owner, plan, step.key, "reminder", reminderId);
      }
    }
    await thread.move(owner, plan, step, "WAITING_YOU");
    return added.replayed ? "ALREADY" : "PLACED";
  };

  /** A Q-owned step's own-account job on the durable queue (one per step and version). */
  const enqueueStepJob = async (
    actor: ActorContext,
    plan: QPlan,
    step: QPlanStep,
    payload: WorkforceJobStartPayload,
    trace: { readonly runId: string | null },
  ): Promise<string> => {
    const owner: Owner = { tenantId: actor.tenantId, userId: actor.userId };
    const key = `plan-step:${plan.planId}:${String(plan.version)}:${step.key}`;
    const filed = await dependencies.jobsFor(actor).file(owner, {
      goal: payload.goal,
      budgetUsd: Number(payload.budgetUsd),
      source: { kind: "JOB", id: key },
    });
    await dependencies.queue().enqueue(owner, {
      jobId: filed.jobId,
      plan: payload,
      trace: {
        actionId: key,
        ...(trace.runId === null ? {} : { runId: trace.runId }),
        organisationId: actor.organisationId ?? undefined,
        planId: plan.planId,
      },
    });
    dependencies.kick?.();
    return filed.jobId;
  };

  /** S6: the person's direction to a plan's work since `since`, bounded. */
  const directions = async (
    owner: Owner,
    planId: string,
    since: Date,
  ): Promise<string | null> => {
    const entries = await thread.directions(owner, { planId });
    const after = entries.filter(
      (entry) => Date.parse(entry.createdAt) >= since.getTime(),
    );
    return after.length === 0
      ? null
      : after.map((entry) => entry.text).join(" / ");
  };

  /** One step, fired: by its owner and its action's class. */
  const fireStep = async (
    actor: ActorContext,
    plan: QPlan,
    step: QPlanStep,
    trace: {
      readonly runId: string | null;
      readonly conversationId: string | null;
    },
  ): Promise<void> => {
    const owner: Owner = { tenantId: actor.tenantId, userId: actor.userId };
    if (step.owner === "YOU") {
      if ((await boardTask(actor, plan, step)) === "FAILED") {
        await thread.notPlaced(owner, plan, step).catch(() => undefined);
      }
      return;
    }
    if (step.owner === "TOGETHER") {
      if ((await boardTask(actor, plan, step)) === "FAILED") {
        await thread.notPlaced(owner, plan, step).catch(() => undefined);
      }
      // Their part, asked of them once (the card asks; the thread keeps it).
      await store
        .appendThread(owner, {
          planId: plan.planId,
          jobId: null,
          kind: "QUESTION",
          author: "LIAISON",
          stepKey: step.key,
          factRef: null,
          text: `Your part of "${step.title}": ${step.evidenceNeeded[0] ?? "finish it once Q has prepared it"}`.slice(
            0,
            1_000,
          ),
          idempotencyKey: `plan-question:${plan.planId}:${String(plan.version)}:${step.key}`,
        })
        .catch(() => null);
    }
    const action = step.action;
    if (action.kind === "WORKFORCE") {
      const outward = action.roles.some(
        (role) => OUTWARD_TOOLS[role] !== undefined,
      );
      const payload = stepJobPayload(actor.userId, plan, step);
      if (payload === null) {
        await thread.move(owner, plan, step, "PROPOSED", { prepared: false });
        return;
      }
      if (!outward) {
        // Their own work (research, a document of theirs, a specialist's
        // public reading), approved with the plan: it starts now, on the
        // durable queue, carrying the plan so it reads the person's
        // direction from the plan's thread before each step.
        const jobId = await enqueueStepJob(
          actor,
          plan,
          step,
          payload,
          trace,
        ).catch((error: unknown) => {
          logger?.warn(
            { err: error, planId: plan.planId },
            "plan step not started",
          );
          return null;
        });
        if (jobId !== null) {
          await thread.link(owner, plan, step.key, "job", jobId);
          await thread.move(owner, plan, step, "DOING");
          return;
        }
      }
      // Outward work: its own approval card, always (CLAUDE.md).
      const card = await dependencies
        .ask?.(actor, {
          conversationId: trace.conversationId,
          actionType: "q.workforce.job.start",
          payload,
          words: step.title,
          key: `plan-step:${plan.planId}:${String(plan.version)}:${step.key}`,
        })
        .catch(() => null);
      const prepared = card !== null && card !== undefined;
      if (prepared) {
        await thread.link(owner, plan, step.key, "action", card.qActionId);
      }
      // "Ready for your approval" only when the card exists (live
      // 2026-10-29: said with no approval behind it).
      await thread.move(owner, plan, step, "PROPOSED", { prepared });
      return;
    }
    if (
      action.kind === "APP_ACTION" &&
      action.name === "board.item.add" &&
      step.owner === "Q"
    ) {
      // Q's own note on their board: instant and theirs to remove.
      if ((await boardTask(actor, plan, step)) !== "FAILED") {
        await thread.move(owner, plan, step, "DONE");
      }
      return;
    }
    // A single proposal Q prepares when they say go: its card names the
    // exact message, meeting or change, approved on its own. Nothing is
    // prepared yet, so it is never said to be ready for approval.
    await thread.move(owner, plan, step, "PROPOSED", { prepared: false });
  };

  /**
   * Execute (the approved action): the exact version approved -- same
   * version, same body -- each step fired once (idempotent per step and
   * version). Steps that wait on a condition stay TODO until it holds.
   */
  const execute = async (
    approver: ActorContext,
    payload: QPlanExecutePayload,
  ): Promise<"EXECUTED" | "STALE"> => {
    const owner: Owner = {
      tenantId: approver.tenantId,
      userId: approver.userId,
    };
    const stored = await store.read(owner, payload.planId, payload.version);
    if (
      stored === null ||
      stored.bodySha256 !== payload.bodySha256 ||
      stored.headVersion !== payload.version
    ) {
      return "STALE";
    }
    const plan = stored.plan;
    const head = await store.head(owner, plan.planId);
    const trace = await traceOf(owner, head?.jobId ?? null);
    const runtimes = await thread.runtimes(owner, plan.planId);
    for (const step of plan.steps) {
      if (!payload.stepKeys.includes(step.key)) continue;
      if (!awaitsGo(step, runtimeOf(runtimes, step.key))) continue;
      if (!conditionsHold(step.waitsFor, runtimes, now())) continue;
      await fireStep(approver, plan, step, trace);
    }
    await store.setStatus(owner, plan.planId, "EXECUTING");
    return "EXECUTED";
  };

  /** The q.plan.execute action: one approval bound to the exact version. */
  const executeAction = (): AnyQActionDefinition =>
    defineQAction<QPlanExecutePayload, { readonly planId: string }>({
      actionType: PLAN_EXECUTE,
      version: 1,
      riskClass: "CONFIRM_REQUIRED",
      owner: "q-api",
      description:
        "Runs the plan Q wrote for the person, exactly the version approved: Q's own work starts, anything that goes to another person gets its own approval card, and the person's steps go on their board with reminders.",
      payload: QPlanExecutePayloadSchema,
      result: z.object({ planId: UuidSchema }).strict(),
      targets: (payload): readonly QSubjectRef[] => [
        { kind: "USER", userId: payload.ownerUserId },
      ],
      describe: (payload) => ({
        summary: `Run your plan: ${payload.goal}`.slice(0, 200),
        preview: payload.steps
          .map((step, index) => {
            const who =
              step.owner === "Q"
                ? "Q"
                : step.owner === "YOU"
                  ? "You"
                  : "Q prepares, you finish";
            const when = step.due === null ? "" : ` (by ${step.due})`;
            const asks = step.needsApproval
              ? " — comes to you for approval before anything goes out"
              : step.owner === "YOU"
                ? " — on your board, with a reminder when dated"
                : "";
            return `${String(index + 1)}. ${who}: ${step.title}${when}${asks}`;
          })
          .join("\n")
          .concat(
            (payload.specialists ?? [])
              .map(
                (one) =>
                  `\nQ sets up "${one.name}" for this, able only to read public sources.`,
              )
              .join(""),
          ),
      }),
      // Said before the steps run: it promises only what is about to be
      // tried; the plan card shows each step as it lands (or fails).
      confirm: () =>
        "Approved. I'm starting my steps and putting yours on your board; the plan card shows each one as it lands, and anything that goes out comes to you first.",
      authorize: (payload, actor) =>
        Promise.resolve(
          actor.actorType !== "HUMAN"
            ? { outcome: "DENY" as const, code: "NOT_A_PERSON" }
            : payload.ownerUserId !== actor.userId
              ? { outcome: "DENY" as const, code: "NOT_YOURS" }
              : { outcome: "ALLOW" as const },
        ),
      executor: {
        execute: async (action, context) => {
          try {
            const done = await execute(context.approver, action.payload);
            return done === "STALE"
              ? {
                  outcome: "FAILED",
                  failureCode: "PLAN_CHANGED",
                  retryable: false,
                }
              : {
                  outcome: "EXECUTED",
                  result: { planId: action.payload.planId },
                };
          } catch (error: unknown) {
            logger?.warn(
              { err: error, actionId: action.actionId },
              "plan not executed",
            );
            return {
              outcome: "FAILED",
              failureCode: "NOT_EXECUTED",
              retryable: true,
            };
          }
        },
      },
    });

  /**
   * S6: the person's words to work under way (the reader's directsWork).
   * Filed once per turn as DIRECTION on their newest plan being carried
   * out, else on their newest plan job still running; every running step
   * reads it before its next action. NONE: nothing of theirs is running.
   */
  const direct = async (
    actor: ActorContext,
    runId: string,
    text: string,
  ): Promise<{ readonly status: "NOTED" | "NONE" }> => {
    const owner: Owner = { tenantId: actor.tenantId, userId: actor.userId };
    const rows = await sql<{ plan_id: string | null; job_id: string | null }[]>`
      (select p.id as plan_id, null::uuid as job_id, p.updated_at as at
         from q_runtime.q_plans p
        where p.tenant_id = ${owner.tenantId} and p.user_id = ${owner.userId}
          and p.status in ('ACCEPTED', 'ON_BOARD', 'EXECUTING')
        order by p.updated_at desc limit 1)
      union all
      (select null::uuid, q.job_id, q.created_at
         from q_runtime.agent_work_queue q
        where q.tenant_id = ${owner.tenantId} and q.user_id = ${owner.userId}
          and q.state in ('QUEUED', 'RUNNING', 'RECOVERING')
        order by q.created_at desc limit 1)
      order by at desc limit 1`;
    const row = rows[0];
    if (row === undefined) return { status: "NONE" };
    const target =
      row.plan_id !== null
        ? { planId: row.plan_id }
        : { jobId: row.job_id ?? "" };
    if ("jobId" in target && target.jobId === "") return { status: "NONE" };
    const entry = await thread
      .direct(owner, target, text, runId)
      .catch(() => null);
    return { status: entry === null ? "NONE" : "NOTED" };
  };

  /**
   * S6 (addendum 2): every open plan of the tenant re-evaluated on ANY of
   * its domain events -- no per-feature watchers. Each step's condition
   * is decided by code from typed reads (the board item's status, the
   * linked job's state, the linked card's status, a date); a step whose
   * wait now holds is fired as its owner; a step whose own work finished
   * is marked done, confirmed in the thread. Idempotent: the thread's keys
   * make a replayed event write nothing.
   */
  const wakeTenant = async (tenantId: string): Promise<number> => {
    dependencies.invalidate?.(tenantId);
    const live = await store.livePlans(tenantId);
    let moved = 0;
    for (const row of live) {
      const owner: Owner = { tenantId: row.tenantId, userId: row.userId };
      moved += await evaluatePlan(owner, row.planId).catch((error: unknown) => {
        logger?.warn(
          { err: error, planId: row.planId },
          "plan conditions not evaluated",
        );
        return 0;
      });
    }
    return moved;
  };

  /**
   * The safety net beside the wake channel: every tenant with a plan under
   * way, re-evaluated (a date reached; a wake missed during a deploy).
   */
  const sweep = async (): Promise<number> => {
    const tenants = await sql<{ tenant_id: string }[]>`
      select distinct tenant_id from q_runtime.q_plans
       where status in ('ACCEPTED', 'ON_BOARD', 'EXECUTING')
       limit 200`;
    let moved = 0;
    for (const row of tenants) moved += await wakeTenant(row.tenant_id);
    return moved;
  };

  const evaluatePlan = async (
    owner: Owner,
    planId: string,
  ): Promise<number> => {
    const stored = await store.read(owner, planId);
    if (stored === null) return 0;
    const plan = stored.plan;
    let runtimes = await thread.runtimes(owner, planId);
    const facts = await linkedState(owner, runtimes);
    let moved = 0;
    // 1. Work that finished, verified from its own record.
    for (const step of plan.steps) {
      const runtime = runtimeOf(runtimes, step.key);
      if (runtime.status === "DONE" || runtime.status === "SKIPPED") continue;
      const verified = verifiedDone(runtime, facts, step.owner);
      if (verified === null) {
        // A shared step whose Q part finished first now waits on theirs.
        const ours = qPartDone(runtime, facts);
        if (
          step.owner === "TOGETHER" &&
          runtime.boardItemId !== null &&
          ours !== null &&
          runtime.status !== "WAITING_YOU"
        ) {
          await thread.move(owner, plan, step, "WAITING_YOU");
          await thread.finding(
            owner,
            planId,
            step.key,
            `${ours} Your part is still open on your board.`,
            `${String(plan.version)}:${step.key}:our-part-done`,
          );
          moved += 1;
        }
        continue;
      }
      await thread.move(owner, plan, step, "DONE");
      await thread.finding(
        owner,
        planId,
        step.key,
        verified,
        `${String(plan.version)}:${step.key}:done`,
      );
      moved += 1;
    }
    if (moved > 0) runtimes = await thread.runtimes(owner, planId);
    // 2. Steps whose wait now holds are fired (as the person, now).
    const waiting = plan.steps.filter(
      (step) =>
        step.waitsFor.length > 0 &&
        runtimeOf(runtimes, step.key).status === "TODO" &&
        conditionsHold(step.waitsFor, runtimes, now()),
    );
    if (waiting.length === 0 || stored.status !== "EXECUTING") return moved;
    const actor = await dependencies.actorFor?.(owner).catch(() => null);
    if (actor === null || actor === undefined) return moved;
    const head = await store.head(owner, planId);
    const trace = await traceOf(owner, head?.jobId ?? null);
    for (const step of waiting) {
      await thread.finding(
        owner,
        planId,
        step.key,
        `What this step waited for is done, so it starts now: ${step.title}`,
        `${String(plan.version)}:${step.key}:ready`,
      );
      await fireStep(actor, plan, step, trace);
      moved += 1;
    }
    return moved;
  };

  /** Each linked record's state, one batched read per kind. */
  const linkedState = async (
    owner: Owner,
    runtimes: ReadonlyMap<string, StepRuntime>,
  ): Promise<LinkedState> => {
    const boardIds = [...runtimes.values()].flatMap((one) =>
      one.boardItemId === null ? [] : [one.boardItemId],
    );
    const jobIds = [...runtimes.values()].flatMap((one) =>
      one.jobId === null ? [] : [one.jobId],
    );
    const actionIds = [...runtimes.values()].flatMap((one) =>
      one.actionId === null ? [] : [one.actionId],
    );
    const [board, jobs, actions] = await Promise.all([
      boardIds.length === 0
        ? Promise.resolve([])
        : sql<{ id: string; status: string }[]>`
            select id, status from workspace.board_items
             where tenant_id = ${owner.tenantId} and user_id = ${owner.userId}
               and id = any(${boardIds}::uuid[])`,
      jobIds.length === 0
        ? Promise.resolve([])
        : sql<{ id: string; status: string }[]>`
            select job_id as id, state as status from q_runtime.agent_work_queue
             where tenant_id = ${owner.tenantId} and user_id = ${owner.userId}
               and job_id = any(${jobIds}::uuid[])`,
      actionIds.length === 0
        ? Promise.resolve([])
        : sql<{ id: string; status: string }[]>`
            select id, status from q_runtime.actions
             where tenant_id = ${owner.tenantId} and id = any(${actionIds}::uuid[])`,
    ]);
    return {
      board: new Map(board.map((row) => [row.id, row.status])),
      jobs: new Map(jobs.map((row) => [row.id, row.status])),
      actions: new Map(actions.map((row) => [row.id, row.status])),
    };
  };

  return {
    subjectOf,
    start,
    run,
    view,
    decide,
    execute,
    executeAction,
    direct,
    directions,
    wakeTenant,
    sweep,
    evaluatePlan,
  };
}

export type Plans = ReturnType<typeof createPlans>;

type LinkedState = {
  readonly board: ReadonlyMap<string, string>;
  readonly jobs: ReadonlyMap<string, string>;
  readonly actions: ReadonlyMap<string, string>;
};

/**
 * Whether Execute still has to fire this step (live 2026-10-29, plan
 * 6505af77): "Put on my board" parks Q's steps as PROPOSED (waiting for
 * go) and moves the person's to WAITING_YOU, so an Execute that fired only
 * TODO steps started nothing while saying it had. A step awaits go until
 * something was started for it: a job or an approval card. The person's
 * own step awaits only its board task; placing it again is a replay.
 */
export function awaitsGo(step: QPlanStep, runtime: StepRuntime): boolean {
  if (runtime.status === "DONE" || runtime.status === "SKIPPED") return false;
  if (runtime.status === "DOING") return false;
  if (runtime.jobId !== null || runtime.actionId !== null) return false;
  if (step.owner === "YOU") return runtime.boardItemId === null;
  return true;
}

/**
 * Live e11 (2026-10-29): the card showed the thread's last four lines, so a
 * finished step still read "Started" and nothing said which step stood
 * where. A version's body is immutable; where its steps stand is the
 * thread's projection, laid over the body's own additive step fields
 * (status, job, board item, approval, reminder) for the reader only. The
 * body hash the approval binds to is the stored one, untouched.
 */
export function withRuntimes(
  plan: QPlan,
  runtimes: ReadonlyMap<string, StepRuntime>,
): QPlan {
  if (runtimes.size === 0) return plan;
  const uuid = (id: string | null) =>
    id !== null && UUID_TEXT.test(id) ? id : null;
  return {
    ...plan,
    steps: plan.steps.map((step) => {
      const runtime = runtimes.get(step.key);
      if (runtime === undefined) return step;
      return {
        ...step,
        status: runtime.status,
        jobId: uuid(runtime.jobId) ?? step.jobId,
        boardItemId: uuid(runtime.boardItemId) ?? step.boardItemId,
        proposalId: uuid(runtime.actionId) ?? step.proposalId,
        reminderId: runtime.reminderId ?? step.reminderId,
      };
    }),
  };
}

const UUID_TEXT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A step's own record says it is done: what was verified, in plain words. */
export function verifiedDone(
  runtime: StepRuntime,
  state: LinkedState,
  owner?: QPlanStep["owner"],
): string | null {
  if (
    runtime.boardItemId !== null &&
    state.board.get(runtime.boardItemId) === "DONE"
  ) {
    return "You marked it done on your board.";
  }
  // A shared step is done when their part is (live 2026-10-29: Done while
  // the founder's part was still open on their board). Without a board item
  // there is no part of theirs to wait on.
  if (owner === "TOGETHER" && runtime.boardItemId !== null) return null;
  return qPartDone(runtime, state);
}

/** Q's own part of a step finished, verified from its record. */
export function qPartDone(
  runtime: StepRuntime,
  state: LinkedState,
): string | null {
  if (runtime.jobId !== null && state.jobs.get(runtime.jobId) === "COMPLETED") {
    return "Q's work on it finished.";
  }
  if (
    runtime.actionId !== null &&
    state.actions.get(runtime.actionId) === "EXECUTED"
  ) {
    return "Approved and done.";
  }
  return null;
}

/** Whether every condition of a step holds now (code, from the thread and the date). */
export function conditionsHold(
  conditions: readonly QPlanCondition[],
  runtimes: ReadonlyMap<string, StepRuntime>,
  at: Date,
): boolean {
  return conditions.every((condition) => {
    switch (condition.kind) {
      case "STEP_DONE":
        return runtimeOf(runtimes, condition.stepKey).status === "DONE";
      case "DATE_REACHED":
        return at.toISOString().slice(0, 10) >= condition.on;
      case "BOARD_TASK_DONE":
        return [...runtimes.values()].some(
          (one) =>
            one.boardItemId === condition.boardItemId && one.status === "DONE",
        );
      case "APPROVAL_DECIDED":
        return [...runtimes.values()].some(
          (one) =>
            one.actionId === condition.proposalId && one.status === "DONE",
        );
      case "MEETING_BOOKED":
      case "DOCUMENT_SHARED":
      case "THEY_REPLIED":
        // Read from their records when such a condition is written; a plan
        // version that names one waits until code can decide it.
        return false;
    }
  });
}

/** The approval's exact payload for a stored version. */
export function executePayloadOf(
  ownerUserId: string,
  plan: QPlan,
  bodySha256: string,
): QPlanExecutePayload {
  return QPlanExecutePayloadSchema.parse({
    ownerUserId,
    planId: plan.planId,
    version: plan.version,
    bodySha256,
    stepKeys: plan.steps.map((step) => step.key),
    goal: plan.goal.slice(0, 500),
    steps: plan.steps.map((step) => ({
      key: step.key,
      title: step.title,
      owner: step.owner,
      due: step.due,
      needsApproval: step.needsApproval,
    })),
    ...(plan.specialists === undefined || plan.specialists.length === 0
      ? {}
      : {
          specialists: plan.specialists.map((one) => ({
            stepKey: one.stepKey,
            name: one.name,
            tools: [...one.tools],
          })),
        }),
  });
}

/**
 * A Q-owned WORKFORCE step as one approved job's plan: the executor tools
 * its roles need; a specialist's (addendum 1) mapped to the executor that
 * runs them and named as the specialist -- never wider than its own tools.
 */
export function stepJobPayload(
  ownerUserId: string,
  plan: QPlan,
  step: QPlanStep,
): WorkforceJobStartPayload | null {
  if (step.action.kind !== "WORKFORCE") return null;
  const specialist = plan.specialists?.find((one) => one.stepKey === step.key);
  const goal = `${step.title}. ${step.why}`.slice(0, 400);
  type DraftStep = {
    readonly key: string;
    readonly role: string;
    readonly agentName: string;
    readonly goal: string;
    readonly tools: readonly string[];
    readonly dependsOn: readonly string[];
    readonly budgetUsd: string;
    readonly spawned: boolean;
    readonly why: string;
    readonly document?: unknown;
  };
  const steps = step.action.roles.flatMap((role, index): DraftStep[] => {
    const key = `${step.key.slice(0, 30)}_${String(index + 1)}`;
    const base = {
      key,
      dependsOn: [] as string[],
      budgetUsd: "0.3",
      spawned: false,
      goal,
      why: step.why.slice(0, 300),
    };
    switch (role) {
      case "RESEARCH":
        return [
          {
            ...base,
            role,
            agentName: "Research",
            tools: ["public_web.search"],
          },
        ];
      case "DOCUMENTS":
        return [
          {
            ...base,
            role,
            agentName: "Documents",
            tools: ["documents.own.prepare"],
            document: {
              operation: "PREPARE" as const,
              kind: "ANALYSIS" as const,
              scope:
                plan.side === "FOUNDER"
                  ? ("OWN_COMPANY" as const)
                  : ("GENERAL" as const),
            },
          },
        ];
      case "AD_HOC": {
        if (specialist === undefined) return [];
        const tools = [
          ...new Set(
            specialist.tools.flatMap((tool) => {
              const mapped = SPECIALIST_EXECUTOR_TOOLS[tool];
              return mapped === undefined ? [] : [mapped];
            }),
          ),
        ];
        return tools.length === 0
          ? []
          : [
              {
                ...base,
                role,
                agentName: specialist.name,
                tools,
                spawned: true,
              },
            ];
      }
      case "MANDATE_WATCHER":
        // Watching new companies against their own mandate: own work.
        return [
          {
            ...base,
            role,
            agentName: "Mandate watcher",
            tools: ["search_companies", "list_my_relationships"],
          },
        ];
      case "LEAD":
      case "WRITER":
      case "REVIEWER":
        // Internal: the orchestrator assigns these; a plan never does.
        return [];
      case "CONVERSATION":
      case "OUTREACH":
      case "SCHEDULER": {
        const tools = OUTWARD_TOOLS[role];
        return tools === undefined
          ? []
          : [
              {
                ...base,
                role,
                agentName: role.charAt(0) + role.slice(1).toLowerCase(),
                tools: [...tools],
              },
            ];
      }
    }
  });
  if (steps.length === 0) return null;
  const parsed = WorkforceJobStartPayloadSchema.safeParse({
    ownerUserId,
    goal: `${plan.goal}: ${step.title}`.slice(0, 2_000),
    summary: step.title.slice(0, 400),
    steps,
    permitted: [...new Set(steps.flatMap((one) => one.tools))].slice(0, 24),
    budgetUsd: "0.5",
    cannot: [],
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The facts a plan cites, from the situation it was written from: what a
 * step's "why" opens on the card. Only cited refs; the person's own
 * situation, read as them when the plan was made.
 */
export function citedFacts(
  plan: QPlan,
  situation: unknown,
): NonNullable<QPlanView["facts"]> {
  const dossier = QSituationDossierSchema.safeParse(situation);
  if (!dossier.success) return [];
  const cited = new Set([
    ...plan.situationRefs,
    ...plan.steps.flatMap((step) => step.cites),
  ]);
  return situationFacts(dossier.data)
    .filter((fact) => cited.has(fact.ref))
    .slice(0, 120)
    .map((fact) => ({
      ref: fact.ref,
      statement: fact.statement.slice(0, 1_000),
      truthClass: fact.truthClass,
    }));
}

/** A plan step's board key as the UUID the board requires (stable per key). */
export function planBoardKey(key: string): string {
  return boardKey(key, "plan-step", null);
}

export type BoardPlacement = {
  readonly placed: number;
  readonly already: number;
  readonly failed: number;
  /** Q's steps, waiting until they say go. */
  readonly waiting: number;
};

function countWords(n: number, noun = "task"): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

/** What the person is told after Put on my board: only what landed. */
export function boardMessage(board: BoardPlacement): string {
  const parts: string[] = [];
  if (board.placed > 0) {
    parts.push(
      `On your board: ${countWords(board.placed)}, with reminders where a step has a date.`,
    );
  }
  if (board.already > 0) {
    parts.push(
      board.placed > 0 || board.failed > 0
        ? `${countWords(board.already)} ${board.already === 1 ? "was" : "were"} already there.`
        : `Your ${countWords(board.already)} ${board.already === 1 ? "is" : "are"} already on your board.`,
    );
  }
  if (board.failed > 0) {
    parts.push(
      board.placed === 0
        ? `I couldn't put ${board.failed === 1 ? "your step" : `your ${countWords(board.failed, "step")}`} on your board just now, so ${board.already > 0 ? "nothing new" : "nothing"} was added. Try again in a moment.`
        : `I couldn't add ${countWords(board.failed, "step")}; try again in a moment.`,
    );
  }
  if (board.placed + board.already + board.failed === 0) {
    parts.push(
      "None of the steps is yours to do, so nothing went on your board.",
    );
  }
  if (board.waiting > 0) parts.push("My steps wait until you say go.");
  return parts.join(" ");
}

function summaryOf(
  quote: string | null,
  deliverable: PlanAskReading["deliverable"],
): string {
  const head =
    deliverable === "DOCUMENT_REVIEW"
      ? "Review of your documents"
      : "Your plan";
  const clean = (quote ?? "").replace(/\s+/gu, " ").trim();
  if (clean.length === 0) return head;
  const words = clipAtWord(clean, 120);
  return `${head}: ${words}`.slice(0, 400);
}
