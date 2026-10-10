/**
 * @capital-q/network
 *
 * Owns: the one canonical Company ↔ Investor Organisation relationship
 * (network.relationships) and its append-only, sequence-ordered,
 * visibility-scoped history (network.relationship_events): identity, pair
 * uniqueness, ordering, provenance, the internal ensure primitive, the
 * transactional event appender and the permission-neutral query port;
 * Express Interest (CQ-NET-010: network.interests, the authorised command,
 * its idempotency record and `interest_expressed`); and the company's
 * answer (CQ-NET-011: network.interest_responses, network.matches,
 * `connection_accepted` and `interest_declined`).
 *
 * Does not own: the state projector (CQ-NET-012), disclosure
 * (CQ-PERM-001), GateQ, meetings, messaging, diligence, commitments,
 * investment outcomes, recommendations, the feed, or Q. Zero LLM calls.
 *
 *   Relationship ≠ Recommendation ≠ Impression ≠ Save ≠ Interest ≠ Match ≠ Deal
 *   current_state ≠ history; relationship ≠ disclosure permission;
 *   history ≠ audit ≠ outbox ≠ Q memory
 *
 * Deliberately absent from these exports: any relationship state setter,
 * any history update or delete, any relationship deletion, any way to
 * overwrite an answer or end a match.
 */

export {
  INTEREST_PARTIES,
  InterestIdSchema,
  InterestResponseIdSchema,
  MatchIdSchema,
  RelationshipEventIdSchema,
  RelationshipIdSchema,
  toConnectionRequestDto,
  toIncomingConnectionRequestDto,
  toIncomingInterestDto,
  toInterestDto,
  toRelationshipDto,
  toRelationshipEventSummaryDto,
  type Interest,
  type InterestDecision,
  type InterestId,
  type InterestParty,
  type InterestResponseId,
  type MatchId,
  type Relationship,
  type RelationshipEvent,
  type RelationshipEventActor,
  type RelationshipEventId,
  type RelationshipEventSource,
  type RelationshipId,
} from "./contracts/index.js";
export {
  ConnectionNotAcceptedError,
  ConnectionNotPermittedError,
  InterestAlreadyAnsweredError,
  RelationshipAlreadyConnectedError,
  InterestCompanyNotFoundError,
  InterestIdempotencyConflictError,
  InterestNotFoundError,
  InterestNotPermittedError,
  RelationshipEventTypeUnknownError,
  RelationshipEventVisibilityNotAllowedError,
  RelationshipNotFoundError,
  RelationshipPartyNotFoundError,
} from "./domain/errors.js";
export {
  ConnectionAcceptedPayloadSchema,
  ConnectionAcceptedRelationshipEvent,
  createRelationshipEventRegistry,
  defineRelationshipEvent,
  DiscoveredPayloadSchema,
  DiscoveredRelationshipEvent,
  EmailActivityPayloadSchema,
  ChatActivityPayloadSchema,
  DocumentRequestedRelationshipEvent,
  DocumentSharedRelationshipEvent,
  RELATIONSHIP_EVENT_DOCUMENT_REQUESTED,
  RELATIONSHIP_EVENT_DOCUMENT_SHARED,
  RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_REQUESTED,
  RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_GRANTED,
  MessageSentRelationshipEvent,
  RELATIONSHIP_EVENT_MESSAGE_SENT,
  MeetingActivityPayloadSchema,
  MeetingCancelledRelationshipEvent,
  MeetingHeldRelationshipEvent,
  MeetingRescheduledRelationshipEvent,
  MeetingScheduledRelationshipEvent,
  RELATIONSHIP_EVENT_MEETING_CANCELLED,
  RELATIONSHIP_EVENT_MEETING_HELD,
  RELATIONSHIP_EVENT_MEETING_RESCHEDULED,
  RELATIONSHIP_EVENT_MEETING_SCHEDULED,
  type MeetingActivityPayload,
  type ChatActivityPayload,
  OutreachSentRelationshipEvent,
  RELATIONSHIP_EVENT_OUTREACH_SENT,
  RELATIONSHIP_EVENT_REPLY_RECEIVED,
  ReplyReceivedRelationshipEvent,
  type EmailActivityPayload,
  InterestExpressedPayloadSchema,
  InterestDeclinedPayloadSchema,
  InterestDeclinedRelationshipEvent,
  InterestExpressedRelationshipEvent,
  RELATIONSHIP_EVENT_CONNECTION_ACCEPTED,
  RELATIONSHIP_EVENT_DEFINITIONS,
  RELATIONSHIP_EVENT_DISCOVERED,
  RELATIONSHIP_EVENT_INTEREST_DECLINED,
  RELATIONSHIP_EVENT_INTEREST_EXPRESSED,
  type ConnectionAcceptedPayload,
  type DiscoveredPayload,
  type InterestDeclinedPayload,
  type InterestExpressedPayload,
  type RelationshipEventDefinition,
  type RelationshipEventRegistry,
} from "./domain/event-registry.js";

