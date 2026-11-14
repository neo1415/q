import { z } from "zod";

import { VideoAllowanceDtoSchema } from "../common/video-allowance.js";

/**
 * `/v1/gateq/apply` — the public applicant surface (CQ-GATE-002 §42).
 *
 *   guest session ≠ membership ≠ capability
 *   applicant said it ≠ verified fact
 *   draft ≠ submitted
 *
 * Every route here is anonymous. There is no actor, no organisation and no
 * account: authority is a bearer credential that names exactly one
 * application at exactly one gateway.
 *
 * Note what a client cannot send anywhere below. There is no tenant, no
 * investor organisation, no gateway version, no company id and no
 * qualification outcome — the server derives all of them, because a field
 * a browser fills is a field a browser can forge.
 */

export const GATEQ_APPLY_START_PATH = "/v1/gateq/apply" as const;
export const GATEQ_APPLY_SESSION_PATH = "/v1/gateq/apply/session" as const;
export const GATEQ_APPLY_TURN_PATH = "/v1/gateq/apply/turn" as const;
export const GATEQ_APPLY_SUBMIT_PATH = "/v1/gateq/apply/submit" as const;
/**
 * F1: a signed-in founder shares their own documents with the application.
 * The one applicant route that also needs an actor: the documents must be
 * the founder organisation's own, which only a signed-in caller can prove.
 */
export const GATEQ_APPLY_MATERIALS_PATH = "/v1/gateq/apply/materials" as const;
/** F1: the founder answers a short form instead of talking to Q. */
export const GATEQ_APPLY_ANSWERS_PATH = "/v1/gateq/apply/answers" as const;

/** The credential is a bearer token, never a cookie: embeds are third-party. */
export const GATEQ_SESSION_HEADER = "authorization" as const;

/**
 * How long a message may be (§43).
 *
 * Two thousand characters is far more than anybody types in a chat turn
 * and far less than a pasted document. An anonymous conversational
 * endpoint without a length bound is somebody else's token budget.
 */
export const GATEQ_TURN_MAX_CHARS = 2_000;

export const StartApplicationRequestSchema = z
  .object({
    /** The gateway's opaque public handle. Nothing else identifies it. */
    gatewayPublicId: z.string().max(64),
    /**
     * F1 (2026-10-06): "form" opens the application for the GateQ form.
     * No opening line is composed, so no model is reached; the reply is
     * empty. Omitted, the conversation opens as before.
     */
    mode: z.enum(["conversation", "form"]).optional(),
  })
  .strict();
export type StartApplicationRequest = z.infer<
  typeof StartApplicationRequestSchema
>;

export const ApplicationTurnRequestSchema = z
  .object({
    message: z.string().min(1).max(GATEQ_TURN_MAX_CHARS),
    /**
     * The applicant's own idempotency key. A retried turn is the same
     * turn: it must not record the same facts twice or spend a second
     * model call. It is an identifier, never authority.
     */
    clientTurnId: z.string().min(8).max(128),
    /** Typed by default; a transcript arrives the same way (§39). */
    channel: z.enum(["text", "voice"]).optional(),
  })
  .strict();
export type ApplicationTurnRequest = z.infer<
  typeof ApplicationTurnRequestSchema
>;

/**
 * "I'd rather not say" (F1). A real answer, recorded as asked-and-unknown:
 * the rule it feeds stays UNKNOWN, which is never a no.
 */
export const GATEQ_DECLINED = "DECLINED" as const;
const Declined = z.literal(GATEQ_DECLINED);

export const GATEQ_INSTRUMENTS = [
  "SAFE",
  "EQUITY",
  "CONVERTIBLE_NOTE",
  "NOT_DECIDED",
] as const;
export const GATEQ_LEAD_STATUSES = [
  "HAS_LEAD",
  "LOOKING",
  "NOT_NEEDED",
] as const;
export const GATEQ_NOTE_MAX_CHARS = 600;

/**
 * The GateQ form's answers (F1). Each field omitted is untouched; each
 * DECLINED is "I'd rather not say". Every value is bounded vocabulary or a
 * decimal with its currency: the server records them as applicant-provided
 * facts and the deterministic engine decides fit from them. No model reads
 * or writes any of it, and nothing here names a tenant, a gateway version
 * or an outcome.
 */
export const ApplicationAnswersRequestSchema = z
  .object({
    companyName: z.string().trim().min(1).max(200).optional(),
    oneLiner: z.string().trim().min(1).max(280).optional(),
    website: z.string().trim().min(3).max(200).optional(),
    stage: z
      .union([z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), Declined])
      .optional(),
    /** Plain sector words; the taxonomy resolver maps them, never the browser. */
    sectors: z
      .union([
        z.array(z.string().trim().min(1).max(120)).min(1).max(6),
        Declined,
      ])
      .optional(),
    country: z.union([z.string().regex(/^[A-Z]{2}$/), Declined]).optional(),
    raise: z
      .union([
        z
          .object({
            amount: z
              .string()
              .regex(
                /^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/,
                "expected a decimal",
              ),
            currency: z.string().regex(/^[A-Z]{3}$/),
          })
          .strict(),
        Declined,
      ])
      .optional(),
    instrument: z.union([z.enum(GATEQ_INSTRUMENTS), Declined]).optional(),
    lead: z.union([z.enum(GATEQ_LEAD_STATUSES), Declined]).optional(),
    note: z.string().trim().max(GATEQ_NOTE_MAX_CHARS).optional(),
    contactName: z.string().trim().min(1).max(200).optional(),
    contactEmail: z.string().trim().email().max(254).optional(),
  })
  .strict();
