import { z } from "zod";

import { createUuidIdSchema } from "@capital-q/contracts";
import { TenantIdSchema } from "@capital-q/security";

/**
 * GateQ intake contracts (CQ-GATE-002).
 *
 *   application ≠ canonical Company
 *   applicant said it ≠ verified fact
 *   draft ≠ submitted;  submission is the disclosure boundary
 *   guest session ≠ membership ≠ capability
 *   model proposal ≠ recorded truth
 *
 * A person who follows a GateQ link has no account and no organisation.
 * Everything here is built so they never need one, and so nothing they say
 * is promoted beyond what it is: a claim, from a stranger, with a
 * provenance attached.
 */

export const ApplicationIdSchema = createUuidIdSchema("GateQApplicationId");
export type ApplicationId = z.infer<typeof ApplicationIdSchema>;

export const ApplicationSessionIdSchema = createUuidIdSchema(
  "GateQApplicationSessionId",
);
export type ApplicationSessionId = z.infer<typeof ApplicationSessionIdSchema>;

export const ApplicationFactIdSchema = createUuidIdSchema(
  "GateQApplicationFactId",
);
export type ApplicationFactId = z.infer<typeof ApplicationFactIdSchema>;

/** The applicant's opaque handle, like a gateway's. Grants nothing. */
export const ApplicationReferenceSchema = z
  .string()
  .regex(/^ga_[0-9a-hjkmnp-tv-z]{26}$/, "expected an application reference");
export type ApplicationReference = z.infer<typeof ApplicationReferenceSchema>;

/**
 * The guest credential.
 *
 * 256 bits, carried as a bearer token rather than a cookie: a gateway
 * embedded on somebody else's site is a third-party context, and a product
 * that only works when third-party cookies do is a product that is already
 * broken in Safari and will be broken everywhere.
 */
export const SessionTokenSchema = z
  .string()
  .regex(/^gqs_[A-Za-z0-9_-]{43}$/, "expected a GateQ session credential");
export type SessionToken = z.infer<typeof SessionTokenSchema>;

export const APPLICATION_STATUSES = [
  "IN_PROGRESS",
  /** Enough is known that the applicant could submit; they still choose to. */
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "WITHDRAWN",
  "EXPIRED",
] as const;
export const ApplicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

// ---------------------------------------------------------------------------
// What the applicant tells us
// ---------------------------------------------------------------------------

/**
 * The information dimensions an application can hold (§16).
 *
 * Bounded, and the bound is the point: a model proposes values for these
 * and only these, so it cannot invent a field, and every dimension has
 * somewhere it is allowed to go. Not every one is required, and most
 * applications will never fill them all — the objective is institutional
 * understanding, not a completion percentage.
 */
export const APPLICATION_DIMENSIONS = [
  "contact.name",
  "contact.email",
  "contact.role",
  "company.name",
  "company.description",
  "company.website",
  "company.country",
  "company.stage",
  "company.problem",
  "company.solution",
  "company.market",
  "company.customers",
  "company.team",
  "company.business_model",
  /** Free-text phrases the taxonomy resolver maps; never a node id from a model. */
  "company.sector_phrases",
  /** Applicant-stated revenue. Intelligence, never a qualification criterion (§25). */
  "claims.revenue",
  /** Applicant-stated traction. Same: captured, never a criterion. */
  "claims.traction",
  "raise.amount",
  "raise.currency",
  "raise.instrument",
  "raise.use_of_funds",
  /** F1 form: whether the round has a lead. Intelligence, never a criterion. */
  "raise.lead_status",
  /** F1 form: the founder's short note to the investor (≤ 600 characters). */
  "application.note",
] as const;
export const ApplicationDimensionSchema = z.enum(APPLICATION_DIMENSIONS);
export type ApplicationDimension = z.infer<typeof ApplicationDimensionSchema>;

/**
 * Dimensions whose value the deterministic engine may read (§25).
 *
 * Everything else is intelligence for a human. Revenue and traction are
 * deliberately absent: GATE-001 does not support them as criteria, and
 * hearing a founder mention revenue must not quietly change that.
 */
export const QUALIFYING_DIMENSIONS: readonly ApplicationDimension[] = [
  "company.country",
  "company.stage",
  "company.sector_phrases",
  "raise.amount",
  "raise.currency",
];

/**
 * Where a value came from (§17).
 *
 * It is never upgraded by being useful. "We're at $80k MRR" is an
 * applicant claim for as long as that is all it is; a document that says
 * so makes it document-supported, and nothing in this packet makes
 * anything verified.
 */
