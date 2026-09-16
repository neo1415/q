/**
 * @capital-q/discovery — who an investor or a founder could reasonably
 * meet (doc 19).
 *
 * Owns: hard eligibility, candidate generation, declared hard exclusions,
 * explicit fit over declared fields, and one deterministic ranking with a
 * versioned weight set.
 *
 * Does not own: canonical company or investor state, mandates, GateQ
 * rules, relationships, or any notion of interest. It writes nothing.
 *
 * Invariants: no model runs in this path; the slate is reproducible from
 * the rows alone; hard exclusions come only from declared rules; viewing
 * is not interest and behaviour is never read; an investor is matched
 * against their own mandate and a founder is never matched against
 * somebody else's.
 */

export {
  DISCOVERY_CANDIDATE_MAX,
  DISCOVERY_LIMIT_DEFAULT,
  DISCOVERY_LIMIT_MAX,
  DISCOVERY_NOTES,
  DISCOVERY_RANKING_VERSION,
  DISCOVERY_REASON_KINDS,
  DiscoveredCompanySchema,
  DiscoveredInvestorSchema,
  DiscoveryCompanySlateSchema,
  DiscoveryInvestorSlateSchema,
  DiscoveryNoteSchema,
  DiscoveryReasonKindSchema,
  DiscoveryReasonSchema,
  type DiscoveredCompany,
  type DiscoveredInvestor,
  type DiscoveryCompanySlate,
  type DiscoveryInvestorSlate,
  type DiscoveryNote,
  type DiscoveryReason,
  type DiscoveryReasonKind,
} from "./contracts.js";

export {
  declaredProfileFit,
  explicitFit,
  isExcluded,
  STAGE_LADDER,
  stageInRange,
  type DeclaredClassification,
  type DeclaredPreference,
  type FitOutcome,
} from "./domain/fit.js";

export {
  PREFERENCE_WEIGHT,
  preferenceWeight,
  rankCompanies,
  rankInvestors,
  reasonKindForVocabulary,
  SIGNAL_WEIGHT,
} from "./domain/ranking.js";

export type {
  CandidateCompany,
  CandidateInvestor,
  DiscoveryDisclosurePort,
  DiscoveryRepository,
  DiscoverySide,
  OwnMandate,
} from "./ports.js";

export {
  createDiscoveryService,
  type DiscoverQuery,
  type DiscoveryService,
  type DiscoveryServiceDependencies,
} from "./application/discover.js";

export { createPostgresDiscoveryRepository } from "./infrastructure/postgres-discovery-repository.js";

export const PACKAGE_NAME = "@capital-q/discovery" as const;
