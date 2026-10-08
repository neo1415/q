import type { Logger } from "@capital-q/observability";
import {
  AGENT_REGISTRY,
  DEFAULT_REVIEW_POLICY,
  RUBRIC_VERSION,
  boundPlan,
  executorRosterText,
  planIsValid,
  registeredExecutors,
  runJob,
  type AgentExecutor,
  type BoundStep,
  type JobRecorder,
  type PriorRun,
  type StepResult,
} from "@capital-q/q-orchestrator";
import { workforceCorrelationId, type QAgentRole } from "@capital-q/contracts";
import { stanceDeclines } from "@capital-q/q-core";
import { z } from "zod";

import type { WorkforceModels } from "./models.js";
import { heldLine, type OutwardReview } from "./review.js";
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
    /** D-09: what this reply is for (the step's goal), never empty. */
    brief?: string,
  ) => Promise<string | null>;
  /**
   * Sends as the person, marked as Q's (D-07: `jobId` is the message's
   * Q marker, so the other side sees it was sent by Q). False or a throw:
   * nothing was sent.
   */
  readonly send: (
    owner: Owner,
    relationshipId: string,
    idempotencyKey: string,
    body: string,
    jobId?: string,
  ) => Promise<boolean>;
  /**
   * RESEARCH (D1): bounded public-web research through the composed
   * research service. Absent where no provider is composed, and then the
   * role is not registered at all.
   */
  readonly research?:
    | ((
        owner: Owner,
        input: {
          readonly jobId: string;
          readonly runId: string;
          /** The job in the person's words: their request. */
          readonly request: string;
          /** The step's goal: a proposed query, composed before egress. */
          readonly query: string;
        },
      ) => Promise<ResearchFound>)
    | undefined;
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

export type ResearchFound =
  | {
      readonly status: "OK";
      /** The query that left Capital Q. */
      readonly query: string;
      readonly sources: readonly {
        readonly url: string;
        readonly title: string | null;
        readonly domain: string;
      }[];
    }
  | { readonly status: "UNAVAILABLE"; readonly message: string };

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

