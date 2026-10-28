import { z } from "zod";

import {
  UuidSchema,
  WORKFORCE_AGENT_ROLES,
  WORKFORCE_INSTRUCTION_STEP_STATUSES,
  WORKFORCE_TEAM_STATES,
  WORKFORCE_JOB_STATUSES,
  WORKFORCE_RUN_STATUSES,
  WorkforceGradeDtoSchema,
} from "@capital-q/contracts";
import type {
  WorkforceLive,
  WorkforceDraftDto,
  WorkforceJobDetailDto,
  WorkforceJobListDto,
  WorkforceJobSummaryDto,
  WorkforceOverviewDto,
  WorkforceTimelineEntryDto,
  QArtifactDetail,
  QApprovalView,
} from "@capital-q/contracts";

import type {
  JobDetail,
  JobListRow,
  JobRow,
  Owner,
  WorkforceStore,
} from "./store.js";
import { expectedOf, progressOf } from "./progress.js";
import { deliveredDocument } from "./delivery.js";
import { isPlanJobPayload, planGatheringStage } from "./plan-job.js";
import { filedDocumentIds } from "./results.js";
import {
  LIVE_WORK_STATES,
  liveStageOf,
  type AgentWorkQueue,
  type WorkRow,
} from "./queue.js";

/**
 * The workforce page's reads (founder brief J5, J6): the person's own jobs,
 * newest activity first, each with what its agents cost; one job with its
 * agents, drafts (grade, outcome, feedback) and a timeline written by code.
 * Costs come from the model usage ledger by job and agent run; a ledger
 * that cannot be read shows nothing spent rather than failing the page.
 */

export type WorkforceCosts = (
  owner: Owner,
  jobIds: readonly string[],
) => Promise<
  readonly {
    readonly jobId: string;
    readonly runId: string;
    readonly usd: string;
  }[]
>;

/** This month's workforce spend, by agent run (the usage ledger). */
export type WorkforceMonthCosts = (
  owner: Owner,
  at: Date,
) => Promise<
  readonly {
    readonly runId: string;
    readonly usd: string;
    /** The UTC day (YYYY-MM-DD); absent from an older reader. */
    readonly day?: string | undefined;
  }[]
>;

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

const ZERO = "0";
const APPROVAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
] as const;

/**
 * Where a card stands now: a PENDING one past its expiry has lapsed, even
 * before a sweep writes EXPIRED (14 of Zino's 39 "pending" had, 7 Oct).
 */
function cardStatus(
  status: string,
  expiresAt: Date | null | undefined,
  at: Date,
): (typeof APPROVAL_STATUSES)[number] {
  const known = oneOf(APPROVAL_STATUSES, status, "PENDING");
  return known === "PENDING" &&
    expiresAt !== null &&
    expiresAt !== undefined &&
    expiresAt.getTime() <= at.getTime()
    ? "EXPIRED"
    : known;
}

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
const ACTION = /^[a-z][a-z0-9_.]{0,79}$/u;

/** A stored code read back into its closed set (the table's check holds it). */
function oneOf<T extends string>(
  values: readonly T[],
  value: string,
  fallback: T,
): T {
  return values.find((one) => one === value) ?? fallback;
}

function usd(value: number): string {
  return value <= 0 ? ZERO : value.toFixed(6).replace(/\.?0+$/u, "");
}

function money(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? usd(parsed) : ZERO;
}

/**
 * Recovery D6: the durable work row's state, why it stopped and where it
 * came from -- the same fields "open the task that failed" and "why did it
 * stop" read. Absent before a job was queued (instructions, errands).
 */
