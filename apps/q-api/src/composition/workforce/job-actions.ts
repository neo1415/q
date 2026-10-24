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
  situationFrom,
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
import type { AgentWorkQueue } from "./queue.js";
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

/** What is missing or not known, in plain words (code's, from the plan). */
export function missingLines(payload: WorkforceJobStartPayload): string[] {
  return (payload.reasoning?.prerequisites ?? [])
    .filter((one) => one.status !== "MET")
    .map((one) => {
      const by = payload.steps.find((step) => step.key === one.resolvedBy);
      const state = one.status === "MISSING" ? "missing" : "not known yet";
      return `${one.what} (${state}${one.blocking ? ", needed for the outcome" : ""}${by === undefined ? "" : `; ${who(by)} gets it`})`.slice(
        0,
        400,
      );
    });
}

/** What comes next, each saying whether it would need their approval. */
export function nextLines(payload: WorkforceJobStartPayload): string[] {
  return (payload.reasoning?.nextActions ?? []).map((one) =>
    `${one.action}${one.needsApproval ? " (needs your approval)" : ""}`.slice(
      0,
      400,
    ),
  );
}

/**
 * Owner 2026-10-23: tools whose effect stays with the person -- reading
 * their own records and the public web, preparing a document for them.
 * A plan made only of these is their own work, not an outward or
 * consequential action: it starts at once, with no approval card. Any
 * tool that reaches someone else, books, expresses interest or files a
 * card keeps the plan on the card (Prepare -> Recommend -> Approve).
 */
export const OWN_ACCOUNT_TOOLS: ReadonlySet<string> = new Set([
  "public_web.search",
  "documents.own.prepare",
  "search_companies",
  "list_my_relationships",
  "list_messages",
  "list_schedule",
  "find_meeting_times",
]);

/** Whether a plan is the person's own deep work (see OWN_ACCOUNT_TOOLS). */
export function isOwnAccountWork(payload: WorkforceJobStartPayload): boolean {
  return (
    payload.steps.length > 0 &&
    payload.steps.every(
      (step) =>
        step.tools.length > 0 &&
        step.tools.every((tool) => OWN_ACCOUNT_TOOLS.has(tool)),
    ) &&
    payload.permitted.every((tool) => OWN_ACCOUNT_TOOLS.has(tool))
  );
}

export type OwnWorkStart =
  | { readonly outcome: "STARTED"; readonly jobId: string }
  | { readonly outcome: "NOT_ALLOWED" };

/**
 * Starts the person's own deep work as durable, leased work -- the same
 * queue and runner an approved job uses -- without a card. The source is
 * the run that asked, so asking again in that run never files a second job.
 */
export function createOwnWorkStarter(dependencies: {
  readonly jobsFor: (actor: ActorContext) => WorkforceJobs;
  readonly queue: () => Pick<AgentWorkQueue, "enqueue">;
  readonly kick?: (() => void) | undefined;
  /** The plan's entitlement for agent work (consumed once per run). */
  readonly allowed?:
    | ((actor: ActorContext, idempotencyKey: string) => Promise<boolean>)
    | undefined;
  readonly logger?: Logger | undefined;
}) {
  return async (
    actor: ActorContext,
    runId: string,
    payload: WorkforceJobStartPayload,
  ): Promise<OwnWorkStart | null> => {
    if (
      actor.actorType !== "HUMAN" ||
      payload.ownerUserId !== actor.userId ||
      !isOwnAccountWork(payload)
    )
      return null;
    if (
      dependencies.allowed !== undefined &&
      !(await dependencies.allowed(
        actor,
        `${WORKFORCE_JOB_START}:own:${runId}`,
      ))
    )
      return { outcome: "NOT_ALLOWED" };
    const owner: Owner = { tenantId: actor.tenantId, userId: actor.userId };
    const filed = await dependencies.jobsFor(actor).file(owner, {
      goal: payload.goal,
      budgetUsd: Number(payload.budgetUsd),
      source: { kind: "JOB", id: runId },
    });
    await dependencies.queue().enqueue(owner, {
      jobId: filed.jobId,
      plan: payload,
      trace: {
        // The runner files the job under this source again: the same job.
        actionId: runId,
        runId,
        organisationId: actor.organisationId ?? undefined,
      },
    });
    dependencies.kick?.();
    dependencies.logger?.info(
      { jobId: filed.jobId, qRunId: runId, steps: payload.steps.length },
      "own-account work started without a card",
    );
    return { outcome: "STARTED", jobId: filed.jobId };
  };
}

