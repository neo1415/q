import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { QLocaleSchema } from "./context.js";
import { QConversationIdSchema } from "./ids.js";
import { QVoicePresenceSchema } from "./presence.js";
import { QScreenContextSchema, QViewingMomentSchema } from "./request.js";
import { QSilenceBeatSchema } from "./silence-ladder.js";
import { QSubjectRefsSchema } from "./subject.js";
import { QFailureClassSchema, QTurnDispositionSchema } from "./turn.js";
import { QClientActionIntentSchema } from "./ui-intent.js";

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

/**
 * The sounds Q makes, each with its own tune (founder live 2026-09-29):
 * a flat "Hmm." while it thinks, a low "Mm..." as it considers, a rising
 * "Hm?" before it asks something back. Voiced, never part of an answer,
 * and named here so the transcript can leave them out too. The speech
 * model reads the tune from the punctuation.
 */
export const Q_VOICE_HM_BEATS = ["Hmm.", "Hm.", "Mm..."] as const;
export const Q_VOICE_HUM_BEATS = ["Mmm..."] as const;
export const Q_VOICE_QUESTION_BEAT = "Hm?" as const;
export const Q_VOICE_THINKING_BEATS: ReadonlySet<string> = new Set([
  ...Q_VOICE_HM_BEATS,
  ...Q_VOICE_HUM_BEATS,
  Q_VOICE_QUESTION_BEAT,
]);
export const Q_VOICE_PROVIDERS = ["elevenlabs", "deepgram"] as const;
export const QVoiceProviderSchema = z.enum(Q_VOICE_PROVIDERS);
export type QVoiceProvider = z.infer<typeof QVoiceProviderSchema>;
/** GET: what Q is asking, and where it is taking the person, after the latest spoken turn. */
export const Q_VOICE_TURN_PATH =
  "/v1/q/voice/sessions/:voiceSessionId/turn" as const;
export const qVoiceTurnPath = (voiceSessionId: string) =>
  `/v1/q/voice/sessions/${encodeURIComponent(voiceSessionId)}/turn`;
/**
 * POST: the screen the person is on now, while the line is open (R21).
 * The body is a QScreenContext; spoken turns carry it like typed ones.
 * Owner only; a request, never authority (resolved per run or dropped).
 */
export const Q_VOICE_SCREEN_PATH =
  "/v1/q/voice/sessions/:voiceSessionId/screen" as const;

/**
 * The body of Q_VOICE_SCREEN_PATH: the screen, plus the pitch moment on it
 * when one is playing or paused (R18). A spoken "what is this about?" has
 * no other channel for `viewing`; like a typed turn's, it is authorised
 * for the asker on each run or dropped.
 */
export const QVoiceScreenUpdateSchema = z
  .object({
    ...QScreenContextSchema.shape,
    viewing: QViewingMomentSchema.optional(),
  })
  .strict();
export type QVoiceScreenUpdate = z.infer<typeof QVoiceScreenUpdateSchema>;
export const qVoiceScreenPath = (voiceSessionId: string) =>
  `/v1/q/voice/sessions/${encodeURIComponent(voiceSessionId)}/screen`;

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
     * R18: the pitch being watched while speaking. Authorised server-side
     * with the playback rule, or dropped as if absent.
     */
    viewing: QViewingMomentSchema.optional(),
    /** R21: the screen the line was opened on; later moves arrive by Q_VOICE_SCREEN_PATH. */
    screen: QScreenContextSchema.optional(),
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
    /**
     * REHEARSE: the line carries a rehearsal, so every spoken turn goes to
     * that rehearsal (Q plays the other person) and nothing else. Ownership
     * is checked by the rehearsal service on every turn.
     */
    rehearsal: z.object({ rehearsalId: UuidSchema }).strict().optional(),
    /**
     * The device's language (BCP 47, from the browser), so a person who
     * speaks another language is heard and answered in it (founder
     * direction 2026-10-01). A preference, never authority.
     */
    locale: QLocaleSchema.optional(),
    /**
     * DUPLEX: the browser could not hold a full-duplex line (or one just
     * ended), so the standard line is wanted. A downgrade only: nothing a
     * client sends can turn full duplex on; the server decides that.
     */
    duplex: z.literal(false).optional(),
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
    /**
     * The line's sealed session: presented back (header
     * `x-q-voice-session`) on the turn and screen routes, so any instance
     * of the Q API -- after a deploy or a restart -- still knows the line.
     * Opaque to the browser; it authorises nothing without the person's
     * own session.
     */
    sessionToken: z.string().min(1).max(8192).optional(),
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
    /**
     * DUPLEX: present when the server brokered a full-duplex line for this
     * session. The browser tries it first; the rest of this credential is
     * the standard line, used as it is the moment the duplex one fails.
     */
    duplex: z.lazy(() => QVoiceDuplexCredentialSchema).optional(),
  })
  .strict();

