import { z } from "zod";

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