export function planView(
  payload: WorkforceJobStartPayload,
  calendarConnected: boolean | null = null,
): QJobPlanView {
  return {
    summary: payload.summary,
    steps: payload.steps.map((step) => ({
      who: who(step),
      does:
        step.fallbackFor === undefined
          ? step.goal
          : `${step.goal} (only if ${who(payload.steps.find((one) => one.key === step.fallbackFor) ?? step)} cannot)`,
    })),
    cannot: payload.cannot,
    budgetUsd: payload.budgetUsd,
    needsYou: needsYouFor(payload, calendarConnected),
    ...(payload.reasoning === undefined
      ? {}
      : {
          outcome: payload.reasoning.outcome,
          missing: missingLines(payload),
          next: nextLines(payload),
        }),
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

/**
 * A job plan's shape, for telling whether two plans are the same work by
 * structure, never by words (S9b's proposal, 2026-10-24): the outward
 * actions it may take, and the records it is about.
 */
export type PlanShape = {
  /** Its permitted tools that reach someone else (not OWN_ACCOUNT_TOOLS). */
  readonly outward: readonly string[];
  /** Subject keys it is about: documents' companies, records the goal names. */
  readonly targets: readonly string[];
};

/** A plan's shape (code's, from the payload). */
export function planShape(
  payload: Pick<WorkforceJobStartPayload, "permitted" | "steps">,
  subjects: readonly QSubjectRef[] = [],
): PlanShape {
  const targets = new Set(
    subjects.map((subject) => subjectKey(subject).toLowerCase()),
  );
  for (const step of payload.steps) {
    const document = step.document;
    if (document !== undefined && "companyId" in document)
      targets.add(`company:${document.companyId}`.toLowerCase());
  }
  return {
    outward: [
      ...new Set(
        payload.permitted.filter((tool) => !OWN_ACCOUNT_TOOLS.has(tool)),
      ),
    ],
    targets: [...targets],
  };
}

/**
 * Same work by structure: both take at least one same outward action, and
 * they are about the same records (or neither is about any record). Own
 * work (no outward action) is never the same work as anything.
 */
export function sameWork(a: PlanShape, b: PlanShape): boolean {
  if (!a.outward.some((tool) => b.outward.includes(tool))) return false;
  if (a.targets.length === 0 && b.targets.length === 0) return true;
  return a.targets.some((target) => b.targets.includes(target));
}

/** One approval already waiting for the person, as the Approval Engine lists it. */
export type WaitingItem = {
  readonly summary: string;
  readonly actionType?: string | undefined;
  readonly targets?: readonly QSubjectRef[] | undefined;
  /** A waiting job card's plan shape, read by code from its payload. */
  readonly plan?: PlanShape | undefined;
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
  /**
   * The new plan's shape, once planned. Given: SAME_KIND is decided by
   * structure (sameWork) against each waiting card's own plan, and a card
   * whose plan could not be read is not the same work. Absent: nothing is
   * held as SAME_KIND (it is only checked once a plan exists).
   */
  plan?: PlanShape,
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
      waiting:
        plan === undefined
          ? []
          : pick(
              waiting.filter(
                (item) =>
                  item.actionType === actionType &&
                  item.plan !== undefined &&
                  sameWork(plan, item.plan),
              ),
            ),
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
  const lines: string[] = [];
  if (payload.reasoning !== undefined) {
    lines.push(`Outcome: ${payload.reasoning.outcome}`);
  }
  const facts = new Map(
    (payload.reasoning?.situation ?? []).map((fact) => [fact.ref, fact.text]),
  );
  lines.push(
    ...payload.steps.map((step, index) => {
      const covers =
        step.fallbackFor === undefined
          ? undefined
          : payload.steps.find((one) => one.key === step.fallbackFor);
      const because = (step.evidence ?? [])
        .flatMap((ref) => {
          const text = facts.get(ref);
          return text === undefined ? [] : [text];
        })
        .slice(0, 2);
      return `${String(index + 1)}. ${who(step)}${step.spawned ? " (a helper for this step only)" : ""}${covers === undefined ? "" : ` (only if ${who(covers)} cannot)`}: ${step.goal}${step.why === undefined ? "" : ` Why: ${step.why}`}${because.length === 0 ? "" : ` Based on: ${because.join(" ")}`}`;
    }),
  );
  const missing = missingLines(payload);
  if (missing.length > 0)
    lines.push(`Missing or not known: ${missing.join("; ")}.`);
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
  const executors = registeredExecutors({
    research: true,
    documents: true,
    diligence: true,
  });
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
        ...(step.document === undefined ? {} : { document: step.document }),
        ...(step.why === undefined ? {} : { why: step.why }),
        ...(step.evidence === undefined ? {} : { evidence: step.evidence }),
        ...(step.fallbackFor === undefined
          ? {}
          : { fallbackFor: step.fallbackFor }),
      },
    ];
  });
  return {
    summary: payload.summary,
    steps,
    refused: [],
    cannot: payload.cannot,
    ...(payload.reasoning === undefined
      ? {}
      : { reasoning: payload.reasoning }),
  };
}