export type CreateQVoiceSessionResponse = z.infer<
  typeof CreateQVoiceSessionResponseSchema
>;

// ---------------------------------------------------------------------------
// DUPLEX: full-duplex voice (flag CQ_VOICE_REALTIME, off by default).
//
// The server authorises the person, computes the Context Firewall plan and
// checks the spend caps, then mints a short-lived client secret through the
// Model Gateway. The browser opens the audio line with that secret only;
// every tool the model calls comes back here, and every response's usage is
// reported here for the daily cap. None of these shapes names a vendor.
// ---------------------------------------------------------------------------

/**
 * BACKCHANNEL (duplex only): how much Q reacts while the person is still
 * talking ("mm", "oh no", "right") and whether it bridges a slow answer
 * with a short line. OFF is silence until Q answers; SUBTLE (the default)
 * is sparse; NATURAL reacts about as often as an attentive person. The
 * words are always the model's; the level only bounds when and how often.
 * Reference data, persisted as a per-person memory preference.
 */
export const Q_VOICE_LISTENING_LEVELS = ["OFF", "SUBTLE", "NATURAL"] as const;
export const QVoiceListeningLevelSchema = z.enum(Q_VOICE_LISTENING_LEVELS);
export type QVoiceListeningLevel = z.infer<typeof QVoiceListeningLevelSchema>;
export const Q_VOICE_LISTENING_DEFAULT: QVoiceListeningLevel = "SUBTLE";

/** What the line needs to listen like a person, composed on the server. */
export const QVoiceDuplexListeningSchema = z
  .object({
    /** The person's remembered level, or the default. */
    level: QVoiceListeningLevelSchema,
    /** When they last set it by voice; null when never (the default). */
    setAt: UtcTimestampSchema.nullable(),
    /** The rules for a reaction while they talk (server-owned prompt). */
    backchannelInstructions: z.string().min(1).max(4_000),
    /** The rules for a short bridging line while an answer is slow. */
    bridgeInstructions: z.string().min(1).max(4_000),
  })
  .strict();
export type QVoiceDuplexListening = z.infer<typeof QVoiceDuplexListeningSchema>;

export const QVoiceDuplexCredentialSchema = z
  .object({
    /** Ephemeral, minted server-side for this one line. Never an API key. */
    clientSecret: z.string().min(1).max(8192),
    /** Where the browser sends its session offer, with the secret. */
    callsUrl: z.string().url().max(500),
    /** The secret's own expiry: the line must be opened before this. */
    expiresAt: UtcTimestampSchema,
    /** The line ends (and the standard one takes over) after this long. */
    maxSessionMs: z.number().int().min(10_000).max(3_600_000),
    /** Silence for this long ends the line. */
    idleMs: z.number().int().min(5_000).max(600_000),
    /** BACKCHANNEL: absent when the server has them switched off. */
    listening: QVoiceDuplexListeningSchema.optional(),
    /**
     * VOICE-BRAIN (founder live 2026-10-08): the realtime model is only
     * the voice. It never answers a turn by itself: the line was minted
     * without automatic responses, the browser sends each finished turn's
     * transcript to the server (`heard`), and the server decides whether
     * Q answers it (ask_q) or the voice may (small talk).
     */
    routeTurns: z.boolean().optional(),
  })
  .strict();
export type QVoiceDuplexCredential = z.infer<
  typeof QVoiceDuplexCredentialSchema
>;

/** POST: one function call the duplex model proposed, relayed for execution. */
export const Q_VOICE_DUPLEX_TOOL_PATH =
  "/v1/q/voice/sessions/:voiceSessionId/duplex/tool" as const;
