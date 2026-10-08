import {
  QActionTypeSchema,
  Q_WORKFORCE_JOB_START,
  UuidSchema,
  WorkforceJobStartPayloadSchema,
  type QSubjectRef,
  type WorkforceJobStartPayload,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  defineQAction,
  type AnyQActionDefinition,
  type QActionProposer,
} from "@capital-q/q-actions";
import {
  AGENT_REGISTRY,
  executorRoleOf,
  isAgentRole,
  registeredExecutors,
  type BoundStep,
} from "@capital-q/q-orchestrator";
import type { QJobPlanView, QJobPort } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";
import { z } from "zod";

import {
  DEFAULT_JOB_BUDGET_USD,
  executableJobTools,
  type PlannedJob,
  type WorkforceJobs,
} from "./jobs.js";
import type { Owner } from "./store.js";

/**
 * A job the lead Q proposes (founder brief J1, J4): Prepare -> Recommend ->
 * Approve -> Execute.
 *
 * Q's `propose_q_job` tool asks the lead Q to plan the person's goal. The
 * plan -- each step, the specialist that owns it (or a helper spawned with
 * only the tools its step needs), the tools and the budget -- is bounded by
 * code and becomes the card's exact payload. Approval binds to that plan:
 * on approval the job runs as planned, never re-planned, as the person who
 * approved it, through the app's own authorized services; every outward
 * message still passes the reviewer. A changed plan is a new card.
 */

export const WORKFORCE_JOB_START = QActionTypeSchema.parse(
  Q_WORKFORCE_JOB_START,
);

const StartedSchema = z.object({ jobId: UuidSchema }).strict();
const READING_TTL_MS = 10 * 60_000;

function usd(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/u, "") || "0";
}

/** Each step in plain words: the specialist's name, never a role id. */
function who(step: { readonly role: string; readonly agentName: string }) {
  if (step.role === "AD_HOC") return step.agentName;
  return isAgentRole(step.role) ? AGENT_REGISTRY[step.role].title : "Q";
}

/** Tools whose step books or proposes a call, so a calendar matters. */
const CALENDAR_TOOLS: ReadonlySet<string> = new Set([
  "find_meeting_times",
  "schedule.meeting.book",
]);
const OUTWARD_TOOLS: ReadonlySet<string> = new Set([
  "chat.message.send",
  "email.send",
]);

/**
 * Q room R5: what will need the person, from the plan itself (code, never
 * a model). `calendarConnected` false adds the calendar, honestly: without
 * it Q offers times it could not check.
 */
export function needsYouFor(
  payload: WorkforceJobStartPayload,
  calendarConnected: boolean | null = null,
): readonly string[] {
  const tools = new Set(payload.steps.flatMap((step) => step.tools));
  const needs = [
    [...tools].some((tool) => OUTWARD_TOOLS.has(tool))
      ? "Your approval of this plan before anything is sent"
      : "Your approval of this plan before anything starts",
  ];
  if (
    calendarConnected === false &&
    [...tools].some((tool) => CALENDAR_TOOLS.has(tool))
  ) {
    needs.push(
      "Connect your Google Calendar, or I'll suggest times I can't check against it",
    );
  }
  return needs;
}

export function planView(
  payload: WorkforceJobStartPayload,
  calendarConnected: boolean | null = null,
): QJobPlanView {
  return {
    summary: payload.summary,
    steps: payload.steps.map((step) => ({
      who: who(step),
      does: step.goal,
    })),
    cannot: payload.cannot,
    budgetUsd: payload.budgetUsd,
    needsYou: needsYouFor(payload, calendarConnected),
  };
}

