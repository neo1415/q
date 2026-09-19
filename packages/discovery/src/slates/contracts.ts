import { parseContract, UuidSchema } from "@capital-q/contracts";
import { z } from "zod";

import { STRUCTURED_GENERATOR_VERSION } from "../candidates/contracts.js";
import {
  ELIGIBILITY_POLICY_VERSION,
  RecommendationModeSchema,
} from "../eligibility/contracts.js";
import {
  FEATURE_SCHEMA_VERSION,
  SnapshotCandidateProvenanceSchema,
} from "../features/contracts.js";
import { RANKING_REASON_CODES } from "../ranking/config.js";
import { RANKER_VERSION } from "../ranking/contracts.js";
import { SEMANTIC_GENERATOR_VERSION } from "../semantic/contracts.js";

/**
 * Persisted recommendation slates (doc 19 §10, §62–§65, §149–§151; doc 20
 * §76–§81; CQ-REC-006).
 *
 *   slate ≠ company truth ≠ investor truth ≠ relationship ≠ interest ≠ match
 *   slate item ≠ explanation (REC-007);  internal score ≠ public number
 *   one CURRENT per investor organisation, mandate and context
 *   an old valid slate or a new complete one; never a partial set
 *
 * A slate is the durable output of one pipeline run. It is built, then
 * published in one transaction that supersedes its predecessor, then never
 * edited: invalidation and expiry move lifecycle columns only, and a
 * rebuild is a new slate. Every version that produced the ordering is on
 * the slate; every item names the exact feature snapshot REC-005 ranked.
 */

export const SLATE_STATUSES = [
  "BUILDING",
  "CURRENT",
  "SUPERSEDED",
  "INVALIDATED",
  "EXPIRED",
  "FAILED",
] as const;
export const SlateStatusSchema = z.enum(SLATE_STATUSES);
export type SlateStatus = z.infer<typeof SlateStatusSchema>;

/** Doc 19 §150 high-priority invalidations, plus the ordinary lifecycle ones. */
export const SLATE_INVALIDATION_REASONS = [
  "VISIBILITY_CHANGED",
  "MARKETPLACE_DISABLED",
  "MANDATE_HARD_CHANGED",
  "MANDATE_CLOSED",
  "RELATIONSHIP_RESTRICTED",
  "SECURITY_RESTRICTION",
  "REBUILT",
  "MANUAL",
] as const;
export const SlateInvalidationReasonSchema = z.enum(SLATE_INVALIDATION_REASONS);
export type SlateInvalidationReason = z.infer<
  typeof SlateInvalidationReasonSchema
>;

/** Why a refresh was requested. Bounded; drives priority, not content. */
export const REFRESH_REASONS = [
  "MANDATE_ACTIVATED",
  "MANDATE_UPDATED",
  "MANDATE_HARD_CHANGED",
  "MANDATE_CLOSED",
  "COMPANY_VISIBILITY_CHANGED",
  "COMPANY_READINESS_CHANGED",
  "COMPANY_UPDATED",
  "TAXONOMY_CHANGED",
  "DISCLOSURE_CHANGED",
  "RELATIONSHIP_CHANGED",
  "NO_CURRENT_SLATE",
  "SLATE_EXPIRED",
  "SCHEDULED",
  "MANUAL",
] as const;
export const RefreshReasonSchema = z.enum(REFRESH_REASONS);
export type RefreshReason = z.infer<typeof RefreshReasonSchema>;

export const REFRESH_PRIORITIES = ["NORMAL", "HIGH"] as const;
export const RefreshPrioritySchema = z.enum(REFRESH_PRIORITIES);
export type RefreshPriority = z.infer<typeof RefreshPrioritySchema>;

export const REFRESH_REQUEST_STATUSES = [
  "PENDING",
  "CLAIMED",
  "DONE",
  "FAILED",
] as const;
export const RefreshRequestStatusSchema = z.enum(REFRESH_REQUEST_STATUSES);
export type RefreshRequestStatus = z.infer<typeof RefreshRequestStatusSchema>;

export const SlateIdSchema = z.string().uuid();
export const RecommendationItemIdSchema = z.string().uuid();

/** Bounded counts from a build. Never a name, a value or a marker. */
export const SlateDiagnosticsSchema = z
  .object({
    structuredCandidates: z.number().int().min(0),
    semanticCandidates: z.number().int().min(0),
    semanticUnavailable: z.boolean(),
    mergedCandidates: z.number().int().min(0),
    featureSnapshots: z.number().int().min(0),
    ranked: z.number().int().min(0),
    scored: z.number().int().min(0),
    buildDurationMs: z.number().int().min(0),
  })
  .strict();
export type SlateDiagnostics = z.infer<typeof SlateDiagnosticsSchema>;