export const qVoiceDuplexToolPath = (voiceSessionId: string) =>
  `/v1/q/voice/sessions/${encodeURIComponent(voiceSessionId)}/duplex/tool`;
/** POST: one response's token usage, for the spend cap. */
export const Q_VOICE_DUPLEX_USAGE_PATH =
  "/v1/q/voice/sessions/:voiceSessionId/duplex/usage" as const;
export const qVoiceDuplexUsagePath = (voiceSessionId: string) =>
  `/v1/q/voice/sessions/${encodeURIComponent(voiceSessionId)}/duplex/usage`;
/** POST: the duplex line ended; its reservation is released. */
export const Q_VOICE_DUPLEX_END_PATH =
  "/v1/q/voice/sessions/:voiceSessionId/duplex/end" as const;
export const qVoiceDuplexEndPath = (voiceSessionId: string) =>
  `/v1/q/voice/sessions/${encodeURIComponent(voiceSessionId)}/duplex/end`;
/** POST: a fresh realtime call for the same line after a drop (I1). */
export const Q_VOICE_DUPLEX_REJOIN_PATH =
  "/v1/q/voice/sessions/:voiceSessionId/duplex/rejoin" as const;
export const qVoiceDuplexRejoinPath = (voiceSessionId: string) =>
  `/v1/q/voice/sessions/${encodeURIComponent(voiceSessionId)}/duplex/rejoin`;

/**
 * POST (long poll): the silence ladder's beats on a duplex line while an
 * ask_q is working (ADR 0062). The browser voices each out of band, with
 * fixed text, so none enters the conversation. Owner only.
 */
export const Q_VOICE_DUPLEX_NARRATION_PATH =
  "/v1/q/voice/sessions/:voiceSessionId/duplex/narration" as const;
export const qVoiceDuplexNarrationPath = (voiceSessionId: string) =>
  `/v1/q/voice/sessions/${encodeURIComponent(voiceSessionId)}/duplex/narration`;
export const QVoiceDuplexNarrationRequestSchema = z
  .object({ after: z.number().int().min(0) })
  .strict();
export type QVoiceDuplexNarrationRequest = z.infer<
  typeof QVoiceDuplexNarrationRequestSchema
>;
export const QVoiceDuplexNarrationResultSchema = z
  .object({
    beats: z
      .array(
        z
          .object({
            sequence: z.number().int().min(1),
            beat: QSilenceBeatSchema,
          })
          .strict(),
      )
      .max(8),
    /** No ask_q is working on the line: stop asking. */
    idle: z.boolean(),
  })
  .strict();
export type QVoiceDuplexNarrationResult = z.infer<
  typeof QVoiceDuplexNarrationResultSchema
>;

/** A model's proposal: untrusted input, validated again by the tool pipeline. */
export const QVoiceDuplexToolCallSchema = z
  .object({
    callId: z.string().min(1).max(128),
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
    /** The arguments as the model wrote them (JSON text). */
    arguments: z.string().max(8_000),
    /**
     * BACKCHANNEL, set_listening only: the provider's transcripts of the
     * person's latest turns (not the model's words), so the memory Write
     * Gate can check the quote against what was actually said.
     */
    heard: z.array(z.string().max(600)).max(4).optional(),
    /** BACKCHANNEL, set_listening only: the level the line is using now. */
    listening: QVoiceListeningLevelSchema.optional(),
  })
  .strict();
export type QVoiceDuplexToolCall = z.infer<typeof QVoiceDuplexToolCallSchema>;

export const QVoiceDuplexToolResultSchema = z
  .object({
    /** What goes back to the model as the call's output (JSON text). */
    output: z.string().max(16_000),
    /** Something now waits on screen for the person's approval. */
    approvalPending: z.boolean(),
    /** BACKCHANNEL: the line's new listening level, applied at once. */
    listening: QVoiceListeningLevelSchema.optional(),
    /**
     * Q chose to say nothing (C-01, audit 2026-10-08): the same flag the
     * heard result carries. Missing here, a silent ask_q the model called
     * failed the strict parse and the voice said "that did not get through".
     */
    silent: z.boolean().optional(),
    /** RECOVERY-2026-10: how this turn ended on the server (A4). */
    disposition: QTurnDispositionSchema.optional(),
    /** FAILED only: why, for diagnostics; the person hears plain words. */
    failure: QFailureClassSchema.optional(),
  })
  .strict();
