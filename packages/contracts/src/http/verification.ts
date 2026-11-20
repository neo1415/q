import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * `/v1/companies/:companyId/verification` -- the founder-facing verification
 * contract (CQ-VERIFY-001; doc 13 §24; ADR-001: `verification_claims` is a
 * separate workflow, never folded into truth / evidence / lifecycle).
 *
 * A founder can ask Capital Q to verify two things about their company --
 * that a founder's identity is verified and that the organisation is -- and
 * can read where those requests stand. Nobody can send a standing: there is
 * no field in any request body in which a client names a status, a method
 * or a decision. Capital Q decides, and every decision carries how.
 *
 * Intended home: packages/contracts/src/http/verification.ts, re-exported
 * from packages/contracts/src/http/index.ts. The lead owns both.
 */

export const VERIFICATION_CLAIM_TYPES = [
  "FOUNDER_IDENTITY",
  /** An investor organisation's person (ADR 0038); never a founder. */
  "INVESTOR_IDENTITY",
  "ORGANISATION",
  "DOMAIN_CONTROL",
] as const;
export const VerificationClaimTypeSchema = z.enum(VERIFICATION_CLAIM_TYPES);
export type VerificationClaimType = z.infer<typeof VerificationClaimTypeSchema>;

/** The two claims marketplace readiness reads; DOMAIN_CONTROL is not requested through this route yet. */
export const COMPANY_VERIFICATION_CLAIM_TYPES = [
  "FOUNDER_IDENTITY",
  "ORGANISATION",
] as const;

export const VERIFICATION_SUBJECT_TYPES = [
  "PERSON",
  "ORGANISATION",
  "DOMAIN",
] as const;
export const VerificationSubjectTypeSchema = z.enum(VERIFICATION_SUBJECT_TYPES);
export type VerificationSubjectType = z.infer<
  typeof VerificationSubjectTypeSchema
>;

/** A persisted claim row's status. A row never moves between these. */
export const VERIFICATION_CLAIM_STATUSES = [
  "PENDING",
  "VERIFIED",
  "EXPIRED",
  "REVOKED",
] as const;
export const VerificationClaimStatusSchema = z.enum(
  VERIFICATION_CLAIM_STATUSES,
);
export type VerificationClaimStatus = z.infer<
  typeof VerificationClaimStatusSchema
>;

/**
 * A subject's standing as the founder reads it: the persisted statuses plus
 * NOT_REQUESTED, which is the truthful answer when no row exists. Unknown
 * is never rendered as "not verified" by anything but this value.
 */
export const VERIFICATION_STANDING_STATUSES = [
  "NOT_REQUESTED",
  ...VERIFICATION_CLAIM_STATUSES,
] as const;
export const VerificationStandingStatusSchema = z.enum(
  VERIFICATION_STANDING_STATUSES,
);
export type VerificationStandingStatus = z.infer<
  typeof VerificationStandingStatusSchema
>;

/**
 * How Capital Q decided. Every method is deterministic, recorded on the row
 * and shown in plain words. No LLM decides a verification. V1 (migration
 * 20261231599900, decision 113): the provider methods, each decided by the
 * system against a provider's record, never by the provider's say-so alone.
 */
export const VERIFICATION_METHODS = [
  "SYNTHETIC_DEMO_ATTESTATION",
  "OPERATOR_DECISION",
  "REGISTRY_LOOKUP",
  "ID_SELFIE",
  "DIRECTOR_MATCH",
  "BANK_NAME_MATCH",
  "DOMAIN_EMAIL",
] as const;
export const VerificationMethodSchema = z.enum(VERIFICATION_METHODS);
export type VerificationMethod = z.infer<typeof VerificationMethodSchema>;

export const VerificationStandingDtoSchema = z
  .object({
    claimType: VerificationClaimTypeSchema,
    subjectType: VerificationSubjectTypeSchema,
    status: VerificationStandingStatusSchema,
    /** Present on a decision; null while pending or never requested. */
    method: VerificationMethodSchema.nullable(),
    requestedAt: UtcTimestampSchema.nullable(),
    decidedAt: UtcTimestampSchema.nullable(),
    verifiedAt: UtcTimestampSchema.nullable(),
    expiresAt: UtcTimestampSchema.nullable(),
    revokedAt: UtcTimestampSchema.nullable(),
    /** ADMIN-4: an operator's reason when they declined or withdrew it. */
    declineReason: z.string().max(500).nullable().optional(),
    /**
     * Plain English for the person, from one place in the Verification
     * context ("Verified (synthetic demo attestation)", "Requested; Capital
     * Q has not decided yet"). Never an internal code, never private content.
     */
    description: z.string().min(1).max(300),
  })
  .strict();
export type VerificationStandingDto = z.infer<
  typeof VerificationStandingDtoSchema
>;

/**
 * The founder's read of their company's verification. Exactly the two
 * claims readiness reads, in a fixed order, so a screen never has to guess
 * which line is missing.
 */
export const CompanyVerificationDtoSchema = z
  .object({
    companyId: UuidSchema,
    standings: z
      .array(VerificationStandingDtoSchema)
      .length(COMPANY_VERIFICATION_CLAIM_TYPES.length),
    /** True when at least one standing can be requested now (NOT_REQUESTED, EXPIRED or REVOKED). */
    requestable: z.boolean(),
    retrievedAt: UtcTimestampSchema,
  })
  .strict();
export type CompanyVerificationDto = z.infer<
  typeof CompanyVerificationDtoSchema
>;

/**
 * `POST /v1/companies/:companyId/verification/requests`
 *
 * Body-less on purpose: the founder asks; the server decides which claims
 * are requestable for this company and this person and creates PENDING
 * rows for those. Consequential, so an Idempotency-Key header is required
 * (IDEMPOTENCY_KEY_HEADER). A repeat with the same key returns the same
 * result; a repeat while everything is already pending or verified changes
 * nothing and says so through the standings.
 */
export const RequestCompanyVerificationRequestSchema = z.object({}).strict();
export type RequestCompanyVerificationRequest = z.infer<
  typeof RequestCompanyVerificationRequestSchema
>;

export const COMPANY_VERIFICATION_SEGMENT = "/verification" as const;
export const COMPANY_VERIFICATION_REQUESTS_SEGMENT =
  "/verification/requests" as const;

/**
 * V1 (decision 113): `GET /v1/verification/providers`. Whether each
 * verification provider is connected on this deployment, so the screen and
 * the admin say "not connected" plainly instead of implying a check ran.
 * Names and coverage only; never a key, never a setting.
 */
export const VERIFICATION_PROVIDERS_PATH = "/v1/verification/providers";

export const VerificationProviderConnectionDtoSchema = z
  .object({
    provider: z.enum(["COMPANIES_HOUSE", "DOJAH", "SUMSUB"]),
    label: z.string().min(1).max(60),
    covers: z.string().min(1).max(200),
    connected: z.boolean(),
    description: z.string().min(1).max(300),
  })
  .strict();
export type VerificationProviderConnectionDto = z.infer<
  typeof VerificationProviderConnectionDtoSchema
>;

export const VerificationProvidersDtoSchema = z
  .object({
    providers: z.array(VerificationProviderConnectionDtoSchema).max(10),
  })
  .strict();
export type VerificationProvidersDto = z.infer<
  typeof VerificationProvidersDtoSchema
>;
