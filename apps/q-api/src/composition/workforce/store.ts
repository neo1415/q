import { createHash, randomUUID } from "node:crypto";

import type { DatabaseExecutor } from "@capital-q/database";
import type { Grade, StepStatus } from "@capital-q/q-orchestrator";

/**
 * The workforce record (founder brief J1-J9): jobs, agent runs, hand-offs,
 * drafts, grades, outcomes and feedback in q_runtime.workforce_*. Every
 * call names its owner, and every read is filtered by it: an id that is
 * not the owner's is the same miss as one that does not exist. Writes are
 * the server's; history rows are inserted, never updated.
 */

export type Owner = { readonly tenantId: string; readonly userId: string };

export type JobSourceKind =
  | "JOB"
  | "INSTRUCTION"
  | "DELEGATED_WORK"
  | "ERRAND"
  | "MEETING_FOLLOW_UP"
  | "EMAIL_DRAFT";

export type JobRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly source_kind: JobSourceKind;
  readonly source_id: string | null;
  readonly goal: string;
  readonly status: string;
  readonly budget_usd: string;
  readonly review_threshold: number;
  readonly max_redrafts: number;
  readonly rubric_version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
};

export type RunRow = {
  readonly id: string;
  readonly job_id: string;
  readonly role: string;
  readonly agent_name: string;
  readonly goal: string;
  readonly tools: readonly string[];
  readonly budget_usd: string;
  readonly step_key: string | null;
  readonly spawned_by_run_id: string | null;
  readonly status: string;
  readonly summary: string | null;
  readonly started_at: Date;
  readonly ended_at: Date | null;
};

export type HandoffRow = {
  readonly id: string;
  readonly job_id: string;
  readonly from_run_id: string;
  readonly to_run_id: string;
  readonly draft_id: string | null;
  readonly note: string;
  readonly created_at: Date;
};

export type DraftRow = {
  readonly id: string;
  readonly job_id: string;
  readonly writer_run_id: string | null;
  readonly attempt: number;
  readonly parent_draft_id: string | null;
  readonly channel: "CHAT" | "EMAIL";
  readonly counterpart_name: string | null;
  readonly body: string;
  readonly created_at: Date;
};

export type GradeRow = {
  readonly draft_id: string;
  readonly job_id: string;
  readonly reviewer_run_id: string | null;
  readonly score: number;
  readonly passed: boolean;
  readonly threshold: number;
  readonly max_redrafts: number;
  readonly rubric_version: string;
  readonly prompt_version: string;
  readonly criteria: unknown;
  readonly integrity: unknown;
  readonly feedback: string;
  readonly created_at: Date;
};

export type OutcomeRow = {
  readonly draft_id: string;
  readonly job_id: string;
  readonly outcome: "SENT" | "OFFERED" | "HELD";
  readonly reason: string | null;
  readonly q_action_id: string | null;
  readonly created_at: Date;
};

export type FeedbackRow = {
  readonly id: string;
  readonly draft_id: string;
  readonly job_id: string;
  readonly kind: "APPROVED" | "EDITED" | "REJECTED" | "REPLIED" | "NO_REPLY";
  readonly edited_body: string | null;
  readonly note: string | null;
  readonly created_at: Date;
};

export type JobDetail = {
  readonly job: JobRow;
  readonly runs: readonly RunRow[];
  readonly handoffs: readonly HandoffRow[];
  readonly drafts: readonly DraftRow[];
  readonly grades: readonly GradeRow[];
  readonly outcomes: readonly OutcomeRow[];
  readonly feedback: readonly FeedbackRow[];
};

export type JobListRow = JobRow & {
  readonly agents: number;
  readonly drafts: number;
  readonly held: number;
};

export type NewJob = {
  readonly source: { readonly kind: JobSourceKind; readonly id: string | null };
  readonly goal: string;
  readonly budgetUsd: number;
  readonly threshold: number;
  readonly maxRedrafts: number;
  readonly rubricVersion: string;
};

export type NewRun = {
  readonly jobId: string;
  readonly role: string;
  readonly agentName: string;
  readonly goal: string;
  readonly tools: readonly string[];
  readonly budgetUsd: number;
  readonly stepKey: string | null;
  readonly spawnedByRunId: string | null;
};