export const RecommendationSlateSchema = z
  .object({
    id: SlateIdSchema,
    tenantId: UuidSchema,
    investorOrganisationId: UuidSchema,
    mandateId: UuidSchema,
    mandateVersion: z.number().int().min(1),
    mode: RecommendationModeSchema,
    status: SlateStatusSchema,
    eligibilityPolicyVersion: z.string().min(1).max(64),
    structuredGeneratorVersion: z.string().min(1).max(64),
    semanticGeneratorVersion: z.string().min(1).max(64).nullable(),
    featureSchemaVersion: z.string().min(1).max(64),
    rankerVersion: z.string().min(1).max(64),
    rankingConfigVersion: z.string().min(1).max(64),
    taxonomyVersion: z.record(z.string(), z.number().int()).nullable(),
    generationFingerprint: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    itemCount: z.number().int().min(0),
    diagnostics: SlateDiagnosticsSchema.nullable(),
    generatedAt: z.string().datetime({ offset: true }),
    publishedAt: z.string().datetime({ offset: true }).nullable(),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    invalidatedAt: z.string().datetime({ offset: true }).nullable(),
    invalidationReason: SlateInvalidationReasonSchema.nullable(),
    supersededAt: z.string().datetime({ offset: true }).nullable(),
    supersedesSlateId: SlateIdSchema.nullable(),
    failureCode: z.string().max(64).nullable(),
  })
  .strict();
export type RecommendationSlate = z.infer<typeof RecommendationSlateSchema>;

export const RecommendationItemSchema = z
  .object({
    id: RecommendationItemIdSchema,
    slateId: SlateIdSchema,
    companyId: UuidSchema,
    companyTenantId: UuidSchema,
    rank: z.number().int().min(1),
    /** REC-005 internal ordering score; null when unscored. Never public. */
    internalScore: z.number().finite().min(0).max(1).nullable(),
    reasonCodes: z.array(z.enum(RANKING_REASON_CODES)).max(32),
    featureSnapshotId: UuidSchema,
    featureSnapshotFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    candidateProvenance: SnapshotCandidateProvenanceSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type RecommendationItem = z.infer<typeof RecommendationItemSchema>;

/** What a build writes for one item; the store assigns id and createdAt. */
export const NewRecommendationItemSchema = RecommendationItemSchema.omit({
  id: true,
  slateId: true,
  createdAt: true,
});
export type NewRecommendationItem = z.infer<typeof NewRecommendationItemSchema>;

/** The versions a build ran under, all of them, separately (§20, §71). */
export const SlateVersionsSchema = z
  .object({
    eligibilityPolicyVersion: z.literal(ELIGIBILITY_POLICY_VERSION),
    structuredGeneratorVersion: z.literal(STRUCTURED_GENERATOR_VERSION),
    semanticGeneratorVersion: z.literal(SEMANTIC_GENERATOR_VERSION).nullable(),
    featureSchemaVersion: z.literal(FEATURE_SCHEMA_VERSION),
    rankerVersion: z.literal(RANKER_VERSION),
    rankingConfigVersion: z.string().min(1).max(64),
    taxonomyVersion: z.record(z.string(), z.number().int()).nullable(),
  })
  .strict();
export type SlateVersions = z.infer<typeof SlateVersionsSchema>;

// ---------------------------------------------------------------------------
// Slate policy (doc 19 §64; CQ-REC-006 §22, §40): initial, operational,
// configurable. Not product truth. Changing it never rewrites old rows,
// because expiry is stamped on the slate at publication.
// ---------------------------------------------------------------------------

export const SlatePolicySchema = z
  .object({
    version: z.literal("slate-policy.v1"),
    status: z.literal("INITIAL_OPERATIONAL"),
    /** How long a CURRENT slate is served after publication. */
    ttlMs: z.number().int().min(60_000),
    /** Doc 20 §81: 5–10 initially; the client never needs the whole pool. */
    pageSizeDefault: z.number().int().min(1).max(50),
    pageSizeMax: z.number().int().min(1).max(50),
    /** Bounded candidate budget handed to REC-002/REC-003 per build. */
    candidatePoolMax: z.number().int().min(1).max(200),
    semanticTopK: z.number().int().min(1).max(200),
  })
  .strict()
  .refine((p) => p.pageSizeDefault <= p.pageSizeMax, {
    message: "the default page size is within the maximum",
  });
export type SlatePolicy = z.infer<typeof SlatePolicySchema>;

export const SLATE_POLICY_V1: SlatePolicy = Object.freeze(
  SlatePolicySchema.parse({
    version: "slate-policy.v1",
    status: "INITIAL_OPERATIONAL",
    ttlMs: 24 * 60 * 60 * 1000,
    pageSizeDefault: 10,
    pageSizeMax: 20,
    candidatePoolMax: 200,
    semanticTopK: 200,
  }),
);

// ---------------------------------------------------------------------------
// Cursor (doc 19 §65; doc 20 §80): stable continuation keys, opaque
// encoding, never an authorisation token. Every page re-resolves the actor
// and re-checks that the slate is theirs and servable.
// ---------------------------------------------------------------------------

export const SlateCursorSchema = z
  .object({
    v: z.literal(1),
    slateId: SlateIdSchema,
    /** The last rank already served; the next page starts after it. */
    afterRank: z.number().int().min(0),
  })
  .strict();
export type SlateCursor = z.infer<typeof SlateCursorSchema>;

export function encodeSlateCursor(cursor: SlateCursor): string {
  return Buffer.from(
    JSON.stringify(SlateCursorSchema.parse(cursor)),
    "utf8",
  ).toString("base64url");
}

/** Rejects anything this server did not issue, with a safe message. */
export function decodeSlateCursor(raw: string): SlateCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    decoded = undefined;
  }
  return parseContract(
    SlateCursorSchema,
    decoded,
    "The cursor is not one this server issued.",
  );
}
