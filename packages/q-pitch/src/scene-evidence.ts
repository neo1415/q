import { z } from "zod";

import { MarketplaceVisibilitySchema } from "@capital-q/contracts";

import { TourActionKindSchema } from "./tour-action.js";

/**
 * Tour Evidence Manifest record, one per scene, per environment, per
 * release (blueprint §9). The field set is the blueprint's table exactly:
 *
 *   Identity      sceneId scriptVersion appCommit fixtureVersion featureId approvedClaimIds
 *   Scope         actorContext allowedSourceIds allowedResourceIds sourceSensitivity validUntil
 *   Behaviour     requiredCapabilities expectedRoute expectedUI actionContracts fallbackScene
 *   Facts         facts (each with sourceTimestamp, claimKind, confidence, permissions)
 *   Verification  verifiedAt verifierType receipt auditLink (the redacted audit link)
 *   Prefetch      prefetch
 *
 * It states what may be claimed and demonstrated. It is NOT Q memory, and
 * it never holds secrets, raw private transcripts or another role's data.
 */

export const SceneIdSchema = z.string().regex(/^s\.[a-z0-9][a-z0-9.-]{1,62}$/u);
export type SceneId = z.infer<typeof SceneIdSchema>;

/** Atlas feature id, as CERTIFICATION_MANIFEST.md names them. */
export const FeatureIdSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/u);
export type FeatureId = z.infer<typeof FeatureIdSchema>;

/** A certified claim: `<featureId>.c<n>` (one ledger entry's allowed claim). */
export const ClaimIdSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+\.c[0-9]{1,3}$/u);
export type ClaimId = z.infer<typeof ClaimIdSchema>;

export function featureOfClaim(claimId: ClaimId): FeatureId {
  return claimId.slice(0, claimId.lastIndexOf("."));
}

export const GitShaSchema = z.string().regex(/^[0-9a-f]{7,40}$/u);

/**
 * The demo identity a scene is shown as. Fictional accounts only
 * (blueprint §4 and audit QP-F03): never a real person's account, and the
 * server still decides everything this identity may read.
 */
export const TOUR_ROLES = ["INVESTOR", "FOUNDER", "GUEST_APPLICANT"] as const;
export const TourRoleSchema = z.enum(TOUR_ROLES);
export type TourRole = z.infer<typeof TourRoleSchema>;

export const FICTIONAL_ACCOUNT_DOMAIN = "@fictional.capitalq.local";

export const TourActorSchema = z
  .object({
    role: TourRoleSchema,
    account: z
      .email()
      .max(200)
      .refine(
        (email) => email.toLowerCase().endsWith(FICTIONAL_ACCOUNT_DOMAIN),
        {
          message: "a tour actor is a fictional demo account",
        },
      ),
  })
  .strict();
export type TourActor = z.infer<typeof TourActorSchema>;

export function sameActor(a: TourActor, b: TourActor): boolean {
  return (
    a.role === b.role && a.account.toLowerCase() === b.account.toLowerCase()
  );
}

/** Re-certification due: a time, or a change that invalidates the entry. */
export const ValidUntilSchema = z.union([
  z.object({ at: z.iso.datetime({ offset: true }) }).strict(),
  z.object({ invalidatedBy: z.string().trim().min(1).max(300) }).strict(),
]);
export type ValidUntil = z.infer<typeof ValidUntilSchema>;

/**
 * Blueprint §9 claim kinds. ADR-001 keeps truth class as its own axis with
 * different words; `truthClassOfClaimKind` maps them (flagged in the
 * report: the blueprint has no ESTIMATE, ADR-001 has no STATED).
 */
export const CLAIM_KINDS = [
  "VERIFIED",
  "STATED",
  "INFERRED",
  "UNKNOWN",
] as const;
export const ClaimKindSchema = z.enum(CLAIM_KINDS);
export type ClaimKind = z.infer<typeof ClaimKindSchema>;

