import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Q's delegated work (AUTO, ADR 0029): an investor's outreach and a
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
    /** The first-stage report (a Q document), when written. */
    reportArtifactId: UuidSchema.nullable(),
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

export const QPresenceRequestSchema = z.object({ away: z.boolean() }).strict();
export type QPresenceRequest = z.infer<typeof QPresenceRequestSchema>;
