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

export const SubmitApplicationResponseSchema = z
  .object({
    submittedAt: z.string(),
    deduplicated: z.boolean(),
    application: ApplicationSummaryDtoSchema,
  })
  .strict();