export const FACT_PROVENANCES = [
  "APPLICANT_PROVIDED",
  "DOCUMENT_SUPPORTED",
  /** The applicant gave a range or an approximation and said so. */
  "ESTIMATED",
  /** They were asked and do not know. A real answer, not an absence (§20). */
  "UNKNOWN",
] as const;
export const FactProvenanceSchema = z.enum(FACT_PROVENANCES);
export type FactProvenance = z.infer<typeof FactProvenanceSchema>;

/** A bounded value. No free JSON: a model cannot post an object of its own shape. */
export const FactValueSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("TEXT"), text: z.string().min(1).max(2000) })
    .strict(),
  z
    .object({
      kind: z.literal("CODE"),
      /** A bounded identifier such as a country or a stage code. */
      code: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("AMOUNT"),
      amount: z
        .string()
        .regex(/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/, "expected a decimal"),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("PHRASES"),
      phrases: z.array(z.string().min(1).max(120)).min(1).max(12),
    })
    .strict(),
  /** Asked and not known. Carries no value on purpose. */
  z.object({ kind: z.literal("NONE") }).strict(),
]);
export type FactValue = z.infer<typeof FactValueSchema>;

export const ApplicationFactSchema = z
  .object({
    id: ApplicationFactIdSchema,
    applicationId: ApplicationIdSchema,
    dimension: ApplicationDimensionSchema,
    value: FactValueSchema,
    provenance: FactProvenanceSchema,
    recordedAt: z.string().datetime({ offset: true }),
    /** Null while current; set when a correction superseded it. */
    supersededAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type ApplicationFact = z.infer<typeof ApplicationFactSchema>;

/** What a caller proposes to record. The store assigns identity and time. */
export const NewApplicationFactSchema = z
  .object({
    dimension: ApplicationDimensionSchema,
    value: FactValueSchema,
    provenance: FactProvenanceSchema,
  })
  .strict();
export type NewApplicationFact = z.infer<typeof NewApplicationFactSchema>;

// ---------------------------------------------------------------------------
// The application
// ---------------------------------------------------------------------------

export const ApplicationSchema = z
  .object({
    id: ApplicationIdSchema,
    tenantId: TenantIdSchema,
    gatewayId: z.string().uuid(),
    /** Frozen at creation (§15). Never "the current version". */
    gatewayVersionId: z.string().uuid(),
    publicReference: ApplicationReferenceSchema,
    status: ApplicationStatusSchema,
    declaredName: z.string().min(1).max(200).nullable(),
    submittedAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type Application = z.infer<typeof ApplicationSchema>;

export const ApplicationSessionSchema = z
  .object({
    id: ApplicationSessionIdSchema,
    applicationId: ApplicationIdSchema,
    tenantId: TenantIdSchema,
    expiresAt: z.string().datetime({ offset: true }),
    revokedAt: z.string().datetime({ offset: true }).nullable(),
    lastSeenAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type ApplicationSession = z.infer<typeof ApplicationSessionSchema>;

/**
 * What a resumed applicant is handed, and what the interviewer reads.
 *
 * Note what is absent: no gateway criteria configuration, no private
 * threshold, no other application, no organisation note. An applicant's
 * own view of their own application is all this is.
 */
export const ApplicationViewSchema = z
  .object({
    reference: ApplicationReferenceSchema,
    status: ApplicationStatusSchema,
    declaredName: z.string().nullable(),
    /** Current values only; the history is the store's and stays there. */
    facts: z
      .array(
        z
          .object({
            dimension: ApplicationDimensionSchema,
            value: FactValueSchema,
            provenance: FactProvenanceSchema,
          })
          .strict(),
      )
      .max(64),
    documentCount: z.number().int().min(0),
    submittedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type ApplicationView = z.infer<typeof ApplicationViewSchema>;

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * Why a guest request was refused.
 *
 * Deliberately coarse. An expired session, a revoked one, a forged token
 * and a token for somebody else's application are one answer at the edge:
 * telling a caller which of those it was is telling them how close they
 * got.
 */
export const INTAKE_REFUSALS = [
  "NOT_FOUND",
  "SESSION_INVALID",
  "GATEWAY_NOT_ACCEPTING",
  "ALREADY_SUBMITTED",
  "NOT_READY_TO_SUBMIT",
  /**
   * This credential has spent its allowance for this operation
   * (CQ-GATE-002S §8). One guest's own quota, never a global one: a
   * founder who exhausts theirs must not throttle anybody else.
   */
  "TOO_MANY_REQUESTS",
] as const;
export const IntakeRefusalSchema = z.enum(INTAKE_REFUSALS);
export type IntakeRefusal = z.infer<typeof IntakeRefusalSchema>;

export class IntakeRefusedError extends Error {
  readonly refusal: IntakeRefusal;
  constructor(refusal: IntakeRefusal, message?: string) {
    super(message ?? "The request cannot be completed.");
    this.name = "IntakeRefusedError";
    this.refusal = refusal;
  }
}