/** Names in a goal: capitalised words of three letters or more. */
function namesIn(text: string): ReadonlySet<string> {
  return new Set(
    (text.match(/\b\p{Lu}[\p{L}'-]{2,}/gu) ?? [])
      .map((word) => word.toLowerCase())
      .filter((word) => !COMMON_CAPITALISED.has(word)),
  );
}
const COMMON_CAPITALISED: ReadonlySet<string> = new Set([
  "the",
  "and",
  "can",
  "could",
  "please",
  "follow",
  "send",
  "draft",
  "book",
  "set",
  "introduce",
  "reply",
  "write",
  "ask",
  "find",
  "get",
  "make",
]);

/** One approval already waiting for the person, as the Approval Engine lists it. */
export type WaitingItem = {
  readonly summary: string;
  readonly actionType?: string | undefined;
  readonly targets?: readonly QSubjectRef[] | undefined;
};

function subjectKey(subject: QSubjectRef): string {
  switch (subject.kind) {
    case "COMPANY":
      return `COMPANY:${subject.companyId}`;
    case "INVESTOR_ORGANISATION":
      return `INVESTOR_ORGANISATION:${subject.investorOrganisationId}`;
    case "RELATIONSHIP":
      return `RELATIONSHIP:${subject.relationshipId}`;
    case "CAPITAL_OBJECTIVE":
      return `CAPITAL_OBJECTIVE:${subject.capitalObjectiveId}`;
    case "DOCUMENT":
      return `DOCUMENT:${subject.documentId}`;
    case "USER":
      return `USER:${subject.userId}`;
    case "ORGANISATION":
      return `ORGANISATION:${subject.organisationId}`;
  }
}

/**
 * Q room R5 / W4b: what already waits for them, like a colleague checks
 * (code, deterministic):
 *
 * - the goal resolves to records (the companies, investors, relationships
 *   its names mean, by the person's own reach): waiting work aimed at any
 *   of them, or naming them, is about the same people;
 * - it names people none of their records match: the names both mention;
 * - it names nobody at all: waiting jobs of the same kind (this action
 *   type), so two near-identical jobs are not planned side by side.
 */
export function relatedWaiting(
  goal: string,
  waiting: readonly WaitingItem[],
  subjects: readonly QSubjectRef[] = [],
  actionType: string = WORKFORCE_JOB_START,
): {
  readonly about: "SAME_PEOPLE" | "SAME_KIND";
  readonly waiting: readonly string[];
} {
  const names = namesIn(goal);
  const keys = new Set(
    subjects.map((subject) => subjectKey(subject).toLowerCase()),
  );
  const pick = (items: readonly WaitingItem[]) =>
    items.map((item) => item.summary.slice(0, 200)).slice(0, 5);
  if (keys.size === 0 && names.size === 0) {
    return {
      about: "SAME_KIND",
      waiting: pick(waiting.filter((item) => item.actionType === actionType)),
    };
  }
  return {
    about: "SAME_PEOPLE",
    waiting: pick(
      waiting.filter((item) => {
        const aimed = (item.targets ?? []).some((target) =>
          keys.has(subjectKey(target).toLowerCase()),
        );
        if (aimed) return true;
        const theirs = namesIn(item.summary);
        return [...names].some((name) => theirs.has(name));
      }),
    ),
  };
}

/** The card's preview: the plan the person approves, step by step. */
function preview(payload: WorkforceJobStartPayload): string {
  const lines = payload.steps.map(
    (step, index) =>
      `${String(index + 1)}. ${who(step)}${step.spawned ? " (a helper for this step only)" : ""}: ${step.goal}`,
  );
  lines.push(
    "Every message to the other side is checked by the reviewer before it goes.",
  );
  lines.push(`What will need you: ${needsYouFor(payload).join("; ")}.`);
  if (payload.cannot.length > 0) {
    lines.push(`Q can't: ${payload.cannot.join("; ")}.`);
  }
  lines.push(
    `Budget: up to $${Number(payload.budgetUsd).toFixed(2)} of Q's work.`,
  );
  return lines.join("\n");
}

/**
 * The approved payload back into the runner's plan, as it was approved.
 *
 * Recovery D1: a plan approved before the executor registry may carry
 * WRITER and REVIEWER steps. Those were never separate work -- the sending
 * step writes and reviews every draft itself -- so they are folded away and
 * whatever waited on them waits on what they waited on. An older helper
 * (AD_HOC) runs on the registered executor whose tools cover its own, or
 * else goes to the person with the reason; it is never widened.
 */
export function plannedFrom(payload: WorkforceJobStartPayload): PlannedJob {
  const executors = registeredExecutors({ research: true });
  const folded = new Map<string, readonly string[]>();
  for (const step of payload.steps) {
    if (step.role === "WRITER" || step.role === "REVIEWER") {
      folded.set(step.key, step.dependsOn);
    }
  }
  const unfold = (keys: readonly string[], depth = 0): string[] =>
    depth > 12
      ? []
      : keys.flatMap((key) => {
          const through = folded.get(key);
          return through === undefined ? [key] : unfold(through, depth + 1);
        });
  const steps = payload.steps.flatMap((step): BoundStep[] => {
    if (!isAgentRole(step.role) || folded.has(step.key)) return [];
    // Never wider than the approved grant, whatever the payload says.
    const tools = step.tools.filter((tool) => payload.permitted.includes(tool));
    const executor =
      step.role === "AD_HOC"
        ? (Object.values(executors).find(
            (one) =>
              one !== undefined &&
              tools.length > 0 &&
              tools.every((tool) => one.tools.includes(tool)),
          )?.role ?? null)
        : executorRoleOf(step.role);
    return [
      {
        key: step.key,
        role: step.role,
        executor,
        agentName: step.agentName,
        goal: step.goal,
        tools,
        dependsOn: [...new Set(unfold(step.dependsOn))],
        budgetUsd: Number(step.budgetUsd),
        outward: step.tools.some((tool) =>
          ["chat.message.send", "email.send"].includes(tool),
        ),
        spawned: step.spawned,
      },
    ];
  });
  return {
    summary: payload.summary,
    steps,
    refused: [],
    cannot: payload.cannot,
  };
}

export function createWorkforceJobActions(dependencies: {
  /** The jobs runner for one approver, over their own ports. */
  readonly jobsFor: (actor: ActorContext) => WorkforceJobs;
  readonly logger?: Logger | undefined;
}): readonly AnyQActionDefinition[] {
  const { logger } = dependencies;
  return [
    defineQAction<WorkforceJobStartPayload, z.infer<typeof StartedSchema>>({
      actionType: WORKFORCE_JOB_START,
      version: 1,
      riskClass: "CONFIRM_REQUIRED",
      owner: "q-api",
      description:
        "Runs one job the lead Q planned, exactly as approved: each step by its specialist (or a helper with only its step's tools), as the approver, within the plan's tools and budget; every outward message passes the reviewer.",
      payload: WorkforceJobStartPayloadSchema,
      result: StartedSchema,
      targets: (payload): readonly QSubjectRef[] => [
        { kind: "USER", userId: payload.ownerUserId },
      ],
      describe: (payload) => ({
        summary: `Q's team: ${payload.summary}`.slice(0, 200),
        preview: preview(payload),
      }),
      confirm: () =>
        "On it. You can follow each step under Q's team on your Work page.",
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
          const owner: Owner = {
            tenantId: context.approver.tenantId,
            userId: context.approver.userId,
          };
          const jobs = dependencies.jobsFor(context.approver);
          try {
            const filed = await jobs.file(owner, {
              goal: action.payload.goal,
              budgetUsd: Number(action.payload.budgetUsd),
              source: { kind: "JOB", id: action.actionId },
            });
            // The job runs past the approval: never inside it (model calls,
            // messages and bookings are slow and each is idempotent by key).
            void jobs
              .run(
                owner,
                {
                  goal: action.payload.goal,
                  budgetUsd: Number(action.payload.budgetUsd),
                  source: { kind: "JOB", id: action.actionId },
                  planned: plannedFrom(action.payload),
                },
                filed,
              )
              .catch((error: unknown) => {
                logger?.warn(
                  { err: error, actionId: action.actionId },
                  "workforce job did not finish",
                );
              });
            return { outcome: "EXECUTED", result: { jobId: filed.jobId } };
          } catch (error: unknown) {
            logger?.warn(
              { err: error, actionId: action.actionId },
              "workforce job not started",
            );
            return {
              outcome: "FAILED",
              failureCode: "NOT_FILED",
              retryable: true,
            };
          }
        },
      },
    }),
  ];
}

/**
 * The tool's port and the run's proposer: the lead Q's plan is prepared as
 * this run's card, one per turn, and proposed by the engine after the turn.
 */
export function createWorkforceJobBoard(dependencies: {
  readonly jobsFor: (actor: ActorContext) => WorkforceJobs;
  /** J6: whether this month's spend leaves room for a new job. */
  readonly withinLimit?: ((owner: Owner) => Promise<boolean>) | undefined;
  readonly budgetUsd?: number | undefined;
  readonly now?: (() => number) | undefined;
  /** R5: what already waits for their approval (the Approval Engine's list). */
  readonly waiting?:
    ((actor: ActorContext) => Promise<readonly WaitingItem[]>) | undefined;
  /** R5: whether their own Google Calendar is connected (stored state only). */
  readonly calendarConnected?:
    ((actor: ActorContext) => Promise<boolean>) | undefined;
}): { readonly port: QJobPort; readonly proposer: QActionProposer } {
  const now = dependencies.now ?? (() => Date.now());
  const budget = dependencies.budgetUsd ?? DEFAULT_JOB_BUDGET_USD;
  const prepared = new Map<
    string,
    {
      readonly tenantId: string;
      readonly userId: string;
      readonly payload: WorkforceJobStartPayload;
      readonly at: number;
    }
  >();
  return {
    port: {
      prepare: async (actor, runId, goal, options) => {
        const cutoff = now() - READING_TTL_MS;
        for (const [key, value] of prepared) {
          if (value.at < cutoff) prepared.delete(key);
        }
        const existing = prepared.get(runId);
        if (existing !== undefined) {
          return { status: "ONE_PER_TURN", plan: planView(existing.payload) };
        }
        // R5: like a colleague, look at what is already waiting first.
        if (options?.proceed !== true && dependencies.waiting !== undefined) {
          const related = relatedWaiting(
            goal,
            await dependencies.waiting(actor).catch(() => []),
            options?.subjects ?? [],
          );
          if (related.waiting.length > 0) {
            return {
              status: "ALREADY_WAITING",
              waiting: related.waiting,
              about: related.about,
            };
          }
        }
        const owner = { tenantId: actor.tenantId, userId: actor.userId };
        if (
          dependencies.withinLimit !== undefined &&
          !(await dependencies.withinLimit(owner).catch(() => true))
        ) {
          return { status: "LIMIT_REACHED" };
        }
        const jobs = dependencies.jobsFor(actor);
        const planned = await jobs
          .plan(owner, {
            goal,
            permitted: executableJobTools(jobs.research),
            budgetUsd: budget,
          })
          .catch(() => null);
        // D1: a plan with any step no registered executor can run is not
        // offered at all -- never a partial plan approved as if whole.
        if (
          planned === null ||
          planned.steps.length === 0 ||
          planned.refused.length > 0
        ) {
          return { status: "NOT_PLANNED" };
        }
        const steps = planned.steps.slice(0, 12).map((step) => ({
          key: step.key.slice(0, 40),
          role: step.role,
          agentName: step.agentName.slice(0, 60) || who(step),
          goal: step.goal.slice(0, 400),
          tools: [...step.tools].slice(0, 8),
          dependsOn: [...step.dependsOn].slice(0, 8),
          budgetUsd: usd(step.budgetUsd),
          spawned: step.spawned,
        }));
        const parsed = WorkforceJobStartPayloadSchema.safeParse({
          ownerUserId: actor.userId,
          goal: goal.slice(0, 2_000),
          summary: planned.summary.slice(0, 400) || "A job for Q's team",
          steps,
          permitted: [...new Set(steps.flatMap((step) => step.tools))].slice(
            0,
            24,
          ),
          budgetUsd: usd(budget),
          cannot: planned.cannot.slice(0, 5).map((line) => line.slice(0, 300)),
        });
        if (!parsed.success) return { status: "NOT_PLANNED" };
        prepared.set(runId, {
          tenantId: actor.tenantId,
          userId: actor.userId,
          payload: parsed.data,
          at: now(),
        });
        const calendarConnected =
          dependencies.calendarConnected === undefined
            ? null
            : await dependencies.calendarConnected(actor).catch(() => null);
        return {
          status: "PREPARED",
          plan: planView(parsed.data, calendarConnected),
        };
      },
    },
    proposer: {
      propose: (context) => {
        const entry = prepared.get(context.runId);
        if (entry === undefined) return Promise.resolve(null);
        prepared.delete(context.runId);
        if (
          entry.tenantId !== context.actor.tenantId ||
          entry.userId !== context.actor.userId
        ) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          actionType: WORKFORCE_JOB_START,
          payload: entry.payload,
        });
      },
    },
  };
}
