import type { Logger } from "@capital-q/observability";
import {
  AGENT_REGISTRY,
  RUBRIC_VERSION,
  boundPlan,
  rosterText,
  runJob,
  type AgentExecutor,
  type AgentRole,
  type JobRecorder,
  type StepResult,
} from "@capital-q/q-orchestrator";
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
    notice: { readonly key: string; readonly title: string; readonly body: string },
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
}): Partial<Record<AgentRole, AgentExecutor>> {
  const { owner, ports, models, review } = dependencies;

  const has = (tools: readonly string[], tool: string) => tools.includes(tool);

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
      if (!has(step.tools, mode === "REPLY" ? "chat.message.send" : "schedule.meeting.book")) {
        return { status: "HELD", summary: "Not allowed to do this step." };
      }
      const principalName = await ports.principalName(owner);
      const open = (await ports.openConversations(owner)).slice(0, MAX_PER_STEP);
      let replied = 0;
      let booked = 0;
      let held = 0;
      let handed = 0;
      for (const one of open) {
        if (one.latest === null) continue;
        const reading = await models.readReply(
          owner,
          { jobId: context.jobId, runId: context.runId },
          {
            principalName,
            counterpartName: one.counterpartName,
            thread: one.thread.slice(-4_000),
            latest: one.latest.text.slice(0, 4_000),
          },
        );
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
            .book(owner, one.relationshipId, `wf:${context.jobId}:book:${one.relationshipId}`, first)
            .catch(() => ({ ok: false, meetingId: null }));
          if (result.ok) booked += 1;
          continue;
        }
        if (reading.wantsMeeting && has(step.tools, "schedule.meeting.book")) {
          // The scheduler books it; a reply now would cross with the invite.
          continue;
        }
        const draft = await ports.writeReply(owner, one, "WARM_REPLY");
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
          .send(owner, one.relationshipId, `wf:${context.jobId}:reply:${one.latest.id}`, verdict.body)
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
              summary: booked === 0 ? "No calls to book yet." : `Booked ${plural(booked, "call", "calls")}.`,
              outputs: { booked },
            }
          : {
              status: "DONE",
              summary: [
                `Replied to ${plural(replied, "person", "people")}`,
                held > 0 ? `held ${plural(held, "draft", "drafts")} below the bar` : null,
                handed > 0 ? `left ${plural(handed, "reply", "replies")} for you` : null,
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
      readonly steps: readonly { readonly key: string; readonly status: string; readonly summary: string }[];
      readonly refused: readonly { readonly key: string; readonly reason: string }[];
      readonly cannot: readonly string[];
    }
  | { readonly outcome: "NOT_PLANNED" | "PLAN_LIMIT"; readonly jobId: string | null };

export function createWorkforceJobs(dependencies: {
  readonly store: WorkforceStore;
  readonly models: Pick<WorkforceModels, "plan" | "readReply">;
  readonly review: OutwardReview;
  readonly ports: WorkforcePorts;
  /** J6: one unit of `q.agent_jobs` per job; false is the plan's limit. */
  readonly meter?: ((owner: Owner, idempotencyKey: string) => Promise<boolean>) | undefined;
  readonly logger?: Logger | undefined;
}) {
  return {
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
        readonly source: { readonly kind: "JOB" | "INSTRUCTION" | "DELEGATED_WORK"; readonly id: string };
      },
    ): Promise<StartJobResult> => {
      const { store } = dependencies;
      const filed = await store.ensureJob(owner, {
        source: input.source,
        goal: input.goal,
        budgetUsd: input.budgetUsd,
        threshold: 75,
        maxRedrafts: 2,
        rubricVersion: RUBRIC_VERSION,
      });
      const jobId = filed.job.id;
      if (dependencies.meter !== undefined) {
        const allowed = await dependencies
          .meter(owner, `wf:${jobId}`)
          .catch(() => false);
        if (!allowed) {
          await store.endRun(owner, filed.leadRunId, "HELD", "Your plan's agent jobs for this month are used up.");
          await store.setJobStatus(owner, jobId, "HELD");
          return { outcome: "PLAN_LIMIT", jobId };
        }
      }
      const permitted = new Set(input.permitted);
      const plan = await dependencies.models.plan(
        owner,
        { jobId, runId: filed.leadRunId },
        {
          goal: input.goal.slice(0, 2_000),
          roster: rosterText(permitted),
          allowed: `Tools and actions: ${[...permitted].join(", ") || "none"}. Budget for the whole job: $${input.budgetUsd.toFixed(2)}.`,
        },
      );
      if (plan === null) {
        await store.endRun(owner, filed.leadRunId, "HELD", "Couldn't plan this job just now.");
        await store.setJobStatus(owner, jobId, "HELD");
        return { outcome: "NOT_PLANNED", jobId };
      }
      const bound = boundPlan(plan.steps, {
        permitted,
        // The lead's own planning comes out of the same budget.
        budgetUsd: Math.max(0, input.budgetUsd - AGENT_REGISTRY.LEAD.budgetUsd),
      });
      // The lead's run of this job already exists: the runner records the
      // steps under a fresh lead run only when there is none (direct use).
      const result = await runJob({
        jobId,
        goal: plan.summary,
        steps: bound.steps,
        executors: createWorkforceExecutors({
          owner,
          ports: dependencies.ports,
          models: dependencies.models,
          review: dependencies.review,
        }),
        recorder: {
          ...recorderFor(store, owner),
          // The lead is the job's lead run, not a second one.
          startRun: (run) =>
            run.role === "LEAD"
              ? Promise.resolve(filed.leadRunId)
              : recorderFor(store, owner).startRun(run),
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
        summary: plan.summary,
        steps: result.steps.map((step) => ({
          key: step.key,
          status: step.status,
          summary: step.summary,
        })),
        refused: bound.refused,
        cannot: plan.cannot,
      };
    },
  };
}

export type WorkforceJobs = ReturnType<typeof createWorkforceJobs>;