export type QVoiceDuplexToolResult = z.infer<
  typeof QVoiceDuplexToolResultSchema
>;

/**
 * POST: one finished turn of the person's on a routed duplex line, as the
 * provider transcribed it (or as they typed it). The server decides who
 * answers: Q (it runs ask_q itself and returns the result for the voice
 * to say) or the voice (small talk; a reply to a card in focus).
 */
export const Q_VOICE_DUPLEX_HEARD_PATH =
  "/v1/q/voice/sessions/:voiceSessionId/duplex/heard" as const;
export const qVoiceDuplexHeardPath = (voiceSessionId: string) =>
  `/v1/q/voice/sessions/${encodeURIComponent(voiceSessionId)}/duplex/heard`;
export const QVoiceDuplexHeardSchema = z
  .object({
    /** The provider's item id for the turn (null when typed). */
    itemId: z.string().min(1).max(128).nullable(),
    /** The provider's transcript of the person: untrusted input. */
    transcript: z.string().min(1).max(2_000),
    typed: z.boolean().optional(),
    /** A decision card is in focus on their screen (decide_card). */
    cardInFocus: z.boolean().optional(),
  })
  .strict();
export type QVoiceDuplexHeard = z.infer<typeof QVoiceDuplexHeardSchema>;

export const Q_VOICE_DUPLEX_ROUTES = ["ASK_Q", "SMALLTALK", "MODEL"] as const;
export const QVoiceDuplexHeardResultSchema = z.discriminatedUnion("route", [
  z
    .object({
      route: z.literal("ASK_Q"),
      /** The call the browser records on the line, then its output. */
      callId: z.string().min(1).max(128),
      arguments: z.string().max(8_000),
      output: z.string().max(16_000),
      approvalPending: z.boolean(),
      /**
       * Q chose to say nothing (words that were only the room): the voice
       * is not asked to speak, so it never improvises a reply of its own
       * (live 2026-10-08: "could you give me a bit more detail?").
       */
      silent: z.boolean().optional(),
      /** RECOVERY-2026-10: how this turn ended on the server (A4). */
      disposition: QTurnDispositionSchema.optional(),
      /** FAILED only: why, for diagnostics. */
      failure: QFailureClassSchema.optional(),
      /**
       * SIDEBAND: the server already put the answer on the call and asked
       * the voice to say it; the browser must not send it again.
       */
      delivered: z.literal("SERVER").optional(),
    })
    .strict(),
  z.object({ route: z.literal("SMALLTALK") }).strict(),
  z.object({ route: z.literal("MODEL") }).strict(),
]);
export type QVoiceDuplexHeardResult = z.infer<
  typeof QVoiceDuplexHeardResultSchema
>;

/** POST: what the voice said in one response (the transcript's Q side). */
export const Q_VOICE_DUPLEX_SAID_PATH =
  "/v1/q/voice/sessions/:voiceSessionId/duplex/said" as const;
export const qVoiceDuplexSaidPath = (voiceSessionId: string) =>
  `/v1/q/voice/sessions/${encodeURIComponent(voiceSessionId)}/duplex/said`;
export const QVoiceDuplexSaidSchema = z
  .object({
    responseId: z.string().min(1).max(128),
    text: z.string().min(1).max(4_000),
  })
  .strict();
export type QVoiceDuplexSaid = z.infer<typeof QVoiceDuplexSaidSchema>;

/**
 * POST (RECOVERY A4): how one turn on the line ended, with its timings,
 * for the server's per-turn log. Ids and milliseconds only, never words.
 */
export const Q_VOICE_DUPLEX_OUTCOME_PATH =
  "/v1/q/voice/sessions/:voiceSessionId/duplex/outcome" as const;
export const qVoiceDuplexOutcomePath = (voiceSessionId: string) =>
  `/v1/q/voice/sessions/${encodeURIComponent(voiceSessionId)}/duplex/outcome`;
const TurnMsSchema = z.number().int().min(0).max(600_000);
export const QVoiceDuplexTurnReportSchema = z
  .object({
    turnId: z.string().regex(/^turn_[A-Za-z0-9_-]{8,64}$/),
    disposition: QTurnDispositionSchema,
    failure: QFailureClassSchema.optional(),
    /** End of their turn to Q's first audio. */
    firstAudioMs: TurnMsSchema.optional(),
    /** The heard relay's round trip. */
    relayMs: TurnMsSchema.optional(),
  })
  .strict();
