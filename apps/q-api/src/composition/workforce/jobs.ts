import type { Logger } from "@capital-q/observability";
import {
  AGENT_REGISTRY,
  RUBRIC_VERSION,
  boundPlan,
  rosterText,
  runJob,
  type AgentExecutor,
  type AgentRole,
  type BoundStep,
  type JobRecorder,
  type StepResult,
} from "@capital-q/q-orchestrator";
import { workforceCorrelationId } from "@capital-q/contracts";
import { stanceDeclines } from "@capital-q/q-core";

import type { WorkforceModels } from "./models.js";
import type { OutwardReview } from "./review.js";
import type { Owner, WorkforceStore } from "./store.js";

/**
 * The lead Q (founder brief J1, J4, J9): a job in the person's words is
 * planned into steps owned by agents, bounded by what the person allowed
 * and by the job's budget, then carried out agent by agent.
 *
 * The job's grant is the person's approval of it (an approved standing
 * instruction, delegation or prepared job): `permitted` is what it allows,
 * code's list, never the model's. Each agent works only through the ports
 * below, which are the app's own authorized services. Every message to
 * the other side is written, graded by the reviewer and sent only if it
 * passes; replies are read by meaning (REPLY_READER), never by a phrase
 * list, and a reply that may be a no is the person's to answer.
 */

export type MandateMatch = {
  readonly companyId: string;
  readonly name: string;
};

export type OpenConversation = {
  readonly relationshipId: string;
  readonly counterpartName: string;
  /** "Name: words" per line, oldest first. */
  readonly thread: string;
  /** Their latest message, when it is theirs and unanswered. */
  readonly latest: { readonly id: string; readonly text: string } | null;
  /** What Q may state as fact for the person in this conversation. */
  readonly material: string;
};

/** The app's own services an agent may call, each authorized for the owner. */
export type WorkforcePorts = {
  readonly principalName: (owner: Owner) => Promise<string>;
  /** Mandate watcher: companies newly matching the declared mandate. */
  readonly mandateMatches: (owner: Owner) => Promise<readonly MandateMatch[]>;
  readonly expressInterest: (
    owner: Owner,
    companyId: string,
    idempotencyKey: string,
  ) => Promise<{ readonly ok: boolean }>;
  /** Conversation: relationships with a reply waiting. */
  readonly openConversations: (
    owner: Owner,
  ) => Promise<readonly OpenConversation[]>;
  /** The writer's first draft of a reply. Null: nothing honest to say. */
  readonly writeReply: (
    owner: Owner,
    conversation: OpenConversation,
    intent: "WARM_REPLY" | "PROPOSE_TIMES",
    /** J6: the writer's call is priced under the job's own run. */
    correlationId?: string,
  ) => Promise<string | null>;
  readonly send: (
    owner: Owner,
    relationshipId: string,
    idempotencyKey: string,
    body: string,
  ) => Promise<boolean>;
  /** Scheduler. */
  readonly freeSlots: (
    owner: Owner,
    relationshipId: string,
  ) => Promise<readonly string[]>;
  readonly book: (
    owner: Owner,
    relationshipId: string,
    idempotencyKey: string,
    startsAt: string,
  ) => Promise<{ readonly ok: boolean; readonly meetingId: string | null }>;
  /** Something the person should see (a possible no, a held draft). */
  readonly notify: (
    owner: Owner,
    notice: {
      readonly key: string;
      readonly title: string;
      readonly body: string;
    },
  ) => Promise<void>;
};

const MAX_PER_STEP = 25;

