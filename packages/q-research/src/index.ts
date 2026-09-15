/**
 * @capital-q/q-research — controlled public-web research (CQ-Q-RESEARCH-001).
 *
 * Owns: the provider-neutral PublicWebResearchProvider port (search and
 * extract, nothing else); the outbound egress composer that decides which
 * words may leave Capital Q in a query; public-URL safety; bounded,
 * instruction-scanned excerpts; deterministic comparison notes between
 * public sources and the subject's recorded public identity; and the
 * research service Q's tools call.
 *
 * Does not own: truth (public material is unverified until the Evidence and
 * Knowledge contexts say otherwise), canonical company or investor state,
 * any table, the vendor (behind `./providers/tavily` only), or a model.
 *
 * Invariants: a search result is not a claim; a public page is untrusted
 * data and never instruction; a query is composed from allowed terms, never
 * forwarded; extract reads only URLs a search in the same run surfaced.
 */

export {
  PUBLIC_WEB_FRESHNESS,
  PublicUrlSchema,
  PublicWebExtractRequestSchema,
  PublicWebExtractResultSchema,
  PublicWebFreshnessSchema,
  PublicWebSearchHitSchema,
  PublicWebSearchRequestSchema,
  PublicWebSearchResultSchema,
  RESEARCH_BOUNDS,
  RESEARCH_PROVIDER_CODES,
  RESEARCH_PROVIDER_FAILURE_CLASSES,
  PublicCompanyProfileSchema,
  PublicPersonProfileSchema,
  PublicProfileLookupRequestSchema,
  PublicProfileLookupResultSchema,
  type PublicCompanyProfile,
  type PublicPersonProfile,
  type PublicProfileLookupRequest,
  type PublicProfileLookupResult,
  type PublicWebExtractRequest,
  type PublicWebExtractResult,
  type PublicWebExtractedPage,
  type PublicWebFreshness,
  type PublicWebSearchHit,
  type PublicWebSearchRequest,
  type PublicWebSearchResult,
  type ResearchProviderCode,
  type ResearchProviderFailureClass,
} from "./contracts.js";
export {
  isResearchProviderFailure,
  ResearchProviderFailure,
  type PublicProfileLookupProvider,
  type PublicWebResearchProvider,
  type ResearchExecutionContext,
} from "./ports.js";
export {
  judgePublicUrl,
  publicDomainOf,
  URL_REJECTION_REASONS,
  type UrlRejectionReason,
  type UrlSafetyVerdict,
} from "./domain/url-safety.js";
export {
  composeEgressQuery,
  containsAny,
  tokenise,
  type EgressInput,
  type EgressOutcome,
} from "./domain/egress.js";
export {
  COUNTRIES,
  countryName,
  mentionedCountries,
  type CountryEntry,
} from "./domain/geography.js";
export {
  boundExcerpt,
  cleanPublicText,
  INSTRUCTION_RISK_CATEGORIES,
  scanExcerptForInstructions,
  type BoundedExcerpt,
  type InstructionRiskCategory,
} from "./domain/excerpt.js";
export {
  COMPARISON_BASES,
  COMPARISON_RELATIONSHIPS,
  compareSourcesWithSubject,
  TEMPORAL_CLASSES,
  temporalClassOf,
  type ComparableSource,
  type ComparableSubject,
  type ComparisonBasis,
  type ComparisonNote,
  type ComparisonRelationship,
  type TemporalClass,
} from "./domain/comparison.js";
export {
  createPublicWebResearchService,
  type ExtractCommand,
  type ExtractOutcome,
  type PublicWebResearchService,
  type PublicWebResearchServiceDependencies,
  type ResearchBudgetUsed,
  type ResearchCommand,
  type ResearchedSource,
  type ResearchEvidenceRecorder,
  type ResearchOutcome,
  type ResearchSubject,
} from "./application/research-service.js";
