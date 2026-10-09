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
    model: z.string(),
    maxSessionMs: z.number().int().positive(),
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
  })
  .strict();
export type LiveDelegationRequest = z.infer<typeof LiveDelegationRequestSchema>;

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

export const LiveUsageResultSchema = z
  .object({
    recordedSeconds: z.number().int().min(0),
    /** Time left before the hard cap; 0 means close now. */
    remainingMs: z.number().int().min(0),
  })
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
