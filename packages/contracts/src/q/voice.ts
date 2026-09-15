import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { QConversationIdSchema } from "./ids.js";
import { QSubjectRefsSchema } from "./subject.js";

/**
 * The realtime voice surface (CQ-Q-VOICE-001 C; doc 12 §7.2, §36).
 *
 * Voice is a transport for the one Q. A voice session binds an ElevenLabs
 * Speech Engine conversation to the server-resolved actor and to the thread
 * the person is already in — a Q conversation, an onboarding interview, or
 * both — before the microphone opens. Spoken turns then travel the same
 * paths a typed turn takes; there is no voice database, no voice memory and
 * no voice-only authority. The provider's conversation id is integration
 * metadata, never a Capital Q identity.
 */

/** `POST /v1/q/voice/sessions` — an ephemeral, scoped voice credential. */
export const Q_VOICE_SESSIONS_PATH = "/v1/q/voice/sessions" as const;

/**
 * The WebSocket route the Speech Engine connects to (the resource's
 * `wsUrl` points here through the public hostname of the environment). It
 * carries provider-verified traffic only: every upgrade is checked against
 * the provider's signed header before a session exists.
 */
export const Q_VOICE_WS_PATH = "/v1/q/voice/ws" as const;

export const Q_VOICE_CHOICES = ["FEMALE", "MALE"] as const;
export type QVoiceChoice = (typeof Q_VOICE_CHOICES)[number];
export const QVoiceChoiceSchema = z.enum(Q_VOICE_CHOICES);

export const OnboardingJourneyTypeForVoiceSchema = z.enum([
  "founder",
  "investor",
]);

/**
 * PUBLIC. What a client may say when it asks for a voice session: which
 * thread the microphone joins and which voice Q speaks with. What it may
 * not say, and what fails validation if it tries: who it is, which tenant,
 * what it may see, or which Speech Engine to use. All of that is resolved
 * or chosen on the server.
 */
export const CreateQVoiceSessionRequestSchema = z
  .object({
    /** Continue this Q conversation aloud; absent starts one on the first question. */
    conversationId: QConversationIdSchema.optional(),
    /** The platform subjects spoken questions are about, resolved and authorised server-side. */
    subjects: QSubjectRefsSchema.optional(),
    /**
     * The interview the person is in, so spoken answers reach the same
     * onboarding session their typed answers do. Ownership is enforced by
     * the onboarding runtime on every turn, never assumed from this body.
     */
    onboarding: z
      .object({
        sessionId: UuidSchema,
        journeyType: OnboardingJourneyTypeForVoiceSchema,
      })
      .strict()
      .optional(),
    voice: QVoiceChoiceSchema.default("FEMALE"),
  })
  .strict();

export type CreateQVoiceSessionRequest = z.infer<
  typeof CreateQVoiceSessionRequestSchema
>;

/**
 * PUBLIC. The credential a browser uses to open the microphone session with
 * the Speech Engine. Short-lived and scoped to one conversation; it grants
 * audio transport, nothing in Capital Q. The provider conversation id is
 * returned so a client can correlate its own session, and for no other use.
 */
export const CreateQVoiceSessionResponseSchema = z
  .object({
    voiceSessionId: UuidSchema,
    providerConversationId: z.string().min(1).max(200),
    /** The provider's ephemeral session token. Never the provider API key. */
    token: z.string().min(1).max(8192),
    voice: QVoiceChoiceSchema,
    expiresAt: UtcTimestampSchema,
    /**
     * What Q says first, composed by Q from the interview's state (a
     * greeting and the live question). Absent when Q waits for the person.
     */
    firstMessage: z.string().min(1).max(700).optional(),
  })
  .strict();

export type CreateQVoiceSessionResponse = z.infer<
  typeof CreateQVoiceSessionResponseSchema
>;