export type QVoiceDuplexTurnReport = z.infer<
  typeof QVoiceDuplexTurnReportSchema
>;

/**
 * POST (RECOVERY A8, SIDEBAND): the realtime call's id, from the SDP
 * answer's Location header, so the server can attach to the call. Only
 * acted on when the sideband is on; the id alone grants nothing without
 * the server's own provider key.
 */
export const Q_VOICE_DUPLEX_ATTACH_PATH =
  "/v1/q/voice/sessions/:voiceSessionId/duplex/attach" as const;
export const qVoiceDuplexAttachPath = (voiceSessionId: string) =>
  `/v1/q/voice/sessions/${encodeURIComponent(voiceSessionId)}/duplex/attach`;
export const QVoiceDuplexAttachSchema = z
  .object({ callId: z.string().regex(/^rtc_[A-Za-z0-9_-]{1,120}$/) })
  .strict();
export type QVoiceDuplexAttach = z.infer<typeof QVoiceDuplexAttachSchema>;

const TokenCountSchema = z.number().int().min(0).max(2_000_000);

/** One response's usage, as the model reported it, by modality. */
export const QVoiceDuplexUsageReportSchema = z
  .object({
    /** The model's id for the response: one report per response is counted. */
    responseId: z.string().min(1).max(128),
    /**
     * What produced it. RESPONSE (default): a turn. BACKCHANNEL and
     * BRIDGE: Q's out-of-band reactions. TRANSCRIPTION: the input
     * transcription model, priced at its own rates. All count toward the
     * same VOICE_REALTIME ledger and daily cap.
     */
    kind: z
      .enum(["RESPONSE", "BACKCHANNEL", "BRIDGE", "TRANSCRIPTION"])
      .optional(),
    inputTextTokens: TokenCountSchema,
    inputAudioTokens: TokenCountSchema,
    cachedTextTokens: TokenCountSchema,
    cachedAudioTokens: TokenCountSchema,
    outputTextTokens: TokenCountSchema,
    outputAudioTokens: TokenCountSchema,
  })
  .strict();
export type QVoiceDuplexUsageReport = z.infer<
  typeof QVoiceDuplexUsageReportSchema
>;

export const QVoiceDuplexUsageResultSchema = z
  .object({
    /** False: end the duplex line now and carry on on the standard one. */
    continue: z.boolean(),
    /** One line for the person, when they should know why. */
    notice: z.string().min(1).max(300).optional(),
  })
  .strict();
export type QVoiceDuplexUsageResult = z.infer<
  typeof QVoiceDuplexUsageResultSchema
>;

/** Why a duplex line handed over to the standard voice. */
export const Q_VOICE_DUPLEX_FALLBACK_CAUSES = [
  "CONNECT",
  "NETWORK",
  "RELAY",
  "CAP",
  "MAX_LENGTH",
] as const;

/**
 * What the line measured, sent with its end (I1, Dubai demo 2026-10-05:
 * the server knew only "FALLBACK", never why). Measurements, never words.
 */
export const QVoiceDuplexLineStatsSchema = z
  .object({
    /** Times the line rejoined after a drop or its length limit. */
    rejoins: z.number().int().min(0).max(1_000),
    /** Seconds the line spent weak (loss, jitter or round trip high). */
    weakSeconds: z.number().int().min(0).max(86_400),
    /** Worst one-second packet loss seen, in percent. */
    worstLossPct: z.number().min(0).max(100).nullable(),
    worstJitterMs: z.number().int().min(0).max(600_000).nullable(),
    worstRttMs: z.number().int().min(0).max(600_000).nullable(),
    /** End of the person's turn to Q's first audio, in ms. */
    firstAudioMsP50: z.number().int().min(0).max(600_000).nullable(),
    firstAudioMsMax: z.number().int().min(0).max(600_000).nullable(),
    turns: z.number().int().min(0).max(100_000),
  })
  .strict();
export type QVoiceDuplexLineStats = z.infer<typeof QVoiceDuplexLineStatsSchema>;

