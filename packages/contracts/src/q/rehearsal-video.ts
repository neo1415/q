import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { VideoAllowanceDtoSchema } from "../common/video-allowance.js";
import { QRehearsalDtoSchema } from "./rehearsals.js";

/**
 * Video rehearsals (ADR 0066): the same rehearsal, met face to face. A
 * stock AI interviewer (a provider face, never a likeness of the real
 * person) gives the rehearsal's existing counterpart a face and a voice;
 * every line it speaks comes from the existing rehearsal service, and the
 * review afterwards is the existing review. A live video session is capped
 * at three minutes, enforced by the Q API (not by the browser).
 */

export const Q_REHEARSAL_VIDEO_INTERVIEWERS_PATH =
  "/v1/q/rehearsals/video/interviewers" as const;
export const Q_REHEARSAL_VIDEO_PATH =
  "/v1/q/rehearsals/:rehearsalId/video" as const;
export const Q_REHEARSAL_VIDEO_END_PATH =
  "/v1/q/rehearsals/:rehearsalId/video/end" as const;
/**
 * The bridge the video provider calls for each line (OpenAI-compatible
 * `/chat/completions` beneath it). Not cookie-authenticated: a per-session
 * bearer the Q API issued, never the founder's own token.
 */
export const Q_REHEARSAL_VIDEO_BRIDGE_BASE_PATH =
  "/v1/q/rehearsals/video/bridge/:videoSessionId" as const;

/** The hard cap on one live video session, in seconds. */
export const REHEARSAL_VIDEO_MAX_SECONDS = 180 as const;

const enc = encodeURIComponent;
export const qRehearsalVideoPath = (rehearsalId: string) =>
  Q_REHEARSAL_VIDEO_PATH.replace(":rehearsalId", enc(rehearsalId));
export const qRehearsalVideoEndPath = (rehearsalId: string) =>
  Q_REHEARSAL_VIDEO_END_PATH.replace(":rehearsalId", enc(rehearsalId));
export const qRehearsalVideoBridgeBasePath = (videoSessionId: string) =>
  Q_REHEARSAL_VIDEO_BRIDGE_BASE_PATH.replace(
    ":videoSessionId",
    enc(videoSessionId),
  );

/** A catalogue id: reference data in server configuration, never an enum. */
export const RehearsalInterviewerIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,47}$/u);

export const RehearsalInterviewerDtoSchema = z
  .object({
    id: RehearsalInterviewerIdSchema,
    /** The stock face's display name, e.g. "Steve". */
    name: z.string().min(1).max(80),
    /** How this interviewer questions, in a few words. */
    style: z.string().min(1).max(160),
    /** False: planned, shown but not selectable yet. */
    available: z.boolean(),
  })
  .strict();
export type RehearsalInterviewerDto = z.infer<
  typeof RehearsalInterviewerDtoSchema
>;

export const RehearsalInterviewersDtoSchema = z
  .object({
    /** False when video is not configured: the voice room is the way in. */
    videoAvailable: z.boolean(),
    maxSeconds: z.literal(REHEARSAL_VIDEO_MAX_SECONDS),
    interviewers: z.array(RehearsalInterviewerDtoSchema).max(12),
    /** Video sessions left this week, shared with GateQ; optional for rollout. */
    allowance: VideoAllowanceDtoSchema.nullable().optional(),
  })
  .strict();
export type RehearsalInterviewersDto = z.infer<
  typeof RehearsalInterviewersDtoSchema
>;

export const StartRehearsalVideoRequestSchema = z
  .object({ interviewerId: RehearsalInterviewerIdSchema })
  .strict();
export type StartRehearsalVideoRequest = z.infer<
  typeof StartRehearsalVideoRequestSchema
>;

export const REHEARSAL_VIDEO_STATUSES = ["LIVE", "ENDED"] as const;
export const REHEARSAL_VIDEO_ENDED_REASONS = [
  "FOUNDER_ENDED",
  "TIME_LIMIT",
  "CONTINUED_BY_VOICE",
  "PROVIDER_ENDED",
] as const;

export const RehearsalVideoSessionDtoSchema = z
  .object({
    id: UuidSchema,
    rehearsalId: UuidSchema,
    interviewer: RehearsalInterviewerDtoSchema,
    status: z.enum(REHEARSAL_VIDEO_STATUSES),
    /**
     * The provider room to embed, with its single-use join token; null once
     * the session has ended. Only ever returned to the rehearsal's founder.
     */
    joinUrl: z.string().url().max(2_000).nullable(),
    startedAt: UtcTimestampSchema,
    /** Fixed when the session is created; a reconnect never extends it. */
    endsAt: UtcTimestampSchema,
    maxSeconds: z.literal(REHEARSAL_VIDEO_MAX_SECONDS),
    endedReason: z.enum(REHEARSAL_VIDEO_ENDED_REASONS).nullable(),
    /** Shown on screen for the whole call. */
    disclosure: z.string().min(1).max(300),
  })
  .strict();
export type RehearsalVideoSessionDto = z.infer<
  typeof RehearsalVideoSessionDtoSchema
>;

/**
 * Starting video either opens the session or says to continue the same
 * rehearsal in the existing voice room (video not configured, the provider
 * unavailable). A fallback is an answer, not an error.
 */
export const StartRehearsalVideoResponseSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("VIDEO"),
      session: RehearsalVideoSessionDtoSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal("VOICE_FALLBACK"),
      reason: z.enum([
        "NOT_CONFIGURED",
        "PROVIDER_UNAVAILABLE",
        "ALLOWANCE_EXHAUSTED",
        "CONCURRENCY_LIMIT",
      ]),
    })
    .strict(),
]);
export type StartRehearsalVideoResponse = z.infer<
  typeof StartRehearsalVideoResponseSchema
>;

export const EndRehearsalVideoRequestSchema = z
  .object({
    /**
     * True: the founder carries on in the voice room, so the rehearsal stays
     * open. Otherwise the rehearsal is finished and its review written.
     */
    continueByVoice: z.boolean().optional(),
  })
  .strict();
export type EndRehearsalVideoRequest = z.infer<
  typeof EndRehearsalVideoRequestSchema
>;

export const EndRehearsalVideoResponseSchema = z
  .object({
    session: RehearsalVideoSessionDtoSchema,
    rehearsal: QRehearsalDtoSchema,
  })
  .strict();
export type EndRehearsalVideoResponse = z.infer<
  typeof EndRehearsalVideoResponseSchema
>;
