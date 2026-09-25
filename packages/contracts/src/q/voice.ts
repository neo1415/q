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
/** Where the Deepgram Voice Agent brings each turn (OpenAI chat-completions dialect). */
export const Q_VOICE_THINK_PATH = "/v1/q/voice/think" as const;
export const Q_VOICE_PROVIDERS = ["elevenlabs", "deepgram"] as const;
export const QVoiceProviderSchema = z.enum(Q_VOICE_PROVIDERS);
export type QVoiceProvider = z.infer<typeof QVoiceProviderSchema>;
/** GET: what Q is asking, and where it is taking the person, after the latest spoken turn. */
export const Q_VOICE_TURN_PATH =
  "/v1/q/voice/sessions/:voiceSessionId/turn" as const;
export const qVoiceTurnPath = (voiceSessionId: string) =>
  `/v1/q/voice/sessions/${encodeURIComponent(voiceSessionId)}/turn`;

export const Q_VOICE_CHOICES = ["FEMALE", "MALE"] as const;
export type QVoiceChoice = (typeof Q_VOICE_CHOICES)[number];
export const QVoiceChoiceSchema = z.enum(Q_VOICE_CHOICES);

/**
 * `POST /v1/q/voice/speech` — Q says one line, and nothing listens
 * (Q-FIRST-RUN-TTS-001).
 *
 * One-way synthesis, deliberately separate from a voice session. A
 * session is a conversation: it opens a microphone, recognises speech,
 * detects turns and can be interrupted. Hearing Q read the words already
 * on the screen needs none of that, and asking somebody for a microphone
 * in order to play them audio is the kind of permission prompt that
 * teaches people to refuse every prompt.
 *
 * So this is not a session, does not create one, and carries no thread:
 * text in, audio out, no conversation on either side.
 */
export const Q_VOICE_SPEECH_PATH = "/v1/q/voice/speech" as const;

/**
 * The longest line Q will synthesise in one request.
 *
 * Short on purpose. What this is for is a greeting or a line of copy
 * already visible on the screen, not reading a document aloud: a spoken
 * answer is bounded elsewhere too (`SPOKEN_MAX_CHARS`). A caller is
 * authenticated, so this is not the only thing standing between the
 * product and a synthesis bill — but it is the one that makes the cost of
 * a single request knowable.
 */
export const Q_SPEECH_MAX_CHARS = 600;

/** What the browser may ask to hear, and nothing else. */
export const CreateQSpeechRequestSchema = z
  .object({
    /**
     * The words to say. Text, not markup and not a template: whatever is
     * sent is what is synthesised, so it is bounded and validated here
     * rather than trusted because of where it came from.
     */
    text: z.string().trim().min(1).max(Q_SPEECH_MAX_CHARS),
    voice: QVoiceChoiceSchema.default("FEMALE"),
  })
  .strict();
export type CreateQSpeechRequest = z.infer<typeof CreateQSpeechRequestSchema>;

/**
 * What the browser will play. One format, so a response that is anything
 * else is a provider changing its mind rather than something to hand to
 * an audio element.
 */
export const Q_SPEECH_MEDIA_TYPE = "audio/mpeg" as const;

/** Beyond this, the audio is not what was asked for. Bounded playback, bounded memory. */
export const Q_SPEECH_MAX_BYTES = 2 * 1024 * 1024;

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
    /**
     * Q's first minute with a new person: no onboarding session yet. Q
     * introduces itself, learns the person's name and reads which setup
     * to start; the turn state then names the interview to open.
     */
    welcome: z.literal(true).optional(),
    /**
     * What the person said their organisation was called when they signed
     * up, so Q does not open by asking something it was already told.
     *
     * Text a person typed, and treated as such: it is a hint for the
     * greeting and a term for looking them up in public, never a claim
     * about which organisation they belong to. Membership is resolved
     * server-side from their session, as it always is, and nothing here
     * can create or join one.
     */
    organisationHint: z.string().trim().min(1).max(120).optional(),
    /**
     * The thread is already open, so Q does not open it again.
     *
     * Set when a dropped line comes back, when the voice is switched, and
     * when the person turns voice on over a conversation whose question
     * is already on screen. Q composes no opening line and records none:
     * an opening per restore path is how one arrival produced three
     * "Welcome back"s (acceptance fixture, 2026-09-24). What Q says first,
     * if anything, is the line already on screen, supplied by the
     * browser that shows it.
     */
    resume: z.literal(true).optional(),
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
    /** Which transport the browser opens with this credential. */
    provider: QVoiceProviderSchema.default("elevenlabs"),
    /**
     * For the Deepgram transport: the agent settings the browser sends on
     * connect. Composed on the server; the think endpoint inside carries a
     * per-session secret and nothing of the person's Capital Q session.
     */
    deepgram: z
      .object({
        agent: z.record(z.string(), z.unknown()),
        audio: z.record(z.string(), z.unknown()),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CreateQVoiceSessionResponse = z.infer<
  typeof CreateQVoiceSessionResponseSchema
>;

/** Where Q may take the person on a spoken request; the browser maps each to a route. */
export const Q_VOICE_DESTINATIONS = [
  "HOME",
  "PROFILE",
  "CAPITAL",
  "DISCOVER",
  "COMPANY_VISIBILITY",
  "INTERVIEW",
  "INTERVIEW_FOUNDER",
  "INTERVIEW_INVESTOR",
  "FORM",
] as const;
export const QVoiceDestinationSchema = z.enum(Q_VOICE_DESTINATIONS);
export type QVoiceDestination = z.infer<typeof QVoiceDestinationSchema>;

/**
 * PUBLIC. The state of the interview after Q's latest spoken turn, for the
 * screen: which step Q is asking and its options when they help, whether
 * Q is taking the person somewhere, and whether Q has handed the person
 * to the form. Read by the owning person only; nothing here is authority —
 * a tapped option travels the same path as a spoken one.
 */
export const QVoiceTurnStateSchema = z
  .object({
    /** Increments on every turn Q completes; 0 before the first. */
    sequence: z.number().int().min(0),
    asking: z
      .object({
        stepKey: z.string().min(1).max(64),
        kind: z.enum([
          "ONE_OF",
          "MANY_OF",
          "NUMBER",
          "SHORT_TEXT",
          "LONG_TEXT",
          "YES_NO",
          "CATEGORIES",
          "DOCUMENT",
        ]),
        options: z
          .array(
            z
              .object({
                key: z.string().max(64),
                label: z.string().max(120),
                description: z.string().max(300).optional(),
              })
              .strict(),
          )
          .max(50),
        maxChoices: z.number().int().min(1).max(50).optional(),
      })
      .strict()
      .nullable(),
    navigate: QVoiceDestinationSchema.nullable(),
    /** FORM: the interview leaves the person with the form. CHAT: the voice ends and the typed thread stays. */
    handoff: z.enum(["FORM", "CHAT"]).nullable(),
    degraded: z.boolean(),
    /**
     * The Q conversation the spoken turns are recorded in, once one
     * exists, so the screen can show and reopen it (ADR 0012).
     */
    conversationId: QConversationIdSchema.optional(),
  })
  .strict();
export type QVoiceTurnState = z.infer<typeof QVoiceTurnStateSchema>;