export type {
  InterestRepository,
  InterestRequestStore,
  InterestResponseRepository,
  InterestResponseRequestStore,
  NewRelationshipEvent,
  RelationshipEventRepository,
  RelationshipQueryPort,
  RelationshipRepository,
} from "./application/ports.js";
export type { NetworkServiceDependencies } from "./application/dependencies.js";
export {
  createEnsureRelationship,
  RESOURCE_RELATIONSHIP,
  type EnsuredRelationship,
  type EnsureRelationshipCommand,
} from "./application/ensure-relationship.js";
export {
  createRelationshipEventAppender,
  type AppendRelationshipEventInput,
  type RelationshipEventAppender,
} from "./application/append-event.js";
export {
  createEnsureRelationshipInTransaction,
  resolveRelationshipParties,
} from "./application/ensure-relationship.js";
export {
  createExpressInterest,
  createGetOwnInterest,
  createMayExpressInterest,
  hashExpressInterestRequest,
  hashInterestIdempotencyKey,
  INVESTOR_INTEREST_EXPRESS,
  type ExpressInterestCommand,
  type ExpressInterestDependencies,
  type ExpressInterestResult,
  type InterestSurface,
} from "./application/express-interest.js";
export {
  COMPANY_INTEREST_RESPOND,
  COMPANY_INTEREST_VIEW,
  createListIncomingInterest,
  createMayRespondToInterest,
  createRespondToInterest,
  hashInterestResponseIdempotencyKey,
  hashRespondToInterestRequest,
  type IncomingInterest,
  type InterestResponseSurface,
  type RespondToInterestCommand,
  type RespondToInterestResult,
} from "./application/respond-to-interest.js";
export {
  COMPANY_CONNECTION_REQUEST,
  createGetConnectionStatus,
  createListConnectionRequests,
  createRequestConnection,
  createRespondToConnectionRequest,
  hashConnectionRequestIdempotencyKey,
  INVESTOR_CONNECTION_RESPOND,
  INVESTOR_CONNECTION_VIEW,
  type ConnectionRequestDependencies,
  type ConnectionRequestResult,
  type InboundPreference,
} from "./application/connection-requests.js";
export {
  createRelationshipStateProjector,
  readHistory,
  type RelationshipStateProjector,
} from "./application/relationship-projection.js";
export {
  createRelationshipById,
  createRelationshipForCompany,
  createRelationshipForInvestor,
  createListRelationshipsForCompany,
  createListRelationshipsForInvestor,
  toRelationshipStatusDto,
  toRelationshipSummaryDto,
  type RelationshipListing,
  type RelationshipPartyView,
  type RelationshipStatus,
} from "./application/relationship-status.js";
export {
  createRelationshipBrief,
  createRelationshipBriefs,
  deriveBriefDecisions,
  RELATIONSHIP_BRIEFS_PAGE,
  type BriefDiligenceRead,
  type BriefMeetingRead,
  type BriefThreadMessage,
  type BriefThreadSummary,
  type RelationshipBriefBatchSources,
  type RelationshipBriefSources,
} from "./application/relationship-brief.js";
export {
  createRelationshipBriefBatchSources,
  createRelationshipBriefSources,
} from "./application/relationship-brief-sources.js";
export {
  nextStepFor,
  projectorFor,
  projectRelationshipState,
  projectRelationshipStateV1,
  projectRelationshipStateV2,
  RELATIONSHIP_PROJECTOR_VERSION,
  RELATIONSHIP_PROJECTOR_VERSIONS,
  RELATIONSHIP_STATE_TRANSITIONS,
  RELATIONSHIP_STATE_TRANSITIONS_V2,
  visibleToParty,
  type ProjectableEvent,
  type RelationshipProjectorVersion,
  type RelationshipNextStep,
  type RelationshipParty,
  type RelationshipProjection,
} from "./domain/state-projector.js";
export {
  createConnectionService,
  createInterestService,
  type ConnectionService,
  type ConnectionServiceOptions,
  createNetworkService,
  type InterestService,
  type InterestServiceOptions,
  type NetworkService,
  type NetworkServiceOptions,
} from "./application/service.js";