export function createWorkforceJobActions(dependencies: {
  /** The jobs runner for one approver, over their own ports. */
  readonly jobsFor: (actor: ActorContext) => WorkforceJobs;
  /**
   * Recovery D3: approved jobs are durable work, claimed under a lease by
   * the runner, never an unawaited promise inside the approval.
   */
  readonly queue: Pick<AgentWorkQueue, "enqueue">;
  /** Wakes the runner now rather than at its next interval. */
  readonly kick?: (() => void) | undefined;
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
      // One Q (CLAUDE.md): the card never names an internal team or agent.
      describe: (payload) => ({
        summary: cardSummary(payload.summary),
        preview: preview(payload),
      }),
      confirm: () => "On it. You can follow each step on your Work page.",
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
            // The job runs past the approval, never inside it: it is
            // enqueued as durable work (exactly the approved plan, with
            // where it came from) and a worker claims it under a lease, so
            // a restart resumes it instead of leaving it RUNNING forever.
            await dependencies.queue.enqueue(owner, {
              jobId: filed.jobId,
              plan: action.payload,
              trace: {
                actionId: action.actionId,
                runId: action.runId,
                organisationId:
                  context.approver.organisationId ??
                  action.organisationId ??
                  undefined,
              },
            });
            dependencies.kick?.();
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
  /** Owner 2026-10-23: own-account work starts at once (createOwnWorkStarter). */
  readonly startOwnWork?:
    | ((
        actor: ActorContext,
        runId: string,
        payload: WorkforceJobStartPayload,
      ) => Promise<OwnWorkStart | null>)
    | undefined;
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
      /** Started without a card: nothing for the proposer to file. */
      readonly started?: boolean | undefined;
      /** The job it started, for a board item that follows it. */
      readonly jobId?: string | undefined;
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
          return existing.started === true
            ? {
                status: "STARTED",
                plan: planView(existing.payload),
                firstRead: null,
                jobId: existing.jobId,
              }
            : { status: "ONE_PER_TURN", plan: planView(existing.payload) };
        }
        // R5: like a colleague, look at what is already waiting first.
        const waitingNow =
          dependencies.waiting === undefined
            ? []
            : await dependencies.waiting(actor).catch(() => []);
        const related =
          options?.proceed === true || dependencies.waiting === undefined
            ? null
            : relatedWaiting(goal, waitingNow, options?.subjects ?? []);
        // Work about the same people as something waiting: asked first,
        // before anything is planned.
        if (
          related !== null &&
          related.about === "SAME_PEOPLE" &&
          related.waiting.length > 0
        )
          return {
            status: "ALREADY_WAITING",
            waiting: related.waiting,
            about: "SAME_PEOPLE",
          };
        const owner = { tenantId: actor.tenantId, userId: actor.userId };
        if (dependencies.withinLimit !== undefined) {
          const room = await dependencies.withinLimit(owner).catch(() => null);
          if (room === null) return { status: "FAILED" };
          if (!room) return { status: "LIMIT_REACHED" };
        }
        const jobs = dependencies.jobsFor(actor);
        // The one company the goal names, resolved as the person by
        // goalSubjects; several or none: no NAMED_COMPANY document.
        const companies = (options?.subjects ?? []).flatMap((subject) =>
          subject.kind === "COMPANY" ? [subject.companyId] : [],
        );
        const planned = await jobs
          .plan(owner, {
            goal,
            permitted: executableJobTools(
              jobs.research,
              jobs.documents,
              jobs.diligence,
            ),
            budgetUsd: budget,
            namedCompany:
              companies.length === 1 && companies[0] !== undefined
                ? { companyId: companies[0], name: "" }
                : null,
            // wf: what code read from their records, as them, before planning.
            situation: situationFrom({
              briefs: options?.reads?.briefs ?? [],
              unreadable: options?.reads?.unreadable ?? [],
              overview:
                options?.reads?.overview === undefined
                  ? undefined
                  : options.reads.overview === null
                    ? null
                    : {
                        items: options.reads.overview.items.map((item) => ({
                          name: item.counterpart.name,
                          state: item.state,
                          stateSince: item.stateSince,
                          nextStep: item.nextStep,
                          lastFrom:
                            item.lastMessageRead === "OK"
                              ? (item.lastMessage?.from ?? null)
                              : undefined,
                          lastAt: item.lastMessage?.at ?? null,
                        })),
                      },
              waiting: waitingNow,
            }),
          })
          .catch(() => null);
        // Live 2026-10-12: the planner's provider refused (credit exhausted)
        // and Q told the person to reword their goal. A plan that could not
        // be made is Q's failure, said as one; NOT_PLANNED is kept for a
        // plan that came back empty or named work no agent here can do.
        if (planned === null) return { status: "FAILED" };
        // D1: a plan with any step no registered executor can run is not
        // offered at all -- never a partial plan approved as if whole.
        if (planned.steps.length === 0 || planned.refused.length > 0) {
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
          ...(step.document === undefined ? {} : { document: step.document }),
          ...(step.why === undefined ? {} : { why: step.why.slice(0, 300) }),
          ...(step.evidence === undefined
            ? {}
            : { evidence: [...step.evidence].slice(0, 6) }),
          ...(step.fallbackFor === undefined
            ? {}
            : { fallbackFor: step.fallbackFor.slice(0, 40) }),
        }));
        const parsed = WorkforceJobStartPayloadSchema.safeParse({
          ownerUserId: actor.userId,
          goal: goal.slice(0, 2_000),
          summary: planned.summary.slice(0, 400) || "Work for you",
          steps,
          permitted: [...new Set(steps.flatMap((step) => step.tools))].slice(
            0,
            24,
          ),
          budgetUsd: usd(budget),
          cannot: planned.cannot.slice(0, 5),
          ...(planned.reasoning === undefined
            ? {}
            : { reasoning: planned.reasoning }),
        });
        if (!parsed.success) return { status: "NOT_PLANNED" };
        // Their own work (research, a document for them) is never held by
        // what waits for approval: nothing it does can cross a waiting card.
        // Only a plan that would itself be a card is checked against them.
        // A goal naming nobody matched every waiting job of this kind (live
        // 2026-10-24: "Write me a short 12-month growth plan for my company"
        // was held by "Prepare for the first call with Savanna Seed
        // Partners"). Their own work (research, a document for them) is
        // never held by it: nothing it does can cross a waiting card. Only
        // a plan that would itself be a card is.
        const ownWork = isOwnAccountWork(parsed.data);
        if (!ownWork && related !== null && related.about === "SAME_KIND") {
          // Same work by structure (S9b, 2026-10-24): the same outward
          // action on the same records as a waiting card's own plan.
          const same = relatedWaiting(
            goal,
            waitingNow,
            options?.subjects ?? [],
            WORKFORCE_JOB_START,
            planShape(parsed.data, options?.subjects ?? []),
          );
          if (same.waiting.length > 0)
            return {
              status: "ALREADY_WAITING",
              waiting: same.waiting,
              about: "SAME_KIND",
            };
        }
        // Owner 2026-10-23: research and a document for themselves is not
        // an outward or consequential action -- it starts now, no card.
        if (dependencies.startOwnWork !== undefined && ownWork) {
          const started = await dependencies
            .startOwnWork(actor, runId, parsed.data)
            .catch(() => null);
          if (started?.outcome === "NOT_ALLOWED")
            return { status: "LIMIT_REACHED" };
          if (started?.outcome === "STARTED") {
            prepared.set(runId, {
              tenantId: actor.tenantId,
              userId: actor.userId,
              payload: parsed.data,
              at: now(),
              started: true,
              jobId: started.jobId,
            });
            return {
              status: "STARTED",
              plan: planView(parsed.data),
              firstRead: planned.firstRead ?? null,
              jobId: started.jobId,
            };
          }
          // Not started (a store failed): the card is still a way to do it.
        }
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
        if (entry === undefined || entry.started === true)
          return Promise.resolve(null);
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

/**
 * The card's one line, at most 200 characters, ending on a sentence or a
 * word, never mid-word (live 2026-10-12: "... for your approval. The res").
 * The full plan is the card's preview.
 */
export function cardSummary(text: string, max = 200): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max);
  const sentenceEnd = head.lastIndexOf(". ");
  if (sentenceEnd >= max / 2) return head.slice(0, sentenceEnd + 1);
  const space = head.lastIndexOf(" ", max - 1);
  return `${head.slice(0, space > 0 ? space : max - 1).replace(/[,;:]$/u, "")}…`;
}