export type WorkforceStore = {
  /** The job for this source (one per source), created with its lead run. */
  readonly ensureJob: (
    owner: Owner,
    job: NewJob,
  ) => Promise<{ readonly job: JobRow; readonly leadRunId: string }>;
  readonly setJobStatus: (
    owner: Owner,
    jobId: string,
    status: "RUNNING" | "DONE" | "HELD" | "STOPPED" | "FAILED",
  ) => Promise<void>;
  readonly startRun: (owner: Owner, run: NewRun) => Promise<string>;
  readonly endRun: (
    owner: Owner,
    runId: string,
    status: StepStatus,
    summary: string,
  ) => Promise<void>;
  readonly handoff: (
    owner: Owner,
    input: {
      readonly jobId: string;
      readonly fromRunId: string;
      readonly toRunId: string;
      readonly draftId: string | null;
      readonly note: string;
    },
  ) => Promise<void>;
  readonly addDraft: (
    owner: Owner,
    input: {
      readonly jobId: string;
      readonly writerRunId: string | null;
      readonly attempt: number;
      readonly parentDraftId: string | null;
      readonly channel: "CHAT" | "EMAIL";
      readonly counterpartName: string | null;
      readonly body: string;
    },
  ) => Promise<string>;
  readonly addGrade: (
    owner: Owner,
    input: {
      readonly jobId: string;
      readonly draftId: string;
      readonly reviewerRunId: string | null;
      readonly grade: Grade;
      readonly threshold: number;
      readonly maxRedrafts: number;
      readonly rubricVersion: string;
      readonly promptVersion: string;
    },
  ) => Promise<void>;
  readonly addOutcome: (
    owner: Owner,
    input: {
      readonly jobId: string;
      readonly draftId: string;
      readonly outcome: "SENT" | "OFFERED" | "HELD";
      readonly reason: string | null;
      readonly qActionId: string | null;
    },
  ) => Promise<void>;
  /** Idempotent by key: a replay answers the first feedback's id. */
  readonly addFeedback: (
    owner: Owner,
    input: {
      readonly draftId: string;
      readonly kind: FeedbackRow["kind"];
      readonly editedBody: string | null;
      readonly note: string | null;
      readonly idempotencyKey: string;
      readonly memoryItemId: string | null;
    },
  ) => Promise<{ readonly id: string; readonly created: boolean } | null>;
  readonly draft: (
    owner: Owner,
    draftId: string,
  ) => Promise<(DraftRow & { readonly outcome: string | null }) | null>;
  /** The draft offered on this approval card, when one was. */
  readonly draftForAction: (
    owner: Owner,
    qActionId: string,
  ) => Promise<string | null>;
  readonly listJobs: (
    owner: Owner,
    page: { readonly limit: number; readonly before: Date | null },
  ) => Promise<readonly JobListRow[]>;
  readonly job: (owner: Owner, jobId: string) => Promise<JobDetail | null>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function goalOf(text: string): string {
  return clip(text, 400) || "Work for you.";
}

export function createPostgresWorkforceStore(
  sql: DatabaseExecutor,
): WorkforceStore {
  return {
    ensureJob: async (owner, input) => {
      const existing =
        input.source.id === null
          ? []
          : await sql<JobRow[]>`
              select * from q_runtime.workforce_jobs
               where tenant_id = ${owner.tenantId} and user_id = ${owner.userId}
                 and source_kind = ${input.source.kind} and source_id = ${input.source.id}`;
      let job = existing[0];
      if (job === undefined) {
        const rows = await sql<JobRow[]>`
          insert into q_runtime.workforce_jobs
            (tenant_id, user_id, source_kind, source_id, goal, budget_usd,
             review_threshold, max_redrafts, rubric_version)
          values (${owner.tenantId}, ${owner.userId}, ${input.source.kind},
                  ${input.source.id}, ${clip(input.goal, 2_000) || "Work for you."},
                  ${input.budgetUsd.toFixed(6)}, ${input.threshold},
                  ${input.maxRedrafts}, ${input.rubricVersion})
          on conflict (tenant_id, user_id, source_kind, source_id)
            where source_id is not null
            do update set status = q_runtime.workforce_jobs.status
          returning *`;
        job = rows[0];
      }
      if (job === undefined) throw new Error("workforce job not filed");
      const lead = await sql<{ id: string }[]>`
        select id from q_runtime.workforce_agent_runs
         where job_id = ${job.id} and role = 'LEAD'
         order by started_at limit 1`;
      const leadRunId =
        lead[0]?.id ??
        (
          await sql<{ id: string }[]>`
            insert into q_runtime.workforce_agent_runs
              (job_id, tenant_id, user_id, role, agent_name, goal)
            values (${job.id}, ${owner.tenantId}, ${owner.userId}, 'LEAD', 'Lead Q',
                    ${goalOf(input.goal)})
            returning id`
        )[0]?.id;
      if (leadRunId === undefined) throw new Error("lead run not filed");
      return { job, leadRunId };
    },

    setJobStatus: async (owner, jobId, status) => {
      await sql`
        update q_runtime.workforce_jobs set status = ${status}
         where id = ${jobId} and tenant_id = ${owner.tenantId} and user_id = ${owner.userId}
           and status <> ${status}`;
    },

    startRun: async (owner, run) => {
      const rows = await sql<{ id: string }[]>`
        insert into q_runtime.workforce_agent_runs
          (job_id, tenant_id, user_id, role, agent_name, goal, tools, budget_usd,
           step_key, spawned_by_run_id)
        values (${run.jobId}, ${owner.tenantId}, ${owner.userId}, ${run.role},
                ${clip(run.agentName, 60) || "Agent"}, ${goalOf(run.goal)},
                ${[...run.tools].slice(0, 16)}::text[], ${run.budgetUsd.toFixed(6)},
                ${run.stepKey}, ${run.spawnedByRunId})
        returning id`;
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("agent run not filed");
      return id;
    },

    endRun: async (owner, runId, status, summary) => {
      await sql`
        update q_runtime.workforce_agent_runs
           set status = ${status},
               summary = ${clip(summary, 500)}, ended_at = clock_timestamp()
         where id = ${runId} and tenant_id = ${owner.tenantId}
           and user_id = ${owner.userId} and status = 'RUNNING'`;
    },

    handoff: async (owner, input) => {
      await sql`
        insert into q_runtime.workforce_handoffs
          (job_id, tenant_id, user_id, from_run_id, to_run_id, draft_id, note)
        values (${input.jobId}, ${owner.tenantId}, ${owner.userId}, ${input.fromRunId},
                ${input.toRunId}, ${input.draftId}, ${clip(input.note, 1_000) || "Handed on."})`;
    },

    addDraft: async (owner, input) => {
      const body = input.body.slice(0, 4_000);
      const rows = await sql<{ id: string }[]>`
        insert into q_runtime.workforce_drafts
          (job_id, tenant_id, user_id, writer_run_id, attempt, parent_draft_id,
           channel, counterpart_name, body, body_sha256)
        values (${input.jobId}, ${owner.tenantId}, ${owner.userId}, ${input.writerRunId},
                ${Math.min(Math.max(input.attempt, 1), 6)}, ${input.parentDraftId},
                ${input.channel}, ${input.counterpartName?.slice(0, 200) ?? null},
                ${body}, ${sha256(body)})
        returning id`;
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("draft not filed");
      return id;
    },

    addGrade: async (owner, input) => {
      await sql`
        insert into q_runtime.workforce_grades
          (draft_id, job_id, tenant_id, user_id, reviewer_run_id, score, passed,
           threshold, max_redrafts, rubric_version, prompt_version, criteria,
           integrity, feedback)
        values (${input.draftId}, ${input.jobId}, ${owner.tenantId}, ${owner.userId},
                ${input.reviewerRunId}, ${input.grade.score}, ${input.grade.passed},
                ${input.threshold}, ${input.maxRedrafts}, ${input.rubricVersion},
                ${input.promptVersion},
                ${sql.json(JSON.parse(JSON.stringify(input.grade.criteria)) as never)},
                ${sql.json(JSON.parse(JSON.stringify(input.grade.integrity)) as never)},
                ${input.grade.feedback.slice(0, 1_000)})
        on conflict (draft_id) do nothing`;
    },

    addOutcome: async (owner, input) => {
      await sql`
        insert into q_runtime.workforce_draft_outcomes
          (draft_id, job_id, tenant_id, user_id, outcome, reason, q_action_id)
        values (${input.draftId}, ${input.jobId}, ${owner.tenantId}, ${owner.userId},
                ${input.outcome}, ${input.reason}, ${input.qActionId})
        on conflict (draft_id, outcome) do nothing`;
    },

    addFeedback: async (owner, input) => {
      if (!UUID.test(input.draftId)) return null;
      const draft = await sql<{ job_id: string }[]>`
        select job_id from q_runtime.workforce_drafts
         where id = ${input.draftId} and tenant_id = ${owner.tenantId}
           and user_id = ${owner.userId}`;
      const jobId = draft[0]?.job_id;
      if (jobId === undefined) return null;
      const inserted = await sql<{ id: string }[]>`
        insert into q_runtime.workforce_feedback
          (draft_id, job_id, tenant_id, user_id, kind, edited_body, note,
           memory_item_id, idempotency_key)
        values (${input.draftId}, ${jobId}, ${owner.tenantId}, ${owner.userId},
                ${input.kind}, ${input.editedBody}, ${input.note}, ${input.memoryItemId},
                ${input.idempotencyKey})
        on conflict (tenant_id, user_id, idempotency_key) do nothing
        returning id`;
      if (inserted[0] !== undefined)
        return { id: inserted[0].id, created: true };
      const replay = await sql<{ id: string }[]>`
        select id from q_runtime.workforce_feedback
         where tenant_id = ${owner.tenantId} and user_id = ${owner.userId}
           and idempotency_key = ${input.idempotencyKey}`;
      return replay[0] === undefined
        ? null
        : { id: replay[0].id, created: false };
    },

    draft: async (owner, draftId) => {
      if (!UUID.test(draftId)) return null;
      const rows = await sql<(DraftRow & { outcome: string | null })[]>`
        select d.id, d.job_id, d.writer_run_id, d.attempt, d.parent_draft_id, d.channel,
               d.counterpart_name, d.body, d.created_at,
               (select o.outcome from q_runtime.workforce_draft_outcomes o
                 where o.draft_id = d.id order by o.created_at desc limit 1) as outcome
          from q_runtime.workforce_drafts d
         where d.id = ${draftId} and d.tenant_id = ${owner.tenantId}
           and d.user_id = ${owner.userId}`;
      return rows[0] ?? null;
    },

    draftForAction: async (owner, qActionId) => {
      if (!UUID.test(qActionId)) return null;
      const rows = await sql<{ draft_id: string }[]>`
        select draft_id from q_runtime.workforce_draft_outcomes
         where q_action_id = ${qActionId} and outcome = 'OFFERED'
           and tenant_id = ${owner.tenantId} and user_id = ${owner.userId}
         limit 1`;
      return rows[0]?.draft_id ?? null;
    },

    listJobs: async (owner, page) =>
      sql<JobListRow[]>`
        select j.*,
               (select count(*)::int from q_runtime.workforce_agent_runs r where r.job_id = j.id) as agents,
               (select count(*)::int from q_runtime.workforce_drafts d where d.job_id = j.id) as drafts,
               (select count(*)::int from q_runtime.workforce_draft_outcomes o
                 where o.job_id = j.id and o.outcome = 'HELD') as held
          from q_runtime.workforce_jobs j
         where j.tenant_id = ${owner.tenantId} and j.user_id = ${owner.userId}
           and (${page.before}::timestamptz is null or j.updated_at < ${page.before})
         order by j.updated_at desc, j.id
         limit ${page.limit}`,

    job: async (owner, jobId) => {
      if (!UUID.test(jobId)) return null;
      const jobs = await sql<JobRow[]>`
        select * from q_runtime.workforce_jobs
         where id = ${jobId} and tenant_id = ${owner.tenantId} and user_id = ${owner.userId}`;
      const job = jobs[0];
      if (job === undefined) return null;
      const [runs, handoffs, drafts, grades, outcomes, feedback] =
        await Promise.all([
          sql<RunRow[]>`
            select * from q_runtime.workforce_agent_runs where job_id = ${job.id}
             order by started_at limit 200`,
          sql<HandoffRow[]>`
            select * from q_runtime.workforce_handoffs where job_id = ${job.id}
             order by created_at limit 400`,
          sql<DraftRow[]>`
            select id, job_id, writer_run_id, attempt, parent_draft_id, channel,
                   counterpart_name, body, created_at
              from q_runtime.workforce_drafts where job_id = ${job.id}
             order by created_at limit 200`,
          sql<GradeRow[]>`
            select * from q_runtime.workforce_grades where job_id = ${job.id}`,
          sql<OutcomeRow[]>`
            select * from q_runtime.workforce_draft_outcomes where job_id = ${job.id}`,
          sql<FeedbackRow[]>`
            select id, draft_id, job_id, kind, edited_body, note, created_at
              from q_runtime.workforce_feedback where job_id = ${job.id}
             order by created_at`,
        ]);
      return { job, runs, handoffs, drafts, grades, outcomes, feedback };
    },
  };
}

/**
 * The same port in memory, for tests and for a Q API composed without a
 * database. Owner checks are the same as the SQL's.
 */
export function createInMemoryWorkforceStore(
  now: () => Date = () => new Date(),
): WorkforceStore & {
  readonly rows: {
    readonly jobs: (JobRow & { owner: string })[];
    readonly runs: (RunRow & { owner: string })[];
    readonly handoffs: (HandoffRow & { owner: string })[];
    readonly drafts: (DraftRow & { owner: string })[];
    readonly grades: (GradeRow & { owner: string })[];
    readonly outcomes: (OutcomeRow & { owner: string })[];
    readonly feedback: (FeedbackRow & { owner: string; key: string })[];
  };
} {
  const key = (owner: Owner) => `${owner.tenantId}:${owner.userId}`;
  const rows = {
    jobs: [] as (JobRow & { owner: string })[],
    runs: [] as (RunRow & { owner: string })[],
    handoffs: [] as (HandoffRow & { owner: string })[],
    drafts: [] as (DraftRow & { owner: string })[],
    grades: [] as (GradeRow & { owner: string })[],
    outcomes: [] as (OutcomeRow & { owner: string })[],
    feedback: [] as (FeedbackRow & { owner: string; key: string })[],
  };
  const ownJob = (owner: Owner, jobId: string) =>
    rows.jobs.find((job) => job.id === jobId && job.owner === key(owner));
  const mustOwn = (owner: Owner, jobId: string) => {
    if (ownJob(owner, jobId) === undefined) {
      throw new Error("not the owner's job");
    }
  };
  return {
    rows,
    ensureJob: (owner, input) => {
      let job =
        input.source.id === null
          ? undefined
          : rows.jobs.find(
              (one) =>
                one.owner === key(owner) &&
                one.source_kind === input.source.kind &&
                one.source_id === input.source.id,
            );
      if (job === undefined) {
        job = {
          owner: key(owner),
          id: randomUUID(),
          tenant_id: owner.tenantId,
          user_id: owner.userId,
          source_kind: input.source.kind,
          source_id: input.source.id,
          goal: clip(input.goal, 2_000),
          status: "RUNNING",
          budget_usd: input.budgetUsd.toFixed(6),
          review_threshold: input.threshold,
          max_redrafts: input.maxRedrafts,
          rubric_version: input.rubricVersion,
          created_at: now(),
          updated_at: now(),
        };
        rows.jobs.push(job);
      }
      const found = job;
      let lead = rows.runs.find(
        (run) => run.job_id === found.id && run.role === "LEAD",
      );
      if (lead === undefined) {
        lead = {
          owner: key(owner),
          id: randomUUID(),
          job_id: found.id,
          role: "LEAD",
          agent_name: "Lead Q",
          goal: goalOf(input.goal),
          tools: [],
          budget_usd: "0",
          step_key: null,
          spawned_by_run_id: null,
          status: "RUNNING",
          summary: null,
          started_at: now(),
          ended_at: null,
        };
        rows.runs.push(lead);
      }
      return Promise.resolve({ job: found, leadRunId: lead.id });
    },
    setJobStatus: (owner, jobId, status) => {
      const index = rows.jobs.findIndex(
        (job) => job.id === jobId && job.owner === key(owner),
      );
      const job = rows.jobs[index];
      if (job !== undefined) {
        rows.jobs[index] = { ...job, status, updated_at: now() };
      }
      return Promise.resolve();
    },
    startRun: (owner, run) => {
      mustOwn(owner, run.jobId);
      const id = randomUUID();
      rows.runs.push({
        owner: key(owner),
        id,
        job_id: run.jobId,
        role: run.role,
        agent_name: clip(run.agentName, 60),
        goal: goalOf(run.goal),
        tools: [...run.tools],
        budget_usd: run.budgetUsd.toFixed(6),
        step_key: run.stepKey,
        spawned_by_run_id: run.spawnedByRunId,
        status: "RUNNING",
        summary: null,
        started_at: now(),
        ended_at: null,
      });
      return Promise.resolve(id);
    },
    endRun: (owner, runId, status, summary) => {
      const index = rows.runs.findIndex(
        (run) =>
          run.id === runId &&
          run.owner === key(owner) &&
          run.status === "RUNNING",
      );
      const run = rows.runs[index];
      if (run !== undefined) {
        rows.runs[index] = {
          ...run,
          status,
          summary: clip(summary, 500),
          ended_at: now(),
        };
      }
      return Promise.resolve();
    },
    handoff: (owner, input) => {
      mustOwn(owner, input.jobId);
      rows.handoffs.push({
        owner: key(owner),
        id: randomUUID(),
        job_id: input.jobId,
        from_run_id: input.fromRunId,
        to_run_id: input.toRunId,
        draft_id: input.draftId,
        note: clip(input.note, 1_000),
        created_at: now(),
      });
      return Promise.resolve();
    },
    addDraft: (owner, input) => {
      mustOwn(owner, input.jobId);
      const id = randomUUID();
      rows.drafts.push({
        owner: key(owner),
        id,
        job_id: input.jobId,
        writer_run_id: input.writerRunId,
        attempt: input.attempt,
        parent_draft_id: input.parentDraftId,
        channel: input.channel,
        counterpart_name: input.counterpartName,
        body: input.body.slice(0, 4_000),
        created_at: now(),
      });
      return Promise.resolve(id);
    },
    addGrade: (owner, input) => {
      mustOwn(owner, input.jobId);
      if (!rows.grades.some((grade) => grade.draft_id === input.draftId)) {
        rows.grades.push({
          owner: key(owner),
          draft_id: input.draftId,
          job_id: input.jobId,
          reviewer_run_id: input.reviewerRunId,
          score: input.grade.score,
          passed: input.grade.passed,
          threshold: input.threshold,
          max_redrafts: input.maxRedrafts,
          rubric_version: input.rubricVersion,
          prompt_version: input.promptVersion,
          criteria: input.grade.criteria,
          integrity: input.grade.integrity,
          feedback: input.grade.feedback,
          created_at: now(),
        });
      }
      return Promise.resolve();
    },
    addOutcome: (owner, input) => {
      mustOwn(owner, input.jobId);
      if (
        !rows.outcomes.some(
          (one) =>
            one.draft_id === input.draftId && one.outcome === input.outcome,
        )
      ) {
        rows.outcomes.push({
          owner: key(owner),
          draft_id: input.draftId,
          job_id: input.jobId,
          outcome: input.outcome,
          reason: input.reason,
          q_action_id: input.qActionId,
          created_at: now(),
        });
      }
      return Promise.resolve();
    },
    addFeedback: (owner, input) => {
      const draft = rows.drafts.find(
        (one) => one.id === input.draftId && one.owner === key(owner),
      );
      if (draft === undefined) return Promise.resolve(null);
      const replay = rows.feedback.find(
        (one) => one.owner === key(owner) && one.key === input.idempotencyKey,
      );
      if (replay !== undefined) {
        return Promise.resolve({ id: replay.id, created: false });
      }
      const id = randomUUID();
      rows.feedback.push({
        owner: key(owner),
        key: input.idempotencyKey,
        id,
        draft_id: draft.id,
        job_id: draft.job_id,
        kind: input.kind,
        edited_body: input.editedBody,
        note: input.note,
        created_at: now(),
      });
      return Promise.resolve({ id, created: true });
    },
    draft: (owner, draftId) => {
      const draft = rows.drafts.find(
        (one) => one.id === draftId && one.owner === key(owner),
      );
      if (draft === undefined) return Promise.resolve(null);
      const outcome =
        rows.outcomes.filter((one) => one.draft_id === draftId).at(-1)
          ?.outcome ?? null;
      return Promise.resolve({ ...draft, outcome });
    },
    draftForAction: (owner, qActionId) =>
      Promise.resolve(
        rows.outcomes.find(
          (one) =>
            one.owner === key(owner) &&
            one.outcome === "OFFERED" &&
            one.q_action_id === qActionId,
        )?.draft_id ?? null,
      ),
    listJobs: (owner, page) =>
      Promise.resolve(
        rows.jobs
          .filter(
            (job) =>
              job.owner === key(owner) &&
              (page.before === null || job.updated_at < page.before),
          )
          .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())
          .slice(0, page.limit)
          .map((job) => ({
            ...job,
            agents: rows.runs.filter((run) => run.job_id === job.id).length,
            drafts: rows.drafts.filter((draft) => draft.job_id === job.id)
              .length,
            held: rows.outcomes.filter(
              (one) => one.job_id === job.id && one.outcome === "HELD",
            ).length,
          })),
      ),
    job: (owner, jobId) => {
      const job = ownJob(owner, jobId);
      if (job === undefined) return Promise.resolve(null);
      const of = <T extends { job_id: string }>(list: readonly T[]) =>
        list.filter((row) => row.job_id === job.id);
      return Promise.resolve({
        job,
        runs: of(rows.runs),
        handoffs: of(rows.handoffs),
        drafts: of(rows.drafts),
        grades: of(rows.grades),
        outcomes: of(rows.outcomes),
        feedback: of(rows.feedback),
      });
    },
  };
}
