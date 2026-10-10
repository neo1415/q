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
  normaliseWebAddress,
  publicDomainOf,
  webAddressesIn,
  URL_REJECTION_REASONS,
  type UrlRejectionReason,
  type UrlSafetyVerdict,
} from "./domain/url-safety.js";
export {
  composeEgressQuery,
  containsAny,
  searchPhrase,
  tokenise,
  type EgressInput,
  type EgressOutcome,
} from "./domain/egress.js";
export {
  ENTITY_RESOLUTIONS,
  RANKING_VERSION,
  SUBJECT_MATCHES,
  type EntityResolution,
  type EntityResolutionStatus,
  type SubjectMatch,
} from "./domain/ranking.js";
export {
  COUNTRIES,
  countryName,
  mentionedCountries,
  regionCountries,
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

// W2 (2026-10-10): the fast public person-identity path.
export {
  createPersonSearch,
  externalPersonIdFor,
  PERSON_SEARCH_BUDGET,
  planPersonQueries,
  sourcesOfCandidate,
  type PersonCallTrace,
  type PersonQueryKind,
  type PersonSearchCommand,
  type PersonSearchDependencies,
  type PersonSearchRun,
  type PlannedPersonQuery,
} from "./application/person-search.js";
export {
  allSpellings,
  basicNameVariants,
  clarifyingQuestionFor,
  decideIdentity,
  linkedInProfileOf,
  namesPerson,
  profileFactsOf,
  rankCandidates,
  type IdentityDecision,
  type PersonCandidate,
  type PersonSpec,
  type SourcedHit,
} from "./domain/person-identity.js";
export {
  aliasKeyOf,
  cardFromKnownEntity,
  createInMemoryKnownEntityStore,
  createKnownEntityIndex,
  knownEntityResult,
  preparedEntityIdFor,
  type EntityFactRecord,
  type EntitySourceRecord,
  type KnownEntityIndex,
  type KnownEntityRecord,
  type KnownEntityStore,
  type KnownLookup,
  type PreparedEntityUpsert,
} from "./application/known-entities.js";
export {
  createPersonLookup,
  type PersonBriefRequest,
  type PersonBriefResult,
  type PersonLookup,
  type PersonLookupCommand,
  type ResearchedEntityReader,
  type PersonLookupOutcome,
} from "./application/person-lookup.js";
export {
  admitAssertions,
  BRIEF_FRESH_DAYS,
  quoteOccursIn,
  roleContradictions,
  STALE_AFTER_DAYS,
  withUnknowns,
  type AdmissionOutcome,
  type BriefSource,
  type ProposedAssertion,
} from "./domain/person-brief.js";
export {
  briefFromKnownEntity,
  createPersonBriefService,
  type PersonBriefCommand,
  type PersonBriefOutcome,
  type PersonBriefSynthesiser,
  type ResearchedEntityScope,
  type ResearchedEntityStore,
} from "./application/person-brief-service.js";

// D1 (2026-10-10): investor discovery by meaning.
export {
  createCounterpartDiscovery,
  DISCOVERY_COUNT,
  DISCOVERY_WEB_BUDGET_MS,
  publicTerm,
  type CounterpartAsk,
  type CounterpartDiscoverer,
  type CounterpartDiscovery,
  type DiscoveredCounterpart,
  type DiscoveryPersist,
} from "./application/counterpart-discovery.js";
