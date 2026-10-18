import { z } from "zod";

/**
 * RECOVERY-2026-10 (lead contract): every accepted turn ends in exactly one
 * terminal disposition. Founder live 2026-10-08: a spoken request was
 * heard, Q stayed silent and the voice model improvised; "no request may
 * silently disappear". Voice and text share this contract, so a turn's
 * fate is recorded and shown the same way on both.
 */
export const Q_TURN_DISPOSITIONS = [
  /** Q answered the question. */
  "ANSWERED",
  /** Q asked one short question back, because the request was genuinely ambiguous. */
  "CLARIFIED",
  /** Q did what was asked (navigation, a UI act, a read, a prepared or executed action). */
  "ACTED",
  /** It could not be done; the person was told why and what they can do next. */
  "FAILED",
  /** The person stopped it. */
  "CANCELLED",
  /** A newer turn replaced it before it finished; nothing of it is said. */
  "SUPERSEDED",
  /** Not meant for Q (background speech, another person); deliberately unanswered and shown as such. */
  "IGNORED",
] as const;
export const QTurnDispositionSchema = z.enum(Q_TURN_DISPOSITIONS);
export type QTurnDisposition = z.infer<typeof QTurnDispositionSchema>;

/**
 * Why a turn failed, distinguishable in engineering diagnostics (Section
 * 11 of the recovery brief). The person sees plain words; logs carry this
 * class.
 */
export const Q_FAILURE_CLASSES = [
  "SPEECH_RECOGNITION",
  "MODEL_REASONING",
  "PERMISSION_DENIED",
  "TOOL_UNAVAILABLE",
  "TOOL_FAILED",
  "UI_TARGET_MISSING",
  "NOT_CONFIRMED",
  "RESULT_DELIVERY",
  "SPEECH_PLAYBACK",
  "AGENT_BLOCKED",
  "NETWORK",
  "TIMEOUT",
  "BUDGET",
] as const;
export const QFailureClassSchema = z.enum(Q_FAILURE_CLASSES);
export type QFailureClass = z.infer<typeof QFailureClassSchema>;

/** A turn's identity, stable across voice, text, tools and agent work. */
export const QTurnIdSchema = z.string().regex(/^turn_[A-Za-z0-9_-]{8,64}$/);
export type QTurnId = z.infer<typeof QTurnIdSchema>;

export const QTurnOutcomeSchema = z
  .object({
    turnId: QTurnIdSchema,
    disposition: QTurnDispositionSchema,
    /** FAILED only. */
    failure: QFailureClassSchema.optional(),
    /** What the person was told, if anything (plain words, bounded). */
    said: z.string().max(2_000).optional(),
    /** The newer turn that superseded this one. */
    supersededBy: QTurnIdSchema.optional(),
  })
  .strict()
  .refine((o) => o.disposition !== "FAILED" || o.failure !== undefined, {
    message: "a FAILED turn names its failure class",
  });
export type QTurnOutcome = z.infer<typeof QTurnOutcomeSchema>;

/**
 * Trace correlation carried through every hop of one instruction (Section
 * 11): session, conversation, voice session, turn, run, tool call, agent
 * job. Ids only; never content.
 */
export const QTraceContextSchema = z
  .object({
    turnId: QTurnIdSchema,
    conversationId: z.string().uuid().optional(),
    voiceSessionId: z.string().uuid().optional(),
    runId: z.string().uuid().optional(),
    jobId: z.string().uuid().optional(),
    correlationId: z.string().max(80).optional(),
  })
  .strict();
export type QTraceContext = z.infer<typeof QTraceContextSchema>;
