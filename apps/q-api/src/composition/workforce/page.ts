import {
  WORKFORCE_AGENT_ROLES,
  WORKFORCE_JOB_STATUSES,
  WORKFORCE_RUN_STATUSES,
  WorkforceGradeDtoSchema,
} from "@capital-q/contracts";
import type {
  WorkforceDraftDto,
  WorkforceJobDetailDto,
  WorkforceJobListDto,
  WorkforceJobSummaryDto,
  WorkforceTimelineEntryDto,
} from "@capital-q/contracts";

import type {
  JobDetail,
  JobListRow,
  JobRow,
  Owner,
  WorkforceStore,
} from "./store.js";

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

const ZERO = "0";

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

function summary(
  job: JobRow,
  counts: { agents: number; drafts: number; held: number },
  costUsd: string,
): WorkforceJobSummaryDto {
  return {
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
}) {
  const { store } = dependencies;

  async function costsOf(owner: Owner, jobIds: readonly string[]) {
    const rows = await (
      dependencies.costs?.(owner, jobIds) ?? Promise.resolve([])
    ).catch(() => []);
    const byJob = new Map<string, number>();
    const byRun = new Map<string, number>();
    for (const row of rows) {
      const value = Number(row.usd);
      if (!Number.isFinite(value)) continue;
      byJob.set(row.jobId, (byJob.get(row.jobId) ?? 0) + value);
      byRun.set(row.runId, (byRun.get(row.runId) ?? 0) + value);
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
      const { byJob } = await costsOf(
        owner,
        shown.map((row) => row.id),
      );
      const last = shown.at(-1);
      return {
        items: shown.map((row) =>
          summary(row, row, usd(byJob.get(row.id) ?? 0)),
        ),
        nextCursor:
          rows.length > page.limit && last !== undefined
            ? last.updated_at.toISOString()
            : null,
      };
    },

    detail: async (
      owner: Owner,
      jobId: string,
    ): Promise<WorkforceJobDetailDto | null> => {
      const detail: JobDetail | null = await store.job(owner, jobId);
      if (detail === null) return null;
      const { byJob, byRun } = await costsOf(owner, [detail.job.id]);
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
              : {
                  outcome: outcome.outcome,
                  reason: outcome.reason,
                  qActionId: outcome.q_action_id,
                },
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

      return {
        job: summary(
          detail.job,
          {
            agents: detail.runs.length,
            drafts: detail.drafts.length,
            held: held.length,
          },
          usd(byJob.get(detail.job.id) ?? 0),
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
      };
    },
  };
}

export type WorkforcePage = ReturnType<typeof createWorkforcePage>;