export type ApplicationAnswersRequest = z.infer<
  typeof ApplicationAnswersRequestSchema
>;

export const ShareApplicationMaterialsRequestSchema = z
  .object({
    /** The application's guest credential, from the form's memory. */
    sessionToken: z.string().min(16).max(128),
    /** May be empty: Send still links the application to the signed-in founder. */
    documentIds: z.array(z.string().uuid()).max(10),
  })
  .strict();
export type ShareApplicationMaterialsRequest = z.infer<
  typeof ShareApplicationMaterialsRequestSchema
>;
export const ShareApplicationMaterialsResponseSchema = z
  .object({ attached: z.number().int().min(0).max(10) })
  .strict();

export const SubmitApplicationRequestSchema = z
  .object({ clientRequestId: z.string().min(8).max(128) })
  .strict();

/**
 * The two Submit refusals a guest is told apart (409 RESOURCE_CONFLICT),
 * because both are fixed on the same screen. The web tells them apart by
 * this exact detail; every other refusal is still one 404.
 */
export const GATEQ_SUBMIT_CONTACT_NOT_CONFIRMED_DETAIL =
  "Confirm your contact email before submitting." as const;
/**
 * B8: this confirmed email already applied to this gateway. Told apart so
 * the applicant knows the organisation has their application; the earlier
 * application is never named.
 */
export const GATEQ_SUBMIT_ALREADY_APPLIED_DETAIL =
  "This email has already applied to this organisation. They have your application." as const;
/**
 * Live D8 (2026-11-14): the two interview states that used to read as a
 * rate limit. Q is still writing its reply to their last message (a 409:
 * wait a moment), or that reply failed and their message is kept (a 503:
 * send it again). The web tells them apart by this exact detail.
 */
export const GATEQ_REPLY_IN_PROGRESS_DETAIL =
  "Q is still answering your last message. Give it a moment, then carry on." as const;
export const GATEQ_REPLY_FAILED_DETAIL =
  "Q couldn't answer that just now. Your message is saved; send it again." as const;
export const GATEQ_SUBMIT_NOT_READY_DETAIL =
  "Your application isn't ready to submit yet. Answer what's still needed, then submit." as const;

export const ApplicationFactDtoSchema = z
  .object({
    dimension: z.string().max(64),
    /** Rendered for a person, not the stored shape. */
    summary: z.string().max(2000),
    provenance: z.enum([
      "APPLICANT_PROVIDED",
      "DOCUMENT_SUPPORTED",
      "ESTIMATED",
      "UNKNOWN",
    ]),
  })
  .strict();

/**
 * What an applicant may see of their own application.
 *
 * Their own words back, the gateway's public face, and the deterministic
 * answer about whether they may apply. Never a criterion's configuration,
 * never an internal id, never another application.
 */
export const ApplicationSummaryDtoSchema = z
  .object({
    reference: z.string().max(64),
    status: z.enum([
      "IN_PROGRESS",
      "READY_TO_SUBMIT",
      "SUBMITTED",
      "WITHDRAWN",
      "EXPIRED",
    ]),
    declaredName: z.string().nullable(),
    facts: z.array(ApplicationFactDtoSchema).max(64),
    documentCount: z.number().int().min(0),
    submittedAt: z.string().nullable(),
    /** GATE-001's answer, in the applicant's terms. Never a model's. */
    access: z.enum(["MAY_APPLY", "MAY_NOT_APPLY", "NEEDS_INFORMATION"]),
    /**
     * Published criteria that did not match, by the investor's own label.
     * A safe reason, never a threshold and never a number.
     */
    unmet: z.array(z.string().max(120)).max(32),
    /** Published criteria nobody can answer yet, by label. */
    stillNeeded: z.array(z.string().max(120)).max(32),
    /**
     * Decision 91: published criteria whose fact the applicant's own
     * answers disagree on, by label. Neither met nor unanswered; may still
     * apply. Optional for an older API (read: none).
     */
    unresolved: z.array(z.string().max(120)).max(32).optional(),
    /**
     * The currency a round or cheque rule is set in, only when the amount
     * given was in another one (the rule then stays unanswered: no rate is
     * invented). A currency code, never a size.
     */
    askCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .optional(),
  })
  .strict();
export type ApplicationSummaryDto = z.infer<typeof ApplicationSummaryDtoSchema>;

export const StartApplicationResponseSchema = z
  .object({
    /** Shown once. The server keeps only its verifier. */
    sessionToken: z.string().max(128),
    expiresAt: z.string(),
    application: ApplicationSummaryDtoSchema,
    /** Q's opening line, composed for this gateway. */
    reply: z.string().max(1200),
  })
  .strict();

export const ApplicationTurnResponseSchema = z
  .object({
    reply: z.string().max(1200),
    /** True when the same turn had already been processed. */
    deduplicated: z.boolean(),
    application: ApplicationSummaryDtoSchema,
  })
  .strict();
export type ApplicationTurnResponse = z.infer<
  typeof ApplicationTurnResponseSchema
>;

export const ApplicationAnswersResponseSchema = z
  .object({ application: ApplicationSummaryDtoSchema })
  .strict();
export type ApplicationAnswersResponse = z.infer<
  typeof ApplicationAnswersResponseSchema
>;

