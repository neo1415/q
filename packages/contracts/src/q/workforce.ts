import { z } from "zod";

import { QWorkStateSchema } from "./agent-capability.js";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Q's workforce, as the person follows it (founder brief J1-J9, J5): the
 * jobs Q's agents carry out for them, which agent did what, the hand-offs,
 * every outward draft with the reviewer's grade and the bar it was held
 * to, what was sent, offered for approval or held, and what each job and
 * agent cost. Read-only. The person's approvals, edits and rejections of
 * offered drafts reach the agents' learning through the Approval Engine's
 * own decisions (ADR 0040: no second mutation path).
 *
 * Starting a job is never this API: jobs come from the person's approved
 * instructions, delegated work and conversations with Q. Ids in paths are
 * input; the server answers only for the person's own jobs, and someone
 * else's id is the same 404 as one that does not exist. Approving an
 * OFFERED draft is the Approval Engine's (its `qActionId`), never a
 * second path here.
 */

export const Q_WORKFORCE_JOBS_PATH = "/v1/q/workforce/jobs" as const;
export const Q_WORKFORCE_JOB_PATH = "/v1/q/workforce/jobs/:jobId" as const;

export const qWorkforceJobPath = (jobId: string) =>
  Q_WORKFORCE_JOB_PATH.replace(":jobId", encodeURIComponent(jobId));

export const WORKFORCE_AGENT_ROLES = [
  "LEAD",
  "OUTREACH",
  "MANDATE_WATCHER",
  "CONVERSATION",
  "WRITER",
  "REVIEWER",
  "SCHEDULER",
  "DOCUMENTS",
  "RESEARCH",
  "AD_HOC",
] as const;
export const WorkforceAgentRoleSchema = z.enum(WORKFORCE_AGENT_ROLES);

export const WORKFORCE_JOB_SOURCES = [
  "JOB",
  "INSTRUCTION",
  "DELEGATED_WORK",
  "ERRAND",
  "MEETING_FOLLOW_UP",
  "EMAIL_DRAFT",
] as const;
export const WorkforceJobSourceSchema = z.enum(WORKFORCE_JOB_SOURCES);

export const WORKFORCE_JOB_STATUSES = [
  "PLANNING",
  "RUNNING",
  "DONE",
  "HELD",
  "STOPPED",
  "FAILED",
] as const;

export const WORKFORCE_RUN_STATUSES = [
  "RUNNING",
  "DONE",
  "HELD",
  "FAILED",
  "SKIPPED",
] as const;

/** Money as a decimal string, never a float. */
const UsdSchema = z.string().regex(/^\d{1,9}(\.\d{1,6})?$/u);

export const WorkforceReviewBarDtoSchema = z
  .object({
    /** The least score, out of 100, a draft needs to be sent or offered. */
    threshold: z.number().int().min(0).max(100),
    maxRedrafts: z.number().int().min(0).max(5),
    rubricVersion: z.string().max(64),
  })
  .strict();