/** The agents, by registered role, over the app's ports. */
export function createWorkforceExecutors(dependencies: {
  readonly owner: Owner;
  readonly ports: WorkforcePorts;
  readonly models: Pick<WorkforceModels, "readReply">;
  readonly review: OutwardReview;
  /** Another agent in this job books calls: a wish to meet is its. */
  readonly scheduling: boolean;
  /** The job in the person's words: research reads it as their request. */
  readonly goal?: string | undefined;
}): Partial<Record<QAgentRole, AgentExecutor>> {
  const { owner, ports, models, review } = dependencies;

  const has = (tools: readonly string[], tool: string) => tools.includes(tool);
  // One reading per message per job: the conversation and the scheduler
  // agents act on the same reading, and a reply is classified once.
  const readings = new Map<
    string,
    Promise<Awaited<ReturnType<WorkforceModels["readReply"]>>>
  >();

  /** DISCOVERY: companies newly matching the mandate, as a shortlist. */
  const discovery: AgentExecutor = async () => {
    const matches = (await ports.mandateMatches(owner)).slice(0, MAX_PER_STEP);
    return {
      status: "DONE",
      summary:
        matches.length === 0
          ? "No new companies match your mandate."
          : `Shortlisted ${plural(matches.length, "company", "companies")} matching your mandate.`,
      outputs: {
        shortlist: matches.map((match) => ({
          companyId: match.companyId,
          name: match.name,
        })),
      },
    };
  };

  /**
   * OUTREACH: interest expressed in the shortlist an earlier DISCOVERY
   * step made, or else in the companies matching the mandate now.
   */
  const outreach: AgentExecutor = async (step, context) => {
    if (!has(step.tools, "relationship.interest.express")) {
      return { status: "HELD", summary: "Not allowed to express interest." };
    }
    const shortlisted = step.dependsOn.flatMap(
      (key) =>
        ShortlistSchema.safeParse(
          context.results.get(key)?.outputs?.["shortlist"],
        ).data ?? [],
    );
    const companies = (
      shortlisted.length > 0 ? shortlisted : await ports.mandateMatches(owner)
    ).slice(0, MAX_PER_STEP);
    let expressed = 0;
    let failed = 0;
    for (const company of companies) {
      const done = await ports
        .expressInterest(
          owner,
          company.companyId,
          `wf:${context.jobId}:interest:${company.companyId}`,
        )
        .catch(() => ({ ok: false }));
      if (done.ok) expressed += 1;
      else failed += 1;
    }
    if (companies.length > 0 && expressed === 0) {
      return {
        status: "FAILED",
        summary: `Couldn't express interest in any of ${plural(companies.length, "company", "companies")}; nothing was sent.`,
        outputs: { expressed, failed },
      };
    }
    return {
      status: "DONE",
      summary:
        companies.length === 0
          ? "No companies to reach out to."
          : [
              `Expressed interest in ${plural(expressed, "company", "companies")}`,
              failed > 0 ? `${String(failed)} didn't go through` : null,
            ]
              .filter((part) => part !== null)
              .join("; ")
              .concat("."),
      outputs: { expressed, failed },
    };
  };

  /**
   * RESEARCH: bounded public-web research with sources. The note (the
   * query that left Capital Q and each source's address and title) is the
   * step's result, kept with the job. Pages are untrusted data: only
   * addresses and titles are kept, never their text.
   */
  const research: AgentExecutor | null =
    ports.research === undefined
      ? null
      : async (step, context) => {
          if (
            !has(step.tools, "public_web.search") ||
            ports.research === undefined
          ) {
            return { status: "HELD", summary: "Not allowed to research." };
          }
          const found = await ports
            .research(owner, {
              jobId: context.jobId,
              runId: context.runId,
              request: (dependencies.goal ?? step.goal).slice(0, 2_000),
              query: step.goal.slice(0, 400),
            })
            .catch(() => null);
          if (found === null || found.status === "UNAVAILABLE") {
            return {
              status: "FAILED",
              summary:
                found?.message ??
                "Public sources couldn't be checked just now.",
            };
          }
          return {
            status: "DONE",
            summary:
              found.sources.length === 0
                ? "Found no public sources for this."
                : `Found ${plural(found.sources.length, "public source", "public sources")}.`,
            outputs: {
              note: {
                query: found.query,
                truthClass: "UNKNOWN",
                sources: found.sources.slice(0, 12),
              },
            },
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
      let failed = 0;
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
        // D-09: the writer is given the step's goal as its brief (it was
        // handed an empty one), and the reviewer their latest words, so
        // thread consistency is checked.
        const draft = await ports.writeReply(
          owner,
          one,
          "WARM_REPLY",
          workforceCorrelationId(context.jobId, context.runId),
          step.goal,
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
            theirLatest: latest.text,
            body: draft,
          },
          { job: { jobId: context.jobId, parentRunId: context.runId } },
        );
        if (verdict.verdict === "HELD") {
          held += 1;
          // D-09: a held reply reaches the person, once per message.
          await ports
            .notify(owner, {
              key: `wf:${context.jobId}:held:${latest.id}`,
              title: `Q held a reply to ${one.counterpartName}`,
              body: heldLine(verdict, one.counterpartName),
            })
            .catch(() => undefined);
          continue;
        }
        const sent = await ports
          .send(
            owner,
            one.relationshipId,
            `wf:${context.jobId}:reply:${one.latest.id}`,
            verdict.body,
            context.jobId,
          )
          .catch(() => false);
        if (sent) {
          replied += 1;
          await review.settle(owner, verdict, "SENT");
        } else {
          failed += 1;
        }
      }
      if (mode === "SCHEDULE") {
        return {
          status: "DONE",
          summary:
            booked === 0
              ? "No calls to book yet."
              : `Booked ${plural(booked, "call", "calls")}.`,
          outputs: { booked },
        };
      }
      const summary = [
        `Replied to ${plural(replied, "person", "people")}`,
        held > 0
          ? `held ${plural(held, "draft", "drafts")} below the bar for you`
          : null,
        handed > 0
          ? `left ${plural(handed, "reply", "replies")} for you`
          : null,
        failed > 0 ? `${plural(failed, "reply", "replies")} didn't send` : null,
      ]
        .filter((part) => part !== null)
        .join("; ")
        .concat(".");
      // Honest end state: a held draft needs the person; a send that
      // failed with nothing sent is a failure, never "done".
      const status: StepResult["status"] =
        replied === 0 && failed > 0 ? "FAILED" : held > 0 ? "HELD" : "DONE";
      return { status, summary, outputs: { replied, held, handed, failed } };
    };

  return {
    DISCOVERY: discovery,
    OUTREACH: outreach,
    CONVERSATION: conversation("REPLY"),
    SCHEDULING: conversation("SCHEDULE"),
    ...(research === null ? {} : { RESEARCH: research }),
  };
}

const ShortlistSchema = z
  .array(z.object({ companyId: z.string().min(1), name: z.string() }).strict())
  .max(MAX_PER_STEP);

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

/** The tools the lead Q may plan with here: research only where composed. */
export function executableJobTools(research: boolean): readonly string[] {
  return research
    ? [...EXECUTABLE_JOB_TOOLS, "public_web.search"]
    : EXECUTABLE_JOB_TOOLS;
}

/**
 * D3: a durable job's memory across restarts -- each finished step's
 * result, so a resumed job never redoes one -- kept by the work queue.
 */