export const SubmitApplicationResponseSchema = z
  .object({
    submittedAt: z.string(),
    deduplicated: z.boolean(),
    application: ApplicationSummaryDtoSchema,
  })
  .strict();

/** An investor organisation's inbox of submitted applications to one gateway. */
export const GATEQ_GATEWAY_APPLICATIONS_PATH =
  "/v1/gateq/gateways/:gatewayId/applications" as const;
export const gateqGatewayApplicationsPath = (gatewayId: string) =>
  GATEQ_GATEWAY_APPLICATIONS_PATH.replace(
    ":gatewayId",
    encodeURIComponent(gatewayId),
  );

export const GatewayApplicationDtoSchema = z
  .object({
    applicationId: z.string().uuid(),
    submittedAt: z.string(),
    application: ApplicationSummaryDtoSchema,
  })
  .strict();
export type GatewayApplicationDto = z.infer<typeof GatewayApplicationDtoSchema>;

export const GatewayApplicationListDtoSchema = z
  .object({ applications: z.array(GatewayApplicationDtoSchema).max(100) })
  .strict();
export type GatewayApplicationListDto = z.infer<
  typeof GatewayApplicationListDtoSchema
>;

// ---------------------------------------------------------------------------
// GateQ slice 1 (2026-10-13): contact first, a durable interview, a
// deterministic coverage check, and the dossier frozen with the submission.
// ---------------------------------------------------------------------------

/** The applicant's contact: saved, and a one-time code sent to the email. */
export const GATEQ_APPLY_CONTACT_PATH = "/v1/gateq/apply/contact" as const;
/** The six-digit code from that email. */
export const GATEQ_APPLY_CONTACT_CONFIRM_PATH =
  "/v1/gateq/apply/contact/confirm" as const;
/**
 * A signed-in founder's contact: when the email is their own account's,
 * it is confirmed without a code. Needs an actor, like materials; the
 * guest credential travels in the body. Creates no membership.
 */
export const GATEQ_APPLY_CONTACT_ACCOUNT_PATH =
  "/v1/gateq/apply/contact/account" as const;
/**
 * A signed-in founder opens a gateway's form (live D5, 2026-11-13): their
 * own unsent draft there is reopened rather than a new one made on every
 * visit. Needs an actor; answers like the public start.
 */
export const GATEQ_APPLY_ACCOUNT_START_PATH =
  "/v1/gateq/apply/account/start" as const;
/** The interview so far, both sides, in order. */
export const GATEQ_APPLY_TRANSCRIPT_PATH =
  "/v1/gateq/apply/transcript" as const;
/**
 * Opens the interview: when nothing has been said yet, Q asks the first
 * question (stored once); otherwise the transcript is returned as it is,
 * with no model call. Idempotent, so a reload or a double click is safe.
 */
export const GATEQ_APPLY_INTERVIEW_OPEN_PATH =
  "/v1/gateq/apply/interview/open" as const;
/** What is answered, unknown, declined, missing and contradictory. */
export const GATEQ_APPLY_COVERAGE_PATH = "/v1/gateq/apply/coverage" as const;

/**
 * The GateQ video interview (C3): the applicant's own session, by their
 * guest credential. GET reads (and says whether video is offered); POST
 * starts or returns the same session; /end ends it, optionally continuing
 * the same interview by typing. The bridge is the provider's alone.
 */
export const GATEQ_APPLY_VIDEO_PATH = "/v1/gateq/apply/video" as const;
export const GATEQ_APPLY_VIDEO_END_PATH = "/v1/gateq/apply/video/end" as const;
export const GATEQ_VIDEO_BRIDGE_PATH =
  "/v1/gateq/video/bridge/chat/completions" as const;
/**
 * The provider's room events (its callback). The last segment is the
 * per-session secret; only "the replica joined" is acted on.
 */
export const GATEQ_VIDEO_EVENTS_PATH = "/v1/gateq/video/events" as const;
/** What the provider's callback sends; beyond these, ignored. */
export const GateqVideoProviderEventSchema = z
  .object({
    event_type: z.string().max(80),
    conversation_id: z.string().max(128).optional(),
  })
  .passthrough();
export const GATEQ_VIDEO_REFUSALS = [
  "DISABLED",
  "ALLOWANCE_EXHAUSTED",
  "CONCURRENCY_LIMIT",
  "PROVIDER_UNAVAILABLE",
] as const;
export const GateqVideoSessionDtoSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["STARTING", "LIVE", "ENDED"]),
    /** The provider's private room link, only while live. */
    joinUrl: z.string().url().max(2048).nullable(),
    /**
     * While `liveAt` is null this is the hard stop (ready + join grace +
     * cap); once Q is in the room it is liveAt + maxSeconds.
     */
    endsAt: z.string().datetime(),
    /**
     * When Q joined the room and the applicant's time began; null while Q
     * is still joining. Optional so a web release can accept it first.
     */
    liveAt: z.string().datetime().nullable().optional(),
    maxSeconds: z.number().int().min(1).max(3600),
    endedReason: z
      .enum([
        "APPLICANT_ENDED",
        "CONTINUED_BY_TYPING",
        "TIME_LIMIT",
        "PROVIDER_FAILED",
        "SWEPT",
      ])
      .nullable(),
    disclosure: z.string().max(300),
  })
  .strict();
