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
    answered: z.array(GateqCoverageAnsweredSchema).max(64),
    unknown: z.array(GateqCoverageGapSchema).max(64),
    declined: z.array(GateqCoverageGapSchema).max(64),
    missing: z.array(GateqCoverageMissingSchema).max(64),
    contradictions: z.array(z.string().max(300)).max(16),
  })
  .strict();
export type GateqCoverageV1 = z.infer<typeof GateqCoverageV1Schema>;

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
  })
  .strict();
export type ApplicationCoverageDto = z.infer<
  typeof ApplicationCoverageDtoSchema
>;

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
            facts: z
              .array(
                z
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
                    truthClass: z.enum([
                      "USER_CLAIM",
                      "ESTIMATE",
                      "UNKNOWN",
                      "Q_INFERENCE",
                    ]),
                    evidenceStatus: z.enum([
                      "NO_EVIDENCE",
                      "SELF_REPORTED",
                      "DOCUMENT_SUPPORTED",
                    ]),
                    /** How a Q_INFERENCE was reached, with the words it came from. */
                    derivation: z.string().max(600).optional(),
                  })
                  .strict(),
              )
              .max(32),
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
      .max(20),
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
      .max(80),
    transcript: z.object({ turnCount: z.number().int().min(0) }).strict(),
    /** Nonbinding Q reading, added later. Always null in v1. */
    synthesis: z.null(),
  })
  .strict();
export type GateqDossierV1 = z.infer<typeof GateqDossierV1Schema>;
