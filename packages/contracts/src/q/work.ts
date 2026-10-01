import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Q's delegated work (AUTO, ADR 0030): an investor's outreach and a
 * founder's stand-in, as the person follows them. Starting either is an
 * approved action (`q.work.outreach.start`, `q.work.standin.start`), never
 * this API. Ids in paths are input; the server answers only for the
 * person's own delegations.
 */

export const Q_WORK_PATH = "/v1/q/work" as const;
export const Q_WORK_ITEM_PATH = "/v1/q/work/:delegationId" as const;
export const Q_WORK_LANE_PATH =
  "/v1/q/work/:delegationId/lanes/:laneId" as const;
export const Q_WORK_LANE_ANSWER_PATH =
  "/v1/q/work/:delegationId/lanes/:laneId/answer" as const;
export const Q_PRESENCE_PATH = "/v1/q/presence" as const;

export const qWorkItemPath = (delegationId: string) =>
  Q_WORK_ITEM_PATH.replace(":delegationId", encodeURIComponent(delegationId));
export const qWorkLanePath = (delegationId: string, laneId: string) =>
  Q_WORK_LANE_PATH.replace(
    ":delegationId",
    encodeURIComponent(delegationId),
  ).replace(":laneId", encodeURIComponent(laneId));
export const qWorkLaneAnswerPath = (delegationId: string, laneId: string) =>
  Q_WORK_LANE_ANSWER_PATH.replace(
    ":delegationId",
    encodeURIComponent(delegationId),
  ).replace(":laneId", encodeURIComponent(laneId));

/**
 * The database notification channel that wakes Q's waiting work when a
 * relationship moves (founder direction 2026-10-01). The payload is the
 * relationship id and nothing else; the waking process re-reads every
 * fact under the owner's own access.
 */
export const Q_WORK_WAKE_CHANNEL = "q_work_wake" as const;

export const Q_WORK_KINDS = ["INVESTOR_OUTREACH", "FOUNDER_STAND_IN"] as const;
export const Q_WORK_STATUSES = [
  "ACTIVE",
  "DONE",
  "STOPPED",
  "FAILED",
  "EXPIRED",
] as const;
export const Q_WORK_LANE_STAGES = [
  "SHORTLISTED",
  "WAITING_ACCEPTANCE",
  "CHATTING",
  "INTERVIEWING",
  "REPORT_READY",
  "NEEDS_TIMES",
  "CALL_BOOKED",
  "STANDING_IN",
  "DECLINED",
  "DONE",
  "STOPPED",
  "FAILED",
] as const;

export const QWorkSlotSchema = z
  .object({ start: UtcTimestampSchema, label: z.string().max(80) })
  .strict();
export type QWorkSlot = z.infer<typeof QWorkSlotSchema>;

export const QWorkLaneDtoSchema = z
  .object({
    id: UuidSchema,
    counterpartName: z.string().max(200),
    stage: z.enum(Q_WORK_LANE_STAGES),
    lastStep: z.string().max(300).nullable(),
    /** Why Q picked them, each with the words it rests on. */
    reasons: z
      .array(
        z
          .object({ reason: z.string().max(300), quote: z.string().max(400) })
          .strict(),
      )
      .max(5),
    /** Times Q offers when it needs the person to choose. */
    offered: z.array(QWorkSlotSchema).max(3),
    /** The first-stage report's verdict, when written. */
    report: z
      .object({
        headline: z.string().max(200),
        recommendation: z.enum(["PROCEED", "MAYBE", "PASS"]),
      })
      .strict()
      .nullable(),
    /** The person's own chat page with them, when connected. */
    chatPath: z
      .string()
      .regex(/^\/[A-Za-z0-9/_-]{0,200}$/)
      .nullable(),
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type QWorkLaneDto = z.infer<typeof QWorkLaneDtoSchema>;

export const QWorkStepDtoSchema = z
  .object({
    words: z.string().max(500),
    at: UtcTimestampSchema,
  })
  .strict();
export type QWorkStepDto = z.infer<typeof QWorkStepDtoSchema>;

export const QWorkDtoSchema = z
  .object({
    id: UuidSchema,
    kind: z.enum(Q_WORK_KINDS),
    status: z.enum(Q_WORK_STATUSES),
    /** Where the whole job stands, in plain words. */
    summary: z.string().max(300).nullable(),
    createdAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    lanes: z.array(QWorkLaneDtoSchema).max(30),
  })
  .strict();
export type QWorkDto = z.infer<typeof QWorkDtoSchema>;

export const QWorkListDtoSchema = z
  .object({ items: z.array(QWorkDtoSchema).max(20) })
  .strict();
export type QWorkListDto = z.infer<typeof QWorkListDtoSchema>;

export const QWorkDetailDtoSchema = z
  .object({
    work: QWorkDtoSchema,
    steps: z.array(QWorkStepDtoSchema).max(200),
  })
  .strict();
export type QWorkDetailDto = z.infer<typeof QWorkDetailDtoSchema>;

/** The person's word on a lane: book at a time (again), or pass. */
export const QWorkLaneAnswerRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("BOOK_AT"), at: UtcTimestampSchema }).strict(),
  z.object({ kind: z.literal("PASS") }).strict(),
]);
export type QWorkLaneAnswerRequest = z.infer<
  typeof QWorkLaneAnswerRequestSchema