export type GateqVideoSessionDto = z.infer<typeof GateqVideoSessionDtoSchema>;
export const GateqVideoStateDtoSchema = z
  .object({
    /** Whether a video interview may be started now; typing always may. */
    available: z.boolean(),
    session: GateqVideoSessionDtoSchema.nullable(),
    /**
     * Video sessions left this week for the person applying, shared with
     * Rehearsals. Optional so a web release can accept it before an API
     * sends it; null when the server cannot say.
     */
    allowance: VideoAllowanceDtoSchema.nullable().optional(),
    /**
     * Why video is not offered (null when it is). Optional so a web release
     * can accept it before an API sends it.
     */
    unavailableReason: z
      .enum([
        "NOT_OFFERED",
        "SUBMITTED",
        "APPLICATION_SESSIONS_USED",
        "WEEKLY_ALLOWANCE_USED",
      ])
      .nullable()
      .optional(),
    /** Video sessions this application may have in all. */
    perApplication: z.number().int().min(1).max(10).optional(),
  })
  .strict();
export type GateqVideoStateDto = z.infer<typeof GateqVideoStateDtoSchema>;
/** What the video provider sends the bridge; beyond messages, ignored. */
export const GateqVideoBridgeBodySchema = z
  .object({
    messages: z
      .array(z.object({ role: z.string().max(40), content: z.unknown() }))
      .max(300),
  })
  .passthrough();
/**
 * POST GATEQ_APPLY_VIDEO_PATH (optional body). The applicant's language
 * for the room (lane ml): their saved Capital Q choice when signed in,
 * otherwise the device's. A presentation hint, never authority; absent or
 * empty is English, as before.
 */
export const GateqVideoStartRequestSchema = z
  .object({
    locale: z
      .string()
      .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u)
      .max(35)
      .optional(),
  })
  .strict();
export type GateqVideoStartRequest = z.infer<
  typeof GateqVideoStartRequestSchema
>;

export const GateqVideoEndRequestSchema = z
  .object({ continueByTyping: z.boolean() })
  .strict();

/**
 * GateQ voice-only interview (directive 2026-11-14 item 4, slice 1): the
 * applicant talks with Q instead of typing, by their guest credential. GET
 * reads (offered? open session?); POST opens a line (or reopens the same
 * session with a fresh line credential); /end ends it, the interview
 * carrying on by typing. The bridge is the speech provider's alone, under
 * a per-line bearer: every heard line is the SAME canonical turn with
 * channel "voice", answered by the same interviewer.
 */
export const GATEQ_APPLY_VOICE_PATH = "/v1/gateq/apply/voice" as const;
export const GATEQ_APPLY_VOICE_END_PATH = "/v1/gateq/apply/voice/end" as const;
/** The provider appends `/chat/completions` (an OpenAI-shaped think call). */
export const GATEQ_VOICE_BRIDGE_PATH = "/v1/gateq/voice/bridge" as const;
/**
 * Where Q's ElevenLabs Speech Engine for GateQ dials back: a WebSocket
 * verified as the provider's on every upgrade. The engine resource's
 * `wsUrl` is this API's public origin plus this path.
 */
export const GATEQ_VOICE_WS_PATH = "/v1/gateq/voice/ws" as const;
export const GATEQ_VOICE_UNAVAILABLE_REASONS = [
  "NOT_OFFERED",
  "SUBMITTED",
  "APPLICATION_SESSIONS_USED",
  "BUSY",
  "PROVIDER_UNAVAILABLE",
] as const;
export const GateqVoiceUnavailableReasonSchema = z.enum(
  GATEQ_VOICE_UNAVAILABLE_REASONS,
);
export type GateqVoiceUnavailableReason = z.infer<
  typeof GateqVoiceUnavailableReasonSchema
>;
export const GateqVoiceSessionDtoSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["LIVE", "ENDED"]),
    /** The hard stop: the bridge refuses every line after it. */
    endsAt: z.string().datetime(),
    maxSeconds: z.number().int().min(1).max(3600),
    endedReason: z
      .enum([
        "APPLICANT_ENDED",
        "CONTINUED_BY_TYPING",
        "TIME_LIMIT",
        "PROVIDER_FAILED",
        "SWEPT",
      ])
      .nullable(),
    disclosure: z.string().max(300),
  })
  .strict();
export type GateqVoiceSessionDto = z.infer<typeof GateqVoiceSessionDtoSchema>;
/**
 * The browser's one-time line credential (v2, owner directive 2026-11-14
 * "GateQ voice reuses the existing voice providers"). Only on the POST
 * that opened the line; never on a GET; never a provider API key.
 *
 * - `elevenlabs` (the default): a short-lived WebRTC conversation token
 *   for Q's own ElevenLabs Speech Engine voice. The engine dials this API
 *   back with nothing but its conversation id, and every reply is the
 *   canonical interviewer's. `firstMessage` is Q's opening as the server
 *   composed it (already in the transcript).
 * - `deepgram` (optional fallback, only when explicitly configured): a
 *   short-lived agent token and the agent settings this server composed,
 *   whose think endpoint is the bridge under this line's bearer.
 */
