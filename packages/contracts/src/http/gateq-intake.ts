import { z } from "zod";

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