export const WorkforceJobSummaryDtoSchema = z
  .object({
    id: UuidSchema,
    goal: z.string().max(2_000),
    source: WorkforceJobSourceSchema,
    status: z.enum(WORKFORCE_JOB_STATUSES),
    reviewBar: WorkforceReviewBarDtoSchema,
    budgetUsd: UsdSchema,
    /** What its agents' model calls cost, from the usage ledger. */
    costUsd: UsdSchema,
    agents: z.number().int().min(0),
    drafts: z.number().int().min(0),
    /** Drafts held below the bar: waiting for the person to look. */
    held: z.number().int().min(0),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
    /**
     * RECOVERY D: the durable queue's state for this job (agent-capability
     * QWorkState), grounded in the queue row; absent before it was queued.
     */
    workState: QWorkStateSchema.optional(),
    /** Why it stopped, when it is FAILED or BLOCKED (plain words). */
    stoppedBecause: z.string().max(500).optional(),
    /** Where it came from: the conversation and run that started it. */
    trace: z
      .object({
        conversationId: UuidSchema.optional(),
        runId: UuidSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type WorkforceJobSummaryDto = z.infer<
  typeof WorkforceJobSummaryDtoSchema
>;

export const WorkforceJobListDtoSchema = z
  .object({
    items: z.array(WorkforceJobSummaryDtoSchema).max(50),
    /** Cursor pagination: pass back as `cursor` for the next page. */
    nextCursor: z.string().max(200).nullable(),
  })
  .strict();
export type WorkforceJobListDto = z.infer<typeof WorkforceJobListDtoSchema>;

export const WorkforceJobListQuerySchema = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const WorkforceAgentRunDtoSchema = z
  .object({
    id: UuidSchema,
    role: WorkforceAgentRoleSchema,
    agentName: z.string().max(60),
    goal: z.string().max(400),
    tools: z.array(z.string().max(80)).max(16),
    status: z.enum(WORKFORCE_RUN_STATUSES),
    summary: z.string().max(500).nullable(),
    /** The run that spawned it (the lead Q's); null for the lead itself. */
    spawnedByRunId: UuidSchema.nullable(),
    spawned: z.boolean(),
    budgetUsd: UsdSchema,
    costUsd: UsdSchema,
    startedAt: UtcTimestampSchema,
    endedAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type WorkforceAgentRunDto = z.infer<typeof WorkforceAgentRunDtoSchema>;

export const WorkforceGradeDtoSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    passed: z.boolean(),
    threshold: z.number().int().min(0).max(100),
    maxRedrafts: z.number().int().min(0).max(5),
    rubricVersion: z.string().max(64),
    criteria: z
      .array(
        z
          .object({
            criterion: z.string().max(40),
            score: z.number().int().min(0).max(5),
            note: z.string().max(300),
          })
          .strict(),
      )
      .max(12),
    integrity: z
      .array(
        z
          .object({
            rule: z.string().max(40),
            ok: z.boolean(),
            note: z.string().max(300),
          })
          .strict(),
      )
      .max(8),
    feedback: z.string().max(1_000),
  })
  .strict();

export const WORKFORCE_DRAFT_OUTCOMES = ["SENT", "OFFERED", "HELD"] as const;
export const WORKFORCE_FEEDBACK_KINDS = [
  "APPROVED",
  "EDITED",
  "REJECTED",
  "REPLIED",
  "NO_REPLY",
] as const;

export const WorkforceDraftDtoSchema = z
  .object({
    id: UuidSchema,
    attempt: z.number().int().min(1).max(6),
    parentDraftId: UuidSchema.nullable(),
    channel: z.enum(["CHAT", "EMAIL"]),
    counterpartName: z.string().max(200).nullable(),
    body: z.string().max(4_000),
    grade: WorkforceGradeDtoSchema.nullable(),
    outcome: z
      .object({
        outcome: z.enum(WORKFORCE_DRAFT_OUTCOMES),
        reason: z.string().max(64).nullable(),
        /** OFFERED: the approval card, approved through the Approval Engine. */
        qActionId: UuidSchema.nullable(),
        /**
         * OFFERED: the card's approval, which binds to this exact text, and
         * where it stands. Null: no card, or one not readable for them.
         */
        approvalId: UuidSchema.nullable().default(null),
        approvalStatus: z
          .enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED", "REVOKED"])
          .nullable()
          .default(null),
      })
      .strict()
      .nullable(),
    feedback: z
      .array(
        z
          .object({
            kind: z.enum(WORKFORCE_FEEDBACK_KINDS),
            at: UtcTimestampSchema,
          })
          .strict(),
      )
      .max(10),
    createdAt: UtcTimestampSchema,
  })
  .strict();
export type WorkforceDraftDto = z.infer<typeof WorkforceDraftDtoSchema>;

export const WORKFORCE_TIMELINE_KINDS = [
  "AGENT_STARTED",
  "AGENT_ENDED",
  "HANDOFF",
  "DRAFT",
  "GRADE",
  "OUTCOME",
  "FEEDBACK",
] as const;

export const WorkforceTimelineEntryDtoSchema = z
  .object({
    at: UtcTimestampSchema,
    kind: z.enum(WORKFORCE_TIMELINE_KINDS),
    runId: UuidSchema.nullable(),
    toRunId: UuidSchema.nullable(),
    draftId: UuidSchema.nullable(),
    /** Plain words for the line, written by code. */
    text: z.string().max(600),
  })
  .strict();
export type WorkforceTimelineEntryDto = z.infer<
  typeof WorkforceTimelineEntryDtoSchema
>;

export const WorkforceJobDetailDtoSchema = z
  .object({
    job: WorkforceJobSummaryDtoSchema,
    agents: z.array(WorkforceAgentRunDtoSchema).max(200),
    drafts: z.array(WorkforceDraftDtoSchema).max(200),
    timeline: z.array(WorkforceTimelineEntryDtoSchema).max(1_000),
  })
  .strict();
export type WorkforceJobDetailDto = z.infer<typeof WorkforceJobDetailDtoSchema>;

export const Q_WORKFORCE_OVERVIEW_PATH = "/v1/q/workforce/overview" as const;

export const WORKFORCE_TEAM_STATES = ["WORKING", "NEEDS_YOU", "IDLE"] as const;

/** A standing instruction step's own status (the table's check). */
export const WORKFORCE_INSTRUCTION_STEP_STATUSES = [
  "DONE",
  "ASKED",
  "REFUSED",
  "FAILED",
  "NOTED",
] as const;

/**
 * One step Q took under a standing instruction, as recorded (Zino, 7 Oct:
 * the map read only job runs, so an instruction that had drafted four
 * cards awaiting his yes showed every specialist "Idle"). The page maps
 * the action to the specialist; code never invents a step.
 */
export const WorkforceInstructionStepDtoSchema = z
  .object({
    action: z.string().regex(/^[a-z][a-z0-9_.]{0,79}$/u),
    status: z.enum(WORKFORCE_INSTRUCTION_STEP_STATUSES),
    reasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/u)
      .nullable(),
    words: z.string().max(500),
    at: UtcTimestampSchema,
    /** ASKED: its card's approval and where it stands (EXPIRED once lapsed). */
    approvalId: UuidSchema.nullable(),
    approvalStatus: z
      .enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED", "REVOKED"])
      .nullable(),
  })
  .strict();
export type WorkforceInstructionStepDto = z.infer<
  typeof WorkforceInstructionStepDtoSchema
>;

/** A live standing instruction: when it last ran and runs next, and its steps. */
export const WorkforceInstructionDtoSchema = z
  .object({
    id: UuidSchema,
    goal: z.string().max(300),
    status: z.enum(["ACTIVE", "PAUSED"]),
    pauseReason: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/u)
      .nullable(),
    lastRunAt: UtcTimestampSchema.nullable(),
    /** The scheduler's next firing; null: due now (or paused). */
    nextRunAt: UtcTimestampSchema.nullable(),
    /** The last day's steps and every card still waiting, newest first. */
    steps: z.array(WorkforceInstructionStepDtoSchema).max(60),
  })
  .strict();
export type WorkforceInstructionDto = z.infer<
  typeof WorkforceInstructionDtoSchema
>;

/**
 * The workforce at a glance (J5, J6): who is on what today, and what Q's
 * work cost this month against the person's monthly limit. Counts and
 * money only; the page writes the words.
 */
export const WorkforceOverviewDtoSchema = z
  .object({
    /** The calendar month, UTC, as YYYY-MM. */
    month: z.string().regex(/^\d{4}-\d{2}$/u),
    spentUsd: UsdSchema,
    /** Q pauses new jobs and asks the person at this; null: no limit. */
    limitUsd: UsdSchema.nullable(),
    /** Spent has reached the limit: new jobs wait for the person. */
    paused: z.boolean(),
    /** This month's spend by agent role, largest first. */
    byRole: z
      .array(
        z.object({ role: WorkforceAgentRoleSchema, usd: UsdSchema }).strict(),
      )
      .max(WORKFORCE_AGENT_ROLES.length),
    /** Each role's day so far. */
    team: z
      .array(
        z
          .object({
            role: WorkforceAgentRoleSchema,
            state: z.enum(WORKFORCE_TEAM_STATES),
            /** Runs today. */
            runs: z.number().int().min(0),
            /** Drafts written today (the writer) or graded (the reviewer). */
            drafts: z.number().int().min(0),
            /** Drafts the reviewer sent back today. */
            sentBack: z.number().int().min(0),
            /** Its latest run's own line, in plain words. */
            latest: z.string().max(500).nullable(),
          })
          .strict(),
      )
      .max(WORKFORCE_AGENT_ROLES.length),
    jobs: z
      .object({
        open: z.number().int().min(0),
        needsYou: z.number().int().min(0),
      })
      .strict(),
    /** Live standing instructions. Absent from an older server. */
    instructions: z.array(WorkforceInstructionDtoSchema).max(20).optional(),
  })
  .strict();
export type WorkforceOverviewDto = z.infer<typeof WorkforceOverviewDtoSchema>;

// ---------------------------------------------------------------------------
// A job the lead Q proposes (J1, J4): Prepare -> Recommend -> Approve
// ---------------------------------------------------------------------------

/**
 * The Q action that starts a job the lead Q planned. Its payload IS the
 * plan: the steps, the specialist that owns each, the tools each may use,
 * and the budget. The person approves exactly that plan; on approval it
 * runs as planned and is never re-planned under the same approval (a
 * changed plan is a new card).
 */
export const Q_WORKFORCE_JOB_START = "q.workforce.job.start" as const;

export const WorkforcePlannedStepSchema = z
  .object({
    key: z.string().trim().min(1).max(40),
    role: WorkforceAgentRoleSchema,
    /** Plain words the person sees: a role's name or a helper's. */
    agentName: z.string().trim().min(1).max(60),
    goal: z.string().trim().min(1).max(400),
    tools: z.array(z.string().max(80)).max(8),
    dependsOn: z.array(z.string().max(40)).max(8),
    budgetUsd: UsdSchema,
    /** A helper the lead Q spawned for this step, with only these tools. */
    spawned: z.boolean(),
  })
  .strict();
export type WorkforcePlannedStep = z.infer<typeof WorkforcePlannedStepSchema>;

export const WorkforceJobStartPayloadSchema = z
  .object({
    ownerUserId: UuidSchema,
    goal: z.string().trim().min(1).max(2_000),
    /** The lead Q's one-line summary of the plan. */
    summary: z.string().trim().min(1).max(400),
    steps: z.array(WorkforcePlannedStepSchema).min(1).max(12),
    /** What the job may use: the union of its steps' tools. */
    permitted: z.array(z.string().max(80)).max(24),
    budgetUsd: UsdSchema,
    /** What it asked that no permitted tool can do, in plain words. */
    cannot: z.array(z.string().max(300)).max(5),
  })
  .strict();
export type WorkforceJobStartPayload = z.infer<
  typeof WorkforceJobStartPayloadSchema
>;

// ---------------------------------------------------------------------------
// "Ask Q to try again" on a held message (Zino, 2026-10-08).

/**
 * `POST` (Idempotency-Key required): the held draft is written and reviewed
 * again now. A pass is OFFERED as an ordinary approval card (its
 * `qActionId`), never sent; the person approves the exact text there. A
 * second hold says why. The draft id is input: someone else's is the same
 * NOT_FOUND as one that does not exist.
 */
export const Q_WORKFORCE_DRAFT_RETRY_PATH =
  "/v1/q/workforce/drafts/:draftId/retry" as const;

export const qWorkforceDraftRetryPath = (draftId: string) =>
  Q_WORKFORCE_DRAFT_RETRY_PATH.replace(":draftId", encodeURIComponent(draftId));

export const WorkforceDraftRetryRequestSchema = z
  .object({
    /** The conversation the card is in; checked against the draft's person. */
    relationshipId: UuidSchema.nullable(),
  })
  .strict();
export type WorkforceDraftRetryRequest = z.infer<
  typeof WorkforceDraftRetryRequestSchema
>;

const ReasonCode = z.string().regex(/^[A-Z][A-Z_]{1,63}$/u);

export const WorkforceDraftRetryResultDtoSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("OFFERED"),
        qActionId: UuidSchema,
        body: z.string().max(8_000),
      })
      .strict(),
    z
      .object({
        outcome: z.literal("HELD"),
        reason: ReasonCode,
        body: z.string().max(8_000),
      })
      .strict(),
    z
      .object({ outcome: z.literal("UNAVAILABLE"), reason: ReasonCode })
      .strict(),
  ],
);
export type WorkforceDraftRetryResultDto = z.infer<
  typeof WorkforceDraftRetryResultDtoSchema
>;