export const GATEQ_VOICE_LINE_PROVIDERS = ["elevenlabs", "deepgram"] as const;
export const GateqVoiceLineDtoSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("elevenlabs"),
      token: z.string().min(1).max(8192),
      firstMessage: z.string().max(1000),
    })
    .strict(),
  z
    .object({
      provider: z.literal("deepgram"),
      token: z.string().min(1).max(8192),
      agent: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);
export type GateqVoiceLineDto = z.infer<typeof GateqVoiceLineDtoSchema>;
export const GateqVoiceStateDtoSchema = z
  .object({
    /** Whether a voice interview may be started now; typing always may. */
    available: z.boolean(),
    session: GateqVoiceSessionDtoSchema.nullable(),
    unavailableReason: GateqVoiceUnavailableReasonSchema.nullable(),
    /** Voice sessions this application may have in all. */
    perApplication: z.number().int().min(1).max(10),
    /** Voice sessions this application has left. */
    remaining: z.number().int().min(0).max(10),
    line: GateqVoiceLineDtoSchema.nullable().optional(),
  })
  .strict();
export type GateqVoiceStateDto = z.infer<typeof GateqVoiceStateDtoSchema>;
export const GateqVoiceStartRequestSchema = GateqVideoStartRequestSchema;
export const GateqVoiceEndRequestSchema = GateqVideoEndRequestSchema;

export const GATEQ_CONTACT_CHANNELS = ["EMAIL", "PHONE"] as const;
export const GateqContactChannelSchema = z.enum(GATEQ_CONTACT_CHANNELS);
export type GateqContactChannel = z.infer<typeof GateqContactChannelSchema>;

const ContactFields = {
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.string().trim().min(1).max(120),
  companyName: z.string().trim().min(1).max(200),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ().-]{6,32}$/, "expected a phone number")
    .optional(),
  preferredChannel: GateqContactChannelSchema.optional(),
} as const;

export const ApplicationContactRequestSchema = z.object(ContactFields).strict();
export type ApplicationContactRequest = z.infer<
  typeof ApplicationContactRequestSchema
>;

export const ApplicationContactAccountRequestSchema = z
  .object({ ...ContactFields, sessionToken: z.string().min(16).max(128) })
  .strict();
export type ApplicationContactAccountRequest = z.infer<
  typeof ApplicationContactAccountRequestSchema
>;

export const ApplicationContactDtoSchema = z
  .object({
    name: z.string().max(200),
    email: z.string().max(254),
    role: z.string().max(120),
    companyName: z.string().max(200),
    phone: z.string().max(32).nullable(),
    preferredChannel: GateqContactChannelSchema.nullable(),
    emailConfirmed: z.boolean(),
    /** How it was confirmed; null while unconfirmed. */
    confirmedVia: z.enum(["EMAIL_CODE", "ACCOUNT"]).nullable(),
  })
  .strict();
export type ApplicationContactDto = z.infer<typeof ApplicationContactDtoSchema>;

export const ApplicationContactResponseSchema = z
  .object({
    contact: ApplicationContactDtoSchema,
    /** False when no code was needed (already confirmed) or it could not go. */
    codeSent: z.boolean(),
    /** Minutes the code works for; null when no code was issued. */
    codeExpiresInMinutes: z.number().int().min(1).max(120).nullable(),
  })
  .strict();
export type ApplicationContactResponse = z.infer<
  typeof ApplicationContactResponseSchema
>;

export const ApplicationContactConfirmRequestSchema = z
  .object({
    code: z.string().regex(/^[0-9]{6}$/, "expected a six-digit code"),
  })
  .strict();
export type ApplicationContactConfirmRequest = z.infer<
  typeof ApplicationContactConfirmRequestSchema
>;

export const ApplicationContactConfirmResponseSchema = z
  .object({
    /** EXPIRED covers both a timed-out code and spent attempts: ask again. */
    status: z.enum(["CONFIRMED", "WRONG_CODE", "EXPIRED", "NOT_FOUND"]),
    contact: ApplicationContactDtoSchema.nullable(),
  })
  .strict();
export type ApplicationContactConfirmResponse = z.infer<
  typeof ApplicationContactConfirmResponseSchema
>;

export const ApplicationTranscriptTurnDtoSchema = z
  .object({
    seq: z.number().int().min(1),
    role: z.enum(["PERSON", "Q"]),
    text: z.string().max(4000),
    at: z.string(),
    /**
     * Q turns: server milliseconds from receiving the person's turn to
     * having Q's reply. Null for person turns and the opening line.
     */
    latencyMs: z.number().int().min(0).nullable().optional(),
  })
  .strict();
export type ApplicationTranscriptTurnDto = z.infer<
  typeof ApplicationTranscriptTurnDtoSchema
>;

export const GATEQ_TRANSCRIPT_MAX_TURNS = 400;
/** Documents a frozen dossier lists by name; any beyond are counted (documentsTotal). */
export const GATEQ_DOSSIER_DOCUMENTS_MAX = 200;
export const ApplicationTranscriptDtoSchema = z
  .object({
    turns: z
      .array(ApplicationTranscriptTurnDtoSchema)
      .max(GATEQ_TRANSCRIPT_MAX_TURNS),
  })
  .strict();
export type ApplicationTranscriptDto = z.infer<
  typeof ApplicationTranscriptDtoSchema
>;

/**
 * The fixed, ordered investment dimensions an application's facts are
 * grouped under. A reading order for a partner, not a weighting.
 */
export const GATEQ_INVESTMENT_GROUPS = [
  "COMPANY",
  "PRODUCT",
  "MARKET",
  "BUSINESS_MODEL",
  "TRACTION",
  "TEAM",
  "FUNDRAISING",
] as const;
export const GateqInvestmentGroupSchema = z.enum(GATEQ_INVESTMENT_GROUPS);
export type GateqInvestmentGroup = z.infer<typeof GateqInvestmentGroupSchema>;

