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
  createIntakeService,
  type GuestContext,
  type IntakeDependencies,
  type IntakeService,
  type StartApplicationResult,
} from "./application/intake-service.js";
export type {
  ApplicationDocumentRepository,
  ApplicationFactRepository,
  ApplicationRepository,
  ApplicationSessionRepository,
  ApplicationSubmissionRepository,
  BoundPolicyPort,
  TaxonomyResolutionPort,
} from "./application/ports.js";

export {
  createPostgresApplicationDocumentRepository,
  createPostgresApplicationFactRepository,
  createPostgresApplicationRepository,
  createPostgresApplicationSessionRepository,
  createPostgresApplicationSubmissionRepository,
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
export {
  createGateqInbox,
  gateqInboxActionsPort,
  gateqInboxAuthority,
  ownGatewayIdFrom,
} from "./inbox/compose.js";
export { createStartupAlerts, type StartupAlerts } from "./find/alerts.js";
export {
  createPostgresApplicationFounders,
  type ApplicationFounders,
  type FounderApplication,
} from "./infrastructure/postgres-application-founders.js";

// P14: founders hear GateQ answers by email.
export {
  recipientDomain as gateqRecipientDomain,
  renderGateqAnswerEmail,
  type GateqEmailEvent,
  type GateqEmailKind,
  type GateqOutboundSender,
} from "./inbox/founder-mail.js";
