import { z } from "zod";

/**
 * ADR-001 Decision 2: truth, evidence support and lifecycle are three
 * independent axes and are never one enum. They are shared vocabulary
 * because Evidence (CQ-EVD-001), Q Knowledge and InvestIQ all classify
 * information on the same scales; only the Evidence context persists them
 * in this packet.
 *
 *   truth_class       what kind of statement this is
 *   evidence_status   how it is supported
 *   lifecycle_status  whether it is still the live assertion
 *
 * UNKNOWN is a real, valid value: absence of information is never
 * converted into zero, false or "poor".
 */
export const TRUTH_CLASSES = [
  "VERIFIED",
  "USER_CLAIM",
  "ESTIMATE",
  "Q_INFERENCE",
  "UNKNOWN",
] as const;
export const TruthClassSchema = z.enum(TRUTH_CLASSES);
export type TruthClass = z.infer<typeof TruthClassSchema>;

export const EVIDENCE_STATUSES = [
  "NO_EVIDENCE",
  "SELF_REPORTED",
  "DOCUMENT_SUPPORTED",
  "MULTI_SOURCE_SUPPORTED",
  "EXTERNALLY_VERIFIED",
  "PLATFORM_VERIFIED",
] as const;
export const EvidenceStatusSchema = z.enum(EVIDENCE_STATUSES);
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

export const LIFECYCLE_STATUSES = [
  "CURRENT",
  "HISTORICAL",
  "SUPERSEDED",
  "DISPUTED",
  "CONTRADICTORY",
  "STALE",
] as const;
export const LifecycleStatusSchema = z.enum(LIFECYCLE_STATUSES);
export type LifecycleStatus = z.infer<typeof LifecycleStatusSchema>;

/**
 * Source reliability (doc 14 §43). Describes source quality, never truth:
 * an authoritative source can still be outdated. Assessed reliability is
 * optional in CQ-EVD-001; no numeric weighting methodology exists yet.
 */
export const RELIABILITY_CLASSES = [
  "PRIMARY_VERIFIED",
  "PRIMARY_UNVERIFIED",
  "AUTHORITATIVE_EXTERNAL",
  "CREDIBLE_EXTERNAL",
  "SECONDARY_EXTERNAL",
  "USER_STATEMENT",
  "MODEL_DERIVED",
  "UNKNOWN",
] as const;
export const ReliabilityClassSchema = z.enum(RELIABILITY_CLASSES);
export type ReliabilityClass = z.infer<typeof ReliabilityClassSchema>;