/** Where a value came from: the applicant's words, a document, an estimate. */
export const GateqFactProvenanceSchema = z.enum([
  "APPLICANT_PROVIDED",
  "DOCUMENT_SUPPORTED",
  "ESTIMATED",
  "UNKNOWN",
]);

const CoverageDimension = {
  dimension: z.string().max(64),
  label: z.string().max(80),
  group: GateqInvestmentGroupSchema,
} as const;

export const GateqCoverageAnsweredSchema = z
  .object({
    ...CoverageDimension,
    summary: z.string().max(2000),
    provenance: GateqFactProvenanceSchema,
    /**
     * C2 lineage: the recorded fact and the transcript turn it was heard in
     * (null for the form or a document). Optional so a release can accept
     * it before any server sends it.
     */
    sourceFactId: z.string().uuid().optional(),
    sourceTurnSeq: z.number().int().min(1).nullable().optional(),
  })
  .strict();
export const GateqCoverageGapSchema = z.object(CoverageDimension).strict();
export const GateqCoverageMissingSchema = z
  .object({
    ...CoverageDimension,
    /** Why it matters, in bounded vocabulary; never the rule behind it. */
    reason: z.enum([
      "REQUIRED_BY_GATEWAY",
      "PREFERRED_BY_GATEWAY",
      "CONTRADICTION",
      "UNDERSTANDING",
    ]),
  })
  .strict();

const AccessSchema = z.enum([
  "MAY_APPLY",
  "MAY_NOT_APPLY",
  "NEEDS_INFORMATION",
]);

/**
 * The deterministic completeness check before submission (v1).
 *
 * No numbers and no weights: what is answered (with where it came from),
 * what the founder does not know, what they preferred not to say, what was
 * never covered, what disagrees, and GATE-001's own access answer with the
 * investor's published labels.
 */
export const GateqCoverageV1Schema = z
  .object({
    version: z.literal(1),
    access: AccessSchema,
    unmet: z.array(z.string().max(120)).max(32),
    stillNeeded: z.array(z.string().max(120)).max(32),
    /**
     * Decision 91: published criteria whose fact the applicant's own
     * answers disagree on, by label. Neither met nor unanswered; may still
     * apply. Optional for an older API (read: none).
     */
    unresolved: z.array(z.string().max(120)).max(32).optional(),
    answered: z.array(GateqCoverageAnsweredSchema).max(64),
    unknown: z.array(GateqCoverageGapSchema).max(64),
    declined: z.array(GateqCoverageGapSchema).max(64),
    missing: z.array(GateqCoverageMissingSchema).max(64),
    contradictions: z.array(z.string().max(300)).max(16),
  })
  .strict();
export type GateqCoverageV1 = z.infer<typeof GateqCoverageV1Schema>;

// ---------------------------------------------------------------------------
// GateQ atomic statements, slice 3: the one statement view every reader uses
// ---------------------------------------------------------------------------

/**
 * Where a statement came from, as every reader labels it. COMPANY_PROFILE
 * is never part of an application: it is the company's own Capital Q
 * profile, named as such wherever Q or an investor reads it beside one.
 */
export const GATEQ_STATEMENT_SOURCE_KINDS = [
  "APPLICATION_STATEMENT",
  "FORM",
  "DOCUMENT",
  "COMPANY_PROFILE",
] as const;
export const GateqStatementSourceKindSchema = z.enum(
  GATEQ_STATEMENT_SOURCE_KINDS,
);
export type GateqStatementSourceKind = z.infer<
  typeof GateqStatementSourceKindSchema
>;

export const GATEQ_DISAGREEMENT_STATES = [
  "OPEN",
  "LEFT_OPEN",
  "RESOLVED",
] as const;
export const GateqDisagreementStateSchema = z.enum(GATEQ_DISAGREEMENT_STATES);
export type GateqDisagreementState = z.infer<
  typeof GateqDisagreementStateSchema
>;

export const GATEQ_STATEMENT_VIEW_VERSION = "gateq-statement-view.v1" as const;

/** One statement, in words: what was said, once, and where it came from. */
export const GateqStatementWordsSchema = z
  .object({
    statementId: z.string().uuid(),
    sourceKind: GateqStatementSourceKindSchema,
    /** Recovered from a record kept before statements existed; said so. */
    backfilled: z.boolean(),
    valueKind: z.enum([
      "TEXT",
      "CODE",
      "MONEY",
      "COUNT",
      "PERCENT",
      "ZERO",
      "UNKNOWN",
    ]),
    /** True for an UNKNOWN the founder chose not to give. */
    declined: z.boolean(),
    /** The value in plain words ("Zero revenue", "USD 2,000,000"). */
    summary: z.string().min(1).max(2000),
    /** The founder's own words. */
    words: z.string().min(1).max(2000),
    quantity: z.string().max(64).nullable(),
    asOf: z.string().max(10).nullable(),
    provenance: GateqFactProvenanceSchema,
    /** The transcript turn it was said in; null for the form or a record. */
    sourceTurnSeq: z.number().int().min(1).nullable(),
    statedAt: z.string().max(40),
  })
  .strict();
export type GateqStatementWords = z.infer<typeof GateqStatementWordsSchema>;

export const GateqSupersededWordsSchema = GateqStatementWordsSchema.extend({
  supersededBy: z.string().uuid(),
  via: z.enum(["CORRECTION", "RESOLUTION"]),
}).strict();
export type GateqSupersededWords = z.infer<typeof GateqSupersededWordsSchema>;

