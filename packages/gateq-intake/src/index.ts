/**
 * `@capital-q/gateq-intake` — the applicant side of GateQ (CQ-GATE-002).
 *
 *   application ≠ canonical Company
 *   applicant said it ≠ verified fact
 *   draft ≠ submitted;  submission is the disclosure boundary
 *   guest session ≠ membership ≠ capability
 *   model proposal ≠ recorded truth
 *
 * A stranger with no Capital Q account can open an application at a
 * published gateway, be interviewed, leave, come back, and submit. This
 * package owns what that produces: the application, the guest credential
 * that carries it, everything they told us with its provenance, and the
 * frozen snapshot the organisation receives.
 *
 * It owns no gateway (GateQ does), no document bytes (Evidence does), no
 * company (Companies does) and no conversation (the Q runtime does). It
 * decides no qualification: GATE-001's deterministic engine does that,
 * from a bounded projection, under the policy version the application was
 * bound to when it was created.
 */

export * from "./contracts/index.js";

export {
  applicationProjection,
  type ResolvedClassification,
} from "./domain/projection.js";
export { factsFromAnswers } from "./domain/form-answers.js";
export {
  createGuestThrottle,
  GATEQ_GUEST_OPERATIONS,
  GATEQ_GUEST_QUOTAS,
  type GateQGuestOperation,
  type GuestQuota,
  type GuestThrottle,
} from "./domain/throttle.js";
export {
  generateApplicationReference,
  hashSessionToken,
  issueSessionToken,
  sessionTokenMatches,
  SESSION_LIFETIME_MS,
} from "./domain/session-credential.js";

export {
  createConversationService,
  type ApplicantTurnResult,
  type ConversationDependencies,
  type ConversationService,
} from "./application/conversation-service.js";
export {
  createGateQInterviewer,
  InterviewUnavailableError,
  type GateQInterviewer,
  type InterviewChannel,
  type InterviewerDependencies,
  type InterviewTurnInput,
  type InterviewTurnOutcome,
} from "./application/interviewer.js";
export {
  contradictionsIn,
  questionNeedsFor,
  type QuestionNeed,
} from "./application/question-needs.js";
export {
  coverageFor,
  DIMENSION_LABELS,
  explainQualification,
  factSummary,
  INVESTMENT_DIMENSIONS,
} from "./application/coverage.js";
export {
  buildDossier,
  withDerivedAmountsMarked,
} from "./application/dossier.js";
export { amountStatedIn, amountsIn } from "./application/stated-amount.js";
export {
  citedSynthesis,
  createDossierSynthesis,
  GATEQ_SYNTHESIS_PROMPT_VERSION,
  synthesisContext,
  type DossierSynthesis,
  type PendingSynthesis,
  type SynthesisStore,
} from "./application/dossier-synthesis.js";
export {
  contactDto,
  CONTACT_CODE_MAX_ATTEMPTS,
  CONTACT_CODE_TTL_MINUTES,
  createIntakeService,
  transcriptDto,
  type ContactCodeMailer,
  type ContactDetails,
  type GuestContext,
  type IntakeDependencies,
  type IntakeService,
  type StartApplicationResult,
} from "./application/intake-service.js";
export type {
  ApplicationContactRepository,
  ApplicationDocumentRepository,
  ApplicationFactRepository,
  ApplicationRepository,
  ApplicationSessionRepository,
  ApplicationSubmissionRepository,
  ApplicationTurnRepository,
  BoundPolicyPort,
  ContactChannel,
  DocumentTitlesPort,
  StoredContact,
  StoredTurn,
  TaxonomyResolutionPort,
} from "./application/ports.js";
// GateQ slice 1: the dossier and coverage contracts live with the HTTP
// contracts so the inbox DTO can carry them; re-exported here as intake's.
export {
  GATEQ_DOSSIER_SCHEMA_VERSION,
  GateqCoverageV1Schema,
  GateqDossierV1Schema,
  type GateqCoverageV1,
  type GateqDossierV1,
} from "@capital-q/contracts";

export {
  createPostgresApplicationContactRepository,
  createPostgresApplicationDocumentRepository,
  createPostgresApplicationFactRepository,
  createPostgresApplicationRepository,
  createPostgresApplicationSessionRepository,
  createPostgresApplicationSubmissionRepository,
  createPostgresApplicationTurnRepository,
} from "./infrastructure/postgres-intake-repositories.js";

export {
  createPostgresSubmissionInbox,
  type SubmissionInbox,
  type SubmittedApplication,
} from "./infrastructure/postgres-submission-inbox.js";

export const PACKAGE_NAME = "@capital-q/gateq-intake" as const;

// F4: the investor's GateQ inbox.
export * from "./inbox/domain.js";
export {
  buildPack,
  crc32,
  packFileName,
  PACK_SCHEMA_VERSION,
  summaryPdf,
  zipEntries,
  type PackFile,
  type PackInput,
} from "./inbox/pack.js";
export type {
  InboxActivity,
  InboxActivityKind,
  InboxAuthority,
  InboxFolder,
  InboxGateway,
  InboxRepository,
  InboxRow,
  SharedDocumentPort,
} from "./inbox/ports.js";
export {
  createInboxService,
  type InboxChanged,
  type InboxRefused,
  type InboxService,
} from "./inbox/service.js";
export { createPostgresInboxRepository } from "./infrastructure/postgres-inbox.js";
export { createPostgresSynthesisStore } from "./infrastructure/postgres-syntheses.js";
export {
  createGateqInbox,
  gateqInboxActionsPort,
  gateqInboxAuthority,
  ownGatewayIdFrom,
} from "./inbox/compose.js";
export {
  createRelationshipGateqApplications,
  type RelationshipGateqApplication,
} from "./inbox/relationship-applications.js";
export { createStartupAlerts, type StartupAlerts } from "./find/alerts.js";
export {
  createPostgresApplicationFounders,
  founderRules,
  type ApplicationFounders,
  type FounderApplication,
} from "./infrastructure/postgres-application-founders.js";

// P14: founders hear GateQ answers by email.
export {
  recipientDomain as gateqRecipientDomain,
  renderApplicationContactCodeEmail,
  renderClaimCodeEmail,
  renderGateqAnswerEmail,
  sendLogged as sendGateqEmailLogged,
  type GateqEmailEvent,
  type GateqEmailKind,
  type GateqOutboundSender,
} from "./inbox/founder-mail.js";

export {
  DisclosureDocumentIdentitySchema,
  DisclosureLineageSchema,
  projectSelectedDisclosure,
  disclosureLineageFromContext,
  APPLICANT_TEXT_LINEAGE,
  type DisclosureDocumentIdentity,
  type DisclosureLineage,
} from "./application/disclosure-projection.js";

// C3: the GateQ video interview session (provider-neutral) and its store.
export {
  createGateqVideoInterview,
  effectiveMaxSeconds,
  GATEQ_VIDEO_DEFAULTS,
  gateqVideoConfigFrom,
  GateqVideoRefusedError,
  type GateqVideoConfig,
  type GateqVideoInterview,
  type GateqVideoProvider,
  type GateqVideoRefusal,
  type GateqVideoSealer,
  type GateqVideoSessionRow,
  type GateqVideoSessionStore,
  type GateqVideoAllowance,
  type GateqVideoUnavailableReason,
  type GateqVideoSessionView,
} from "./video/video-interview.js";
export { createPostgresGateqVideoSessions } from "./video/postgres-video-sessions.js";