function recorderFor(store: WorkforceStore, owner: Owner): JobRecorder {
  return {
    startRun: (input) =>
      store.startRun(owner, {
        jobId: input.jobId,
        role: input.role,
        agentName: input.agentName,
        goal: input.goal,
        tools: input.tools,
        budgetUsd: input.budgetUsd,
        stepKey: input.stepKey,
        spawnedByRunId: input.spawnedByRunId,
      }),
    endRun: (runId, status, summary) =>
      store.endRun(owner, runId, status, summary),
    handoff: (input) =>
      store.handoff(owner, {
        jobId: input.jobId,
        fromRunId: input.fromRunId,
        toRunId: input.toRunId,
        draftId: null,
        note: input.note,
      }),
  };
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** The agents, by role, over the app's ports. */
export function createWorkforceExecutors(dependencies: {
  readonly owner: Owner;
  readonly ports: WorkforcePorts;
  readonly models: Pick<WorkforceModels, "readReply">;
  readonly review: OutwardReview;
  /** Another agent in this job books calls: a wish to meet is its. */
  readonly scheduling: boolean;
}): Partial<Record<AgentRole, AgentExecutor>> {
  const { owner, ports, models, review } = dependencies;

  const has = (tools: readonly string[], tool: string) => tools.includes(tool);
  // One reading per message per job: the conversation and the scheduler
  // agents act on the same reading, and a reply is classified once.
  const readings = new Map<
    string,
    Promise<Awaited<ReturnType<WorkforceModels["readReply"]>>>
  >();

  const watcher: AgentExecutor = async (step, context) => {
    if (!has(step.tools, "relationship.interest.express")) {
      return { status: "HELD", summary: "Not allowed to express interest." };
    }
    const matches = (await ports.mandateMatches(owner)).slice(0, MAX_PER_STEP);
    let expressed = 0;
    for (const match of matches) {
      const done = await ports
        .expressInterest(
          owner,
          match.companyId,
          `wf:${context.jobId}:interest:${match.companyId}`,
        )
        .catch(() => ({ ok: false }));
      if (done.ok) expressed += 1;
    }
    return {
      status: "DONE",
      summary:
        matches.length === 0
          ? "No new companies match your mandate."
          : `Expressed interest in ${plural(expressed, "company", "companies")} matching your mandate.`,
      outputs: { expressed },
    };
  };

  /**
   * Conversation and scheduling share one pass over open replies: each
   * reply is read by meaning, then answered warmly, or offered times, or
   * booked, or handed to the person.
   */
  const conversation =
    (mode: "REPLY" | "SCHEDULE"): AgentExecutor =>
    async (step, context) => {
      if (
        !has(
          step.tools,
          mode === "REPLY" ? "chat.message.send" : "schedule.meeting.book",
        )
      ) {
        return { status: "HELD", summary: "Not allowed to do this step." };
      }
      const principalName = await ports.principalName(owner);
      const open = (await ports.openConversations(owner)).slice(
        0,
        MAX_PER_STEP,
      );
      let replied = 0;
      let booked = 0;
      let held = 0;
      let handed = 0;
      for (const one of open) {
        if (one.latest === null) continue;
        const latest = one.latest;
        const once =
          readings.get(latest.id) ??
          models.readReply(
            owner,
            { jobId: context.jobId, runId: context.runId },
            {
              principalName,
              counterpartName: one.counterpartName,
              thread: one.thread.slice(-4_000),
              latest: latest.text.slice(0, 4_000),
            },
          );
        readings.set(latest.id, once);
        const reading = await once;
        // Unreadable, a no, a not-now or an unhappy tone: the person's.
        if (
          reading === null ||
          stanceDeclines(reading.stance) ||
          reading.tone === "NEGATIVE"
        ) {
          if (mode === "REPLY") {
            handed += 1;
            await ports
              .notify(owner, {
                key: `wf:${context.jobId}:${one.latest.id}`,
                title:
                  reading === null
                    ? `Q couldn't read ${one.counterpartName}'s reply`
                    : `${one.counterpartName} may have said no`,
                body: "Q didn't reply. Read their message and answer yourself if you want to.",
              })
              .catch(() => undefined);
          }
          continue;
        }
        if (mode === "SCHEDULE") {
          if (!reading.wantsMeeting) continue;
          const slots = await ports.freeSlots(owner, one.relationshipId);
          const first = slots[0];
          if (first === undefined) continue;
          const result = await ports
            .book(
              owner,
              one.relationshipId,
              `wf:${context.jobId}:book:${one.relationshipId}`,
              first,
            )
            .catch(() => ({ ok: false, meetingId: null }));
          if (result.ok) booked += 1;
          continue;
        }
        if (reading.wantsMeeting && dependencies.scheduling) {
          // The scheduler books it; a reply now would cross with the invite.
          continue;
        }
        const draft = await ports.writeReply(
          owner,
          one,
          "WARM_REPLY",
          workforceCorrelationId(context.jobId, context.runId),
        );
        if (draft === null) continue;
        const verdict = await review.review(
          owner,
          {
            kind: "DELEGATED_WORK",
            id: `job:${context.jobId}`,
            goal: step.goal,
          },
          {
            principalName,
            counterpartName: one.counterpartName,
            channel: "CHAT",
            stage: "REPLY",
            purpose: `A warm reply to ${one.counterpartName}'s latest message: ${step.goal}`,
            material: one.material,
            thread: one.thread,
            body: draft,
          },
          { job: { jobId: context.jobId, parentRunId: context.runId } },
        );
        if (verdict.verdict === "HELD") {
          held += 1;
          continue;
        }
        const sent = await ports
          .send(
            owner,
            one.relationshipId,
            `wf:${context.jobId}:reply:${one.latest.id}`,
            verdict.body,
          )
          .catch(() => false);
        if (sent) {
          replied += 1;
          await review.settle(owner, verdict, "SENT");
        }
      }
      const result: StepResult =
        mode === "SCHEDULE"
          ? {
              status: "DONE",
              summary:
                booked === 0
                  ? "No calls to book yet."
                  : `Booked ${plural(booked, "call", "calls")}.`,
              outputs: { booked },
            }
          : {
              status: "DONE",
              summary: [
                `Replied to ${plural(replied, "person", "people")}`,
                held > 0
                  ? `held ${plural(held, "draft", "drafts")} below the bar`
                  : null,
                handed > 0
                  ? `left ${plural(handed, "reply", "replies")} for you`
                  : null,
              ]
                .filter((part) => part !== null)
                .join("; ")
                .concat("."),
              outputs: { replied, held, handed },
            };
      return result;
    };

  return {
    MANDATE_WATCHER: watcher,
    OUTREACH: watcher,
    CONVERSATION: conversation("REPLY"),
    SCHEDULER: conversation("SCHEDULE"),
  };
}

export type StartJobResult =
  | {
      readonly outcome: "STARTED";
      readonly jobId: string;
      readonly summary: string;
      readonly steps: readonly {
        readonly key: string;
        readonly status: string;
        readonly summary: string;
      }[];
      readonly refused: readonly {
        readonly key: string;
        readonly reason: string;
      }[];
      readonly cannot: readonly string[];
    }
  | {
      readonly outcome: "NOT_PLANNED" | "PLAN_LIMIT";
      readonly jobId: string | null;
    };

/** What the lead Q may plan with: the tools its specialists can carry out. */
export const EXECUTABLE_JOB_TOOLS: readonly string[] = [
  "search_companies",
  "list_my_relationships",
  "relationship.interest.express",
  "list_messages",
  "chat.message.send",
  "find_meeting_times",
  "list_schedule",
  "schedule.meeting.book",
];

/** The default budget of one job the lead Q proposes, USD. */
export const DEFAULT_JOB_BUDGET_USD = 0.5;

export type PlannedJob = {
  readonly summary: string;
  readonly steps: readonly BoundStep[];
  readonly refused: readonly {
    readonly key: string;
    readonly reason: string;
  }[];
  readonly cannot: readonly string[];
};

export function createWorkforceJobs(dependencies: {
  readonly store: WorkforceStore;
  readonly models: Pick<WorkforceModels, "plan" | "readReply">;
  readonly review: OutwardReview;
  readonly ports: WorkforcePorts;
  /** J6: one unit of `q.agent_jobs` per job; false is the plan's limit. */
  readonly meter?:
    ((owner: Owner, idempotencyKey: string) => Promise<boolean>) | undefined;
  /** J6: whether this month's spend leaves room for a new job. */
  readonly withinLimit?: ((owner: Owner) => Promise<boolean>) | undefined;
  readonly logger?: Logger | undefined;
}) {
  const { store } = dependencies;

  /** The lead Q's plan, bounded by what is permitted and the budget. */
  async function plan(
    owner: Owner,
    input: {
      readonly goal: string;
      readonly permitted: readonly string[];
      readonly budgetUsd: number;
    },
    trace: { readonly jobId: string; readonly runId: string } | null,
  ): Promise<PlannedJob | null> {
    const permitted = new Set(input.permitted);
    const planned = await dependencies.models.plan(owner, trace, {
      goal: input.goal.slice(0, 2_000),
      roster: rosterText(permitted),
      allowed: `Tools and actions: ${[...permitted].join(", ") || "none"}. Budget for the whole job: $${input.budgetUsd.toFixed(2)}.`,
    });
    if (planned === null) return null;
    const bound = boundPlan(planned.steps, {
      permitted,
      // The lead's own planning comes out of the same budget.
      budgetUsd: Math.max(0, input.budgetUsd - AGENT_REGISTRY.LEAD.budgetUsd),
    });
    return {
      summary: planned.summary,
      steps: bound.steps,
      refused: bound.refused,
      cannot: planned.cannot,
    };
  }

  /** Files the job for its source (one per source), with its lead run. */
  async function file(
    owner: Owner,
    input: {
      readonly goal: string;
      readonly budgetUsd: number;
      readonly source: {
        readonly kind: "JOB" | "INSTRUCTION" | "DELEGATED_WORK";
        readonly id: string;
      };
    },
  ): Promise<{ readonly jobId: string; readonly leadRunId: string }> {
    const one = await store.ensureJob(owner, {
      source: input.source,
      goal: input.goal,
      budgetUsd: input.budgetUsd,
      threshold: 75,
      maxRedrafts: 2,
      rubricVersion: RUBRIC_VERSION,
    });
    return { jobId: one.job.id, leadRunId: one.leadRunId };
  }

  /**
   * The month's limit and the plan's agent-job allowance, checked before
   * anything is planned or run; false holds the job with the reason.
   */
  async function gate(
    owner: Owner,
    filed: { readonly jobId: string; readonly leadRunId: string },
  ): Promise<boolean> {
    const hold = async (summary: string) => {
      await store.endRun(owner, filed.leadRunId, "HELD", summary);
      await store.setJobStatus(owner, filed.jobId, "HELD");
    };
    if (dependencies.withinLimit !== undefined) {
      const room = await dependencies.withinLimit(owner).catch(() => true);
      if (!room) {
        await hold(
          "This month's limit for Q's work is reached; raise it to go on.",
        );
        return false;
      }
    }
    if (dependencies.meter !== undefined) {
      const allowed = await dependencies
        .meter(owner, `wf:${filed.jobId}`)
        .catch(() => false);
      if (!allowed) {
        await hold("Your plan's agent jobs for this month are used up.");
        return false;
      }
    }
    return true;
  }

  /**
   * Carries out a plan already bound (and, for a proposed job, approved):
   * never re-planned here. Files the job for its source, checks the plan's
   * agent-job allowance and the month's limit, then runs agent by agent.
   */
  async function run(
    owner: Owner,
    input: {
      readonly goal: string;
      readonly budgetUsd: number;
      readonly source: {
        readonly kind: "JOB" | "INSTRUCTION" | "DELEGATED_WORK";
        readonly id: string;
      };
      readonly planned: PlannedJob;
    },
    filedAlready?: { readonly jobId: string; readonly leadRunId: string },
    options: { readonly gated?: boolean | undefined } = {},
  ): Promise<StartJobResult> {
    const filed = filedAlready ?? (await file(owner, input));
    if (options.gated !== true && !(await gate(owner, filed))) {
      return { outcome: "PLAN_LIMIT", jobId: filed.jobId };
    }
    const { jobId, leadRunId } = filed;
    const { planned } = input;
    const result = await runJob({
      jobId,
      goal: planned.summary,
      steps: planned.steps,
      executors: createWorkforceExecutors({
        owner,
        ports: dependencies.ports,
        models: dependencies.models,
        review: dependencies.review,
        scheduling: planned.steps.some((step) =>
          step.tools.includes("schedule.meeting.book"),
        ),
      }),
      recorder: {
        ...recorderFor(store, owner),
        // The lead is the job's lead run, not a second one.
        startRun: (one) =>
          one.role === "LEAD"
            ? Promise.resolve(leadRunId)
            : recorderFor(store, owner).startRun(one),
      },
    });
    const done = result.steps.filter((step) => step.status === "DONE").length;
    await store.setJobStatus(
      owner,
      jobId,
      result.steps.length > 0 && done === result.steps.length ? "DONE" : "HELD",
    );
    return {
      outcome: "STARTED",
      jobId,
      summary: planned.summary,
      steps: result.steps.map((step) => ({
        key: step.key,
        status: step.status,
        summary: step.summary,
      })),
      refused: planned.refused,
      cannot: planned.cannot,
    };
  }

  return {
    plan: (
      owner: Owner,
      input: {
        readonly goal: string;
        readonly permitted: readonly string[];
        readonly budgetUsd: number;
      },
    ) => plan(owner, input, null),

    file,
    run,

    /**
     * Plan and carry out one job the person approved. `permitted` is the
     * job's grant (tool and action names); `source` ties it to what it was
     * approved under, so a replay is the same job.
     */
    start: async (
      owner: Owner,
      input: {
        readonly goal: string;
        readonly permitted: readonly string[];
        readonly budgetUsd: number;
        readonly source: {
          readonly kind: "JOB" | "INSTRUCTION" | "DELEGATED_WORK";
          readonly id: string;
        };
      },
    ): Promise<StartJobResult> => {
      const filed = await store.ensureJob(owner, {
        source: input.source,
        goal: input.goal,
        budgetUsd: input.budgetUsd,
        threshold: 75,
        maxRedrafts: 2,
        rubricVersion: RUBRIC_VERSION,
      });
      const jobId = filed.job.id;
      const lead = { jobId, leadRunId: filed.leadRunId };
      if (!(await gate(owner, lead))) {
        return { outcome: "PLAN_LIMIT", jobId };
      }
      const planned = await plan(owner, input, {
        jobId,
        runId: filed.leadRunId,
      });
      if (planned === null) {
        await store.endRun(
          owner,
          filed.leadRunId,
          "HELD",
          "Couldn't plan this job just now.",
        );
        await store.setJobStatus(owner, jobId, "HELD");
        return { outcome: "NOT_PLANNED", jobId };
      }
      return run(owner, { ...input, planned }, lead, { gated: true });
    },
  };
}

export type WorkforceJobs = ReturnType<typeof createWorkforceJobs>;

/**
 * Founder brief J5: standing instructions and delegated work are Q's jobs
 * too -- the same job record, one per source, shown on the workforce page
 * as it runs. Best effort: a record that cannot be written never stops the
 * work it describes.
 */
export function workforceTracker(
  store: WorkforceStore,
  kind: "INSTRUCTION" | "DELEGATED_WORK",
) {
  return async (
    owner: Owner,
    source: { readonly id: string; readonly goal: string },
  ): Promise<void> => {
    const filed = await store.ensureJob(owner, {
      source: { kind, id: source.id },
      goal: source.goal,
      budgetUsd: DEFAULT_JOB_BUDGET_USD,
      threshold: 75,
      maxRedrafts: 2,
      rubricVersion: RUBRIC_VERSION,
    });
    await store.setJobStatus(owner, filed.job.id, "RUNNING");
  };
}
