/**
 * Cross-context evidence vocabulary (ADR-001). The Evidence bounded context
 * (`@capital-q/evidence`) owns the tables and the richer entity contracts;
 * only the shared scales live here so Q Knowledge and InvestIQ never
 * redefine them.
 */
export {
  EVIDENCE_STATUSES,
  EvidenceStatusSchema,
  LIFECYCLE_STATUSES,
  LifecycleStatusSchema,
  RELIABILITY_CLASSES,
  ReliabilityClassSchema,
  TRUTH_CLASSES,
  TruthClassSchema,
  type EvidenceStatus,
  type LifecycleStatus,
  type ReliabilityClass,
  type TruthClass,
} from "./vocabulary.js";