export function workFields(
  row: WorkRow | undefined,
): Pick<WorkforceJobSummaryDto, "workState" | "stoppedBecause" | "trace"> {
  if (row === undefined) return {};
  const ids = {
    ...(isUuid(row.trace.conversationId)
      ? { conversationId: row.trace.conversationId }
      : {}),
    ...(isUuid(row.trace.runId) ? { runId: row.trace.runId } : {}),
  };
  const stopped =
    row.state === "FAILED" ||
    row.state === "BLOCKED" ||
    row.state === "CANCELLED" ||
    row.state === "NEEDS_DECISION" ||
    row.state === "RECOVERING";
  return {
    workState: row.state,
    ...(stopped && row.reason !== null
      ? { stoppedBecause: row.reason.slice(0, 500) }
      : {}),
    ...(Object.keys(ids).length > 0 ? { trace: ids } : {}),
  };
}

const isUuid = (value: string | undefined): value is string =>
  value !== undefined && UuidSchema.safeParse(value).success;

function summary(
  job: JobRow,
  counts: { agents: number; drafts: number; held: number },
  costUsd: string,
  work?: WorkRow,
): WorkforceJobSummaryDto {
  return {
    ...workFields(work),
    id: job.id,
    goal: job.goal,
    source: job.source_kind,
    status: oneOf(WORKFORCE_JOB_STATUSES, job.status, "RUNNING"),
    reviewBar: {
      threshold: job.review_threshold,
      maxRedrafts: job.max_redrafts,
      rubricVersion: job.rubric_version,
    },
    budgetUsd: money(job.budget_usd),
    costUsd,
    agents: counts.agents,
    drafts: counts.drafts,
    held: counts.held,
    createdAt: job.created_at.toISOString(),
    updatedAt: job.updated_at.toISOString(),
  };
}

