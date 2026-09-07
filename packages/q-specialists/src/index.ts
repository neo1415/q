/**
 * @capital-q/q-specialists
 *
 * Owns: the bounded Q specialist contract (CQ-Q-020 §7-§11) and the
 * Company Intelligence specialist — deterministic assembly over canonical
 * structured state, authorised Q Knowledge and authorised hybrid
 * retrieval, one governed model call through the Model Gateway, and
 * structured institutional findings whose citations resolve to references
 * the server supplied.
 *
 * Does not own: the run lifecycle (q-runtime), orchestration
 * (q-orchestrator), the Context Firewall (q-firewall), prompts (q-core),
 * models or providers (model-gateway), tools (q-tools), knowledge or
 * retrieval (q-knowledge), or any database.
 *
 *   Company Intelligence ≠ InvestIQ
 *   Company Intelligence ≠ matching ≠ recommendation ≠ investor fit
 *   Company Intelligence ≠ the canonical Company domain
 *   a specialist ≠ an agent a person talks to
 *
 * There is no provider SDK, no SQL, no HTTP client, no write and no
 * scoring anywhere in this package, and a person never learns it ran.
 */

export {
  Q_SPECIALIST_BLOCKED_REASONS,
  specialistVersionId,
  type QSpecialist,
  type QSpecialistBlockedReason,
  type QSpecialistExecutionContext,
  type QSpecialistFinding,
  type QSpecialistProbe,
} from "./contracts.js";

export {
  assembleCompanyContext,
  COMPANY_CONTEXT_MAX_FACTS,
  knowledgeToFact,
  labelAt,
  passageToFact,
  type AssembledCompanyContext,
  type CompanyContextInput,
  type LabelledFact,
} from "./company/assembly.js";
export type {
  CompanyContradictionFinding,
  CompanyDimensionCoverage,
  CompanyFinding,
  CompanyIntelligenceFocus,
  CompanyIntelligenceRequest,
  CompanyIntelligenceResult,
  CompanyIntelligenceTelemetry,
  CompanyMaterialChangeFinding,
} from "./company/contracts.js";
export {
  contradictionFindings,
  coverageByDimension,
  deterministicFindings,
  informationConfidence,
  institutionalNotes,
  materialChangeFindings,
  type DeterministicInput,
} from "./company/deterministic.js";
export {
  asksAboutChange,
  asksAboutGaps,
  dimensionForKnowledgeKey,
  focusFromQuestion,
} from "./company/dimensions.js";
export {
  COMPANY_KNOWLEDGE_LIMIT,
  COMPANY_PASSAGE_LIMIT,
  createKnowledgeCompanyPort,
  createRetrievalEvidencePort,
  createToolCanonicalPort,
} from "./company/adapters.js";
export type {
  CompanyCanonicalPort,
  CompanyEvidencePort,
  CompanyKnowledgePort,
} from "./company/ports.js";
export {
  COMPANY_INTELLIGENCE_ID,
  COMPANY_INTELLIGENCE_VERSION,
  createCompanyIntelligenceSpecialist,
  type CompanyIntelligenceDependencies,
} from "./company/specialist.js";
export {
  assertsAbsence,
  assertsForbiddenClaim,
  boundedTruthClass,
  validateModelFindings,
  type FindingValidation,
  type ValidationInput,
} from "./company/validation.js";

export {
  createSpecialistQAnswer,
  type SpecialistQAnswer,
  type SpecialistQAnswerDependencies,
} from "./answer.js";

export const PACKAGE_NAME = "@capital-q/q-specialists" as const;