export const GateqDisagreementWordsSchema = z
  .object({
    key: z.string().min(1).max(120),
    olderStatementId: z.string().uuid(),
    newerStatementId: z.string().uuid(),
    state: GateqDisagreementStateSchema,
    resolvedByStatementId: z.string().uuid().nullable(),
    /** False once a side is corrected away or it is resolved: history. */
    active: z.boolean(),
  })
  .strict();
export type GateqDisagreementWords = z.infer<
  typeof GateqDisagreementWordsSchema
>;

export const GATEQ_DIMENSION_STATUSES = [
  "SETTLED",
  "ZERO",
  "UNKNOWN",
  "DECLINED",
  "DISAGREEMENT_OPEN",
  "DISAGREEMENT_LEFT_OPEN",
  "UNANSWERED",
] as const;

/** Bounded by the statement store: an interview writes at most hundreds. */
export const GATEQ_STATEMENTS_PER_DIMENSION_MAX = 400;

export const GateqDimensionStatementsSchema = z
  .object({
    dimension: z.string().max(64),
    label: z.string().max(80),
    /** The investment group it is read under; null for contact and note. */
    group: GateqInvestmentGroupSchema.nullable(),
    status: z.enum(GATEQ_DIMENSION_STATUSES),
    /** Every current statement, oldest first. */
    statements: z
      .array(GateqStatementWordsSchema)
      .max(GATEQ_STATEMENTS_PER_DIMENSION_MAX),
    /** Corrected or resolved away: kept as history, never erased. */
    superseded: z
      .array(GateqSupersededWordsSchema)
      .max(GATEQ_STATEMENTS_PER_DIMENSION_MAX),
    disagreements: z
      .array(GateqDisagreementWordsSchema)
      .max(GATEQ_STATEMENTS_PER_DIMENSION_MAX),
  })
  .strict();
export type GateqDimensionStatements = z.infer<
  typeof GateqDimensionStatementsSchema
>;

/**
 * The deterministic statement view of one application (design 2026-11-14,
 * slice 3), as founder review, the frozen dossier, the investor inbox,
 * synthesis and the investor's Q all read it. Values are put into words by
 * one server formatter, and `gateqStatementsInWords` turns the view into
 * the same lines for every reader.
 */
export const GateqStatementViewV1Schema = z
  .object({
    version: z.literal(GATEQ_STATEMENT_VIEW_VERSION),
    dimensions: z.array(GateqDimensionStatementsSchema).max(32),
  })
  .strict();
export type GateqStatementViewV1 = z.infer<typeof GateqStatementViewV1Schema>;

/** The applicant's coverage view, with what still stands before Submit. */
export const ApplicationCoverageDtoSchema = z
  .object({
    coverage: GateqCoverageV1Schema,
    contact: z
      .object({
        /** False only for an application that may still submit without one. */
        required: z.boolean(),
        confirmed: z.boolean(),
        /** Own scoped contact, never verification secrets; older responses may omit it. */
        details: ApplicationContactDtoSchema.nullable().optional(),
      })
      .strict(),
    documentCount: z.number().int().min(0),
    transcriptTurns: z.number().int().min(0),
    /**
     * Slice 3: every statement, kept, corrected and in disagreement, from
     * the one statement view. Optional so an older API still parses.
     */
    statements: GateqStatementViewV1Schema.optional(),
  })
  .strict();
export type ApplicationCoverageDto = z.infer<
  typeof ApplicationCoverageDtoSchema
>;

/** One finding in a frozen dossier, on ADR-001's separate axes. */
export const GateqDossierFactSchema = z
  .object({
    dimension: z.string().max(64),
    label: z.string().max(80),
    summary: z.string().max(2000),
    provenance: GateqFactProvenanceSchema,
    /** Lineage: the recorded application fact this reads. */
    sourceFactId: z.string().uuid(),
    /**
     * Lineage: the transcript turn (seq) it was heard in;
     * null for the form, a document or an older fact.
     */
    sourceTurnSeq: z.number().int().min(1).nullable(),
    /**
     * Q_INFERENCE: a value Q derived (e.g. multiplied) from
     * what was said, never the person's own words; it then
     * carries its `derivation` (ADR-001 truth axis).
     */
    truthClass: z.enum(["USER_CLAIM", "ESTIMATE", "UNKNOWN", "Q_INFERENCE"]),
    evidenceStatus: z.enum([
      "NO_EVIDENCE",
      "SELF_REPORTED",
      "DOCUMENT_SUPPORTED",
    ]),
    /** How a Q_INFERENCE was reached, with the words it came from. */
    derivation: z.string().max(600).optional(),
  })
  .strict();
export type GateqDossierFact = z.infer<typeof GateqDossierFactSchema>;

export const GATEQ_DOSSIER_SCHEMA_VERSION = "gateq-dossier.v1" as const;

/**
 * The investor-ready brief frozen with a submission (GateqDossierV1).
 *
 * Deterministic: built from the frozen view, the published criteria's
 * labels and statuses, the transcript and the coverage check, with no model
 * involved. Every fact keeps its provenance on ADR-001's separate axes, and
 * nothing an applicant said is ever VERIFIED here. `synthesis` is reserved
 * for a later, clearly labelled and nonbinding Q reading; it is always null
 * in v1.
 */