>;

export const QWorkAcceptedDtoSchema = z
  .object({ accepted: z.literal(true) })
  .strict();
export type QWorkAcceptedDto = z.infer<typeof QWorkAcceptedDtoSchema>;

/** The first-stage interview report (spec auto.md §3.1 step 7). */
export const QWorkReportDtoSchema = z
  .object({
    counterpartName: z.string().max(200),
    writtenAt: UtcTimestampSchema,
    headline: z.string().max(200),
    howItWent: z.string().max(800),
    strengths: z
      .array(
        z
          .object({
            point: z.string().max(300),
            basis: z.enum(["CLAIM", "INFERENCE"]),
          })
          .strict(),
      )
      .max(5),
    concerns: z
      .array(
        z
          .object({
            point: z.string().max(300),
            basis: z.enum(["CLAIM", "INFERENCE"]),
          })
          .strict(),
      )
      .max(5),
    openQuestions: z.array(z.string().max(300)).max(5),
    recommendation: z.enum(["PROCEED", "MAYBE", "PASS"]),
    why: z.string().max(500),
    interview: z
      .array(
        z
          .object({
            question: z.string().max(400),
            answer: z.string().max(1_500),
            /** Given by the founder's own Q standing in, not by the founder. */
            byQ: z.boolean().default(false),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
export type QWorkReportDto = z.infer<typeof QWorkReportDtoSchema>;

export const Q_WORK_LANE_REPORT_PATH =
  "/v1/q/work/:delegationId/lanes/:laneId/report" as const;
export const qWorkLaneReportPath = (delegationId: string, laneId: string) =>
  Q_WORK_LANE_REPORT_PATH.replace(
    ":delegationId",
    encodeURIComponent(delegationId),
  ).replace(":laneId", encodeURIComponent(laneId));

// ---------------------------------------------------------------------------
// The grants (the approved payloads): what Q may do, exactly
// ---------------------------------------------------------------------------

export const Q_WORK_OUTREACH_START = "q.work.outreach.start" as const;
export const Q_WORK_STANDIN_START = "q.work.standin.start" as const;

/** When the person takes calls, in their own calendar zone. */
export const QWorkCallWindowSchema = z
  .object({
    /** ISO weekdays, 1 = Monday … 7 = Sunday. */
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
  })
  .strict()
  .refine((window) => window.endHour > window.startHour, {
    message: "a window ends after it starts",
  });
export type QWorkCallWindow = z.infer<typeof QWorkCallWindowSchema>;

/** The investor's approved outreach plan, exactly as approved. */
export const QWorkOutreachGrantSchema = z
  .object({
    maxCompanies: z.number().int().min(1).max(10),
    /** Posted, marked as from Q, once a founder accepts. */
    openingMessage: z.string().trim().min(10).max(1_200),
    /** Everything Q may tell founders. Null: Q answers nothing itself. */
    brief: z.string().trim().min(20).max(2_000).nullable(),
    /** What Q should learn from each founder for the investor. */
    topics: z.array(z.string().trim().min(3).max(200)).max(6),
    /** A first-stage interview in the chat, question by question. */
    interview: z
      .object({
        questions: z.array(z.string().trim().min(5).max(400)).min(1).max(8),
      })
      .strict()
      .nullable(),
    call: z
      .object({
        purpose: z.string().trim().min(3).max(200),
        durationMinutes: z.number().int().min(15).max(120),
        windows: z.array(QWorkCallWindowSchema).min(1).max(7),
        /** Q may book the first free time inside a window without asking. */
        mayBookInWindows: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type QWorkOutreachGrant = z.infer<typeof QWorkOutreachGrantSchema>;

/** The founder's approved stand-in: the brief is the Context Firewall. */
export const QWorkStandInGrantSchema = z
  .object({
    brief: z.string().trim().min(20).max(3_000),
    /** Q steps in after this long without the founder on Capital Q. */
    awayAfterMinutes: z.number().int().min(10).max(1_440),
  })
  .strict();
export type QWorkStandInGrant = z.infer<typeof QWorkStandInGrantSchema>;

export const QWorkOutreachStartPayloadSchema = z
  .object({
    grant: QWorkOutreachGrantSchema,
    expiresInDays: z.number().int().min(1).max(30),
  })
  .strict();
export type QWorkOutreachStartPayload = z.infer<
  typeof QWorkOutreachStartPayloadSchema
>;

export const QWorkStandInStartPayloadSchema = z
  .object({
    grant: QWorkStandInGrantSchema,
    expiresInDays: z.number().int().min(1).max(90),
  })
  .strict();
export type QWorkStandInStartPayload = z.infer<
  typeof QWorkStandInStartPayloadSchema
>;

export const QPresenceRequestSchema = z.object({ away: z.boolean() }).strict();
export type QPresenceRequest = z.infer<typeof QPresenceRequestSchema>;