export function truthClassOfClaimKind(
  kind: ClaimKind,
): "VERIFIED" | "USER_CLAIM" | "Q_INFERENCE" | "UNKNOWN" {
  switch (kind) {
    case "VERIFIED":
      return "VERIFIED";
    case "STATED":
      return "USER_CLAIM";
    case "INFERRED":
      return "Q_INFERENCE";
    case "UNKNOWN":
      return "UNKNOWN";
  }
}

/** Qualitative only: no invented confidence percentages (CLAUDE.md). */
export const SCENE_CONFIDENCE = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export const SceneConfidenceSchema = z.enum(SCENE_CONFIDENCE);

export const SceneFactSchema = z
  .object({
    claimId: ClaimIdSchema,
    statement: z.string().trim().min(1).max(500),
    sourceTimestamp: z.iso.datetime({ offset: true }).nullable(),
    claimKind: ClaimKindSchema,
    confidence: SceneConfidenceSchema,
    /** Capability codes the actor must hold for this fact to be shown. */
    permissions: z.array(z.string().regex(/^[a-z][a-z0-9_.]{1,80}$/u)).max(16),
  })
  .strict();
export type SceneFact = z.infer<typeof SceneFactSchema>;

export const VERIFIER_TYPES = ["CODE", "CI", "BROWSER", "HUMAN"] as const;
export const VerifierTypeSchema = z.enum(VERIFIER_TYPES);

const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/u);

export const SceneEvidenceSchema = z
  .object({
    // Identity
    sceneId: SceneIdSchema,
    scriptVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$/u),
    appCommit: GitShaSchema,
    fixtureVersion: z.string().trim().min(1).max(80),
    featureId: FeatureIdSchema,
    approvedClaimIds: z.array(ClaimIdSchema).min(1).max(32),
    // Scope
    actorContext: TourActorSchema,
    allowedSourceIds: z.array(OpaqueIdSchema).max(64),
    allowedResourceIds: z.array(OpaqueIdSchema).max(64),
    sourceSensitivity: MarketplaceVisibilitySchema,
    validUntil: ValidUntilSchema,
    // Behaviour
    requiredCapabilities: z
      .array(z.string().regex(/^[a-z][a-z0-9_.]{1,80}$/u))
      .max(32),
    /** An app route pattern ("/company/[companyId]"), never a URL. */
    expectedRoute: z.string().regex(/^\/[A-Za-z0-9/_[\]-]{0,200}$/u),
    /** Registered control ids or result-block kinds expected on screen. */
    expectedUI: z
      .array(z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,80}$/u))
      .max(32),
    actionContracts: z.array(TourActionKindSchema).min(1).max(16),
    fallbackScene: SceneIdSchema.nullable(),
    // Facts
    facts: z.array(SceneFactSchema).max(32),
    // Verification
    verifiedAt: z.iso.datetime({ offset: true }),
    verifierType: VerifierTypeSchema,
    /** A path or reference; private receipts are never inlined. */
    receipt: z.string().trim().min(1).max(300),
    auditLink: z.string().trim().min(1).max(300).nullable(),
    // Prefetch: safe UI data/media for THIS actor only.
    prefetch: z
      .object({
        routes: z
          .array(z.string().regex(/^\/[A-Za-z0-9/_[\]-]{0,200}$/u))
          .max(4),
        mediaIds: z.array(OpaqueIdSchema).max(8),
      })
      .strict(),
  })
  .strict()
  .refine(
    (e) => e.facts.every((fact) => e.approvedClaimIds.includes(fact.claimId)),
    {
      message: "every fact is one of the scene's approved claims",
      path: ["facts"],
    },
  )
  .refine((e) => e.fallbackScene !== e.sceneId, {
    message: "a scene cannot be its own fallback",
    path: ["fallbackScene"],
  });
export type SceneEvidence = z.infer<typeof SceneEvidenceSchema>;