/** Stored grades, read back through the contract (jsonb is input too). */
function criteriaOf(value: unknown) {
  const parsed = WorkforceGradeDtoSchema.shape.criteria.safeParse(value);
  return parsed.success ? parsed.data : [];
}
function integrityOf(value: unknown) {
  const parsed = WorkforceGradeDtoSchema.shape.integrity.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function createWorkforcePage(dependencies: {
  readonly store: WorkforceStore;
  readonly costs?: WorkforceCosts | undefined;
  readonly monthCosts?: WorkforceMonthCosts | undefined;
  /**
   * A standing instruction's own planning (its first drafts), by
   * instruction id: priced under its job's lead (J6).
   */
  readonly sourceCosts?:
    | ((
        owner: Owner,
        instructionIds: readonly string[],
      ) => Promise<
        readonly { readonly instructionId: string; readonly usd: string }[]
      >)
    | undefined;
  /** The person's monthly limit for Q's work, USD; null: none. */
  readonly monthlyLimitUsd?:
    ((owner: Owner) => Promise<number | null>) | undefined;
  readonly now?: (() => Date) | undefined;
  /** Recovery D6: the durable work rows behind these jobs (the queue's). */
  readonly work?: Pick<AgentWorkQueue, "forOwner"> | undefined;
  /** Resolve canonical documents and approvals under one fresh owner context. */
  readonly deliverables?:
    | ((
        owner: Owner,
        organisationId: string | null,
        references: {
          readonly artifactIds: readonly string[];
          readonly actionIds: readonly string[];
        },
      ) => Promise<{
        readonly documents: readonly QArtifactDetail[];
        readonly approvals: readonly QApprovalView[];
      }>)
    | undefined;
}) {
  const { store } = dependencies;

  /** The work rows behind these jobs; unreadable is simply absent. */
  async function workOf(
    owner: Owner,
    jobIds: readonly string[],
  ): Promise<ReadonlyMap<string, WorkRow>> {
    if (dependencies.work === undefined || jobIds.length === 0) {
      return new Map();
    }
    const rows = await dependencies.work
      .forOwner(owner, jobIds)
      .catch((): readonly WorkRow[] => []);
    return new Map(rows.map((row) => [row.job_id, row]));
  }

  /** A finished job's first READY document, resolved as its owner may see it. */
  async function filedDocumentOf(
    owner: Owner,
    work: WorkRow,
  ): Promise<{
    readonly artifactId: string;
    readonly type: string;
    readonly title: string;
  } | null> {
    const artifactIds = filedDocumentIds(work);
    if (artifactIds.length === 0 || dependencies.deliverables === undefined) {
      return null;
    }
    const resolved = await dependencies
      .deliverables(owner, work.trace.organisationId ?? null, {
        artifactIds,
        actionIds: [],
      })
      .catch(() => null);
    const ready = resolved?.documents.find(
      (document) =>
        artifactIds.includes(document.artifact.artifactId) &&
        document.artifact.status === "READY",
    );
    return ready === undefined
      ? null
      : {
          artifactId: ready.artifact.artifactId,
          type: ready.artifact.type,
          title: ready.artifact.title.slice(0, 160),
        };
  }

  async function costsOf(
    owner: Owner,
    jobs: readonly Pick<JobRow, "id" | "source_kind" | "source_id">[],
    leadRunId: string | null = null,
  ) {
    const instructions = new Map(
      jobs.flatMap((job) =>
        job.source_kind === "INSTRUCTION" && job.source_id !== null
          ? [[job.source_id, job.id] as const]
          : [],
      ),
    );
    const [rows, planning] = await Promise.all([
      (
        dependencies.costs?.(
          owner,
          jobs.map((job) => job.id),
        ) ?? Promise.resolve([])
      ).catch(() => []),
      (instructions.size === 0 || dependencies.sourceCosts === undefined
        ? Promise.resolve([])
        : dependencies.sourceCosts(owner, [...instructions.keys()])
      ).catch(() => []),
    ]);
    const byJob = new Map<string, number>();
    const byRun = new Map<string, number>();
    for (const row of rows) {
      const value = Number(row.usd);
      if (!Number.isFinite(value)) continue;
      byJob.set(row.jobId, (byJob.get(row.jobId) ?? 0) + value);
      byRun.set(row.runId, (byRun.get(row.runId) ?? 0) + value);
    }
    // The instruction's planning wrote its first drafts: the lead's cost.
    for (const row of planning) {
      const value = Number(row.usd);
      const jobId = instructions.get(row.instructionId);
      if (!Number.isFinite(value) || jobId === undefined) continue;
      byJob.set(jobId, (byJob.get(jobId) ?? 0) + value);
      if (leadRunId !== null) {
        byRun.set(leadRunId, (byRun.get(leadRunId) ?? 0) + value);
      }
    }
    return { byJob, byRun };
  }

  return {
    list: async (
      owner: Owner,
      page: { readonly cursor?: string | undefined; readonly limit: number },
    ): Promise<WorkforceJobListDto> => {
      const before =
        page.cursor === undefined || Number.isNaN(Date.parse(page.cursor))
          ? null
          : new Date(page.cursor);
      const rows: readonly JobListRow[] = await store.listJobs(owner, {
        limit: page.limit + 1,
        before,
      });
      const shown = rows.slice(0, page.limit);
      const { byJob } = await costsOf(owner, shown);
      const work = await workOf(
        owner,
        shown.map((row) => row.id),
      );
      const last = shown.at(-1);
      return {
        items: shown.map((row) =>
          summary(row, row, usd(byJob.get(row.id) ?? 0), work.get(row.id)),
        ),
        nextCursor:
          rows.length > page.limit && last !== undefined
            ? last.updated_at.toISOString()
            : null,
      };
    },

    /**
     * Owner 2026-10-24: one job as its document is being made, for the
     * conversation's card: the row the person owns (someone else's job is
     * the same null as none), its plan's steps done, the stage its work
     * last recorded, and the document once filed. One row, no model.
     */
    live: async (
      owner: Owner,
      jobId: string,
    ): Promise<WorkforceLive | null> => {
      const work = (await workOf(owner, [jobId])).get(jobId);
      if (work === undefined) return null;
      const plan = progressOf(work);
      const working = LIVE_WORK_STATES.includes(work.state);
      // QA 25 Oct (job 4d1a8b04, "a one-page investor update"): a document
      // step that is not an analysis records only its artifact id, so the
      // card said "Done" with no document. Such a document is resolved as
      // the job's page resolves it, under the owner's fresh context.
      const filed =
        deliveredDocument(work) ??
        (work.state === "COMPLETED"
          ? await filedDocumentOf(owner, work)
          : null);
      return {
        jobId: work.job_id,
        state: working
          ? "WORKING"
          : work.state === "COMPLETED"
            ? "DONE"
            : work.state === "NEEDS_DECISION" || work.state === "BLOCKED"
              ? "WAITING"
              : work.state === "CANCELLED"
                ? "STOPPED"
                : "FAILED",
        done: plan?.done ?? 0,
        total: plan?.total ?? 0,
        // A plan job is gathering from the moment it is asked (addendum 4:
        // the first stage on screen at once, before a worker claims it).
        stage:
          liveStageOf(work) ??
          (isPlanJobPayload(work.plan) && working
            ? planGatheringStage(work.created_at)
            : null),
        document:
          filed === null
            ? null
            : "delivery" in filed
              ? {
                  artifactId: filed.artifactId,
                  type: filed.delivery.artifactType,
                  title: filed.delivery.title.slice(0, 160),
                }
              : filed,
        reason: working || work.state === "COMPLETED" ? null : work.reason,
        // Owner 2026-10-28: how long it has been going, and how long work
        // of its kind usually takes, so a 3-minute wait is understood.
        startedAt: work.created_at.toISOString(),
        expected: expectedOf(work),
      };
    },

    detail: async (
      owner: Owner,
      jobId: string,
    ): Promise<WorkforceJobDetailDto | null> => {
      const detail: JobDetail | null = await store.job(owner, jobId);
      if (detail === null) return null;
      const at = dependencies.now?.() ?? new Date();
      const { byJob, byRun } = await costsOf(
        owner,
        [detail.job],
        detail.runs.find((run) => run.role === "LEAD")?.id ?? null,
      );
      const held = detail.outcomes.filter((one) => one.outcome === "HELD");
      const names = new Map(detail.runs.map((run) => [run.id, run.agent_name]));
      const name = (id: string | null) =>
        (id === null ? undefined : names.get(id)) ?? "An agent";

      const drafts: WorkforceDraftDto[] = detail.drafts.map((draft) => {
        const grade = detail.grades.find((one) => one.draft_id === draft.id);
        const outcome = detail.outcomes
          .filter((one) => one.draft_id === draft.id)
          .at(-1);
        return {
          id: draft.id,
          attempt: draft.attempt,
          parentDraftId: draft.parent_draft_id,
          channel: draft.channel,
          counterpartName: draft.counterpart_name,
          body: draft.body,
          grade:
            grade === undefined
              ? null
              : {
                  score: grade.score,
                  passed: grade.passed,
                  threshold: grade.threshold,
                  maxRedrafts: grade.max_redrafts,
                  rubricVersion: grade.rubric_version,
                  criteria: criteriaOf(grade.criteria),
                  integrity: integrityOf(grade.integrity),
                  feedback: grade.feedback,
                },
          outcome:
            outcome === undefined
              ? null
              : (() => {
                  const card =
                    outcome.q_action_id === null
                      ? undefined
                      : detail.approvals.find(
                          (one) => one.action_id === outcome.q_action_id,
                        );
                  return {
                    outcome: outcome.outcome,
                    reason: outcome.reason,
                    qActionId: outcome.q_action_id,
                    approvalId: card?.id ?? null,
                    approvalStatus:
                      card === undefined
                        ? null
                        : cardStatus(card.status, card.expires_at, at),
                  };
                })(),
          feedback: detail.feedback
            .filter((one) => one.draft_id === draft.id)
            .slice(0, 10)
            .map((one) => ({
              kind: one.kind,
              at: one.created_at.toISOString(),
            })),
          createdAt: draft.created_at.toISOString(),
        };
      });

      const timeline: WorkforceTimelineEntryDto[] = [];
      const entry = (
        at: Date,
        kind: WorkforceTimelineEntryDto["kind"],
        text: string,
        ids: {
          runId?: string | null;
          toRunId?: string | null;
          draftId?: string | null;
        } = {},
      ) => {
        timeline.push({
          at: at.toISOString(),
          kind,
          runId: ids.runId ?? null,
          toRunId: ids.toRunId ?? null,
          draftId: ids.draftId ?? null,
          text: text.slice(0, 600),
        });
      };
      for (const run of detail.runs) {
        entry(
          run.started_at,
          "AGENT_STARTED",
          run.spawned_by_run_id === null
            ? `${run.agent_name} took the job.`
            : `${run.agent_name} started: ${run.goal}`,
          { runId: run.id },
        );
        if (run.ended_at !== null) {
          entry(
            run.ended_at,
            "AGENT_ENDED",
            `${run.agent_name}: ${run.summary ?? run.status.toLowerCase()}`,
            { runId: run.id },
          );
        }
      }
      for (const handoff of detail.handoffs) {
        entry(
          handoff.created_at,
          "HANDOFF",
          `${name(handoff.from_run_id)} to ${name(handoff.to_run_id)}: ${handoff.note}`,
          {
            runId: handoff.from_run_id,
            toRunId: handoff.to_run_id,
            draftId: handoff.draft_id,
          },
        );
      }
      for (const draft of detail.drafts) {
        entry(
          draft.created_at,
          "DRAFT",
          `${name(draft.writer_run_id)} wrote ${draft.attempt === 1 ? "a draft" : `redraft ${String(draft.attempt - 1)}`}${draft.counterpart_name === null ? "" : ` to ${draft.counterpart_name}`}.`,
          { runId: draft.writer_run_id, draftId: draft.id },
        );
      }
      for (const grade of detail.grades) {
        entry(
          grade.created_at,
          "GRADE",
          `${name(grade.reviewer_run_id)} scored it ${String(grade.score)} against a bar of ${String(grade.threshold)}: ${grade.passed ? "passed" : "below the bar"}.`,
          { runId: grade.reviewer_run_id, draftId: grade.draft_id },
        );
      }
      for (const outcome of detail.outcomes) {
        const words = {
          SENT: "Sent.",
          OFFERED: "Offered to you for approval.",
          HELD: `Held, not sent${outcome.reason === null ? "" : ` (${outcome.reason.toLowerCase().replaceAll("_", " ")})`}.`,
        }[outcome.outcome];
        entry(outcome.created_at, "OUTCOME", words, {
          draftId: outcome.draft_id,
        });
      }
      for (const one of detail.feedback) {
        entry(
          one.created_at,
          "FEEDBACK",
          {
            APPROVED: "You approved it.",
            EDITED: "You edited it.",
            REJECTED: "You rejected it.",
            REPLIED: "They replied.",
            NO_REPLY: "No reply yet.",
          }[one.kind],
          { draftId: one.draft_id },
        );
      }
      timeline.sort((a, b) => a.at.localeCompare(b.at));

      const work = (await workOf(owner, [detail.job.id])).get(detail.job.id);
      const artifactIds = filedDocumentIds(work);
      const completedAction = z
        .object({
          status: z.literal("DONE"),
          outputs: z.object({ qActionId: UuidSchema }).passthrough(),
        })
        .passthrough();
      const actionIds = [
        ...new Set(
          Object.values(work?.results ?? {}).flatMap((result) => {
            const parsed = completedAction.safeParse(result);
            return parsed.success ? [parsed.data.outputs.qActionId] : [];
          }),
        ),
      ].slice(0, 12);
      const unavailable = { documents: [], approvals: [] };
      const resolved =
        artifactIds.length === 0 && actionIds.length === 0
          ? unavailable
          : await (
              dependencies.deliverables?.(
                owner,
                work?.trace.organisationId ?? null,
                { artifactIds, actionIds },
              ) ?? Promise.resolve(unavailable)
            ).catch(() => unavailable);
      const documents = resolved.documents
        .filter(
          (document) =>
            artifactIds.includes(document.artifact.artifactId) &&
            document.artifact.status === "READY" &&
            document.current !== undefined &&
            document.current.artifactId === document.artifact.artifactId &&
            document.current.version === document.artifact.currentVersion,
        )
        .map((document) => document.artifact)
        .filter(
          (document, index, all) =>
            all.findIndex((one) => one.artifactId === document.artifactId) ===
            index,
        );
      const approvals = resolved.approvals
        .filter((view) => actionIds.includes(view.action.actionId))
        .filter(
          (view, index, all) =>
            all.findIndex((one) => one.approvalId === view.approvalId) ===
            index,
        );

      const plan = progressOf(work, detail.runs);
      return {
        ...(plan === undefined ? {} : { plan }),
        job: summary(
          detail.job,
          {
            agents: detail.runs.length,
            drafts: detail.drafts.length,
            held: held.length,
          },
          usd(byJob.get(detail.job.id) ?? 0),
          work,
        ),
        agents: detail.runs.slice(0, 200).map((run) => ({
          id: run.id,
          role: oneOf(WORKFORCE_AGENT_ROLES, run.role, "AD_HOC"),
          agentName: run.agent_name,
          goal: run.goal,
          tools: [...run.tools].slice(0, 16),
          status: oneOf(WORKFORCE_RUN_STATUSES, run.status, "RUNNING"),
          summary: run.summary,
          spawnedByRunId: run.spawned_by_run_id,
          spawned: run.role === "AD_HOC",
          budgetUsd: money(run.budget_usd),
          costUsd: usd(byRun.get(run.id) ?? 0),
          startedAt: run.started_at.toISOString(),
          endedAt: run.ended_at?.toISOString() ?? null,
        })),
        drafts: drafts.slice(0, 200),
        timeline: timeline.slice(-1_000),
        ...(artifactIds.length === 0
          ? {}
          : {
              documents,
              documentsUnavailable: documents.length < artifactIds.length,
            }),
        ...(actionIds.length === 0
          ? {}
          : {
              approvals,
              approvalsUnavailable: approvals.length < actionIds.length,
            }),
      };
    },

    /**
     * Who is on what today, and this month's spend by role against the
     * person's limit (J5, J6). A ledger or limit that cannot be read shows
     * nothing spent and no limit, never a failed page.
     */
    overview: async (owner: Owner): Promise<WorkforceOverviewDto> => {
      const at = dependencies.now?.() ?? new Date();
      const today = new Date(
        Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
      );
      const [read, limit, team, jobs, instructions] = await Promise.all([
        (dependencies.monthCosts?.(owner, at) ?? Promise.resolve(null)).catch(
          () => null,
        ),
        (dependencies.monthlyLimitUsd?.(owner) ?? Promise.resolve(null)).catch(
          () => null,
        ),
        store.team(owner, today),
        store.openJobs(owner),
        // A failed read shows no instructions rather than failing the page.
        (
          store.instructions?.(owner, new Date(at.getTime() - DAY_MS)) ??
          Promise.resolve([])
        ).catch(() => []),
      ]);
      // A ledger that cannot be read shows nothing spent (as before), but
      // its days stay unknown rather than reading as a month of zeros.
      const month = read ?? [];
      const roles = await store.runRoles(
        owner,
        month.map((row) => row.runId),
      );
      // Summed in micro-dollars: the ledger's numeric, never a float sum.
      type Role = (typeof WORKFORCE_AGENT_ROLES)[number];
      const byRole = new Map<Role, number>();
      // Day by day (UTC), each split by role: the same ledger rows.
      const byDay = new Map<string, Map<Role, number>>();
      let dated = read !== null;
      let total = 0;
      for (const row of month) {
        const micros = Math.round(Number(row.usd) * 1_000_000);
        if (!Number.isFinite(micros)) continue;
        total += micros;
        const role = oneOf(
          WORKFORCE_AGENT_ROLES,
          roles.get(row.runId) ?? "AD_HOC",
          "AD_HOC",
        );
        byRole.set(role, (byRole.get(role) ?? 0) + micros);
        if (row.day === undefined || !DAY.test(row.day)) {
          dated = false;
          continue;
        }
        const day = byDay.get(row.day) ?? new Map<Role, number>();
        day.set(role, (day.get(role) ?? 0) + micros);
        byDay.set(row.day, day);
      }
      const dollars = (micros: number) => usd(micros / 1_000_000);
      const limitMicros = limit === null ? null : Math.round(limit * 1_000_000);
      return {
        month: `${String(at.getUTCFullYear())}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`,
        spentUsd: dollars(total),
        limitUsd: limitMicros === null ? null : dollars(limitMicros),
        paused: limitMicros !== null && total >= limitMicros,
        byRole: [...byRole.entries()]
          .filter(([, micros]) => micros > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([role, micros]) => ({ role, usd: dollars(micros) })),
        // A ledger without days (an older reader) leaves the days unknown.
        ...(dated
          ? {
              byDay: [...byDay.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .slice(-31)
                .flatMap(([day, roleMicros]) => {
                  const sum = [...roleMicros.values()].reduce(
                    (one, two) => one + two,
                    0,
                  );
                  if (sum <= 0) return [];
                  return [
                    {
                      day,
                      usd: dollars(sum),
                      byRole: [...roleMicros.entries()]
                        .filter(([, micros]) => micros > 0)
                        .sort((a, b) => b[1] - a[1])
                        .map(([role, micros]) => ({
                          role,
                          usd: dollars(micros),
                        })),
                    },
                  ];
                }),
            }
          : {}),
        team: team.map((row) => ({
          role: oneOf(WORKFORCE_AGENT_ROLES, row.role, "AD_HOC"),
          state: oneOf(
            WORKFORCE_TEAM_STATES,
            row.needs_you > 0
              ? "NEEDS_YOU"
              : row.running > 0
                ? "WORKING"
                : "IDLE",
            "IDLE",
          ),
          runs: row.runs,
          drafts: row.drafts,
          sentBack: row.sent_back,
          latest: row.latest?.slice(0, 500) ?? null,
        })),
        jobs,
        instructions: instructions.map((one) => ({
          id: one.id,
          goal: one.goal_text.trim().slice(0, 300),
          status: one.status === "PAUSED" ? "PAUSED" : "ACTIVE",
          pauseReason:
            one.pause_reason !== null && CODE.test(one.pause_reason)
              ? one.pause_reason
              : null,
          lastRunAt: one.last_fired_at?.toISOString() ?? null,
          nextRunAt:
            one.status === "ACTIVE"
              ? (one.next_fire_at?.toISOString() ?? null)
              : null,
          steps: one.steps
            .filter((step) => ACTION.test(step.action))
            .slice(0, 60)
            .map((step) => ({
              action: step.action,
              status: oneOf(
                WORKFORCE_INSTRUCTION_STEP_STATUSES,
                step.status,
                "NOTED",
              ),
              reasonCode:
                step.reason_code !== null && CODE.test(step.reason_code)
                  ? step.reason_code
                  : null,
              words: step.words.trim().slice(0, 500),
              at: step.created_at.toISOString(),
              approvalId: step.approval_id,
              approvalStatus:
                step.approval_status === null
                  ? null
                  : cardStatus(
                      step.approval_status,
                      step.approval_expires_at,
                      at,
                    ),
            })),
        })),
      };
    },
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type WorkforcePage = ReturnType<typeof createWorkforcePage>;