export {
  createPostgresDiligenceRequests,
  type DiligenceRequestRecord,
  type DiligenceRequestRepository,
} from "./infrastructure/postgres-diligence.js";
export {
  createPostgresDiligenceQuestions,
  type DiligenceAnswerRecord,
  type DiligenceQuestionRecord,
  type DiligenceQuestionRepository,
} from "./infrastructure/postgres-diligence-questions.js";
export {
  createPostgresPassStandingReader,
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
} from "./infrastructure/postgres-repositories.js";
export {
  createPostgresInterestRepository,
  createPostgresInterestRequestStore,
  createPostgresInterestResponseRepository,
  createPostgresInterestResponseRequestStore,
} from "./infrastructure/postgres-interest-repositories.js";

// Founder direction 2026-09-30: money Q heard in a call.
export {
  parseSpokenAmount,
  sideOfParty,
  type SpokenAmount,
} from "./domain/commitment-signals.js";
// Spec 6.6.14-6.6.15: commitments and the fundraising view.
export {
  commitmentBucket,
  commitmentNextStep,
  createCommitmentService,
  type CommitmentLedger,
  type CommitmentOutcome,
  type CommitmentService,
  type LedgerCommitment,
  type LedgerSum,
} from "./application/commitments.js";
export { COMMITMENT_STEPS, type CommitmentStep } from "./events/index.js";
export {
  reapproachAfterPass,
  type PassStanding,
  type ReapproachEvidence,
  type ReapproachReason,
} from "./domain/reapproach.js";
export {
  createRelationshipOutcomeService,
  PROGRESS_STEPS,
  type OutcomeRefusal,
  type OutcomeResult,
  type PassReason,
  type PassRecordView,
  type ProgressStep,
  type RelationshipOutcomeService,
} from "./application/outcomes.js";
export {
  CommitmentActivityPayloadSchema,
  CommitmentConfirmedRelationshipEvent,
  CommitmentDetectedRelationshipEvent,
  CommitmentDisputedRelationshipEvent,
  CommitmentReceivedRelationshipEvent,
  CommitmentTransferSentRelationshipEvent,
  MeetingRecordingDeclinedRelationshipEvent,
  MeetingNoShowRelationshipEvent,
  RELATIONSHIP_EVENT_MEETING_NO_SHOW,
  RELATIONSHIP_EVENT_COMMITMENT_DETECTED,
  RELATIONSHIP_EVENT_COMMITMENT_DISPUTED,
  RELATIONSHIP_EVENT_COMMITMENT_RECEIVED,
  RELATIONSHIP_EVENT_COMMITMENT_TRANSFER_SENT,
  RELATIONSHIP_EVENT_MEETING_RECORDING_DECLINED,
  CommitmentStatedRelationshipEvent,
  CommitmentWithdrawnRelationshipEvent,
  RELATIONSHIP_EVENT_COMMITMENT_CONFIRMED,
  RELATIONSHIP_EVENT_COMMITMENT_STATED,
  RELATIONSHIP_EVENT_COMMITMENT_WITHDRAWN,
  type CommitmentActivityPayload,
} from "./domain/event-registry.js";

// Deal close (2026-10-08): terms, signature, close, reports on the ONE
// relationship; the stage strip is deal-stage.v1's reading of its history.
export {
  CLOSE_CHECKLIST,
  DEAL_STAGES,
  DEAL_STAGE_VERSION,
  dealNextSteps,
  draftPassNote,
  projectDealStage,
  postCloseCadence,
  type DealEnd,
  type DealStage,
  type DealStageProjection,
  type DealStep,
} from "./domain/deal-stage.js";
export {
  compileReport,
  DEAL_REPORT_COMPILER,
  moneyText,
  REPORT_POLICY,
  reportDate,
  reportDigest,
  type ReportFacts,
} from "./domain/deal-reports.js";
export {
  createDealCloseService,
  type DealCloseService,
  type DealMeetingNote,
  type DealRefusal,
  type DealResult,
  type ReportResult,
} from "./application/deal-close.js";
export {
  RELATIONSHIP_EVENT_DEAL_CLOSED,
  RELATIONSHIP_EVENT_DEAL_TERMS_RECORDED,
  RELATIONSHIP_EVENT_DEAL_TERMS_SIGNED,
} from "./domain/event-registry.js";

export const PACKAGE_NAME = "@capital-q/network" as const;