export type DurableSteps = {
  readonly prior: (stepKey: string) => Promise<PriorRun | null>;
  readonly record: (
    stepKey: string,
    result: StepResult,
    runId: string,
  ) => Promise<void>;
};

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
    // D1: the roster is what this deployment really runs, nothing more.
    const executors = registeredExecutors({
      research: dependencies.ports.research !== undefined,
    });
    const planned = await dependencies.models.plan(owner, trace, {
      goal: input.goal.slice(0, 2_000),
      roster: executorRosterText(executors, permitted),
      allowed: `Tools and actions: ${[...permitted].join(", ") || "none"}. Budget for the whole job: $${input.budgetUsd.toFixed(2)}.`,
    });
    if (planned === null) return null;
    const bound = boundPlan(
      planned.steps.map((step) => ({ ...step, agentName: null })),
      {
        permitted,
        // The lead's own planning comes out of the same budget.
        budgetUsd: Math.max(0, input.budgetUsd - AGENT_REGISTRY.LEAD.budgetUsd),
        executors,
      },
    );
    if (!planIsValid(bound)) {
      // Refused whole, before anyone is asked to approve it (D-02).
      dependencies.logger?.info(
        { refused: bound.refused, steps: bound.steps.length },
        "workforce plan refused before approval",
      );
    }
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
      threshold: DEFAULT_REVIEW_POLICY.threshold,
      // D-14: the redrafts the review loop really allows.
      maxRedrafts: DEFAULT_REVIEW_POLICY.maxRedrafts,
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
    options: {
      readonly gated?: boolean | undefined;
      /** D3: resume from, and keep, each finished step's result. */
      readonly durable?: DurableSteps | undefined;
    } = {},
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
      executors: withDurableResults(
        createWorkforceExecutors({
          owner,
          ports: dependencies.ports,
          models: dependencies.models,
          review: dependencies.review,
          scheduling: planned.steps.some((step) =>
            step.tools.includes("schedule.meeting.book"),
          ),
          goal: input.goal,
        }),
        options.durable,
      ),
      recorder: {
        ...recorderFor(store, owner),
        // The lead is the job's lead run, not a second one.
        startRun: (one) =>
          one.role === "LEAD"
            ? Promise.resolve(leadRunId)
            : recorderFor(store, owner).startRun(one),
        ...(options.durable === undefined
          ? {}
          : {
              prior: (_jobId: string, stepKey: string) =>
                options.durable?.prior(stepKey) ?? Promise.resolve(null),
            }),
      },
    });
    await store.setJobStatus(owner, jobId, jobStatusOf(result.steps));
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
    /** Whether RESEARCH is registered here (a research provider is composed). */
    research: dependencies.ports.research !== undefined,

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
        threshold: DEFAULT_REVIEW_POLICY.threshold,
        maxRedrafts: DEFAULT_REVIEW_POLICY.maxRedrafts,
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
      if (planned === null || !planIsValid(planned)) {
        await store.endRun(
          owner,
          filed.leadRunId,
          "HELD",
          planned === null
            ? "Couldn't plan this job just now."
            : "The plan named work no agent here can do, so nothing ran.",
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
    /**
     * D-11: "START" when a firing begins, "END" when it is over (DONE, or
     * HELD while something waits on the person). Before, these jobs were
     * set RUNNING and never left it, so the page said "Working" forever.
     */
    phase: "START" | "END" = "START",
    waitingOnPerson = false,
  ): Promise<void> => {
    const filed = await store.ensureJob(owner, {
      source: { kind, id: source.id },
      goal: source.goal,
      budgetUsd: DEFAULT_JOB_BUDGET_USD,
      threshold: DEFAULT_REVIEW_POLICY.threshold,
      maxRedrafts: DEFAULT_REVIEW_POLICY.maxRedrafts,
      rubricVersion: RUBRIC_VERSION,
    });
    // The lead run of such a job is not work happening: it ends at once,
    // saying what the job is, so nothing shows "Working" between firings.
    await store.endRun(
      owner,
      filed.leadRunId,
      "DONE",
      kind === "INSTRUCTION"
        ? "Q works on this on your instruction's schedule; each step is recorded here."
        : "Q works on this under your approval; each step is recorded here.",
    );
    await store.setJobStatus(
      owner,
      filed.job.id,
      phase === "START" ? "RUNNING" : waitingOnPerson ? "HELD" : "DONE",
    );
  };
}

/** A job's status from its steps: DONE only when every step is done. */
export function jobStatusOf(
  steps: readonly { readonly status: string }[],
): "DONE" | "HELD" | "FAILED" {
  if (steps.length === 0) return "HELD";
  if (steps.every((step) => step.status === "DONE")) return "DONE";
  if (steps.some((step) => step.status === "HELD")) return "HELD";
  return steps.some((step) => step.status === "FAILED") ? "FAILED" : "HELD";
}

/** Each step's result kept as it finishes, so a restart never redoes it. */
function withDurableResults(
  executors: Partial<Record<QAgentRole, AgentExecutor>>,
  durable: DurableSteps | undefined,
): Partial<Record<QAgentRole, AgentExecutor>> {
  if (durable === undefined) return executors;
  return Object.fromEntries(
    Object.entries(executors).map(([role, executor]) => [
      role,
      async (step: BoundStep, context: Parameters<AgentExecutor>[1]) => {
        const result = await executor(step, context);
        await durable.record(step.key, result, context.runId);
        return result;
      },
    ]),
  ) as Partial<Record<QAgentRole, AgentExecutor>>;
}
