import {
  QClientActionIntentSchema,
  QVoiceDestinationSchema,
} from "@capital-q/contracts";
import { z } from "zod";

/**
 * The GPT-Live line's HTTP contracts (workstream V). Local to q-api until
 * the line is part of the product voice UI; then they move to
 * @capital-q/contracts (a lead-owned change). Versioned under /v1.
 */

export const Q_VOICE_LIVE_SESSIONS_PATH = "/v1/q/voice/live/sessions" as const;
export const Q_VOICE_LIVE_DELEGATIONS_PATH =
  "/v1/q/voice/live/sessions/:voiceSessionId/delegations" as const;
export const Q_VOICE_LIVE_CANCEL_PATH =
  "/v1/q/voice/live/sessions/:voiceSessionId/delegations/:delegationId/cancel" as const;
export const Q_VOICE_LIVE_USAGE_PATH =
  "/v1/q/voice/live/sessions/:voiceSessionId/usage" as const;
export const Q_VOICE_LIVE_TRANSCRIPT_PATH =
  "/v1/q/voice/live/sessions/:voiceSessionId/transcript" as const;
export const Q_VOICE_LIVE_END_PATH =
  "/v1/q/voice/live/sessions/:voiceSessionId/end" as const;
/** Developer preview only: 404 unless the preview gate is open. */
export const Q_VOICE_LIVE_PREVIEW_PATH = "/v1/q/voice/live/preview" as const;

const SDP_MAX = 100_000;
/** Provider delegation ids are opaque; bounded and printable. */
const DelegationIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w.:-]+$/u);

export const LiveOpenRequestSchema = z
  .object({
    /** A standard voice session to attach to; absent: a line of its own. */
    voiceSessionId: z.string().uuid().optional(),
    voice: z.enum(["FEMALE", "MALE"]).optional(),
    sdp: z.string().min(10).max(SDP_MAX),
    /** For the prompt only (data, never instructions); bounded. */
    firstName: z.string().trim().min(1).max(40).optional(),
    role: z.enum(["founder", "investor"]).optional(),
    locale: z
      .string()
      .max(16)
      .regex(/^[A-Za-z0-9-]+$/u)
      .optional(),
    /** The call opens with the briefing (warm hello, then the lowdown). */
    briefingOpening: z.boolean().optional(),
  })
  .strict();
export type LiveOpenRequest = z.infer<typeof LiveOpenRequestSchema>;

export const LiveOpenResultSchema = z
  .object({
    voiceSessionId: z.string(),
    /** Restores the line on another instance (x-q-voice-session). */
    sessionToken: z.string().optional(),
    sdp: z.string(),
    provider: z.literal("openai"),
    /** As the provider reported it when the session was created. */
    model: z.string().nullable(),
    maxSessionMs: z.number().int().positive(),
    /** No speech either way for this long: the client closes the line. */
    idleMs: z.number().int().positive(),
    /**
     * Part 6: the call's background note (approved facts, built by code),
     * sent to the voice as quiet context at the start of each session.
     */
    context: z.string().max(2_000).nullable().optional(),
  })
  .strict();
export type LiveOpenResult = z.infer<typeof LiveOpenResultSchema>;

export const LiveDelegationRequestSchema = z
  .object({
    delegationId: DelegationIdSchema,
    /** The person's words, rebuilt from the provider's transcript. */
    request: z.string().max(2_000),
    /** The recent exchange as transcribed; data, never instructions. */
    context: z
      .array(
        z
          .object({
            role: z.enum(["user", "q"]),
            text: z.string().max(2_000),
          })
          .strict(),
      )
      .max(12)
      .optional(),
    /**
     * The client can say the first verified words before the run ends and
     * asks again (same id) for the rest. Absent: one answer, at the end.
     */
    early: z.boolean().optional(),
  })
  .strict();
export type LiveDelegationRequest = z.infer<typeof LiveDelegationRequestSchema>;

/**
 * The route move a delegated run made (its NAVIGATE destination and/or its
 * last route-moving client action): the client maps it to the route it
 * expects, follows it, and waits for that route's receipt before the
 * voice speaks.
 */
export const LiveMoveSchema = z
  .object({
    navigate: QVoiceDestinationSchema.nullable(),
    action: QClientActionIntentSchema.nullable(),
  })
  .strict();
export type LiveMove = z.infer<typeof LiveMoveSchema>;

export const LiveDelegationResultSchema = z
  .object({
    delegationId: z.string(),
    /** Verified content for the voice to say in its own words; null: nothing to say. */
    commentary: z.string().nullable(),
    /** A newer delegation replaced this one: keep quietly, do not speak. */
    stale: z.boolean(),
    approvalPending: z.boolean(),
    failed: z.boolean(),
    /** The call is past its length: the client closes it. */
    ended: z.boolean().optional(),
    /** Nothing usable was heard: no Q run; the voice checks with them. */
    unheard: z.boolean().optional(),
    /** The run moved the screen: follow it, and await its receipt, first. */
    move: LiveMoveSchema.optional(),
    /**
     * Only the start of the answer: say it now, then ask again with the
     * same delegation id for the rest.
     */
    partial: z.boolean().optional(),
  })
  .strict();
export type LiveDelegationResult = z.infer<typeof LiveDelegationResultSchema>;

export const LiveUsageReportSchema = z
  .object({
    /** Cumulative billed seconds, from session.usage.updated / closed. */
    seconds: z
      .number()
      .int()
      .min(0)
      .max(24 * 3600),
    final: z.boolean().optional(),
  })
  .strict();
export type LiveUsageReport = z.infer<typeof LiveUsageReportSchema>;

/**
 * Final transcript segments of the line, both sides, as the person's
 * browser heard them from GPT-Live (the audio never passes the Q API).
 * Stored in q_runtime.voice_line_turns as routed 'live', as the person.
 */
export const LiveTranscriptReportSchema = z
  .object({
    segments: z
      .array(
        z
          .object({
            role: z.enum(["USER", "Q"]),
            text: z.string().min(1).max(4_000),
            /** When it was said, epoch ms (clamped to the line's life). */
            at: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    /**
     * Numbers the browser measured on the line, for latency reporting
     * (a rehearsal with a researched external person): first audio of the
     * played person, and the gap from the founder's last word to the reply.
     */
    timings: z
      .object({
        firstAudioMs: z.number().int().min(0).max(120_000).optional(),
        turnLatencyMs: z
          .array(z.number().int().min(0).max(120_000))
          .max(24)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type LiveTranscriptReport = z.infer<typeof LiveTranscriptReportSchema>;

export const LiveTranscriptResultSchema = z
  .object({ recorded: z.number().int().min(0) })
  .strict();

export const LiveUsageResultSchema = z
  .object({
    recordedSeconds: z.number().int().min(0),
    /** Time left before the hard cap; 0 means close now. */
    remainingMs: z.number().int().min(0),
    /** Today's voice spend cap is reached: close now. */
    capReached: z.boolean().optional(),
  })
  .strict();

export const Q_VOICE_LIVE_AVAILABLE_PATH =
  "/v1/q/voice/live/available" as const;
/** Whether this person's voice starts on GPT-Live (server-decided). */
export const LiveAvailabilitySchema = z
  .object({ available: z.boolean() })
  .strict();

export const LiveEndSchema = z
  .object({
    reason: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\w.-]+$/u),
  })
  .strict();