export const QVoiceDuplexEndSchema = z
  .object({
    reason: z.enum(["ENDED", "IDLE", "MAX_LENGTH", "FALLBACK"]),
    cause: z.enum(Q_VOICE_DUPLEX_FALLBACK_CAUSES).optional(),
    stats: QVoiceDuplexLineStatsSchema.optional(),
  })
  .strict();
export type QVoiceDuplexEnd = z.infer<typeof QVoiceDuplexEndSchema>;

/**
 * POST: the line dropped (or reached its length) and the browser wants a
 * fresh realtime call for the same line, the same voice and the same
 * conversation, instead of handing over to the standard voice.
 */
export const QVoiceDuplexRejoinSchema = z
  .object({
    cause: z.enum(["NETWORK", "MAX_LENGTH", "RELAY"]),
  })
  .strict();
export type QVoiceDuplexRejoin = z.infer<typeof QVoiceDuplexRejoinSchema>;

/** A fresh credential, or no line (with a sentence when the person should know). */
export const QVoiceDuplexRejoinResultSchema = z
  .object({
    credential: QVoiceDuplexCredentialSchema.optional(),
    notice: z.string().min(1).max(300).optional(),
  })
  .strict();
export type QVoiceDuplexRejoinResult = z.infer<
  typeof QVoiceDuplexRejoinResultSchema
>;