export const GateqDossierV1Schema = z
  .object({
    schemaVersion: z.literal(GATEQ_DOSSIER_SCHEMA_VERSION),
    generatedAt: z.string(),
    application: z
      .object({
        reference: z.string().max(64),
        submittedAt: z.string(),
      })
      .strict(),
    company: z
      .object({
        name: z.string().max(200).nullable(),
        description: z.string().max(2000).nullable(),
        website: z.string().max(200).nullable(),
        country: z.string().max(64).nullable(),
        stage: z.string().max(64).nullable(),
        sectorPhrases: z.array(z.string().max(120)).max(12),
        note: z.string().max(2000).nullable(),
      })
      .strict(),
    contact: ApplicationContactDtoSchema.nullable(),
    qualification: z
      .object({
        outcome: z.enum([
          "QUALIFIED",
          "NOT_QUALIFIED",
          "INSUFFICIENT_INFORMATION",
          // Decision 91: a required rule's fact is disputed; may still apply.
          "UNRESOLVED",
        ]),
        access: AccessSchema,
        /** The published labels and their status; never the configuration. */
        criteria: z
          .array(
            z
              .object({
                label: z.string().max(120),
                requiredness: z.enum(["REQUIRED", "PREFERRED"]),
                status: z.enum([
                  "MATCH",
                  "NO_MATCH",
                  "UNKNOWN",
                  "NOT_APPLICABLE",
                  "UNRESOLVED",
                ]),
              })
              .strict(),
          )
          .max(64),
      })
      .strict(),
    dimensions: z
      .array(
        z
          .object({
            group: GateqInvestmentGroupSchema,
            label: z.string().max(80),
            facts: z.array(GateqDossierFactSchema).max(32),
          })
          .strict(),
      )
      .max(GATEQ_INVESTMENT_GROUPS.length),
    unknowns: z.array(GateqCoverageGapSchema).max(64),
    declined: z.array(GateqCoverageGapSchema).max(64),
    missing: z.array(GateqCoverageMissingSchema).max(64),
    contradictions: z.array(z.string().max(300)).max(16),
    documents: z
      .array(
        z
          .object({ documentId: z.string().uuid(), title: z.string().max(200) })
          .strict(),
      )
      .max(GATEQ_DOSSIER_DOCUMENTS_MAX),
    /**
     * Decision 97: how many documents were shared at submission. Above the
     * frozen list's length, the rest are named as a count, never hidden.
     * Absent on dossiers frozen before 2026-11-14.
     */
    documentsTotal: z.number().int().min(0).optional(),
    diligenceQuestions: z
      .array(
        z
          .object({
            dimension: z.string().max(64).nullable(),
            basis: z.enum(["MISSING", "UNKNOWN", "DECLINED", "CONTRADICTION"]),
            question: z.string().max(400),
          })
          .strict(),
      )
      // Every gap and contradiction above yields at most one question
      // (16 + 3 x 64 = 208): the bound holds them all.
      .max(256),
    /** Decision 97: questions derived at submission. Absent before 2026-11-14. */
    diligenceQuestionsTotal: z.number().int().min(0).optional(),
    transcript: z.object({ turnCount: z.number().int().min(0) }).strict(),
    /** Nonbinding Q reading, added later. Always null in v1. */
    synthesis: z.null(),
  })
  .strict();
export type GateqDossierV1 = z.infer<typeof GateqDossierV1Schema>;

export const GATEQ_DOSSIER_V2_SCHEMA_VERSION = "gateq-dossier.v2" as const;

/**
 * A v2 finding: one current statement of the statement view. `sourceFactId`
 * keeps its v1 meaning of "the source record this finding reads", which in
 * v2 is the statement itself (so it equals `statementId`), so every reader
 * and every citation of v1 reads v2 unchanged.
 */
export const GateqDossierV2FactSchema = GateqDossierFactSchema.extend({
  statementId: z.string().uuid(),
  sourceKind: GateqStatementSourceKindSchema,
  backfilled: z.boolean(),
  /** The state of a disagreement it is part of; null when none stands. */
  disagreementState: GateqDisagreementStateSchema.nullable(),
}).strict();
export type GateqDossierV2Fact = z.infer<typeof GateqDossierV2FactSchema>;

/**
 * The frozen dossier built from the statement view (slice 3; submission
 * snapshot v3). Every current statement is a finding with its source, the
 * full view travels with it (superseded history and disagreements with
 * their state), and nothing is joined text. Frozen v1 rows are never
 * rewritten: readers accept both through `GateqDossierSchema`.
 */
export const GateqDossierV2Schema = GateqDossierV1Schema.extend({
  schemaVersion: z.literal(GATEQ_DOSSIER_V2_SCHEMA_VERSION),
  dimensions: z
    .array(
      z
        .object({
          group: GateqInvestmentGroupSchema,
          label: z.string().max(80),
          facts: z
            .array(GateqDossierV2FactSchema)
            .max(GATEQ_STATEMENTS_PER_DIMENSION_MAX),
        })
        .strict(),
    )
    .max(GATEQ_INVESTMENT_GROUPS.length),
  /** Decision 97: more disagreements than the 16 lines above, counted. */
  contradictionsTotal: z.number().int().min(0),
  statements: GateqStatementViewV1Schema,
}).strict();
export type GateqDossierV2 = z.infer<typeof GateqDossierV2Schema>;

/** Every frozen dossier version a reader accepts. */
export const GateqDossierSchema = z.discriminatedUnion("schemaVersion", [
  GateqDossierV1Schema,
  GateqDossierV2Schema,
]);
export type GateqDossier = z.infer<typeof GateqDossierSchema>;