/** Where Q may take the person on a spoken request; the browser maps each to a route. */
export const Q_VOICE_DESTINATIONS = [
  "HOME",
  "PROFILE",
  "CAPITAL",
  "DISCOVER",
  "COMPANY_VISIBILITY",
  "RELATIONSHIPS",
  "SETTINGS",
  "VERIFICATION",
  "PITCH",
  "COMPANY_INTEREST",
  "SAVED",
  "INVESTORS",
  "SEARCH",
  "GATEWAY",
  "MEMORY",
  // Lead 2026-10-03: what Q used for them this month.
  "USAGE",
  "NEW_PITCH",
  "REHEARSALS",
  // DOCS: their documents and brand kit.
  "DOCUMENTS",
  // DAILY: The Q Daily, their newspaper and its archive.
  "DAILY",
  // Results: what their activity on Capital Q produced, with reports.
  "RESULTS",
  // The Passed list (/discover/passed).
  "PASSED",
  // follow-55: Discover's "Your companies" tab (an investor's own companies).
  "YOUR_COMPANIES",
  // WORK-58: Q's work page ("show my work", "what's Q doing").
  "WORK",
  // voice-cards (Zino 2026-10-08: "take me to the explore page" went to
  // Discover, twice): every page and tab a person can open has its own
  // name, so nothing is ever approximated by a neighbour.
  "EXPLORE",
  "PEOPLE_SEARCH",
  "WORK_NEEDS",
  "WORK_PROGRESS",
  "WORK_DONE",
  "WORK_TEAM",
  "WORK_COST",
  "GATEQ_INBOX",
  "GATEQ_FIND",
  "GATEQ_CLAIM",
  "GATEQ_APPLICATIONS",
  "SAVED_COMPARE",
  "REVIEWS",
  "TOP_INVESTORS",
  // capital-tabs (2026-10-08): a founder's Capital page, by its tabs
  // (CAPITAL itself opens Overview).
  "CAPITAL_RAISE",
  "CAPITAL_READINESS",
  "CAPITAL_ACTION_PLAN",
  "CAPITAL_PLAN",
  "CAPITAL_INVESTORS",
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
    /**
     * R20/R33: something the app does in the browser that Q's answer
     * carried (theme, reload, open their website); followed once, like
     * `navigate`. Absent or null when none.
     */
    clientAction: QClientActionIntentSchema.nullable().optional(),
    /**
     * RECOVERY-2026-10 (C2): every client action the answer carried, in
     * its order ("open Capital, the readiness tab, scroll to the risks").
     * The screen performs them in order; `clientAction` is the latest.
     */
    clientActions: z.array(QClientActionIntentSchema).max(12).optional(),
    /** FORM: the interview leaves the person with the form. CHAT: the voice ends and the typed thread stays. */
    handoff: z.enum(["FORM", "CHAT"]).nullable(),
    degraded: z.boolean(),
    /**
     * The Q conversation the spoken turns are recorded in, once one
     * exists, so the screen can show and reopen it (ADR 0012).
     */
    conversationId: QConversationIdSchema.optional(),
    /** PRESENCE: the latest spoken answer's gestures, played once per answer. */
    presence: QVoicePresenceSchema.optional(),
    /**
     * RECOVERY A4 (standard line): how the latest turn ended, numbered so
     * the screen shows each once. A turn Q chose not to answer (IGNORED)
     * is shown instead of a silent "Thinking".
     */
    outcome: z
      .object({
        seq: z.number().int().min(1),
        disposition: QTurnDispositionSchema,
        failure: QFailureClassSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type QVoiceTurnState = z.infer<typeof QVoiceTurnStateSchema>;

// ---------------------------------------------------------------------------
// Decision cards on either voice line (RECOVERY A, audit E-03)

function cardWords(transcript: string): readonly string[] {
  return transcript
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9'\s-]+/g, " ")
    .split(/[\s-]+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length > 0);
}

/**
 * RECOVERY A3 (C-03/B-01, founder live 2026-10-08): with a card in focus,
 * only a reply about the card is the card's. "Find anything that needs my
 * attention" (6 words) went to the voice model and decide_card because
 * every utterance of twelve words or fewer did. A card reply names what
 * to do with the card; a question or a request for something else is Q's.
 */
const CARD_VERBS = new Set([
  "send",
  "sent",
  "approve",
  "approved",
  "go",
  "yes",
  "yeah",
  "yep",
  "ok",
  "okay",
  "sure",
  "no",
  "nope",
  "skip",
  "later",
  "dismiss",
  "ignore",
  "drop",
  "cancel",
  "edit",
  "change",
  "rewrite",
  "redo",
  "warmer",
  "shorter",
  "longer",
  "softer",
  "friendlier",
  "formal",
  "casual",
  "book",
  "schedule",
  "reschedule",
  "accept",
  "decline",
  "next",
  "previous",
  "moving",
  "retry",
  "again",
  "snooze",
  "remind",
  "leave",
  "keep",
  "pass",
]);
const CARD_PHRASES = ["not now", "move on", "do it", "that one", "this one"];
/** Opening words of a question or of a request for something else. */
const ELSEWHERE = new Set([
  "what",
  "what's",
  "whats",
  "why",
  "how",
  "who",
  "who's",
  "which",
  "where",
  "find",
  "show",
  "open",
  "tell",
  "explain",
  "read",
  "give",
  "search",
  "look",
  "check",
  "take",
  "anything",
  "is",
  "are",
  "does",
  "do",
]);

/** True when the words are a reply about the decision card in focus. */
export function isQVoiceCardReply(transcript: string): boolean {
  const said = cardWords(transcript);
  if (said.length === 0 || said.length > 12) return false;
  const first = said[0] ?? "";
  // "do it" is a reply; "do they fit?" is not.
  const joined = ` ${said.join(" ")} `;
  if (ELSEWHERE.has(first) && !joined.startsWith(" do it ")) return false;
  if (CARD_PHRASES.some((phrase) => joined.includes(` ${phrase} `))) {
    return true;
  }
  return said.some((w) => CARD_VERBS.has(w));
}

/**
 * POST: the standard line's side of the screen's decision cards. FOCUS:
 * whether a card is in focus now (a reply about it is the card's).
 * VERDICT: the browser read the person's words against the card in focus
 * with the card's own code; `handled` when they decided it, with the
 * outcome's facts for Q to say. Owner only; facts are data, never
 * instructions, and bounded.
 */
export const Q_VOICE_CARD_PATH =
  "/v1/q/voice/sessions/:voiceSessionId/card" as const;
export const qVoiceCardPath = (voiceSessionId: string) =>
  `/v1/q/voice/sessions/${encodeURIComponent(voiceSessionId)}/card`;
export const QVoiceCardUpdateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("FOCUS"), inFocus: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal("VERDICT"),
      words: z.string().min(1).max(700),
      handled: z.boolean(),
      outcome: z
        .record(z.string().max(40), z.unknown())
        .refine((value) => JSON.stringify(value).length <= 6_000, {
          message: "outcome too large",
        })
        .optional(),
    })
    .strict(),
]);
export type QVoiceCardUpdate = z.infer<typeof QVoiceCardUpdateSchema>;
