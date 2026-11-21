import { randomUUID } from "node:crypto";

import {
  followsUpPublicSources,
  namedInTheirWords,
  publicResearchFollowUp,
  type SelectedCompany,
} from "./research-follow-up.js";

import { z } from "zod";

import {
  GetRelationshipOutputSchema,
  type DiligenceFollowUp,
} from "@capital-q/q-tools";

import { carriesScreenMove, withoutUnaskedMoves } from "./unasked-moves.js";
import {
  asksForComparison,
  asksForPipelineSummary,
  comparisonLead,
  researchLead,
  pipelineLead,
  PIPELINE_NOTE,
} from "./early-lead.js";
import {
  asksWhoCanSeeDataRoom,
  dataRoomAccessStatement,
} from "./data-room-access.js";
import {
  companiesMapAskOf,
  mayDrawCompaniesMap,
  runCompaniesMap,
  type CompaniesMapAnswer,
  type CompaniesMapAsk,
} from "./companies-map.js";
import {
  DO_IT_NOW_NOTE,
  defersAskedWork,
  withoutDeferredWork,
} from "./deferred-work.js";

import {
  MODEL_TOOLS_MAX,
  MODEL_TOOL_CALLS_MAX,
  QClientActionToolResultSchema,
  QDocumentToolResultSchema,
  QMessageIdSchema,
  UncertaintyStandingSchema,
  type ModelMessage,
  type ModelDataPosture,
  type ModelSensitivity,
  type ModelToolCall,
  type PermittedContextPlan,
  type QResultBlock,
  type QAccountDigest,
  type QResponseMessage,
  type QSpokenForm,
  type TurnExecutionClass,
  type QStageAbout,
  type QVisibleStage,
} from "@capital-q/contracts";
import { withRoundTripPhase } from "@capital-q/database";
import {
  personTimeZone,
  situationHeader,
  situationSurfaceOf,
} from "./situation-header.js";
import {
  createSentenceCutter,
  EXECUTION_LANES,
  spokenFormWithin,
  citeAuthorisedFacts,
  withoutPublicSourceLabels,
  publicSourceBlockFields,
  type AuthorisedFact,
  type PublicSourceLike,
  type CompanyAnalystV30Result,
  gesturesForReply,
  DisplayNameRequestSchema,
  NOTHING_REMEMBERED,
  ProfileUpdateSchema,
  type CompanyAnalystV4Variables,
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  PromptRenderError,
  bundleVersionOf,
  isEmptyPromise,
  stripEmptyPromises,
  withoutRecommendationClaims,
  inFirstPerson,
  createCaveatGuard,
  withOneCaveat,
  type RecommendationGrounds,
  quietlyNoted,
  statesSomething,
  dailyFollowUpKind,
  ModelFindingSchema,
  inTurnLanguage,
  streamedPiece,
  asksForOnePage,
  templateRulesHead,
  endsWithOffer,
  naturalRegisterIssues,
} from "@capital-q/q-core";

import { fittedVariables } from "./prompt-variables-fit.js";

import { createStageClock } from "./stage-clock.js";
import {
  appendRunEvent,
  appendRunEventAtomic,
  createUnconfiguredQTools,
  toQMessage,
  type QLiveDeltaBus,
  type QAnswerOutcome,
  type QAnswerRequest,
  type QOfferedTool,
  type QToolCallOutcome,
  type QToolExecutionContext,
  type QToolPort,
  ownsOnboarding,
} from "@capital-q/q-runtime";

import { isModelGatewayError } from "../errors.js";
import { createPartialAnswerReader } from "../policy/partial-answer.js";
import { createPartialFindingsReader } from "../policy/partial-findings.js";
import type { ModelGatewayExecuteOptions } from "../gateway.js";
import { acceptStructuredOutput } from "../policy/structured.js";
import {
  claimsChangeStatus,
  withoutActionTalk,
  withoutRestatedLines,
  withoutStatusTalk,
} from "./action-talk.js";
import { createSubjectAnnouncer } from "./artifact-preview.js";
import {
  createRunCompanies,
  containsCompanyName,
  namedCompanySubjects,
  withCardSubjects,
  type RunRead,
} from "./card-subjects.js";
import { stageAbout, stageKey } from "./stage-subjects.js";
import {
  createRunFits,
  fitAnswerCardsBlock,
  withPlatformFit,
  withReadableSourceCounts,
  isPlatformFitCard,
  fitCardsSummary,
  fitSweepCardsBlock,
  fitSweepSummary,
  fitsInOutcome,
  groundedFitWords,
  hasOrphanListItems,
  spokenBeforeCards,
  type RunFit,
} from "./fit-cards.js";
import {
  fitSweepAsk,
  fitSweepAskOfReading,
  withReadCount,
  isSingleCompanyQuestion,
  runFitSweep,
  type FitSweepAsk,
  type FitSweepResult,
} from "./fit-sweep.js";
import { fitReasonsAnswer, reasonSubjects } from "./fit-reasons.js";
import {
  runCompanyDiscovery,
  type DiscoverAsk,
  type DiscoveryAnswer,
  type DiscoveryRankUnavailable,
} from "./discover-companies.js";
import {
  capitalQAsCompanyAsked,
  companyFactAskOf,
  followsReplyAboutACompany,
  companyNameCandidates,
  isCapitalQCompanyRead,
  itemsOf,
  nameKey,
  lowercaseNameCandidates,
  namesOnlyCompany,
  profileOf,
  readNamedVisibleCompany,
  readVisibleCompanyById,
  runNamedCompanyFact,
  type CompanyFactAnswer,
  type CompanyFactAsk,
} from "./named-company-fact.js";
import { namedCompanyFitLine } from "./named-fit-line.js";
import {
  asksForTheWeb,
  asksReasonForPlace,
  cardNamesInWords,
  companyCardNamesInConversation,
} from "./shown-list-explanation.js";
import { boundCompaniesOf } from "./bound-companies.js";
import {
  FIRST_CONTACT_TOOL,
  FIRST_CONTACT_REPLY,
  firstContactMessage,
  firstContactOf,
  MESSAGE_TOOLS,
  MESSAGE_TURN_TOOLS,
  asksForMessage,
  prepareMessageNote,
} from "./first-contact.js";
import {
  Q_CARD_CLAIM_TOOL,
  qCardOfferMessage,
  qCardOfferOf,
  qCardReadOf,
  asksAboutOwnQCard,
  Q_CARD_READ_TOOL,
  withQCardLink,
  type QCardRead,
} from "./q-card-offer.js";
import {
  CHAT_INSTEAD_TOOL,
  chatInsteadMessage,
  chatInsteadReply,
  MESSAGE_PREPARED_REPLY,
  chatInsteadOf,
} from "./message-channel.js";
import {
  CHAINED_FIGURES_TOOL,
  CHAINED_GET_TOOL,
  CHAINED_READ_TOOLS,
  chainedCompanyOf,
  chainedKey,
} from "./chained-read.js";
import {
  COMPARE_ANSWER_SCHEMA,
  NARROWED_ANALYST_SCHEMA,
  compareAnswerOutput,
  conversationAnswerOutput,
  restatesVerdict,
} from "./compare-answer.js";
import { outputSplitOf } from "./output-split.js";
import { STATED_FIGURE_TOOL, statedFigureCard } from "./stated-figure-card.js";
import {
  EXTRAS_ELSEWHERE_NOTE,
  TABLE_IS_THE_COMPARISON,
  extrasMessages,
  extrasOutput,
  joinExtras,
} from "./parallel-extras.js";
import {
  checkAnswer,
  claimCorpus,
  createClaimChecker,
  templateValues,
  type ClaimKind,
} from "./claim-check.js";
import {
  distinctFacts,
  documentRowFacts,
  fetchedDocumentRowFacts,
  fetchedDocumentTexts,
} from "./document-rows.js";
import {
  checkPromises,
  createPromiseChecker,
  createRunActions,
  type ActionClaimKind,
  type PromiseGrounds,
} from "./promise-check.js";
import { toolLoopBudget } from "./tool-loop-budget.js";
import {
  meetingIntentOf,
  meetingVehicleDecision,
  type MeetingIntent,
} from "./meeting-vehicle.js";
export {
  meetingIntentOf,
  meetingVehicleDecision,
  type MeetingIntent,
} from "./meeting-vehicle.js";
export {
  checkAnswer,
  claimCorpus,
  groundText,
  type ClaimKind,
  type GroundedText,
} from "./claim-check.js";
export {
  ACTION_CLAIM_KINDS,
  actionClaims,
  checkPromises,
  type ActionClaimKind,
} from "./promise-check.js";
export {
  Q_DEEP_TOOL_LOOP_BUDGET_MS,
  Q_DEEP_TOOL_LOOP_MAX_CALLS,
  Q_DEEP_TOOL_LOOP_MAX_ROUNDS,
} from "./tool-loop-budget.js";
import {
  corroboratedPictures,
  pageAboutThem,
  type SearchEvidence,
} from "./picture-corroboration.js";
import { boundedCompletedMessage } from "./completed-event.js";
import {
  type ConflictFact,
  figureConflictBlocks,
  figureConflicts,
  pageFigureConflictBlocks,
  pageFigureConflicts,
} from "./figure-conflicts.js";
import {
  earlierResearchNote,
  earlierResearchPages,
  earlierResearchSubjects,
  RESEARCH_TOOL_NAME,
} from "./earlier-research.js";
import { asksForFresh, canonical, createReadCache } from "./read-cache.js";
import {
  createConversationEvidence,
  evidenceScopeOf,
} from "./conversation-evidence.js";
import { keepAnswerContext } from "./context-follow-up.js";
export { outputSplitOf, type OutputSplit } from "./output-split.js";
// RC3: conversation-scoped evidence reuse, composed with its watermark.
export {
  CONVERSATION_EVIDENCE_TTL_MS,
  createConversationEvidence,
  evidenceScopeOf,
  accessContextKeyOf,
  type ConversationEvidence,
  type EvidenceScope,
  type EvidenceWatermark,
} from "./conversation-evidence.js";
// The seam's read cache, for the composition that must forget a person's
// reads when an approved action of theirs executes outside any run.
export { createReadCache, type ReadCache } from "./read-cache.js";
// XLSX-002: a filed answer drops what only made sense on screen.
export { claimsOnScreen } from "./screen-claims.js";
export { boundedCompletedMessage } from "./completed-event.js";
import {
  findKnownInvestor,
  runPersonSearch,
  type PersonAsk,
} from "./person-search-answer.js";
import {
  runInvestorDiscovery,
  type InvestorAsk,
} from "./investor-discovery-answer.js";
import {
  runConditionedProspects,
  runInvestorProspects,
  withCodeFitMeasures,
  type InvestorProspectsAsk,
} from "./investor-prospects-answer.js";
import {
  carriedListConditions,
  listConditionsOf,
  refinesShownList,
  needsConditionedLane,
  hasAnyCondition,
  runConditionedCompanyList,
  type ListConditions,
} from "./list-conditions.js";
export { identityCardBlock } from "./person-search-answer.js";
export {
  investorCardsBlock,
  investorDiscoveryText,
  runInvestorDiscovery,
  type InvestorAsk,
  type InvestorDiscoveryAnswer,
} from "./investor-discovery-answer.js";
export {
  createPersonBriefReader,
  type PersonBriefReaderInput,
  type ProposedBriefAssertion,
} from "./person-brief-reader.js";
import { answerPathOf } from "./answer-path.js";
import { streamRetractions } from "./stream-fidelity.js";
import {
  memoryCallbackFor,
  memoryCallbackNote,
  quotesCallback,
  withoutQuotedCallback,
} from "./memory-callback.js";
import { forModelReading } from "./pending-confirmation.js";
import {
  holdsWebForOwned,
  OWNED_FIRST_CODE,
  OWNED_FIRST_MESSAGE,
  ownedReadFound,
  PUBLIC_WEB_TOOL,
  settledWithin,
} from "./owned-first.js";
import { createSingleFlight } from "./single-flight.js";
import {
  createGateqLabelGuard,
  gateqReadingHeld,
  readNamedGateqApplications,
  withoutUnsourcedGateqLabels,
} from "./gateq-application-fact.js";
import { notOfferedThisTurn, toolBlockFor } from "./tool-order.js";
import {
  askedToOpen,
  createScreenClaimGuard,
  DRAWN_BLOCK_KINDS,
  withoutUnbackedScreenClaims,
} from "./screen-claims.js";
import {
  createArtifactClaimGuard,
  drawnArtifacts,
  drawnOnScreen,
  withoutUnbackedArtifactClaims,
} from "./artifact-claims.js";
import { ownProfileFact } from "./own-profile.js";
import {
  asksForOwnMandate,
  mandateCategories,
  ownMandateAnswer,
} from "./own-mandate-answer.js";
import {
  DISCOVERY_CALL_PREFIX,
  priorListings,
  runWebDiscovery,
  type WebDiscoveryAsk,
} from "./web-discovery.js";
import { tiedToRecordPerson, type PersonAnchor } from "./person-anchor.js";
import { createWebDiscoveryReader } from "./web-discovery-reader.js";
import { pitchMomentFact } from "./pitch-moment-fact.js";
import {
  asksAboutOwnPitch,
  asksOnlyToReviewOwnPitch,
  ownPitchReviewFact,
} from "./own-pitch-review.js";
import { withoutInternalFailureLines } from "./internal-failure-lines.js";
import {
  discoverFilterDecision,
  newestAnswerListsCompanies,
  SET_DISCOVER_FILTERS_TOOL,
  type DiscoverRule,
} from "./discover-filter-rule.js";
import { relationshipFact } from "./relationship-fact.js";
import { ownIndexFact, ownStandingFact } from "./own-standing.js";
import {
  afterLeadLines,
  ASKS_ABOUT_OWN_TEAM,
  heldBackDocumentsFact,
  ownReadinessFact,
  ownTeamFact,
} from "./own-readiness.js";
import { speculationGate } from "./speculation.js";

export type { QOwnIndex } from "./own-standing.js";
// Q room W4b: the silence ladder names the company the same way a card does.
export { companiesInOutcome } from "./card-subjects.js";
export { fitAnswerCardsBlock, fitsInOutcome } from "./fit-cards.js";
export { readinessLeadLines } from "./own-readiness.js";
export { reRenderAskOf } from "./re-render.js";
// RECOVERY B1 on voice (workstream A): the voice line says this answer from
// the attention report, for the same question.
export { asksWhatNeedsThem } from "./attention-answer.js";
export {
  createPartialAnswerReader,
  type PartialAnswerReader,
} from "../policy/partial-answer.js";
export {
  createSmallTalkReply,
  type SmallTalkReply,
  type SmallTalkTurn,
} from "./small-talk.js";
export { createCallPrepWriter, type CallPrepWriter } from "./call-prep.js";
export {
  createConversationRecall,
  type ConversationRecall,
  type ConversationRecallTurn,
} from "./conversation-recall.js";
export {
  answerContextOf,
  CONTEXT_EVIDENCE_CHARS_MAX,
  createContextFollowUp,
  keepAnswerContext,
  type AnswerContext,
  type ContextFollowUp,
  type ContextFollowUpInput,
  type ContextFollowUpMiss,
  type ContextFollowUpOutcome,
} from "./context-follow-up.js";
export {
  conversationContextOf,
  reshownBlocks,
  shownTurnOf,
  CONTEXT_CHARS_MAX,
  CONTEXT_TURNS_MAX,
  type ConversationContext,
  type ShownTurn,
} from "./conversation-context.js";
export {
  createTurnSkimmer,
  type QTurnSkim,
  type QTurnSkimInput,
  type QTurnSkimmer,
} from "./turn-skim.js";
export { speculationGate, type SpeculationGate } from "./speculation.js";
import { arrivalSnapshotFact } from "./arrival-fact.js";
import { dailyFollowUpAnswer } from "./daily-follow-up.js";
import {
  arrivalAspectAnswer,
  arrivalFollowUpAnswer,
  arrivalFollowUpKind,
  pointsAtArrival,
  type ArrivalReply,
} from "./arrival-answer.js";

export { arrivalSnapshotFact };
import {
  companyDeckFiguresFacts,
  companyFiguresFacts,
  companyFiguresLimitFact,
  onScreenCompanyFact,
  ownCompanySnapshotFact,
  withSharedDocumentsInLimits,
} from "./company-fact.js";
import { onScreenDocumentFact } from "./document-fact.js";
import {
  correctDocumentDenials,
  createDocumentDenialGuard,
  documentsReadOf,
  supersededByDocuments,
  type ReadDocument,
} from "./document-stated-figures.js";
import type { CheckedLineNeed } from "./uncertainty.js";
import {
  alreadyReadLine,
  alreadySharedLine,
  documentsReadIn,
  readDocumentFor,
  asksForFigures,
  asksToReconcile,
  documentDeckDifferenceFact,
  furtherPageRange,
  listedDocumentsOf,
  measuresMissing,
  pagesCarrying,
  pagesOfRead,
  readableDocumentCounts,
  readableListed,
  sharedDocumentFor,
  sharedDocumentReads,
  sharedDocumentsFact,
  sharedPageRange,
  type ListedDocument,
} from "./shared-documents.js";
import { ownEvidenceTurn, readOwnDocuments } from "./own-documents.js";
import {
  DATA_ROOM_FACTS_MAX_CHARS,
  dataRoomDocumentFacts,
  dataRoomDocumentReads,
} from "./data-room-document-fact.js";
import {
  attachedDocumentFacts,
  attachedDocumentsWithin,
} from "./attached-document-fact.js";
import { asksChequeFit, chequeFitStatement } from "./cheque-fit-fact.js";
import {
  othersInterestAsked,
  OTHERS_INTEREST_NOTE,
  withOthersInterestWithheld,
} from "./others-interest.js";
// Item 17: the word rule, for the reader eval's record of what it catches.
export {
  asksAboutOthersInterest,
  othersInterestAsked,
} from "./others-interest.js";
import {
  asksToCompare,
  comparisonFactStatement,
  comparisonOnScreen,
  comparisonVerdict,
  ledByVerdict,
  type ComparisonVerdict,
  comparisonSpokenLine,
  withoutCompareOffers,
  withoutMarkdownTables,
  comparisonTableBlock,
  tractionUnstated,
  verdictSentence,
  compareTargets,
  namesToCompare,
  newestAnswerCards,
  answerCardCompanies,
} from "./compare-table.js";
import {
  answerChart,
  answerChartOutcome,
  chartFactOf,
  chartMetricOf,
  chartNotDrawnFact,
  previousChartOf,
  type ChartMetricAsked,
  type ChartOutcome,
  type ChartPeriod,
} from "./figure-chart.js";
import {
  attachedDocumentIntent,
  attachedOnThisTurn,
} from "./attached-document-intent.js";
import { reRenderAskOf } from "./re-render.js";
import {
  manifestFacts,
  manifestReads,
  selectedDossierRead,
} from "./manifest-fact.js";
import { onScreenDailyFact } from "./daily-fact.js";
import { ownDayFact } from "./own-day.js";
import {
  relationshipCounterparts,
  withExclusionChecked,
  withoutExcludedCompanies,
} from "./account-digest.js";
import {
  claimsLeftOutContacts,
  contactStagesOf,
  contactStatusAnswer,
  contactSubjectsOf,
  inContactOf,
  inContactWith,
} from "./in-contact.js";
import {
  asComparison,
  namedCardCompanyIds,
  previousCardCompanyIds,
  shownCardCompanyIds,
  tieIsAsked,
  tieLine,
  withFitIntegrity,
} from "./fit-integrity.js";
import {
  connectedAlready,
  inSecondPerson,
  withReferenceLead,
  withRelationshipStagesChecked,
} from "./answer-continuity.js";
import type { QAnswerCardsBlock, ArrivalSnapshot } from "@capital-q/contracts";
import {
  ATTENTION_TOOL_NAME,
  asksWhatNeedsThem,
  attentionAnswerText,
  attentionReportOf,
} from "./attention-answer.js";
import { companiesNamedIn, knownCompaniesOf } from "./named-companies.js";
import { ownOnboardingFacts } from "./own-onboarding.js";
import {
  onboardingNudgeNote,
  type QOnboardingNudge,
} from "./onboarding-nudge.js";
import {
  analystResultBlocks,
  askedSubjects,
  COMPANIES_TABLE_TITLE,
  findingBlockOf,
  suppliedStandingsOf,
  publicStandingsOf,
  publicRecordTimeline,
  withFactLabels,
  type SuppliedStanding,
  namesReadByRun,
  askerSideOf,
  ownInvestorOrganisationIn,
  PICTURE_WAIT_MS,
  pictureBlock,
  publicPictureBlocks,
  scheduleBlock,
  withConversationFindings,
  type QPublicPicturePort,
} from "./result-blocks.js";
import { companyMediaFor, withoutPitchFailureTalk } from "./company-media.js";

// The names a turn's words give, for the conversation core's first words.
export { companyNameCandidates } from "./named-company-fact.js";
// Live re-check of cb28c00e5: an explanation about Q's own shown list.
export {
  asksForTheWeb,
  asksReasonForPlace,
  asksToOpenAPage,
  cardNamesInWords,
  companyCardNamesInConversation,
  sameCompanyName,
} from "./shown-list-explanation.js";
export {
  analystResultBlocks,
  askedSubjects,
  askerSideOf,
  ownInvestorOrganisationIn,
  provenanceLine,
  withoutContradictedGaps,
  type AnalystResultLike,
  namesReadByRun,
  PICTURE_WAIT_MS,
  pictureBlock,
  publicPictureBlocks,
  type QPictureBlock,
  type QPicturePort,
  type QPublicPicturePort,
} from "./result-blocks.js";
// A8: a company's own picture and pitch on the answer about it.
export {
  COMPANY_MEDIA_COMPANIES_MAX,
  companyMediaAskOf,
  companyMediaBlocks,
  companyMediaFor,
  companyMediaPlan,
  withoutPitchFailureTalk,
  type QCompanyMediaAsk,
  type QCompanyMediaPlan,
  type QCompanyMediaPort,
  type QCompanyMediaRead,
} from "./company-media.js";
export {
  createDiligenceDocumentSummariser,
  DILIGENCE_SUMMARY_TEXT_MAX,
  summaryLine,
  summaryText,
  type DiligenceDocumentSummariser,
} from "./diligence-summary.js";
export {
  createPipelineColumnMapper,
  pipelineColumnsText,
  pipelineMappingOf,
  type PipelineColumnMapper,
} from "./pipeline-column-mapper.js";
export {
  createPitchSectionReader,
  normalisePitchSectionReading,
  PITCH_SECTION_READER_PROMPT_VERSION,
  pitchTranscriptText,
  type PitchCue,
  type PitchSectionReader,
  type PitchSectionReadFact,
  type PitchSectionReading,
  type PitchSectionSpec,
} from "./pitch-section-reader.js";
export {
  createPageTranscriber,
  PAGE_TRANSCRIBER_MAX_COST_USD,
  PAGE_TRANSCRIBER_MAX_PAGES,
  type PageImage,
  type PageTranscriber,
  type PageTranscription,
  type PageTranscriptionRun,
} from "./page-transcriber.js";
export {
  createDeckReader,
  DECK_READER_PROMPT_VERSION,
  DECK_READER_TEXT_MAX,
  deckText,
  normaliseDeckReading,
  type DeckPassage,
  type DeckReader,
} from "./deck-reader.js";
export {
  ACCOUNT_DIGEST_BLOCK_MAX_CHARS,
  accountDigestBlock,
  exclusionLine,
  localWhen,
  relationshipCounterparts,
  withExclusionChecked,
  withoutExcludedCompanies,
  type QAccountDigestPort,
} from "./account-digest.js";
export {
  asInContact,
  claimsLeftOutContacts,
  inContactOf,
  inContactWith,
  contactStagesOf,
  contactStatusAnswer,
  type ContactSubject,
  type InContact,
} from "./in-contact.js";
export {
  personTimeZone,
  situationHeader,
  situationSurfaceOf,
  SITUATION_HEADER_MAX_CHARS,
  type QSituationAsker,
  type QSituationOnScreen,
  type QSituationOwnOrganisation,
  type QSituationPort,
  type QSituationScreenIds,
  type QSituationSurface,
} from "./situation-header.js";
export {
  createReaderRouteActivity,
  createReaderWarmup,
  READER_WARMUP_IDLE_MS,
  type ReaderRouteActivity,
  type ReaderWarmup,
} from "./reader-warmup.js";
export {
  createQTurnReader,
  readerActions,
  TURN_READER_ACTIONS_MAX,
  TURN_READER_ATTEMPT_TIMEOUT_MS,
  TURN_READER_RECENT_TURNS_MAX,
  TURN_READER_REASONING,
  TURN_READER_REASONING_KEY,
  TURN_READER_SAME_MODEL_HEDGE_MS,
  type QTurnReader,
  type QTurnReading,
} from "./turn-reader.js";
export {
  APPROVE_PENDING_TOOL,
  approvalStatusLine,
  asksAboutQWork,
  CAPABILITY_NOTE_MAX_CHARS,
  capabilityNote,
  collectReceipts,
  DAILY_HERE_LINE,
  HERE_LINE,
  NAVIGATION_LINE,
  WORKSPACE_PANE_LINE,
  proposalStatusLine,
  PLAIN_KNOWING_LINE,
  POINTING_LINE,
  screenLines,
  type QCapabilityManifest,
  type QReceipt,
  type QReceiptPort,
} from "./conversation-receipts.js";
import {
  APPROVE_PENDING_TOOL,
  approvalStatusLine,
  asksAboutQWork,
  capabilityNote,
  collectReceipts,
  proposalStatusLine,
  Q_WORK_LINE,
  waitingCardLine,
} from "./conversation-receipts.js";
export {
  createWordsReaders,
  type WordsReaders,
  type WordsWho,
} from "./words-readers.js";
export {
  createTaxonomyChooser,
  type TaxonomyChoice,
  type TaxonomyChooser,
} from "./taxonomy-chooser.js";
export {
  createQDelegationReader,
  NO_TURN_AUTHORITY,
  type QDelegationReader,
  type QTurnAuthority,
} from "./delegation-reader.js";
export {
  createOnboardingTranscriptReader,
  transcriptText,
  type OnboardingTranscriptReader,
  type OnboardingTranscriptReading,
} from "./transcript-reader.js";
export { mandateStatement, ownProfileFact } from "./own-profile.js";
export { asksForOwnMandate } from "./own-mandate-answer.js";
export {
  mandateCategories,
  type MandateCategories,
} from "./own-mandate-answer.js";
export {
  admitDiscoveries,
  discoveryAnswerText,
  discoveryFit,
  DISCOVERY_DEFAULT_COUNT,
  DISCOVERY_MAX_COUNT,
  DISCOVERY_MAX_TOOL_CALLS,
  DISCOVERY_QUERIES,
  namedIn,
  planDiscovery,
  priorListings,
  queryIsPublic,
  runWebDiscovery,
  type DiscoveredCompany,
  type DiscoveryPlan,
  type WebDiscoveryAnswer,
} from "./web-discovery.js";
export {
  createWebDiscoveryReader,
  type WebDiscoveryReader,
  type WebDiscoveryReaderInput,
} from "./web-discovery-reader.js";
export {
  ownOnboardingFacts,
  type OwnOnboarding,
  type OwnOnboardingJourney,
  type QOwnOnboardingPort,
} from "./own-onboarding.js";
export {
  withoutActionTalk,
  withoutStatusTalk,
  type ActionTalkStripResult,
  type StatusTalkResult,
} from "./action-talk.js";
export {
  onboardingNudgeNote,
  type QOnboardingNudge,
  type QOnboardingNudgePort,
} from "./onboarding-nudge.js";
export {
  bindOffer,
  offerStanding,
  offerTakenNote,
  OFFER_UNRECORDED_NOTE,
  OFFER_UNRECORDED_REFUSAL,
  offerBoundRefusal,
  closingLineNote,
  type OfferBinding,
} from "./offer-binding.js";
import {
  bindOffer,
  offerStanding,
  OFFER_UNRECORDED_REFUSAL,
  offerBoundRefusal,
} from "./offer-binding.js";
export {
  answerSaysPublicCheck,
  askedAboutPublic,
  checkedLine,
  checkedLineNeedOf,
  chooseVehicle,
  codeUncertaintyOffer,
  decideUncertaintyOffer,
  materialUncertaintyFor,
  offerBacking,
  offerDecisionTrace,
  publicStandingOf,
  publicCheckOf,
  publicWebSeenOf,
  reassessmentNote,
  saidEarlier,
  stepLineWithoutOffer,
  uncertaintiesOf,
  withResolves,
  openResolutionOf,
  resolutionArguments,
  resolutionTitleOf,
  sameCounterparty,
  withOpenResolution,
  UNAVAILABLE_CODE_SAYS_GUIDANCE,
  UNCERTAINTY_VEHICLES,
  MESSAGE_TO_COMPANY_TOOLS,
  type OpenResolutionItem,
  type CheckedLineNeed,
  type PublicCheck,
  type PublicWebSeen,
  type RelationshipStanding,
  type UncertaintyAbout,
  type UncertaintyOfferDecision,
  type VehicleChoice,
} from "./uncertainty.js";
import {
  answerSaysPublicCheck,
  checkedLine,
  chooseVehicle,
  codeUncertaintyOffer,
  existingRequestFor,
  offerBacking,
  offerRequestFor,
  requestStateLine,
  stageLimitNote,
  stageLimitOf,
  stageRestatements,
  type VehicleChoice as StageVehicleChoice,
  decideUncertaintyOffer,
  DILIGENCE_DOCUMENTS_TOOL,
  offerDecisionTrace,
  publicCheckOf,
  publicWebSeenOf,
  checkedLineNeedOf,
  reassessmentNote,
  saidEarlier,
  stepLineWithoutOffer,
  uncertaintiesOf,
  withResolves,
  withOpenResolution,
  resolutionArguments,
  UNAVAILABLE_CODE_SAYS_GUIDANCE,
  UNCERTAINTY_VEHICLES,
  MESSAGE_TO_COMPANY_TOOLS,
  type OpenResolutionItem,
  type PublicWebSeen,
  type RelationshipStanding,
  type UncertaintyAbout,
} from "./uncertainty.js";
import {
  ANSWER_LIMIT_CHARS,
  ARRIVAL_SKIM_GRACE_MS,
  CARD_FOLLOW_UP_SUBJECT,
  CLIENT_ACTION_DONE_LINE,
  CalendarConnectCarrierSchema,
  LanguageCarrierSchema,
  NAMED_FIGURES_MAX,
  OUTWARD_FOLLOW_ON_RESERVE,
  PRIVATE_READS_PER_RUN,
  PRIVATE_READ_CHARS,
  PUBLIC_FACT_SCOPE,
  PUBLIC_WEB_TOOLS,
  Q_TOOL_LOOP_MAX_CALLS,
  Q_TOOL_LOOP_MAX_ROUNDS,
  RoomCardCarrierSchema,
  SHARED_FIGURES_TURN_TOOLS,
  SHARED_LISTINGS_MAX,
  TURN_NOTES_MAX_CHARS,
  USE_CAPABILITY_TOOL,
  answerReasoning,
  answerShapeNoteOf,
  answerTaskClass,
  askPartsNote,
  budgetForTaskClass,
  comparisonAsked,
  diagnosticCodeFor,
  discoveryAsked,
  discoveryBlocks,
  fixedCommunicationProfile,
  loadCapabilities,
  modelOfferAllowed,
  namedInFactsNote,
  noAuthorisedContext,
  operatingModeForCapability,
  readAnswerKinds,
  readAsComparison,
  taskClassForCapability,
  type AttachedNow,
  withoutTrailingOffers,
} from "./answer-plan.js";
import {
  ALREADY_SEARCHED_NOTE,
  ANALYST_LENIENT_FIELDS,
  ANALYST_RESULT_SCHEMA,
  CONVERSATION_FINDINGS_NOTE,
  OWN_MANDATE_NOTE,
  PREPARED_FOR_APPROVAL_LINE,
  PROSPECT_RESEARCH_BELOW,
  PROSPECT_RESEARCH_NOTE,
  SAY_DO_NOTE,
  SEARCHED_EMPTY_MAX,
  SEARCHED_EMPTY_TTL_MS,
  SOURCE_CHANGE_NOTE,
  TOOLS_FIRST_NOTE,
  WEB_BESIDE_RECORDS_NOTE,
  WEB_LANE_BUDGET_MS,
  WEB_LANE_DROPPED_NOTE,
  askedOf,
  canActFor,
  companyCardNamesOfLastQ,
  conversationStateNote,
  heldNamedIn,
  heldOnRecord,
  missFacts,
  namedOnRecord,
  noMatchLast,
  pagesMatchThem,
  referencesNote,
  screenActMissLine,
  screenActsNote,
  screenSubjectNote,
  shownCompanyCard,
  shownContextNote,
  webFoundNothing,
  whileSearching,
  withoutLandedClaims,
  withoutStaleFailures,
} from "./turn-notes.js";
import {
  LONG_ANSWER_NOTE,
  REFINE_WAIT_MS,
  UNPREPARED_CHANGE_LINE,
  analystSpokenOf,
  boundedRefinement,
  clearsOnPurpose,
  nextStepTurn,
  requestedChangeValues,
  restatedListAsk,
  spokenHeldToAnswerGuards,
  uncertaintyOfferTurn,
  unreadActionOf,
} from "./held-and-offers.js";
import {
  environmentNoteParts,
  fittedTurnNotes,
  joinedNoteParts,
  screenIdsOf,
  situationWithAccount,
  type NoteOptions,
} from "./environment-notes.js";
import {
  NOTHING_RECALLED,
  earlierWordsOf,
  recalledText,
  summaryCorrections,
  type ModelGatewayQAnswer,
  type ModelGatewayQAnswerDependencies,
  type QAnswerObservation,
  type QMemoryRecalled,
  type QToolCallObservation,
} from "./answer-dependencies.js";
import {
  FILL_PROFILE_GAPS_TOOL,
  fetchedForYouMessage,
  gapsLineOf,
  guardSentence,
  phased,
  readForYouMessage,
  recordUserStatements,
  toolResultMessage,
  type EarlyArrival,
} from "./tool-messages.js";
import {
  DRAFT_NOT_ON_CARD_LINE,
  appActionLineOf,
  asksThePerson,
  atMostOneOffer,
  claimsDone,
  couldNotLineFor,
  documentReceiptOf,
  explainsNothingDone,
  heardNames,
  isAsk,
  ownRecordOf,
  preparedLineOf,
  rememberConfirmation,
  repliedInOtherScript,
  shownFindingsLine,
  withoutRememberTalk,
  withoutTrailingAsks,
} from "./answer-lines.js";

export function createModelGatewayQAnswer(
  dependencies: ModelGatewayQAnswerDependencies,
): ModelGatewayQAnswer {
  const { gateway, repositories, sql, transactions, deltas, logger } =
    dependencies;
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const context = dependencies.context ?? noAuthorisedContext;
  // W4 (DECISIONS 71): the decision started beside the turn's reads; a
  // failure keeps the answer's own blocks.
  const movedBlocks = async (
    request: QAnswerRequest,
    blocks: readonly QResultBlock[] | undefined,
  ): Promise<QResultBlock[] | undefined> => {
    const moved =
      dependencies.pageMoves === undefined
        ? blocks
        : await dependencies.pageMoves
            .settle(request, blocks)
            .catch(() => blocks);
    return moved === undefined ? undefined : [...moved];
  };
  const baseTools = dependencies.tools ?? createUnconfiguredQTools();
  // R0: the companies each run's tools returned, so an answer card can
  // carry the record its name means (never an id the model wrote).
  const runCompanies = createRunCompanies();
  // The fits each run's tools returned, for cards code builds when the
  // model wrote none (Zino live 2026-10-07).
  const runFits = createRunFits();
  // Step 8: what each run's tools really did, the only backing for a
  // sentence in which Q says it prepared, sent, booked or saved something.
  const runActions = createRunActions();
  const webDiscoveryReader =
    dependencies.webDiscoveryReader ??
    createWebDiscoveryReader({
      gateway,
      dataPosture: dependencies.dataPosture,
      logger,
    });
  const available = baseTools.available;
  // K4: identical concurrent reads within a run share one call. Which
  // tools are reads is the offer's own declaration, per run.
  const singleFlight = createSingleFlight();
  const readCache = dependencies.readCache ?? createReadCache();
  const evidence =
    dependencies.conversationEvidence ?? createConversationEvidence();
  /**
   * Subjects a conversation already searched the public web for and found
   * nothing about (owner 2026-10-23), keyed by tenant, conversation and the
   * name searched: a new conversation searches, and says so, once. Only an
   * empty search is kept, never a failure (that is tried again) and never
   * what was found.
   */
  const searchedEmpty = new Map<
    string,
    { readonly outcome: QToolCallOutcome; readonly at: number }
  >();
  const readOnlyByRun = new Map<string, Set<string>>();
  /** C3: each run's tools that act (PREPARE or SIDE_EFFECT). Bounded. */
  const actingByRun = new Map<string, Set<string>>();
  const noteOffer = (
    runId: string,
    offered: readonly QOfferedTool[] | null,
  ): void => {
    if (offered === null) return;
    const names = readOnlyByRun.get(runId) ?? new Set<string>();
    const acting = actingByRun.get(runId) ?? new Set<string>();
    for (const tool of offered) {
      if (tool.classification === "READ_ONLY") names.add(tool.definition.name);
      // A screen act (client.*) is not acted on here: whether it may move
      // their screen is the move guard's (unmovedRuns, after it runs).
      if (
        (tool.classification === "PREPARE" ||
          tool.classification === "SIDE_EFFECT") &&
        !tool.toolName.startsWith("client.")
      ) {
        acting.add(tool.definition.name);
      }
    }
    readOnlyByRun.set(runId, names);
    actingByRun.set(runId, acting);
    for (const map of [readOnlyByRun, actingByRun]) {
      if (map.size > 256) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
    }
  };
  /**
   * A public search about someone Capital Q holds keeps only the pages
   * about them (owner 2026-10-24: "Q must never narrate irrelevant
   * results"): LEGO DUPLO's pages name "Duplo" but are not about the Lagos
   * company the record holds, so the answer never sees them, nor do its
   * Sources or its pictures. By the run's own reads of their record.
   */
  /**
   * Live 2026-11-06 (6c8d108cf): the person each run's turn is about, when
   * Capital Q holds them against a company (person-anchor.ts). Bounded.
   */
  const personAnchorByRun = new Map<string, PersonAnchor>();
  const notePersonAnchor = (runId: string, anchor: PersonAnchor): void => {
    personAnchorByRun.set(runId, anchor);
    if (personAnchorByRun.size > 256) {
      const [oldest] = personAnchorByRun.keys();
      if (oldest !== undefined) personAnchorByRun.delete(oldest);
    }
  };
  /**
   * Every public search a run makes passes here: pages about a company
   * Capital Q holds must be about it, and pages about a person it holds
   * against a company must name that company too (never a namesake).
   */
  const aboutThemOnly = (
    proposal: Parameters<QToolPort["execute"]>[0],
    runId: string,
    outcome: QToolCallOutcome,
    words: string,
  ): QToolCallOutcome => {
    // Live 2026-11-06 (run ad5c5e5f): web discovery searches for OTHER
    // companies by design ("…that maybe not exist in capital Q yet"). Its
    // own searches (made by code, never the model) are not held to the
    // companies the words name: that filter kept only pages about Capital
    // Q and the discovery listed nothing. Its admission does its own
    // grounding (web-discovery.ts); the person rule below still applies.
    const companies = proposal.callId.startsWith(DISCOVERY_CALL_PREFIX)
      ? outcome
      : aboutHeldCompaniesOnly(proposal, runId, outcome, words);
    const anchor = personAnchorByRun.get(runId);
    if (proposal.name !== PUBLIC_WEB_TOOL || anchor === undefined) {
      return companies;
    }
    const tied = tiedToRecordPerson(proposal, companies, anchor);
    if (tied.dropped > 0) {
      // Never the page text or the name: how many were left out.
      logger?.info(
        { qRunId: runId, dropped: tied.dropped },
        "q public pages that do not tie the person to their company left out",
      );
    }
    return tied.outcome;
  };
  const aboutHeldCompaniesOnly = (
    proposal: Parameters<QToolPort["execute"]>[0],
    runId: string,
    outcome: QToolCallOutcome,
    /** The person's own words this turn, for whom a search without a name is about. */
    words: string,
  ): QToolCallOutcome => {
    if (proposal.name !== PUBLIC_WEB_TOOL || !outcome.result.ok) {
      return outcome;
    }
    const read = runCompanies.read(runId);
    const name = (proposal.arguments as { readonly entityName?: unknown })
      .entityName;
    const named = typeof name === "string" && name.trim().length > 0;
    const held = named ? heldOnRecord(read, name) : null;
    // Whom the pages must be about: the name searched, when Capital Q holds
    // it; else the companies the run read that the person named.
    const subjects =
      named && held !== null
        ? [{ name, held }]
        : named
          ? []
          : heldNamedIn(read, words);
    if (subjects.length === 0) return outcome;
    const data = outcome.result.data as {
      readonly sources?: readonly Record<string, unknown>[];
      readonly comparison?: readonly Record<string, unknown>[];
    };
    const sources = data.sources ?? [];
    const kept = sources.filter((source) => {
      const evidence = {
        domain: typeof source["domain"] === "string" ? source["domain"] : "",
        subjectMatch:
          typeof source["subjectMatch"] === "string"
            ? source["subjectMatch"]
            : null,
        countries: Array.isArray(source["mentionedCountries"])
          ? source["mentionedCountries"].filter(
              (country): country is string => typeof country === "string",
            )
          : [],
        text: typeof source["excerpt"] === "string" ? source["excerpt"] : null,
        title: typeof source["title"] === "string" ? source["title"] : null,
      };
      return subjects.some((subject) =>
        pageAboutThem(evidence, subject.name, subject.held),
      );
    });
    if (kept.length === sources.length) return outcome;
    logger?.info(
      {
        qRunId: runId,
        kept: kept.length,
        dropped: sources.length - kept.length,
      },
      "q public pages not about whom the search was for left out",
    );
    // Capital Q's notes on a page left out go with it: a note on LEGO's
    // page is still LEGO's page in front of the answer.
    const keptIndexes = new Set(kept.map((source) => source["index"]));
    const comparison = (data.comparison ?? []).filter((note) =>
      keptIndexes.has(note["sourceIndex"]),
    );
    return {
      ...outcome,
      result: { ok: true, data: { ...data, sources: kept, comparison } },
    };
  };
  /**
   * QA F-107 (run bad4b716): runs that review a founder's own pitch video
   * with no change asked. Their answer reads; a document revision is
   * refused here, whatever the model calls. Bounded.
   */
  const reviewOnlyRuns = new Set<string>();
  const markReviewOnly = (runId: string): void => {
    reviewOnlyRuns.add(runId);
    if (reviewOnlyRuns.size > 256) {
      const [oldest] = reviewOnlyRuns;
      if (oldest !== undefined) reviewOnlyRuns.delete(oldest);
    }
  };
  /**
   * Live 2026-10-30: runs whose turn took Q up on an offer code did not
   * record (offerTakenUnrecorded). No tool result moves their screen in
   * them: the destination would be re-guessed ("the pending approvals"
   * became account settings). Bounded.
   */
  /**
   * Addendum 14 Nov 2026 (uncertainty.ts). Per run, bounded like the rest:
   * what the public web returned (slice 0), whether code says what was
   * checked (a turn about a named company or person not theirs), whether an
   * on-request data-room title was in view (slice 4), and what a taken
   * uncertainty offer resolves (slice 5).
   */
  const publicWebByRun = new Map<string, PublicWebSeen[]>();
  const codeSaysCheckedRuns = new Set<string>();
  const onRequestSeenRuns = new Set<string>();
  const offerAboutByRun = new Map<string, UncertaintyAbout>();
  /**
   * Live 14 Nov 2026 (run 28635630): on a yes to a recorded offer, the
   * tool that acts is the one the offer bound, never one the model picks
   * again on the yes turn. Per run, the bound tool's name.
   */
  const offerToolByRun = new Map<string, string>();
  /**
   * Live 78f8d72d5 (D13, D14): the conversation's open resolution item per
   * run, and the vehicle the turn asked for (askedAction). A document
   * request toward the item's company carries what it resolves; a message
   * the model prepares on a turn that asked for the vehicle goes as that
   * vehicle (run c72a0fbe prepared a chat message instead).
   */
  const openResolutionByRun = new Map<string, OpenResolutionItem>();
  const askedVehicleByRun = new Map<string, string>();
  /**
   * D-Q3 (live 15 Nov 2026): the meeting the turn asked for (askedAction:
   * set up or move a call), per run. A chat message or profile change on
   * such a turn is refused with the meeting vehicle named.
   */
  const meetingIntentByRun = new Map<string, MeetingIntent>();
  /**
   * D15 (live 15 Nov 2026, run e7ba2a79): their diligence requests linked
   * to an open item, per run and company, as the relationship read
   * returned them; an item already asked for is never offered again.
   */
  const followUpsByRun = new Map<
    string,
    Map<string, readonly DiligenceFollowUp[]>
  >();
  /**
   * Live 16 Nov 2026 (shared-documents.ts): per run and company, the
   * documents its data room shows this investor, as code listed them; a
   * document already shared is never offered as a request, and a turn
   * answered from them carries no public-web disclosure.
   */
  const sharedDocumentsByRun = new Map<
    string,
    Map<string, readonly ListedDocument[]>
  >();
  const boundedRunState = (): void => {
    for (const store of [
      followUpsByRun,
      sharedDocumentsByRun,
      publicWebByRun,
      codeSaysCheckedRuns,
      onRequestSeenRuns,
      offerAboutByRun,
      offerToolByRun,
      openResolutionByRun,
      askedVehicleByRun,
      meetingIntentByRun,
    ]) {
      if (store.size > 256) {
        const [oldest] = store.keys();
        if (oldest !== undefined) store.delete(oldest);
      }
    }
  };
  /** A research result seen in a run; re-worded when code says the absence. */
  const notePublicWeb = (
    runId: string,
    name: string,
    outcome: QToolCallOutcome,
  ): QToolCallOutcome => {
    if (name !== PUBLIC_WEB_TOOL) return outcome;
    const seen = publicWebSeenOf(outcome);
    publicWebByRun.set(runId, [...(publicWebByRun.get(runId) ?? []), seen]);
    boundedRunState();
    if (
      codeSaysCheckedRuns.has(runId) &&
      seen.status === "PROVIDER_UNAVAILABLE" &&
      outcome.result.ok
    ) {
      return {
        ...outcome,
        result: {
          ...outcome.result,
          data: {
            ...(outcome.result.data as Record<string, unknown>),
            guidance: UNAVAILABLE_CODE_SAYS_GUIDANCE,
          },
        },
      };
    }
    return outcome;
  };
  const unmovedRuns = new Set<string>();
  const markUnmoved = (runId: string): void => {
    unmovedRuns.add(runId);
    if (unmovedRuns.size > 256) {
      const [oldest] = unmovedRuns;
      if (oldest !== undefined) unmovedRuns.delete(oldest);
    }
  };
  /**
   * Live re-check 15 Nov 2026 (T7): the conditions a ranked list was
   * answered under, kept with Q's message that showed it (tenant, person,
   * conversation and message), so a follow-up on that list keeps them
   * unless the person states others. In memory and bounded: a restart
   * forgets a condition (the next list is answered as read), never a fact.
   */
  const listConditionsByMessage = new Map<
    string,
    {
      readonly side: "INVESTOR" | "FOUNDER";
      readonly conditions: ListConditions;
    }
  >();
  const listConditionsKey = (
    request: Pick<QAnswerRequest, "tenantId" | "actorUserId">,
    conversationId: string,
    messageId: string,
  ): string =>
    `${request.tenantId}:${request.actorUserId}:${conversationId}:${messageId}`;
  const keepListConditions = (
    key: string,
    kept: {
      readonly side: "INVESTOR" | "FOUNDER";
      readonly conditions: ListConditions;
    },
  ): void => {
    listConditionsByMessage.set(key, kept);
    if (listConditionsByMessage.size > 512) {
      const [oldest] = listConditionsByMessage.keys();
      if (oldest !== undefined) listConditionsByMessage.delete(oldest);
    }
  };
  /** QA F-114: each run's Discover filter rule (discover-filter-rule.ts). Bounded. */
  const discoverRuleByRun = new Map<string, DiscoverRule>();
  const noteDiscoverRule = (runId: string, rule: DiscoverRule): void => {
    discoverRuleByRun.set(runId, rule);
    if (discoverRuleByRun.size > 256) {
      const [oldest] = discoverRuleByRun.keys();
      if (oldest !== undefined) discoverRuleByRun.delete(oldest);
    }
  };
  /** Their decision on a change already waiting: theirs, never an offer. */
  const PENDING_DECISION_TOOLS: ReadonlySet<string> = new Set([
    APPROVE_PENDING_TOOL,
    "decline_pending_proposal",
  ]);
  /** A call refused because the person did not ask for it. */
  const notAsked = (callId: string, safeMessage: string): QToolCallOutcome => ({
    callId,
    toolName: null,
    toolVersion: null,
    classification: null,
    status: "DENIED",
    failureCode: "NOT_ASKED",
    sensitivity: null,
    result: { ok: false, error: { code: "NOT_ASKED", safeMessage } },
    latencyMs: 0,
  });
  /**
   * Efficiency pass (coordinator 2026-10-25, run 42b21b5f): a read made
   * once in a turn -- by code ahead of the model, or by the model -- is not
   * made again in the same turn. Their own records too (unlike the
   * cross-turn cache): within one turn nothing of theirs moves unless the
   * turn itself changes it, and then every read is made afresh.
   */
  const turnReads = new Map<string, Map<string, QToolCallOutcome>>();
  const turnReadKey = (proposal: { name: string; arguments: unknown }) =>
    `${proposal.name}|${canonical(proposal.arguments ?? {})}`;
  /**
   * Context Firewall, outbound (CQ-Q-RESEARCH-001 §9-§10): what this run
   * read that is not public (anything above NETWORK_VISIBLE), as text.
   * Never sent anywhere: the tools that search outside Capital Q use it
   * only to withhold a word that only private material holds.
   */
  const privateReadsByRun = new Map<string, string[]>();
  const notePrivateRead = (runId: string, outcome: QToolCallOutcome): void => {
    if (
      !outcome.result.ok ||
      outcome.sensitivity === null ||
      outcome.sensitivity === "PUBLIC" ||
      outcome.sensitivity === "NETWORK_VISIBLE"
    ) {
      return;
    }
    const text = JSON.stringify(outcome.result.data ?? null);
    const reads = privateReadsByRun.get(runId) ?? [];
    if (reads.length >= PRIVATE_READS_PER_RUN) return;
    reads.push(text.slice(0, PRIVATE_READ_CHARS));
    privateReadsByRun.set(runId, reads);
    if (privateReadsByRun.size > 256) {
      const oldest = privateReadsByRun.keys().next().value;
      if (oldest !== undefined) privateReadsByRun.delete(oldest);
    }
  };
  const tools: QToolPort = {
    offer: async (toolContext) => {
      const offered = await baseTools.offer(toolContext);
      noteOffer(toolContext.runId, offered);
      return offered;
    },
    ...(available === undefined
      ? {}
      : {
          available: async (toolContext) => {
            const all = await available(toolContext);
            noteOffer(toolContext.runId, all);
            return all;
          },
        }),
    // What is sent, not what is offered: noted by neither.
    ...(baseTools.catalogue === undefined
      ? {}
      : { catalogue: baseTools.catalogue }),
    execute: async (asked, toolContext) => {
      /**
       * D13 (live 78f8d72d5, run c72a0fbe): the turn asked for the
       * vehicle ("Yes, please request that from Ajopot"), its inputs were
       * not in the words, and the model prepared a chat message to the
       * company instead. On a turn that asked for a vehicle, a message to
       * the company is that vehicle: filled from the open item when code
       * can, else refused with the vehicle named. A turn that asked for a
       * message keeps it ("message them to set up a call").
       */
      const resolvingCall = (
        call: typeof asked,
        runId: string,
      ):
        | { readonly kind: "CALL"; readonly call: typeof asked }
        | { readonly kind: "REFUSE"; readonly said: string } => {
        const vehicle = askedVehicleByRun.get(runId);
        if (
          vehicle === undefined ||
          !MESSAGE_TO_COMPANY_TOOLS.has(call.name) ||
          call.callId.startsWith("q-")
        ) {
          return { kind: "CALL", call };
        }
        const item = openResolutionByRun.get(runId);
        const filled =
          item !== undefined && item.action === vehicle
            ? resolutionArguments(item)
            : null;
        logger?.info(
          { qRunId: runId, tool: call.name, vehicle, filled: filled !== null },
          "a message on a turn that asked for the vehicle went as the vehicle",
        );
        return filled === null
          ? {
              kind: "REFUSE",
              said: `They asked for ${vehicle}, not a message. Call ${vehicle} for what they asked; if it cannot be done, say so plainly. Nothing else is prepared or sent.`,
            }
          : {
              kind: "CALL",
              call: { ...call, name: vehicle, arguments: filled },
            };
      };
      if (
        asked.name === "revise_my_document" &&
        reviewOnlyRuns.has(toolContext.runId)
      ) {
        return notAsked(
          asked.callId,
          "They asked for a review of their own pitch video, not a change to a document. Answer with the review from its transcript and change nothing.",
        );
      }
      // QA F-114: their Discover filters carry only what they stated, and
      // change only when they asked for Discover.
      const discover =
        asked.name === SET_DISCOVER_FILTERS_TOOL
          ? discoverFilterDecision(
              asked.arguments,
              discoverRuleByRun.get(toolContext.runId),
            )
          : null;
      if (discover?.kind === "REFUSE") {
        return notAsked(asked.callId, discover.safeMessage);
      }
      const meeting = meetingVehicleDecision(
        asked,
        meetingIntentByRun.get(toolContext.runId) ?? null,
      );
      if (meeting.kind === "REFUSE") {
        logger?.info(
          { qRunId: toolContext.runId, tool: asked.name },
          "a meeting turn's message or profile change went to the meeting vehicle",
        );
        return notAsked(asked.callId, meeting.said);
      }
      const chosen =
        discover?.kind === "SET"
          ? { ...asked, arguments: discover.arguments }
          : asked;
      // Slice 5: a yes to an uncertainty offer carries what it resolves
      // onto the vehicle's call, from the offer's record.
      const resolving = resolvingCall(chosen, toolContext.runId);
      if (resolving.kind === "REFUSE") {
        return notAsked(chosen.callId, resolving.said);
      }
      const proposal = {
        ...resolving.call,
        arguments: withOpenResolution(
          {
            name: resolving.call.name,
            arguments: withResolves(
              resolving.call,
              offerAboutByRun.get(toolContext.runId),
            ),
          },
          openResolutionByRun.get(toolContext.runId),
        ),
      };
      // C3: a yes to an offer code holds no record of acts on nothing --
      // what was offered would be a guess. Their approval of a change
      // already waiting is theirs, not an offer, and still goes through.
      if (
        unmovedRuns.has(toolContext.runId) &&
        actingByRun.get(toolContext.runId)?.has(proposal.name) === true &&
        !PENDING_DECISION_TOOLS.has(proposal.name)
      ) {
        logger?.info(
          { qRunId: toolContext.runId, tool: proposal.name },
          "q acted on nothing: the offer taken was not recorded",
        );
        return notAsked(proposal.callId, OFFER_UNRECORDED_REFUSAL);
      }
      // A yes to a recorded offer acts only through the tool the offer
      // bound (live 28635630). Code's own follow-on calls (`q-` ids, e.g.
      // the chat message in place of an email no mailbox can send) and
      // the person's decision on a change already waiting still go.
      const boundTool = offerToolByRun.get(toolContext.runId);
      if (
        boundTool !== undefined &&
        proposal.name !== boundTool &&
        !proposal.callId.startsWith("q-") &&
        actingByRun.get(toolContext.runId)?.has(proposal.name) === true &&
        !PENDING_DECISION_TOOLS.has(proposal.name)
      ) {
        logger?.info(
          { qRunId: toolContext.runId, tool: proposal.name, boundTool },
          "q kept to the offer taken: another acting tool was refused",
        );
        return notAsked(proposal.callId, offerBoundRefusal(boundTool));
      }
      const isRead =
        readOnlyByRun.get(toolContext.runId)?.has(proposal.name) === true;
      const thisTurn = turnReads.get(toolContext.runId);
      const readBefore = thisTurn?.get(turnReadKey(proposal));
      if (readBefore !== undefined) {
        logger?.info(
          { qRunId: toolContext.runId, tool: proposal.name },
          "q read answered from this turn's own read",
        );
        return aboutThemOnly(
          proposal,
          toolContext.runId,
          notePublicWeb(toolContext.runId, proposal.name, {
            ...readBefore,
            callId: proposal.callId,
            latencyMs: 0,
          }),
          toolContext.conversation?.latestUserText ?? "",
        );
      }
      // What Q knows, Q knows (read-cache.ts): the same read under the
      // same authority within minutes is answered from what was read.
      const kept = isRead ? readCache.get(proposal, toolContext) : null;
      if (kept !== null) {
        logger?.info(
          { qRunId: toolContext.runId, tool: proposal.name },
          "q read answered from what this person already read",
        );
        runCompanies.note(toolContext.runId, kept);
        runFits.note(toolContext.runId, kept);
        notePrivateRead(toolContext.runId, kept);
        return aboutThemOnly(
          proposal,
          toolContext.runId,
          notePublicWeb(toolContext.runId, proposal.name, kept),
          toolContext.conversation?.latestUserText ?? "",
        );
      }
      const outcome = await singleFlight.execute(
        toolContext.runId,
        proposal,
        readOnlyByRun.get(toolContext.runId)?.has(proposal.name) === true,
        // S3: each tool's round trips under its own phase, so the run's
        // dbRoundTripsByPhase says which reads the answer spends them on.
        () =>
          withRoundTripPhase(`tool.${proposal.name}`, () =>
            baseTools.execute(proposal, toolContext),
          ),
      );
      if (
        unmovedRuns.has(toolContext.runId) &&
        outcome.result.ok &&
        carriesScreenMove(outcome.result.data)
      ) {
        logger?.info(
          { qRunId: toolContext.runId, tool: proposal.name },
          "q made no move: the offer taken was not recorded",
        );
        return notAsked(
          proposal.callId,
          "They said yes to something your last answer offered, but where it would take them was not recorded, so their screen does not move this turn. Answer here, in place, from what you hold; do not say you are opening or taking them anywhere.",
        );
      }
      runCompanies.note(toolContext.runId, outcome);
      runFits.note(toolContext.runId, outcome);
      runActions.note(toolContext.runId, proposal.name, outcome);
      notePrivateRead(toolContext.runId, outcome);
      if (
        outcome.result.ok &&
        (outcome.result.data as { readonly status?: unknown } | null)
          ?.status === "ON_REQUEST"
      ) {
        onRequestSeenRuns.add(toolContext.runId);
        boundedRunState();
      }
      if (
        outcome.status === "SUCCEEDED" &&
        outcome.result.ok &&
        outcome.classification === "READ_ONLY"
      ) {
        // Kept for the rest of this turn, whoever read it first.
        const reads =
          turnReads.get(toolContext.runId) ??
          new Map<string, QToolCallOutcome>();
        reads.set(turnReadKey(proposal), outcome);
        turnReads.set(toolContext.runId, reads);
        if (turnReads.size > 256) {
          const oldest = turnReads.keys().next().value;
          if (oldest !== undefined) turnReads.delete(oldest);
        }
      }
      if (isRead) readCache.keep(proposal, toolContext, outcome);
      else if (
        outcome.status === "SUCCEEDED" &&
        (outcome.classification === "PREPARE" ||
          outcome.classification === "SIDE_EFFECT")
      ) {
        // Something of theirs changed: what was read for them is not kept,
        // in this turn or after it.
        readCache.forget(toolContext);
        evidence.forgetPerson(toolContext.actor);
        turnReads.delete(toolContext.runId);
      }
      return aboutThemOnly(
        proposal,
        toolContext.runId,
        notePublicWeb(toolContext.runId, proposal.name, outcome),
        toolContext.conversation?.latestUserText ?? "",
      );
    },
  };
  const sensitivityPolicy = dependencies.sensitivity ?? { kind: "FROM_PLAN" };
  const dataPosture: ModelDataPosture =
    dependencies.dataPosture ?? "REAL_CUSTOMER";
  const communication =
    dependencies.communication ??
    fixedCommunicationProfile(DEFAULT_COMMUNICATION_PROFILE);
  let last: QAnswerObservation | undefined;

  /** Approved progress only; best effort, never a reason to fail the answer. */
  /** A finding the answer finished, shown before the whole answer is. */
  async function showFinding(
    request: QAnswerRequest,
    finding: Extract<QResultBlock, { kind: "FINDING" }>["finding"],
  ): Promise<void> {
    try {
      const run = { id: request.runId, tenantId: request.tenantId };
      const input = { type: "q.finding.available", data: { finding } } as const;
      const done = await appendRunEventAtomic(repositories, sql, run, input);
      if (done === "UNSUPPORTED") {
        await transactions.run((tx) =>
          appendRunEvent(repositories, tx, run, input),
        );
      }
    } catch (error: unknown) {
      logger?.warn(
        { err: error, qRunId: request.runId },
        "q live finding not recorded",
      );
    }
  }

  async function showStage(
    request: QAnswerRequest,
    stage: QVisibleStage,
    about?: QStageAbout,
  ): Promise<void> {
    try {
      const run = { id: request.runId, tenantId: request.tenantId };
      const input = {
        type: "q.stage.changed",
        data: about === undefined ? { stage } : { stage, about },
      } as const;
      // One statement on the request client where the store offers it
      // (S2); otherwise a transaction, as before.
      const done = await appendRunEventAtomic(repositories, sql, run, input);
      if (done === "UNSUPPORTED") {
        await transactions.run((tx) =>
          appendRunEvent(repositories, tx, run, input),
        );
      }
    } catch (error: unknown) {
      logger?.warn(
        { err: error, qRunId: request.runId },
        "q tool stage event not recorded",
      );
    }
  }

  /**
   * What is remembered, as bounded text; nothing when nothing is, or when
   * recall fails. A memory that cannot be read costs this answer its past,
   * never the answer itself.
   */
  async function recallMemory(
    request: QAnswerRequest,
    conversationId: string,
    utterance: string,
    earlierWords: readonly string[] = [],
  ): Promise<QMemoryRecalled> {
    const port = dependencies.memory;
    if (port === undefined) return NOTHING_RECALLED;
    try {
      const recalled = await port.recall({
        actor: request.actor,
        runId: request.runId,
        conversationId,
        subjects: request.subjects,
        utterance,
        earlierWords,
        plan: request.plan,
        signal: request.signal,
      });
      const text = recalledText(recalled).trim();
      return {
        text: text.length === 0 ? NOTHING_REMEMBERED : text.slice(0, 4_000),
        ownWords: typeof recalled === "string" ? [] : recalled.ownWords,
        earlierSummaries:
          typeof recalled === "string" ? [] : (recalled.earlierSummaries ?? []),
        callbacks:
          typeof recalled === "string" ? [] : (recalled.callbacks ?? []),
      };
    } catch (error: unknown) {
      logger?.warn(
        { err: error, qRunId: request.runId },
        "memory was not recalled for this answer",
      );
      return NOTHING_RECALLED;
    }
  }

  /**
   * The reads a turn needs before the model is asked anything: the
   * conversation, the assembled context, the tools offered, memory, and
   * the person's own facts (mandate, relationship, standing, pitch
   * moment, setup). Read-only and bound to the run's plan, so it can
   * start while the turn is still being read (warm) and be taken up by
   * the answer; null when the run has no conversation to answer.
   */
  /** S2: what the wide reads fill in; see `wide` in prepareTurn. */
  type WideReads = {
    readonly namedCompanies: readonly AuthorisedFact[];
    /** "Capital Q" was read as the company this turn (owner 2026-10-23). */
    readonly capitalQAsCompany: boolean;
    readonly namedCompanyCalls: readonly QToolCallObservation[];
    readonly ownDay: AuthorisedFact | null;
    readonly ownDayCalls: readonly QToolCallObservation[];
    /**
     * The day's raw reads beside the fact: what waits for their approval
     * and their zone, for the schedule card when the model reads their
     * schedule this turn (live 2026-10-28).
     */
    readonly ownDayReads: {
      readonly approvals: unknown;
      readonly timeZone: string | null;
    } | null;
    readonly ownStanding: AuthorisedFact | null;
    readonly ownStandingCall: QToolCallObservation | null;
    readonly ownIndex: AuthorisedFact | null;
    readonly onboardingFacts: readonly AuthorisedFact[];
    readonly arrival: AuthorisedFact | null;
    /**
     * Live 16 Nov 2026: the documents each company's data room showed
     * them (shared-documents.ts), so a turn that reuses these reads still
     * never offers to request what is already shared.
     */
    readonly sharedListings?:
      readonly (readonly [string, readonly ListedDocument[]])[] | undefined;
    /**
     * Live rerun on bab915357: a page of a document the company shared
     * with them was read for this turn (the answer is drawn from it).
     */
    readonly sharedRead?: boolean | undefined;
    /**
     * Live 17 Nov 2026 (Savanna on Nixo): by company name (lower case),
     * the titles of the shared documents whose pages were read for this
     * turn, so the figures-limit fact names them (company-fact.ts).
     */
    readonly sharedReadTitles?:
      readonly (readonly [string, readonly string[]])[] | undefined;
  };
  const NO_WIDE_READS: WideReads = {
    namedCompanies: [],
    capitalQAsCompany: false,
    namedCompanyCalls: [],
    ownDay: null,
    ownDayCalls: [],
    ownDayReads: null,
    ownStanding: null,
    ownStandingCall: null,
    ownIndex: null,
    onboardingFacts: [],
    arrival: null,
  };

  /**
   * Arrival row 22: an arrival follow-up code can answer from the snapshot,
   * offered as soon as it is known, so the answer does not wait for the
   * rest of the turn's preparation (assemble, profile, readiness, prompt).
   * Keyed by run; taken once by that run's answer.
   */
  const arrivalEarly = new Map<string, Promise<EarlyArrival | null>>();
  function prepareTurn(request: QAnswerRequest) {
    let offerEarly: (early: EarlyArrival | null) => void = () => undefined;
    arrivalEarly.set(
      request.runId,
      new Promise<EarlyArrival | null>((resolve) => {
        offerEarly = resolve;
      }),
    );
    while (arrivalEarly.size > 64) {
      const oldest = arrivalEarly.keys().next().value;
      if (oldest === undefined) break;
      arrivalEarly.delete(oldest);
    }
    const preparing = prepareTurnReads(request, offerEarly);
    // Whatever happens to the reads, the early offer settles (null: none).
    preparing.then(
      () => offerEarly(null),
      () => offerEarly(null),
    );
    return preparing;
  }

  async function prepareTurnReads(
    request: QAnswerRequest,
    offerEarly: (early: EarlyArrival | null) => void,
  ) {
    const plan: PermittedContextPlan = request.plan;
    /**
     * Everything recently said in this CONVERSATION, not in this run.
     *
     * A voice turn is a run of its own, so run-scoped history gave the
     * model a single sentence and no past: Q named a company, was asked
     * "tell me more about it", and answered that no company had been
     * named. The person is having one conversation; which run a sentence
     * belonged to is our bookkeeping, not theirs.
     */
    // Row 5: the turn's own read when the caller passed it.
    const history =
      request.history ??
      (await repositories.messages.listRecentForConversationOfRun(
        sql,
        request.tenantId,
        request.runId,
        64,
      ));
    const conversationId = history[0]?.conversationId;
    /**
     * Voice audit Phase 3 (live 16 Nov 2026, run 84be6936): the setup
     * reminder's read began only after every prepared read had landed and
     * then held the answer call for 2.0 s ("nudge"), queued behind the
     * turn's other reads on the same small connection pool. It starts here,
     * beside them, under the same own-only scope; whether the reminder is
     * offered is still decided where it was (a natural pause, a read turn),
     * and an answer that offers none never waits for it. A read only:
     * peek changes nothing, and a failed read is simply no reminder. Null
     * when not started here; the answer then reads it itself, as before.
     */
    const nudgePeek: Promise<QOnboardingNudge | null> | null =
      dependencies.onboardingNudge !== undefined &&
      conversationId !== undefined &&
      // Known already (an answer's own prepare): never during a series of
      // questions or on an unread turn, as below.
      request.questionSequence === undefined &&
      request.turnUnread !== true &&
      ownsOnboarding({ actor: request.actor, plan })
        ? dependencies.onboardingNudge.peek(request.actor, conversationId)
        : null;
    nudgePeek?.catch(() => undefined);
    /**
     * The most recent document Q put in front of this person, from
     * their own turns. Used only to tell the model one exists; which
     * artifact a revision touches is resolved server-side again.
     */
    const openDocumentTitle = (() => {
      for (let index = history.length - 1; index >= 0; index -= 1) {
        for (const block of history[index]?.blocks ?? []) {
          if (block.kind === "ARTIFACT_REFERENCE") return block.title;
        }
      }
      return undefined;
    })();
    const latest = [...history].reverse().find((m) => m.role === "USER");
    if (conversationId === undefined || latest === undefined) {
      return null;
    }
    const earlier = history.filter((m) => m.id !== latest.id);
    // Owner 14 Nov 2026: the account digest, read once per turn as the
    // person, beside every other read and before any lane answers. Typed
    // and spoken turns take this same path; a failed read is null (the
    // answer then says nothing of the account rather than guessing).
    //
    // RC3 (Q voice audit, 15 Nov 2026): the digest read for an earlier turn
    // of THIS conversation, by this person under this access context, may
    // stand in for re-reading it -- only on a turn whose execution class
    // reuses evidence, and only while fresh and unchanged (TTL, writes of
    // theirs, the watermark). Whether it does is known once the turn is read
    // (`settleEvidence`), so a warmed prepare holds the decision, not a read.
    const evidenceScope = evidenceScopeOf({
      actor: request.actor,
      plan,
      conversationId,
    });
    let digestRead: Promise<QAccountDigest | null> | undefined;
    const readDigest = (): Promise<QAccountDigest | null> => {
      digestRead ??= (
        dependencies.accountDigestOf === undefined
          ? Promise.resolve(null)
          : dependencies.accountDigestOf(request.actor).catch(() => null)
      ).then((digest) => {
        if (digest !== null) {
          evidence.keep(evidenceScope, "DIGEST", digest, {
            runId: request.runId,
            reads: ["account.digest"],
          });
        }
        return digest;
      });
      return digestRead;
    };
    const digestHeld =
      dependencies.accountDigestOf !== undefined &&
      evidence.holds(evidenceScope, "DIGEST");
    let settleDigest: (
      executionClass: TurnExecutionClass | undefined,
    ) => void = () => undefined;
    const accountDigest: Promise<QAccountDigest | null> = digestHeld
      ? new Promise<QAccountDigest | null>((resolve) => {
          let settled = false;
          settleDigest = (executionClass) => {
            if (settled) return;
            settled = true;
            resolve(
              executionClass !== undefined &&
                EXECUTION_LANES[executionClass].reuseEvidence
                ? evidence
                    .take<QAccountDigest>(evidenceScope, "DIGEST")
                    .then((kept) => {
                      if (kept === null) return readDigest();
                      logger?.info(
                        {
                          qRunId: request.runId,
                          executionClass,
                          readByRun: kept.provenance.runId,
                          ageMs: Date.now() - kept.readAt,
                        },
                        "q account digest answered from this conversation's evidence",
                      );
                      return kept.value;
                    })
                    .catch(() => readDigest())
                : readDigest(),
            );
          };
          // Never held past the turn: an answer that never settles it (a
          // code lane that returned first) reads it as before.
          setTimeout(() => {
            settleDigest(undefined);
          }, 20_000).unref?.();
        })
      : readDigest();
    if (request.executionClass !== undefined) {
      settleDigest(request.executionClass);
    }
    // Investigation milestone (12 Nov): pages this conversation's recent
    // research already read, for the follow-up to answer from and cite.
    const earlierPages = earlierResearchPages({
      history: earlier,
      fetched: request.fetchedInConversation ?? [],
    });
    // Filled once the run's context is assembled (below).
    const privateContextText: string[] = [];
    const toolContext: QToolExecutionContext = {
      actor: request.actor,
      runId: request.runId,
      correlationId: request.correlationId,
      capability: request.capability,
      plan,
      signal: request.signal,
      // The person's own words, for the one tool family that sends
      // anything outside Capital Q: its query is composed from these and
      // from authorised public identity, never from a model argument.
      conversation: {
        latestUserText: latest.content,
        // ADR 0081: the key of a statement recorded at once is this
        // conversation's, this message's and the statement's.
        conversationId,
        messageId: latest.id,
        // Their own earlier words, for a look-up that refers back ("look
        // her up" after naming her): never Q's words.
        earlierUserText: earlier
          .filter((message) => message.role === "USER")
          .slice(-3)
          .map((message) => message.content),
        // What Q said to them, from which only the name of whom they point
        // at ("the top one") may be searched (owner 2026-10-23).
        earlierQText: earlier
          .filter((message) => message.role === "Q")
          .slice(-3)
          .map((message) => message.content),
        // Private material this run holds (facts assembled for it beyond
        // network-visible, recalled memory, private reads): read when a
        // tool composes an outgoing search, so a word only it holds is
        // withheld. Never sent.
        privateText: () => [
          ...privateContextText,
          ...(privateReadsByRun.get(request.runId) ?? []),
        ],
      },
      // What the turn is about, read by code (lead 2026-10-02): the offer
      // narrows to it; absent, the purpose's list as before.
      ...(request.toolFocus === undefined ? {} : { focus: request.toolFocus }),
    };
    // Independent reads, side by side (speed sweep 2026-10-01: they ran
    // one after another, ~0.3 s of a turn's wait).
    // K4: what each part of context assembly took, for the turn's log.
    const prepareMs: Record<string, number> = {};
    const prepareStarted = Date.now();
    const timed = <T>(name: string, work: Promise<T>): Promise<T> =>
      work.finally(() => {
        prepareMs[name] = Date.now() - prepareStarted;
      });
    let arrival: AuthorisedFact | null = null;
    let arrivalData: ArrivalSnapshot | null = null;
    let arrivalLoaded: Promise<void> | undefined;
    /** Read once per turn, from the wide reads or from a follow-up's own path. */
    const arrivalRead = (): Promise<void> => {
      arrivalLoaded ??= (async (): Promise<void> => {
        if (
          dependencies.arrivalSnapshot === undefined ||
          request.writingDocument === true
        ) {
          return;
        }
        arrivalData = await dependencies
          .arrivalSnapshot(request.actor)
          .catch(() => null);
        arrival = arrivalSnapshotFact(arrivalData);
      })();
      return arrivalLoaded;
    };
    /**
     * W1: a follow-up on what Q told them on arrival is decided HERE, before
     * any tool read is started: when the snapshot answers it, the reads
     * below are skipped altogether (V2: six tool reads per A3 follow-up).
     * Started now so it overlaps the context assembly. The quick patterns
     * answer from the snapshot; unusual words are read by TURN_SKIM.
     */
    const arrivalEligible =
      // A named lookup is answered by code from the lookup tool; reading
      // it as a possible arrival follow-up cost a model call (live
      // 2026-10-10: ~0.9 s of a 1.4 s known-entity answer).
      request.personSearch === undefined &&
      request.discoverInvestors === undefined &&
      request.writingDocument !== true &&
      request.askedAction === undefined &&
      // Owner live 9 Nov: a turn that carries their attached files is
      // never answered by the arrival code, which skipped reading them.
      (plan.screen?.attachedDocumentIds?.length ?? 0) === 0 &&
      (request.turnKind === undefined || request.turnKind === "QUESTION_TO_Q");
    /**
     * Speed lane C (production 2026-10-12): only a follow-up that code
     * itself recognises (a Daily verb, the quick arrival patterns) holds
     * the reads below until it is decided. The semantic fallback (a
     * TURN_SKIM model call after the snapshot read) answers almost nothing
     * yet matched nearly every follow-up -- any pronoun or proper noun --
     * and held every read behind it: 1.0-2.7 s on the three slow runs
     * profiled (6027a668, b5eb0a12, decbdddf). It now runs beside the
     * reads and is taken only if it has answered by the time the answer
     * needs it; otherwise the turn is answered with the arrival fact among
     * the wide reads, as every other turn is.
     */
    const arrivalByCode =
      arrivalEligible &&
      dependencies.arrivalSnapshot !== undefined &&
      (dailyFollowUpKind(latest.content) !== null ||
        request.questionKind === "DAILY_FOLLOW_UP" ||
        arrivalFollowUpKind(latest.content) !== null);
    const decideArrival = async (): Promise<ArrivalReply | null> => {
      if (!arrivalEligible || dependencies.arrivalSnapshot === undefined) {
        return null;
      }
      // P4: the Q Daily stories Q mentioned: gist / more / open, by code
      // from the snapshot's prepared objects (the gate is words only, so
      // an unrelated turn reads nothing).
      // The Daily answer decides for itself (a verb, or a bare "the other
      // one" after stories); null leaves the turn to the rest.
      if (
        dailyFollowUpKind(latest.content) !== null ||
        request.questionKind === "DAILY_FOLLOW_UP"
      ) {
        await arrivalRead();
        const daily = dailyFollowUpAnswer(
          latest.content,
          arrivalData,
          earlier
            .filter((message) => message.role === "Q")
            .map((m) => m.content),
        );
        if (daily !== null) return daily;
      }
      const quick = arrivalFollowUpKind(latest.content) !== null;
      const maybe =
        !quick &&
        dependencies.arrivalSkim !== undefined &&
        pointsAtArrival(latest.content);
      if (!quick && !maybe) return null;
      await arrivalRead();
      const snapshot = arrivalData;
      if (snapshot === null) return null;
      if (quick) {
        return arrivalFollowUpAnswer(
          latest.content,
          snapshot,
          earlier
            .filter((message) => message.role === "USER")
            .slice(-2)
            .map((message) => message.content),
        );
      }
      const named = snapshot.items.filter((item) => item.counterpart !== null);
      if (named.length === 0 || dependencies.arrivalSkim === undefined) {
        return null;
      }
      // Live re-check of 6f9b63cc5 (run 1, "How come it made the list?"): a
      // why about an item of a list Q showed here, naming no one on their
      // arrival, is the reader's to bind to that card (shown-list
      // explanation), not an arrival follow-up: no third classification
      // call for it. Their arrival stays among the wide reads of any turn
      // that is not answered from a card.
      if (
        (request.executionClass === "CONTEXTUAL_FOLLOW_UP" &&
          request.followUpCompanyId !== undefined) ||
        (asksReasonForPlace(latest.content) &&
          companyCardNamesInConversation(earlier).length > 0 &&
          cardNamesInWords(
            latest.content,
            named.map((item) => item.counterpart?.name ?? ""),
          ).length === 0)
      ) {
        return null;
      }
      const skim = await dependencies.arrivalSkim
        .skim({
          utterance: latest.content,
          recentTurns: [],
          arrivalItems: named.map((item) => ({
            key: item.key,
            counterpart: item.counterpart?.name ?? null,
            headline: item.headline,
          })),
          attribution: {
            tenantId: request.tenantId,
            userId: request.actorUserId,
            qRunId: request.runId,
            correlationId: request.correlationId,
          },
        })
        .catch(() => null);
      if (
        skim !== null &&
        skim.kind === "ARRIVAL_FOLLOWUP" &&
        skim.confidence === "HIGH" &&
        skim.arrival != null
      ) {
        return arrivalAspectAnswer(
          snapshot,
          skim.arrival.item,
          skim.arrival.aspect,
        );
      }
      return null;
    };
    const arrivalDecision = decideArrival().catch(() => null);
    // Arrival row 22. Only the code answers ahead of the arrival follow-up
    // in answer() could take this turn (what needs them, their own
    // mandate); their words are kept off the early path, so the answer is
    // the one the full path would give.
    if (
      arrivalByCode &&
      conversationId !== undefined &&
      !asksWhatNeedsThem(latest.content) &&
      !asksForOwnMandate(latest.content)
    ) {
      void arrivalDecision.then((reply) => {
        if (reply !== null) {
          offerEarly({ reply, conversationId, latest, earlier });
        }
      });
    }
    const offerRead = timed(
      "offer",
      phased("offer", () => tools.offer(toolContext)),
    );
    // The facts read for every turn are read by code, so a turn's focus
    // (which narrows only what the model is offered) never removes them.
    const availableRead =
      tools.available === undefined
        ? Promise.resolve(null)
        : timed(
            "available",
            phased(
              "available",
              () => tools.available?.(toolContext) ?? Promise.resolve(null),
            ),
          );
    /**
     * The tools the prefetch may run: only tools the run may use (the
     * research filter decided later never touches them), and none for an
     * arrival follow-up the snapshot answers.
     *
     * S6 (lane S, live 2026-10-15 run ddf0738b, a GateQ dossier review,
     * 6.9 s to first text): the screen's own reads -- the selected
     * dossier's summarise, the page's records, the open document -- waited
     * for context assembly and memory (~0.8 s that day) though they need
     * only this set, known in ~10 ms. They now start from it, with the
     * same tools, plan and tool context, as the asker.
     */
    const prefetchToolsRead = (async (): Promise<{
      readonly names: ReadonlySet<string>;
      readonly arrivalAnswer: ArrivalReply | null;
    }> => {
      const [offered, available] = await Promise.all([
        offerRead,
        availableRead,
      ]);
      const arrivalAnswer = arrivalByCode ? await arrivalDecision : null;
      return {
        arrivalAnswer,
        names: new Set(
          arrivalAnswer !== null
            ? []
            : (available ?? offered).map((tool) => tool.definition.name),
        ),
      };
    })();
    // A failed offer fails the turn where it is awaited below, never here.
    prefetchToolsRead.catch(() => undefined);
    /**
     * The document Q made for them that is open on their screen, read for
     * them (voiceq-63, founder live 2026-10-04: Q opened the prep PDF and
     * could not read what it showed). Through read_my_document under the
     * plan, as the asker; its words are their document's, data to read
     * out or summarise, never instructions.
     */
    let onScreenDocument: AuthorisedFact | null = null;
    let onScreenDocumentCall: QToolCallObservation | null = null;
    const documentRead = (async (): Promise<void> => {
      const artifactId = plan.screen?.artifactId;
      if (artifactId === undefined) return;
      const { names } = await prefetchToolsRead;
      if (!names.has("read_my_document")) return;
      const call = {
        callId: "q-on-screen-document",
        name: "read_my_document",
        arguments: { artifactId },
      };
      const outcome = await tools.execute(call, toolContext);
      onScreenDocumentCall = {
        toolName: outcome.toolName,
        providerName: call.name,
        status: outcome.status,
        failureCode: outcome.failureCode,
        latencyMs: outcome.latencyMs,
      };
      if (outcome.result.ok) {
        onScreenDocument = onScreenDocumentFact(outcome.result.data);
      }
    })();
    // Awaited with the other reads below; a failure there is as before.
    documentRead.catch(() => undefined);
    /**
     * Lane 8: the documents they attached in the composer, read for them
     * through read_attached_document under this plan, as the asker (one
     * not theirs reads as NONE and adds nothing), so the first answer is
     * about the document with no tool round.
     */
    let attachedDocuments: readonly AuthorisedFact[] = [];
    /** The titles of those read this turn, for the turn note (23 Oct). */
    let attachedTitles: readonly string[] = [];
    /**
     * Owner live 9 Nov: the file attached on THIS turn (uploaded after
     * their previous message; the composer sends every file of the
     * conversation on every turn), whatever became of it, so "what's this
     * about?" means the file even while it is still being read.
     */
    const attachedThisTurn: { now: AttachedNow | null } = { now: null };
    const attachmentRead = (async (): Promise<void> => {
      const ids = plan.screen?.attachedDocumentIds;
      if (ids === undefined || ids.length === 0) return;
      const { names } = await prefetchToolsRead;
      if (!names.has("read_attached_document")) return;
      const question = latest?.content.slice(0, 500).trim();
      // The read shows as it starts, through the run's one stage tracker.
      stepStarts(request, "CHECKING_EVIDENCE");
      const reads = await Promise.all(
        ids.map((documentId, index) =>
          tools
            .execute(
              {
                callId: `q-attached-${String(index)}`,
                name: "read_attached_document",
                arguments: {
                  documentId,
                  ...(question === undefined || question.length === 0
                    ? {}
                    : { question }),
                },
              },
              toolContext,
            )
            .catch(() => null),
        ),
      );
      attachedTitles = reads.flatMap((outcome) => {
        if (outcome?.result.ok !== true) return [];
        const data: unknown = outcome.result.data;
        if (typeof data !== "object" || data === null) return [];
        const status: unknown = Reflect.get(data, "status");
        const title: unknown = Reflect.get(data, "title");
        return status === "READ" && typeof title === "string" ? [title] : [];
      });
      attachedThisTurn.now = attachedOnThisTurn(
        reads.map((outcome) =>
          outcome?.result.ok === true ? outcome.result.data : null,
        ),
        earlier.filter((message) => message.role === "USER").at(-1)
          ?.createdAt ?? null,
      );
      attachedDocuments = attachedDocumentsWithin(
        reads.map((outcome) =>
          outcome?.result.ok === true
            ? attachedDocumentFacts(outcome.result.data)
            : [],
        ),
      );
    })();
    attachmentRead.catch(() => undefined);
    /**
     * Stress 2026-10-28 (S02-post): the data-room documents on their screen
     * -- the one open in a viewer, or, for a question about what documents
     * or figures say, those the page's data room lists -- read for them
     * through read_document_pages under this plan, as the asker, so a
     * connected investor's chat reads a shared deck as the job does.
     */
    let dataRoomDocuments: readonly AuthorisedFact[] = [];
    const dataRoomDocumentRead = (async (): Promise<void> => {
      const reads = dataRoomDocumentReads({
        screen: plan.screen,
        question: latest?.content ?? "",
      });
      if (reads.length === 0) return;
      const { names } = await prefetchToolsRead;
      if (!names.has("read_document_pages")) return;
      const outcomes = await Promise.all(
        reads.map((read, index) =>
          tools
            .execute(
              {
                callId: `q-data-room-document-${String(index)}`,
                name: "read_document_pages",
                arguments: {
                  companyId: read.companyId,
                  documentId: read.documentId,
                },
              },
              toolContext,
            )
            .catch(() => null),
        ),
      );
      const share = Math.floor(DATA_ROOM_FACTS_MAX_CHARS / reads.length);
      dataRoomDocuments = outcomes.flatMap((outcome, index) => {
        const read = reads[index];
        return outcome?.result.ok === true && read !== undefined
          ? dataRoomDocumentFacts(outcome.result.data, read, share)
          : [];
      });
    })();
    dataRoomDocumentRead.catch(() => undefined);
    /**
     * Coordinator 23 Oct 2026: "compare the top two side by side" right
     * after a list of cards read nothing, so no table. The companies it
     * means are the ones Q showed (compareTargets); each is read now, in
     * parallel, through the same tools and plan the model would use: its
     * profile, its published figures and its fit. The reads feed the
     * code-built table, and the table is a fact the answer is spoken from.
     */
    let compareFacts: readonly AuthorisedFact[] = [];
    /** The companies compared, in order; the table holds only these. */
    let compareIds: readonly string[] = [];
    /**
     * The table itself, built once here from the prepare's own reads: a
     * speculative answer that took the run's reads must not leave the
     * adopted answer without it (live 23 Oct 21:49, run a19bae24).
     */
    let compareTable: QResultBlock | null = null;
    /** Who leads on Capital Q's fit, decided here by code (see ledByVerdict). */
    let compareVerdict: ComparisonVerdict | null = null;
    /**
     * Root cause, coordinator 24 Oct (third live miss, run 8605b721): the
     * prepare is warmed while the turn is still being read, so the request
     * it sees carries no reader `compare`; "which is better, Anchor or
     * Afyascan?" matched no words, nothing was read, and the answer that
     * took the warmed prepare had no comparison fact, no fits and no
     * verdict. The same reads run again for the turn's own reading
     * (`compareLate`, below) when the warmed prepare built none.
     */
    type CompareOutcome = {
      readonly facts: readonly AuthorisedFact[];
      readonly ids: readonly string[];
      readonly table: QResultBlock | null;
      readonly verdict: ComparisonVerdict | null;
    };
    const compareFor = async (
      reading: QAnswerRequest["compare"],
      /**
       * A2: places bound by code on the turn's own request. The prepare is
       * warmed before the binding exists, so the answer passes them here.
       */
      placedIds: readonly string[] | undefined = request.referencedCompanyIds,
    ): Promise<CompareOutcome | null> => {
      if (latest === undefined) return null;
      // No reader comparison (a warmed prepare, or a reading without one):
      // the companies its words name, found below by exact name only.
      const worded =
        reading === undefined ? namesToCompare(latest.content) : [];
      const asked =
        reading ??
        (worded.length >= 2 ? { count: null, names: worded } : undefined);
      // A2 (live 2026-11-04: "compare the second and third" tabled the
      // first two): places code bound to the shown list come first, in the
      // order said. Only ids from cards Q showed this person.
      const shownCards = newestAnswerCards(earlier);
      // Live 18 Nov 2026 (fictional Savanna, run cce59657): "Am I in
      // contact with any of those?" bound the three companies shown, and
      // those bound places alone built a side-by-side table. Places decide
      // which companies a comparison holds, never that there is one: only
      // a comparison the reading heard (or, with no reading, the words).
      const comparing = asked !== undefined || asksToCompare(latest.content);
      const placed = comparing
        ? (placedIds ?? []).filter((id) =>
            shownCards.some((card) => card.companyId === id),
          )
        : [];
      const fromCards =
        placed.length >= 2
          ? [...new Set(placed)].slice(0, 4)
          : compareTargets(latest.content, shownCards, asked);
      const named = asked?.names ?? [];
      if (fromCards.length < 2 && named.length < 2) return null;
      const { names } = await prefetchToolsRead;
      // Coordinator 24 Oct ("which is better, Anchor or Afyascan?"): the
      // companies the reader heard named but Q did not show are found by
      // their exact name, so they too are read and compared.
      const targets =
        fromCards.length >= 2 || !names.has("search_companies")
          ? fromCards
          : (
              await Promise.all(
                named.slice(0, 4).map(async (name, index) => {
                  const found = await tools
                    .execute(
                      {
                        callId: `q-compare-search-${String(index)}`,
                        name: "search_companies",
                        arguments: { query: name, limit: 5 },
                      },
                      toolContext,
                    )
                    .catch(() => null);
                  const exact = (itemsOf(found) ?? []).filter(
                    (item) =>
                      item.canonicalName.trim().toLowerCase() ===
                      name.trim().toLowerCase(),
                  );
                  return exact.length === 1
                    ? (exact[0]?.companyId ?? null)
                    : null;
                }),
              )
            ).filter(
              (id, index, all): id is string =>
                id !== null && all.indexOf(id) === index,
            );
      if (targets.length < 2) return null;
      const reads = targets.flatMap((companyId, index) =>
        [
          { name: "get_company", key: "profile" },
          { name: "read_company_figures", key: "figures" },
          { name: "fit_profile", key: "fit" },
        ]
          .filter((tool) => names.has(tool.name))
          .map((tool) =>
            tools
              .execute(
                {
                  callId: `q-compare-${tool.key}-${String(index)}`,
                  name: tool.name,
                  arguments: { companyId },
                },
                toolContext,
              )
              .then((outcome) => {
                // Live a7b99c465 ("Which is better, Anchor or Afyascan?"):
                // Anchor's profile and fit reads left no trace and the
                // table had Anchor unscored. A read that did not succeed is
                // logged, by tool, status and code (ids only, no content).
                if (outcome.status !== "SUCCEEDED") {
                  logger?.warn(
                    {
                      qRunId: request.runId,
                      tool: tool.name,
                      companyId,
                      status: outcome.status,
                      failureCode: outcome.failureCode,
                    },
                    "q compare read did not succeed",
                  );
                }
                return outcome;
              })
              .catch((error: unknown) => {
                logger?.warn(
                  {
                    qRunId: request.runId,
                    tool: tool.name,
                    companyId,
                    error: error instanceof Error ? error.name : "UNKNOWN",
                  },
                  "q compare read threw",
                );
                return null;
              }),
          ),
      );
      if (reads.length === 0) return null;
      stepStarts(request, "COMPARING_OPPORTUNITIES");
      // Scenario E (live 2026-11-16, run 06de74f3): what each compared
      // company shared with this investor (or opened to them in its data
      // room) is listed with the comparison's own reads, as them, so the
      // card's documents and the answer's rest on one listing per company.
      const listings =
        askerSideOf(request) === "INVESTOR" &&
        names.has("read_company_data_room")
          ? targets.map((companyId, index) =>
              tools
                .execute(
                  {
                    callId: `q-compare-documents-${String(index)}`,
                    name: "read_company_data_room",
                    arguments: { companyId },
                  },
                  toolContext,
                )
                .then((outcome) => {
                  const documents = outcome.result.ok
                    ? listedDocumentsOf(outcome.result.data)
                    : null;
                  if (documents === null || documents.length === 0) return;
                  const byCompany =
                    sharedDocumentsByRun.get(request.runId) ??
                    new Map<string, readonly ListedDocument[]>();
                  if (!byCompany.has(companyId.toLowerCase())) {
                    byCompany.set(companyId.toLowerCase(), documents);
                  }
                  sharedDocumentsByRun.set(request.runId, byCompany);
                  boundedRunState();
                })
                .catch(() => undefined),
            )
          : [];
      await Promise.all([...reads, ...listings]);
      // Live 2026-11-13 (Ajopot): a company whose Traction cell would be
      // empty after its published figures and profile has its deck read,
      // as the deck service shows it to this reader (an investor: the
      // sections the founder confirmed). Only then: the deck read is the
      // company's confidential material and raises the run's sensitivity
      // through the executor, so a comparison that needs nothing from a
      // deck stays as it was.
      const deckRead = names.has("read_company_deck")
        ? targets.filter((companyId) => {
            const known = runCompanies.read(request.runId);
            return tractionUnstated(
              known.companyFigures.get(companyId),
              known.companyFacts.get(companyId)?.description,
            );
          })
        : [];
      let deckUsed = false;
      await Promise.all(
        deckRead.map((companyId, index) =>
          tools
            .execute(
              {
                callId: `q-compare-deck-${String(index)}`,
                name: "read_company_deck",
                arguments: { companyId },
              },
              toolContext,
            )
            .then((outcome) => {
              runCompanies.noteDeck(request.runId, companyId, outcome);
              if (
                (runCompanies.read(request.runId).deckTraction.get(companyId)
                  ?.length ?? 0) > 0
              )
                deckUsed = true;
            })
            .catch((error: unknown) => {
              logger?.warn(
                {
                  qRunId: request.runId,
                  tool: "read_company_deck",
                  companyId,
                  error: error instanceof Error ? error.name : "UNKNOWN",
                },
                "q compare read threw",
              );
            }),
        ),
      );
      const table = comparisonTableBlock({
        question: latest.content,
        read: runCompanies.read(request.runId),
        fits: runFits.read(request.runId),
        only: targets,
        compareAsked: true,
      });
      const statement =
        table === null
          ? null
          : comparisonFactStatement(table, runFits.read(request.runId));
      if (statement === null || table === null) return null;
      return {
        ids: targets,
        table,
        verdict: comparisonVerdict(table, runFits.read(request.runId)),
        facts: [
          {
            scope: "NETWORK_VISIBLE_DATA",
            statement,
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
            source: deckUsed
              ? "Capital Q profiles, published figures, their decks and computed fit"
              : "Capital Q profiles, published figures and computed fit",
          },
        ],
      };
    };
    /**
     * A8 (owner directive 13 Nov 2026: no keyword routing). Which
     * companies a chart ask is about comes from the turn reader's typed
     * intent (TURN_READER v82 `chart`), never from capitalised words: each
     * name it heard is found by authorised exact search (the plan's
     * firewall applies), and their figures are read through the executor so
     * the chart code has them; nothing is drawn from prose. With no names
     * (they mean the companies already in context), or a follow-up that
     * repeats the previous chart: the previous CHART block's companies (a
     * repeat with names now draws those named now: "the same for
     * Clinicrest" is Clinicrest's chart), else the companies the reader's
     * pointing words bound (retrievalFocus), else the places bound on
     * Q's list. A name two companies fit is asked about, never guessed.
     * Takes the answer's own request: the prepare is warmed before the
     * turn is read (see compareLate).
     */
    type ChartResolution = {
      /** Resolved companies, in order; undefined: none named or in context. */
      readonly ids: readonly string[] | undefined;
      readonly metric: ChartMetricAsked;
      readonly period: ChartPeriod;
      readonly ambiguous: {
        readonly said: string;
        readonly candidates: readonly string[];
      } | null;
      readonly notFound: readonly string[];
    };
    const chartFiguresFor = async (
      asked: Pick<
        QAnswerRequest,
        "chartIntent" | "retrievalFocus" | "referencedCompanyIds"
      >,
    ): Promise<ChartResolution> => {
      const intent = asked.chartIntent;
      const previous =
        intent?.sameAsBefore === true ? previousChartOf(earlier) : null;
      const intentMetric = chartMetricOf(intent?.metric);
      const metric: ChartMetricAsked =
        intentMetric === "UNSPECIFIED" && previous?.metric != null
          ? previous.metric
          : intentMetric;
      const period = intent?.period ?? null;
      const none: ChartResolution = {
        ids: undefined,
        metric,
        period,
        ambiguous: null,
        notFound: [],
      };
      const { names } = await prefetchToolsRead;
      if (
        !names.has("search_companies") ||
        !names.has("read_company_figures")
      ) {
        return none;
      }
      const said = (intent?.companies ?? [])
        .map((name) => name.trim())
        .filter(
          (name, index, all) => name.length > 0 && all.indexOf(name) === index,
        )
        .slice(0, 4);
      const ledgerIds = (() => {
        const focus = asked.retrievalFocus;
        if (focus === undefined) return [];
        return focus.boundRefs.flatMap((ref) => {
          const entity = focus.ledger.entities.find((one) => one.ref === ref);
          return entity?.kind === "COMPANY" && entity.id !== null
            ? [entity.id]
            : [];
        });
      })();
      const searchFor = (
        lookups: readonly string[],
      ): Promise<
        readonly { said: string; ids: readonly string[]; names: string[] }[]
      > =>
        Promise.all(
          lookups.map(async (name, index) => {
            const found = await tools
              .execute(
                {
                  callId: `q-chart-search-${String(index)}`,
                  name: "search_companies",
                  arguments: { query: name, limit: 5 },
                },
                toolContext,
              )
              .catch(() => null);
            // Exact name only (trimmed, case-insensitive): structured
            // matching of a search result, never a guess at a near name.
            const exact = (itemsOf(found) ?? []).filter(
              (item) =>
                item.canonicalName.trim().toLowerCase() === name.toLowerCase(),
            );
            return {
              said: name,
              ids: exact.map((item) => item.companyId),
              names: exact.map((item) => item.canonicalName),
            };
          }),
        );
      const fromNames = async (
        lookups: readonly string[],
      ): Promise<Pick<ChartResolution, "ids" | "ambiguous" | "notFound">> => {
        const found = await searchFor(lookups);
        const twice = found.find((one) => new Set(one.ids).size >= 2);
        if (twice !== undefined) {
          return {
            ids: [],
            ambiguous: {
              said: twice.said,
              candidates: twice.names.slice(0, 4),
            },
            notFound: [],
          };
        }
        const notFound = found
          .filter((one) => one.ids.length === 0)
          .map((one) => one.said);
        const ids = found
          .flatMap((one) => one.ids.slice(0, 1))
          .filter((id, index, all) => all.indexOf(id) === index);
        return { ids, ambiguous: null, notFound };
      };
      const resolved =
        said.length > 0
          ? await fromNames(said)
          : previous !== null && previous.companies.length > 0
            ? await fromNames(previous.companies.slice(0, 4))
            : ledgerIds.length > 0
              ? { ids: ledgerIds.slice(0, 4), ambiguous: null, notFound: [] }
              : (asked.referencedCompanyIds ?? []).length > 0
                ? {
                    ids: (asked.referencedCompanyIds ?? []).slice(0, 4),
                    ambiguous: null,
                    notFound: [],
                  }
                : { ids: undefined, ambiguous: null, notFound: [] };
      if (resolved.ambiguous === null && resolved.notFound.length === 0) {
        await Promise.all(
          (resolved.ids ?? []).map((companyId, index) =>
            tools
              .execute(
                {
                  callId: `q-chart-figures-${String(index)}`,
                  name: "read_company_figures",
                  arguments: { companyId },
                },
                toolContext,
              )
              .catch(() => null),
          ),
        );
      }
      return { ...resolved, metric, period };
    };
    const compareRead = (async (): Promise<void> => {
      const outcome = await compareFor(request.compare);
      if (outcome === null) return;
      compareFacts = outcome.facts;
      compareIds = outcome.ids;
      compareTable = outcome.table;
      compareVerdict = outcome.verdict;
    })();
    compareRead.catch(() => undefined);
    // QA F-28: "who can see my data room?" is read by code, as the asker,
    // from the access editor's own reads (data-room-access.ts).
    let dataRoomFacts: readonly AuthorisedFact[] = [];
    const dataRoomRead = (async (): Promise<void> => {
      if (latest === undefined || !asksWhoCanSeeDataRoom(latest.content)) {
        return;
      }
      const { names } = await prefetchToolsRead;
      if (!names.has("read_my")) return;
      const read = (kind: "access" | "requests") =>
        tools
          .execute(
            {
              callId: `q-data-room-${kind}`,
              name: "read_my",
              arguments: { kind },
            },
            toolContext,
          )
          .then((outcome) => (outcome.result.ok ? outcome.result.data : null))
          .catch(() => null);
      const [access, requests] = await Promise.all([
        read("access"),
        read("requests"),
      ]);
      const statement = dataRoomAccessStatement(access, requests);
      if (statement === null) return;
      dataRoomFacts = [
        {
          scope: "OWN_RECORDS",
          statement,
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
          source: "Their data room's access settings and requests",
        },
      ];
    })();
    dataRoomRead.catch(() => undefined);
    /**
     * Live scenario F, defect 5 (16 Nov): an investor's turn naming a
     * company with a SUBMITTED application in their own GateQ inbox reads
     * that application, through read_my and gateq_inbox_summarise under
     * this plan, as the asker (gateq-application-fact.ts). Not when the
     * application is the one on their screen: the page read has it.
     */
    let gateqFacts: readonly AuthorisedFact[] = [];
    const gateqApplicationRead = (async (): Promise<void> => {
      if (latest === undefined) return;
      if (plan.screen?.manifest?.focus?.kind === "GATEQ_APPLICATION") return;
      const { names } = await prefetchToolsRead;
      gateqFacts = await readNamedGateqApplications({
        side: askerSideOf(request),
        available: names,
        latest: latest.content,
        earlier: earlier
          .filter((message) => message.role === "USER")
          .map((message) => message.content),
        execute: (name, args, callId) =>
          tools
            .execute({ callId, name, arguments: { ...args } }, toolContext)
            .then((outcome) => (outcome.result.ok ? outcome.result.data : null))
            .catch(() => null),
      });
    })();
    gateqApplicationRead.catch(() => undefined);
    /**
     * Q room R1: the whole page on their screen (sections, tab, filters,
     * open windows), sent as ids only and read back here through the read
     * tools the model could call, under the same plan, as the asker. A ref
     * whose read is refused is dropped unread; nothing the browser wrote
     * reaches the model.
     */
    let onScreenPage: readonly AuthorisedFact[] = [];
    /** The selected GateQ application's submitted dossier was read for them. */
    let onScreenDossier = false;
    const onScreenPageCalls: QToolCallObservation[] = [];
    const pageRead = (async (): Promise<void> => {
      const manifest = plan.screen?.manifest;
      if (manifest === undefined) return;
      const { names } = await prefetchToolsRead;
      const reads = manifestReads(manifest, names);
      const results = new Map<string, unknown>();
      await Promise.all(
        reads.map(async (read, index) => {
          const outcome = await tools
            .execute(
              {
                callId: `q-on-screen-page-${String(index)}`,
                name: read.name,
                arguments: { ...read.arguments },
              },
              toolContext,
            )
            .catch(() => null);
          if (outcome === null) return;
          onScreenPageCalls.push({
            toolName: outcome.toolName,
            providerName: read.name,
            status: outcome.status,
            failureCode: outcome.failureCode,
            latencyMs: outcome.latencyMs,
          });
          if (outcome.result.ok) results.set(read.key, outcome.result.data);
        }),
      );
      onScreenPage = manifestFacts(manifest, results);
      onScreenDossier = selectedDossierRead(manifest, results);
    })();
    pageRead.catch(() => undefined);
    const [assembled, profile, offeredForRun, availableForRun, recalled] =
      await Promise.all([
        timed(
          "assemble",
          phased("assemble", () => context.assemble(request)),
        ),
        timed(
          "profile",
          phased("profile", () => communication.profileFor(request)),
        ),
        offerRead,
        availableRead,
        arrivalByCode
          ? // Speed lane 2026-10-20 (arrival row 22): a follow-up the
            // snapshot answers by code is said with no model round, so it
            // never waits for memory recall (its own database reads).
            // Recall still runs; it is used whenever the code answer is not.
            (() => {
              const recall = timed(
                "memory",
                phased("memory", () =>
                  recallMemory(
                    request,
                    conversationId,
                    latest.content,
                    earlierWordsOf(earlier),
                  ),
                ),
              );
              return Promise.race([
                recall,
                arrivalDecision.then((answer) =>
                  answer === null ? recall : NOTHING_RECALLED,
                ),
              ]);
            })()
          : timed(
              "memory",
              phased("memory", () =>
                recallMemory(
                  request,
                  conversationId,
                  latest.content,
                  earlierWordsOf(earlier),
                ),
              ),
            ),
      ]);
    const memory = recalled.text;
    for (const fact of assembled.facts) {
      if (!PUBLIC_FACT_SCOPE.test(fact.scope)) {
        privateContextText.push(fact.statement);
      }
    }
    if (typeof memory === "string" && memory.length > 0) {
      privateContextText.push(memory);
    }
    // Step 9: their own past words recall found, for the claim check.
    const recalledOwnWords = recalled.ownWords;
    // Q's own summaries of other conversations recall rendered: echoes,
    // held to this run's documents after the answer (summaryCorrections).
    const recalledSummaries = recalled.earlierSummaries ?? [];
    // HQ-7: at most one callback, only one this turn bears on.
    const memoryCallback = memoryCallbackFor(
      recalled.callbacks ?? [],
      latest.content,
    );
    const { arrivalAnswer, names: prefetchTools } = await prefetchToolsRead;

    /**
     * Their own declared profile, read for them (CQ-QX-007; directive
     * "Home Q doesn't know the person").
     *
     * An investor asking "according to my profile, who am I?" was told
     * no profile facts existed, and one asking whether a company suits
     * what they invest in was told their thesis was unknown: the
     * firewall had admitted their own mandate and nothing read it. When
     * the plan binds INVESTOR_MANDATE to their own organisation (which
     * only an owner receives) it is read through the same tool the model
     * could call, under the same plan, and placed among the AUTHORISED
     * FACTS the model answers from.
     */
    /**
     * Their own standing -- relationships by state, and an investor's
     * Saves and Passes -- read on every turn, on every surface, through
     * the same tool the model could call (founder report 2026-10-01: "am
     * I interested in this company?" on Discover was answered "I don't
     * know" a minute after they had saved and passed on it). Started now
     * so it overlaps the reads below; its own record only, so nothing
     * here can carry another organisation's data.
     */
    // S2: started on first use, once. A fit sweep asks for it at once; the
    // wide reads below ask only when this turn's route needs them.
    let standingStarted: ReturnType<typeof tools.execute> | undefined;
    const standingOf = (): ReturnType<typeof tools.execute> | null => {
      if (!prefetchTools.has("list_my_relationships")) return null;
      standingStarted ??= tools.execute(
        {
          callId: "q-own-standing",
          name: "list_my_relationships",
          arguments: {},
        },
        toolContext,
      );
      return standingStarted;
    };
    let ownProfile: AuthorisedFact | null = null;
    let ownProfileCall: QToolCallObservation | null = null;
    /** The raw declared mandate, for a recall composed by code (K6). */
    let ownMandateData: unknown = null;
    const ownInvestor = ownInvestorOrganisationIn(plan);
    // A fit question over a set they own is computed by code, side by side
    // with the reads below, through the same tools and plan (fit-sweep.ts).
    // Investors only (fit is against their mandate); never for a document
    // or an action.
    const sweepable =
      ownInvestor !== null &&
      !isSingleCompanyQuestion(latest.content) &&
      request.writingDocument !== true &&
      (request.turnKind === undefined ||
        request.turnKind === "QUESTION_TO_Q" ||
        restatedListAsk(request));
    // INC-1: "rank them" is the set the last answer showed.
    const shownBefore = previousCardCompanyIds(earlier);
    // v56: every company card this conversation showed, for "three new ones".
    const shownInConversation = shownCardCompanyIds(earlier);
    // A comparison naming two earlier cards keeps those records even
    // after company analysis or an evidence-gap follow-up showed no list.
    // Step 4: a comparison is what the reader read, never a word list.
    const namedComparison = readAsComparison(request)
      ? namedCardCompanyIds(earlier, latest.content)
      : [];
    const sweepFor = (ask: FitSweepAsk): Promise<FitSweepResult | null> =>
      runFitSweep({
        ask,
        tools,
        context: toolContext,
        available: prefetchTools,
        own: (standingOf() ?? Promise.resolve(null)).then((outcome) =>
          outcome !== null && outcome.result.ok ? outcome.result.data : null,
        ),
        // D17: whom the account digest says they are in touch with is left
        // out too, so the answer's final check has nothing left to drop.
        // in-contact.ts is the one rule (GateQ applicants included).
        inTouch: accountDigest.then((digest) => inContactOf(digest)),
      }).catch(() => null);
    // v56: when the reader read "companies other than those shown", its
    // reading decides over the words' sweep, which would rank the same
    // companies again (production 2026-10-17, conversation 4f07dae7).
    const sweepAsk = !sweepable
      ? null
      : withReadCount(
          // v88 (D1): "leaving out companies I'm already in contact with"
          // is decided by the reading; the words' cue would pick exactly
          // those relationships.
          request.excludeRelationships === true
            ? fitSweepAskOfReading(
                {
                  text: request.fitQuestion?.text ?? latest.content,
                  count: request.fitQuestion?.count ?? null,
                  excludeShown: request.fitQuestion?.excludeShown === true,
                  excludeRelationships: true,
                },
                shownBefore,
                namedComparison,
                shownInConversation,
              )
            : // v90: "why do they fit?" is about the companies just shown,
              // as the reading read it, whatever the words' cue would pick.
              (request.fitQuestion?.excludeShown === true &&
                  shownInConversation.length > 0) ||
                (request.fitQuestion?.reasons === true &&
                  shownBefore.length > 0)
              ? fitSweepAskOfReading(
                  request.fitQuestion,
                  shownBefore,
                  namedComparison,
                  shownInConversation,
                )
              : (fitSweepAsk(latest.content, shownBefore, namedComparison) ??
                (request.fitQuestion === undefined
                  ? null
                  : fitSweepAskOfReading(
                      request.fitQuestion,
                      shownBefore,
                      namedComparison,
                      shownInConversation,
                    ))),
          request.fitQuestion?.count ?? null,
        );
    const fitSweep: Promise<FitSweepResult | null> =
      sweepAsk === null ? Promise.resolve(null) : sweepFor(sweepAsk);
    // Live 2026-10-09: a FIT reading arrives after a warmed prepare, which
    // read the words only. The reader's fit question is swept then, from
    // the same reads, so any wording reaches the computed fit.
    // D17 (live 15 Nov 2026, run bef9a7f4): a prepare warmed before the
    // turn was read holds a request without the reading's v88 exclusion;
    // the answer passes the exclusion it read (excludeRelationships), so
    // it reaches the sweep however the prepare was started.
    const sweepForReading = (fitQuestion: {
      readonly text: string;
      readonly count: number | null;
      readonly previous?: boolean | undefined;
      readonly excludeShown?: boolean | undefined;
      readonly excludeRelationships?: boolean | undefined;
      readonly reasons?: boolean | undefined;
    }): Promise<FitSweepResult | null> =>
      sweepable
        ? sweepFor(
            fitSweepAskOfReading(
              {
                ...fitQuestion,
                ...(request.excludeRelationships === true ||
                fitQuestion.excludeRelationships === true
                  ? { excludeRelationships: true }
                  : {}),
              },
              shownBefore,
              namedComparison,
              shownInConversation,
            ),
          )
        : Promise.resolve(null);
    // S2b: one declared profile fact about a company named outright, read
    // by code through the same tools and plan (search, then get).
    const factFor = (ask: CompanyFactAsk): Promise<CompanyFactAnswer | null> =>
      runNamedCompanyFact({
        ask,
        tools,
        context: toolContext,
        available: prefetchTools,
      }).catch(() => null);
    // Lead 2026-10-16: a map of companies, drawn by code from their declared
    // locations (companies-map.ts); "my top companies" is the fit ranking.
    const mapFor = (ask: CompaniesMapAsk): Promise<CompaniesMapAnswer | null> =>
      runCompaniesMap({
        ask,
        asked: latest.content,
        shownBefore,
        sweep:
          sweepAsk !== null
            ? fitSweep
            : sweepable
              ? sweepFor({
                  scope: "CANDIDATES",
                  place: null,
                  fitAsked: true,
                  count: null,
                })
              : Promise.resolve(null),
        tools,
        context: toolContext,
        available: prefetchTools,
      }).catch(() => null);
    // K1: companies of a kind, from the catalog by code, through the same
    // tools and plan; fit only for an investor and only when asked for.
    const discoverOnce = (
      ask: DiscoverAsk,
    ): Promise<DiscoveryAnswer | DiscoveryRankUnavailable | null> =>
      runCompanyDiscovery({
        ask,
        tools,
        context: toolContext,
        available: prefetchTools,
        investor: ownInvestor !== null,
      }).catch(() => null);
    /**
     * Owner 2026-10-24 (live bbb4b6773): a fit ranking over the network
     * that failed (the catalog already tried it twice) is never presented
     * as one. Its cause is logged, `networkRankFailed` holds it, and the
     * answer comes from their own pipeline, saying so.
     */
    let networkRankFailed: string | null = null;
    const discoverFor = async (
      ask: DiscoverAsk,
    ): Promise<DiscoveryAnswer | null> => {
      const found = await discoverOnce(ask);
      if (found === null || !("rankUnavailable" in found)) return found;
      logger?.warn(
        { qRunId: request.runId, cause: found.cause },
        "q fit ranking over the network failed",
      );
      networkRankFailed = found.cause;
      return null;
    };
    // W2: a named person, company or body, identified from public sources
    // by the lookup tool under this run's plan; the card is built by code.
    const personFor = (ask: PersonAsk, notOnCapitalQ = false) =>
      runPersonSearch({
        ask,
        tools,
        context: toolContext,
        available: prefetchTools,
        notOnCapitalQ,
      }).catch(() => null);
    // Live 2026-10-28: a founder's named organisation is one of Capital
    // Q's own investors first (the ones they may see), before any web.
    const knownInvestorFor = (name: string) =>
      findKnownInvestor({
        name,
        tools,
        context: toolContext,
        available: prefetchTools,
      }).catch(() => null);
    // D1: investors of a region or kind, found by meaning; cards by code.
    // Owner 2026-11-06: companies out on the public web, found by a
    // discovery plan from the mandate's categories (web-discovery.ts),
    // through this run's tools, plan and firewall.
    const webDiscoveryFor = async (
      ask: WebDiscoveryAsk,
      prepared: unknown,
      alreadyListed: ReturnType<typeof priorListings> = [],
    ) => {
      // The mandate is read through its authorised tool when this turn's
      // prepared reads did not need it (an investor's own mandate only).
      let mandate = prepared;
      const investorOrg = ownInvestorOrganisationIn(request.plan);
      if (
        (mandate === null || mandate === undefined) &&
        investorOrg !== null &&
        prefetchTools.has("get_investor_mandate")
      ) {
        const outcome = await tools
          .execute(
            {
              callId: "q-discovery-mandate",
              name: "get_investor_mandate",
              arguments: { investorOrganisationId: investorOrg },
            },
            toolContext,
          )
          .catch(() => null);
        if (outcome !== null && outcome.result.ok)
          mandate = outcome.result.data;
      }
      return runWebDiscovery({
        ask,
        alreadyListed,
        mandate: mandateCategories(mandate),
        tools,
        context: toolContext,
        available: prefetchTools,
        reader: webDiscoveryReader,
        attribution: {
          tenantId: request.tenantId,
          userId: request.actorUserId,
          correlationId: request.correlationId,
        },
      }).catch((error: unknown) => {
        logger?.warn(
          { err: error, qRunId: request.runId },
          "q web discovery failed",
        );
        return null;
      });
    };
    const investorsFor = (ask: InvestorAsk, companyId: string | null) =>
      runInvestorDiscovery({
        ask,
        tools,
        context: toolContext,
        available: prefetchTools,
        companyId,
      }).catch(() => null);
    // v58: which investors their own company should approach; cards by code.
    const prospectsFor = (ask: InvestorProspectsAsk, companyId: string) =>
      runInvestorProspects({
        ask,
        companyId,
        tools,
        context: toolContext,
        available: prefetchTools,
      }).catch(() => null);
    // RC2 (audit 2026-11-15): a founder's investors under the conditions
    // they stated (v89 listConditions, v88 exclusion), applied by code.
    const conditionedProspectsFor = (
      ask: InvestorProspectsAsk,
      conditions: ListConditions,
      companyId: string,
    ) =>
      runConditionedProspects({
        ask,
        conditions,
        companyId,
        tools,
        context: toolContext,
        available: prefetchTools,
        inContact: accountDigest.then(relationshipCounterparts),
      }).catch(() => null);
    // RC2: an investor's companies under the conditions they stated.
    const conditionedListFor = (input: {
      readonly conditions: ListConditions;
      readonly within: readonly string[] | null;
      readonly count: number | null;
      readonly discover: {
        readonly sectors: readonly string[];
        readonly countries: readonly string[];
        readonly stages: readonly string[];
      } | null;
    }) =>
      runConditionedCompanyList({
        ...input,
        tools,
        context: toolContext,
        available: prefetchTools,
        own: (standingOf() ?? Promise.resolve(null)).then((outcome) =>
          outcome !== null && outcome.result.ok ? outcome.result.data : null,
        ),
        inTouch: accountDigest.then((digest) => inContactOf(digest)),
      }).catch(() => null);
    // RECOVERY-2026-10 B1 (live T3): "what needs me" is read from every
    // source through the attention tool, under this run's plan, beside the
    // other reads; the answer is then written from it by code. Read only
    // for their own question, never for a document or an action.
    const attention: Promise<QToolCallOutcome | null> =
      request.writingDocument === true ||
      (request.turnKind !== undefined &&
        request.turnKind !== "QUESTION_TO_Q") ||
      !prefetchTools.has(ATTENTION_TOOL_NAME) ||
      !asksWhatNeedsThem(latest.content)
        ? Promise.resolve(null)
        : tools
            .execute(
              {
                callId: "q-attention",
                name: ATTENTION_TOOL_NAME,
                arguments: {},
              },
              toolContext,
            )
            .catch(() => null);
    // The reads below are independent of each other and run side by
    // side; each fills its own facts (speed sweep 2026-10-01: in turn
    // they took ~0.6 s before the model was asked anything).
    // K Part 4: a founder's own company from their Tier A snapshot, as a
    // fact, only where this run's plan holds that company's profile.
    let ownCompany: AuthorisedFact | null = null;
    /** Their own company's id (a founder), whatever the plan admits. */
    let ownCompanyId: string | null = null;
    const ownCompanyRead = (async (): Promise<void> => {
      if (ownInvestor !== null || dependencies.ownCompanySnapshot === undefined)
        return;
      const own = await dependencies
        .ownCompanySnapshot(request.actor)
        .catch(() => null);
      if (own === null) return;
      ownCompanyId = own.companyId;
      ownCompany = ownCompanySnapshotFact(own, plan);
    })();
    // Coordinator 2026-10-26 (B, run 42cecfd2): a founder's asked note or
    // email spent a tool round reading their own figures before drafting.
    // They are read here, beside the other reads, through the same tool
    // and plan, so the first round drafts with their real figures.
    let ownFigures: readonly AuthorisedFact[] = [];
    const ownFiguresRead = (async (): Promise<void> => {
      if (!asksForMessage(request.askedAction)) return;
      const { names } = await prefetchToolsRead;
      if (!names.has("read_company_figures")) return;
      await ownCompanyRead;
      if (ownCompanyId === null || ownCompany === null) return;
      const outcome = await tools.execute(
        {
          callId: "q-own-figures",
          name: "read_company_figures",
          arguments: { companyId: ownCompanyId },
        },
        toolContext,
      );
      if (outcome.result.ok) {
        ownFigures = companyFiguresFacts(
          outcome.result.data,
          "Their own company",
        );
      }
    })();
    const mandateRead = (async (): Promise<void> => {
      if (ownInvestor !== null && prefetchTools.has("get_investor_mandate")) {
        const call = {
          callId: "q-own-mandate",
          name: "get_investor_mandate",
          arguments: { investorOrganisationId: ownInvestor },
        };
        // K Part 4: the Tier A copy of this same read, when it is current
        // (only here, where this run's plan offers the mandate tool).
        const kept = await (
          dependencies.ownMandateReads?.get(request.actor) ??
          Promise.resolve(null)
        ).catch(() => null);
        if (kept !== null && kept !== undefined) {
          const fact = ownProfileFact(kept);
          if (fact !== null) {
            ownProfile = fact;
            ownMandateData = kept;
            ownProfileCall = {
              toolName: "investor_mandate.get",
              providerName: call.name,
              status: "SUCCEEDED",
              failureCode: null,
              latencyMs: 0,
            };
            prepareMs["mandateFromSnapshot"] = 1;
            return;
          }
        }
        const outcome = await tools.execute(call, toolContext);
        ownProfileCall = {
          toolName: outcome.toolName,
          providerName: call.name,
          status: outcome.status,
          failureCode: outcome.failureCode,
          latencyMs: outcome.latencyMs,
        };
        if (outcome.result.ok) {
          ownProfile = ownProfileFact(outcome.result.data);
          ownMandateData = outcome.result.data;
          await dependencies.ownMandateReads
            ?.remember(request.actor, outcome.result.data)
            .catch(() => undefined);
        }
      }
    })();
    /**
     * Where their own side stands with the counterparty the question is
     * about (CQ-Q-030), read through the same tool the model could call,
     * under the same plan: a company is asked about as an investor, an
     * investor organisation as a company. A side the person is not on
     * (a founder asking about a company) is refused by the tool and
     * simply adds nothing. A relationship itself as the subject is read
     * by its id, for whichever side the person is on; it comes first,
     * because it names exactly what the person is asking about.
     */
    let relationship: AuthorisedFact | null = null;
    let relationshipCall: QToolCallObservation | null = null;
    const asked = askedSubjects(request.subjects, plan);
    const counterparty =
      asked.find((subject) => subject.kind === "RELATIONSHIP") ??
      asked.find(
        (subject) =>
          subject.kind === "COMPANY" ||
          (subject.kind === "INVESTOR_ORGANISATION" &&
            subject.investorOrganisationId !== ownInvestor),
      );
    /**
     * The company on their screen or asked about, read for them (speed
     * sweep 2026-10-01): "this company" is known before the model is
     * asked, so the commonest Discover question needs no tool round to
     * learn its name. Same tool, same plan as the model's own call.
     */
    let onScreenCompany: AuthorisedFact | null = null;
    let onScreenCompanyCall: QToolCallObservation | null = null;
    /** Its canonical name, for who "they" is in a research follow-up. */
    let onScreenCompanyName: string | null = null;
    /** A4: its figures (published and from its deck), and what is unknown. */
    let onScreenCompanyFigures: readonly AuthorisedFact[] = [];
    const onScreenCompanyFigureCalls: QToolCallObservation[] = [];
    const companyRead = (async (): Promise<void> => {
      if (
        counterparty?.kind !== "COMPANY" ||
        !prefetchTools.has("get_company")
      ) {
        return;
      }
      const call = {
        callId: "q-on-screen-company",
        name: "get_company",
        arguments: { companyId: counterparty.companyId },
      };
      // A4 (rehearsal 2026-11-04): the profile's Key numbers come from the
      // deck as Q read it; Q answered "no burn rate" beside them having
      // read neither. Its published figures and its deck are read with the
      // profile, through the same tools, authorize steps and plan as the
      // model's own calls (a read refused for them adds nothing), so the
      // figures their screen shows reach the answer as the founder's claims.
      const sideRead = (name: string) =>
        prefetchTools.has(name)
          ? tools
              .execute(
                {
                  callId: `q-on-screen-company-${name}`,
                  name,
                  arguments: { companyId: counterparty.companyId },
                },
                toolContext,
              )
              .catch(() => null)
          : Promise.resolve(null);
      const [outcome, figures, deck] = await Promise.all([
        tools.execute(call, toolContext),
        sideRead("read_company_figures"),
        sideRead("read_company_deck"),
      ]);
      for (const [name, side] of [
        ["read_company_figures", figures],
        ["read_company_deck", deck],
      ] as const) {
        if (side === null) continue;
        onScreenCompanyFigureCalls.push({
          toolName: side.toolName,
          providerName: name,
          status: side.status,
          failureCode: side.failureCode,
          latencyMs: side.latencyMs,
        });
      }
      onScreenCompanyCall = {
        toolName: outcome.toolName,
        providerName: call.name,
        status: outcome.status,
        failureCode: outcome.failureCode,
        latencyMs: outcome.latencyMs,
      };
      if (outcome.result.ok) {
        onScreenCompany = onScreenCompanyFact(outcome.result.data);
        const read: unknown = outcome.result.data;
        const name =
          typeof read === "object" && read !== null
            ? (read as { readonly canonicalName?: unknown }).canonicalName
            : undefined;
        onScreenCompanyName = typeof name === "string" ? name : null;
        if (onScreenCompanyName !== null) {
          const figuresOk =
            figures !== null &&
            figures.status === "SUCCEEDED" &&
            figures.result.ok;
          const deckOk =
            deck !== null && deck.status === "SUCCEEDED" && deck.result.ok;
          onScreenCompanyFigures = [
            ...(figuresOk
              ? companyFiguresFacts(figures.result.data, onScreenCompanyName)
              : []),
            ...(deckOk
              ? companyDeckFiguresFacts(deck.result.data, onScreenCompanyName)
              : []),
            companyFiguresLimitFact(onScreenCompanyName, {
              published: figuresOk,
              deck: !prefetchTools.has("read_company_deck")
                ? "NOT_ASKED"
                : deckOk
                  ? "READ"
                  : "NOT_AVAILABLE",
            }),
          ];
        }
      }
    })();
    /**
     * Their own companies this turn names, as typed or as speech misheard
     * them, or as Q's last reply listed them (founder live 2026-10-01:
     * "compare Yamfield Agro, Tallyloom and Kazikit against my mandate"
     * got "I don't have enough company evidence"). Resolved against their
     * own records only, then read through get_company under the plan.
     */
    const namedCompanies: AuthorisedFact[] = [];
    /** "Capital Q" in this turn was read as the company (owner 2026-10-23). */
    let capitalQAsCompany = false;
    const namedCompanyCalls: QToolCallObservation[] = [];
    /** Companies the own-records read above took, so none is read twice. */
    const namedIds = new Set<string>();
    /** Companies whose figures and deck facts were given (never twice). */
    const figuresTaken = new Set<string>();
    /** The names those reads gave each company, by id (lowercase). */
    const namedNames = new Map<string, string>();
    const namedRead = async (): Promise<void> => {
      const standingCall = standingOf();
      if (standingCall === null || !prefetchTools.has("get_company")) return;
      const standing = await standingCall.catch(() => null);
      if (standing === null || !standing.result.ok) return;
      const lastQ = [...earlier].reverse().find((m) => m.role === "Q");
      const onScreen =
        counterparty?.kind === "COMPANY" ? counterparty.companyId : null;
      const known = knownCompaniesOf(standing.result.data);
      // Scenarios D4/E (live 2026-11-16, runs 7cef5d87, 06de74f3): a turn
      // that names its own company ("What closing balance does Halyard
      // Security's latest bank statement show?") also read Watchly and
      // Rankpay, from Q's greeting ("You're connected with Watchly", and
      // "ranked against" near-matched as Rankpay). The person's words are
      // matched as speech bends them; Q's last reply only exactly, and only
      // the companies the reader heard the turn mean, or all of them when
      // the turn names none -- a follow-up pointing back at what Q listed
      // ("compare those three").
      const heard = heardNames(request);
      const turnNamesOne =
        heard.length > 0 ||
        companyNameCandidates(latest.content, 2, heard).length > 0;
      const heardKeys = new Set(heard.map((name) => name.trim().toLowerCase()));
      const named = [
        ...companiesNamedIn(latest.content, known),
        ...companiesNamedIn(
          lastQ?.content.slice(0, 4_000) ?? "",
          known,
          5,
          "EXACT",
        ).filter(
          // A company the reader heard the turn mean is read wherever Q
          // named it ("does that match their deck?" after Q's answer).
          (company) =>
            !turnNamesOne || heardKeys.has(company.name.trim().toLowerCase()),
        ),
      ]
        .filter(
          (company, index, all) =>
            all.findIndex((one) => one.companyId === company.companyId) ===
            index,
        )
        .slice(0, 5)
        .filter((company) => company.companyId !== onScreen);
      for (const company of named) {
        namedIds.add(company.companyId);
        namedNames.set(company.companyId.toLowerCase(), company.name);
        // Its shared documents are listed now, beside its profile reads.
        startShared(company.companyId);
      }
      if (named.length > 0) stepStarts(request, "REVIEWING_COMPANY");
      // Live 16 Nov 2026 (Savanna on Tensorgate, T1-T3): a company of
      // theirs this turn or Q's last reply names was read for its profile
      // only, and the turn-named read below then skipped it as already
      // taken, so the deck's burn and runway (FINANCIALS, read and
      // discarded) never reached the answer, and "does that match their
      // deck?" was answered with no deck at all. The same company now gets
      // the same reads whichever path names it: its published figures and
      // its deck beside the profile (A4), for at most two companies so a
      // long list in Q's last reply does not read every deck.
      const withFigures = named.length <= NAMED_FIGURES_MAX;
      const side = (name: string, companyId: string, index: number) =>
        withFigures && prefetchTools.has(name)
          ? tools
              .execute(
                {
                  callId: `q-named-${name === "read_company_deck" ? "deck" : "figures"}-${String(index)}`,
                  name,
                  arguments: { companyId },
                },
                toolContext,
              )
              .catch(() => null)
          : Promise.resolve(null);
      await Promise.all(
        named.map(async (company, index) => {
          const call = {
            callId: `q-named-company-${String(index)}`,
            name: "get_company",
            arguments: { companyId: company.companyId },
          };
          const [outcome, figures, deck] = await Promise.all([
            tools.execute(call, toolContext),
            side("read_company_figures", company.companyId, index),
            side("read_company_deck", company.companyId, index),
          ]);
          namedCompanyCalls.push({
            toolName: outcome.toolName,
            providerName: call.name,
            status: outcome.status,
            failureCode: outcome.failureCode,
            latencyMs: outcome.latencyMs,
          });
          for (const [name, read] of [
            ["read_company_figures", figures],
            ["read_company_deck", deck],
          ] as const) {
            if (read === null) continue;
            namedCompanyCalls.push({
              toolName: read.toolName,
              providerName: name,
              status: read.status,
              failureCode: read.failureCode,
              latencyMs: read.latencyMs,
            });
          }
          if (!outcome.result.ok) return;
          const fact = onScreenCompanyFact(
            outcome.result.data,
            "A company of theirs this conversation names",
          );
          if (fact !== null) namedCompanies.push(fact);
          if (!withFigures) return;
          const canonical = (
            outcome.result.data as { readonly canonicalName?: unknown } | null
          )?.canonicalName;
          if (typeof canonical !== "string") return;
          const figuresOk =
            figures !== null &&
            figures.status === "SUCCEEDED" &&
            figures.result.ok;
          const deckOk =
            deck !== null && deck.status === "SUCCEEDED" && deck.result.ok;
          if (!figuresOk && !deckOk) return;
          if (deckOk) {
            deckByCompany.set(
              company.companyId.toLowerCase(),
              deck.result.data,
            );
          }
          figuresTaken.add(company.companyId);
          namedCompanies.push(
            ...(figuresOk
              ? companyFiguresFacts(figures.result.data, canonical)
              : []),
            ...(deckOk
              ? companyDeckFiguresFacts(deck.result.data, canonical)
              : []),
            companyFiguresLimitFact(canonical, {
              published: figuresOk,
              deck: !prefetchTools.has("read_company_deck")
                ? "NOT_ASKED"
                : deckOk
                  ? "READ"
                  : "NOT_AVAILABLE",
            }),
          );
        }),
      );
    };
    /**
     * S3a (lane S, live 2026-10-15): a company this turn names that is none
     * of their own records ("tell me about Baridi", "risks with
     * Ledgerfold") cost the model two tool rounds (company.search, then
     * company.get, ~1.5-2.5 s each) before its first sentence. It is read
     * here instead, through the same two tools and plan: only an exact,
     * single visible match, after their own records (never twice), on any
     * page; the record on screen is not read again here.
     */
    const visibleNamedRead = async (own: Promise<void>): Promise<void> => {
      // QO-36 (live 23 Oct, run 98561658): "Compare Ledgerline and Duplo"
      // asked with a record on screen read neither by name, so whether
      // Duplo's profile was in the answer depended on the page they were
      // on. Companies the turn names are read on any page; the one on
      // screen is never read twice here, and stays "this company".
      const onScreenId =
        counterparty?.kind === "COMPANY" ? counterparty.companyId : null;
      // "Capital Q" is never a name candidate (it is the platform's name);
      // an investor asking about it means the company, read as any other.
      const capitalQAsked = capitalQAsCompanyAsked({
        text: latest.content,
        investorSide: ownInvestor !== null,
        onboarding: plan.screen?.route === "ONBOARDING",
      });
      const names = [
        ...(capitalQAsked ? ["Capital Q"] : []),
        // v62: the companies the reader heard them name for a comparison,
        // as said, in any language (the words' own candidates follow).
        ...(request.compare?.names ?? []),
        ...companyNameCandidates(
          latest.content,
          comparisonAsked(request, latest.content, asksToCompare) ? 4 : 2,
          // A word opening a sentence is a name only when the reader heard
          // it as one (live 2026-10-28: "My" was searched).
          heardNames(request),
        ),
        ...(followsReplyAboutACompany(earlier)
          ? []
          : lowercaseNameCandidates(latest.content)),
      ].filter(
        (name, index, all) =>
          all.findIndex(
            (other) => other.toLowerCase() === name.toLowerCase(),
          ) === index,
      );
      // Live 2026-11-06 (347b74a8c): "How many borrowers does it have, and
      // what's its loan book?" after "What does Ledgerfold do?" got the
      // loan book and "no borrower number": a company NAMED in the words
      // was read here, one the reader bound a pronoun to was not, so each
      // part of a follow-up rested on what the model chose to look up.
      // The companies the turn reader bound this turn's words to (step 3,
      // checked against the ledger this person was shown) are read too,
      // by id, through the same tools and plan; a read refused adds
      // nothing. A company the ledger merely recalls is not read.
      const bound = boundCompaniesOf(request.retrievalFocus).filter(
        (companyId) => companyId !== onScreenId,
      );
      if (names.length === 0 && bound.length === 0) return;
      const found = await Promise.all([
        ...names.map((name, index) =>
          readNamedVisibleCompany({
            name,
            exclude: new Set(onScreenId === null ? [] : [onScreenId]),
            tools,
            context: toolContext,
            available: prefetchTools,
            callIndex: index,
            // Its stage goes out once a company matched, as its read starts.
            onFound: (companyId) => {
              stepStarts(request, "REVIEWING_COMPANY");
              startShared(companyId);
            },
          }).catch(() => null),
        ),
        ...bound.map((companyId, index) => {
          stepStarts(request, "REVIEWING_COMPANY");
          startShared(companyId);
          return readVisibleCompanyById({
            companyId,
            tools,
            context: toolContext,
            available: prefetchTools,
            callPrefix: "q-bound-company",
            callIndex: index,
          }).catch(() => null);
        }),
      ]);
      await own.catch(() => undefined);
      for (const read of found) {
        if (read === null) continue;
        if (
          read.deck !== null &&
          !deckByCompany.has(read.companyId.toLowerCase())
        ) {
          deckByCompany.set(read.companyId.toLowerCase(), read.deck);
        }
        for (const { providerName, outcome } of read.calls) {
          namedCompanyCalls.push({
            toolName: outcome.toolName,
            providerName,
            status: outcome.status,
            failureCode: outcome.failureCode,
            latencyMs: outcome.latencyMs,
          });
        }
        if (namedIds.has(read.companyId)) {
          // Live 16 Nov 2026 (T1): taken by the own-records read for its
          // profile; its figures and deck, read here, still count, once.
          const name = (read.data as { readonly canonicalName?: unknown })
            .canonicalName;
          if (typeof name === "string" && !figuresTaken.has(read.companyId)) {
            figuresTaken.add(read.companyId);
            namedCompanies.push(
              ...companyFiguresFacts(read.figures, name),
              ...companyDeckFiguresFacts(read.deck, name),
              companyFiguresLimitFact(name, {
                published: read.figures !== null,
                deck: read.deckRead,
              }),
            );
          }
          continue;
        }
        namedIds.add(read.companyId);
        figuresTaken.add(read.companyId);
        const readName = (read.data as { readonly canonicalName?: unknown })
          .canonicalName;
        if (typeof readName === "string") {
          namedNames.set(read.companyId.toLowerCase(), readName);
        }
        if (capitalQAsked && isCapitalQCompanyRead(read.data)) {
          capitalQAsCompany = true;
        }
        const fact = onScreenCompanyFact(
          read.data,
          "A company on Capital Q this turn names",
        );
        if (fact !== null) namedCompanies.push(fact);
        // Its published figures, each the company's own statement.
        const name = (read.data as { readonly canonicalName?: unknown })
          .canonicalName;
        if (typeof name === "string") {
          namedCompanies.push(...companyFiguresFacts(read.figures, name));
          // A4: the deck's figures, as their Deck tab reads them, and
          // what any figure not given means (unknown to Q, not absent).
          namedCompanies.push(
            ...companyDeckFiguresFacts(read.deck, name),
            companyFiguresLimitFact(name, {
              published: read.figures !== null,
              deck: read.deckRead,
            }),
          );
        }
      }
    };
    /**
     * Addendum 14 Nov 2026 (slice 6): on an investor's turn about a company
     * (on screen, or named this turn), the diligence requests they linked
     * to an uncertainty about it, with what came back, as code's own note.
     * Read through get_relationship as the person (its own authorize step
     * and the diligence service's party check): only their own requests
     * and what was shared with them, never a founder-private record.
     */
    const followUpRead = async (): Promise<void> => {
      if (ownInvestor === null || !prefetchTools.has("get_relationship")) {
        return;
      }
      const onScreen =
        counterparty?.kind === "COMPANY" ? counterparty.companyId : null;
      const ids = [...(onScreen === null ? [] : [onScreen]), ...namedIds]
        .filter((id, index, all) => all.indexOf(id) === index)
        .slice(0, 2);
      await Promise.all(
        ids.map(async (companyId, index) => {
          const outcome = await tools
            .execute(
              {
                callId: "q-follow-ups-" + String(index),
                name: "get_relationship",
                arguments: { companyId },
              },
              toolContext,
            )
            .catch(() => null);
          if (outcome === null || !outcome.result.ok) return;
          const read = GetRelationshipOutputSchema.safeParse(
            outcome.result.data,
          );
          if (!read.success) return;
          // D11 (live 396ebc21): the stage limit code may close with is
          // told to the answer before it is written, so it is said once.
          const limit =
            read.data.yourSide === "INVESTOR"
              ? stageLimitOf(
                  {
                    yourSide: read.data.yourSide,
                    state: read.data.relationship?.state ?? null,
                    milestones: read.data.relationship?.milestones ?? [],
                  },
                  read.data.counterpart.name,
                )
              : null;
          if (limit !== null) {
            namedCompanies.push({
              scope: "RELATIONSHIP_CONTEXT",
              statement: stageLimitNote(limit.line),
              truthClass: "VERIFIED",
              evidenceStatus: "PLATFORM_VERIFIED",
              source: "Capital Q relationship record",
            });
          }
          const followUps = read.data.diligence?.followUps ?? [];
          if (read.data.yourSide !== "INVESTOR" || followUps.length === 0) {
            return;
          }
          const byCompany =
            followUpsByRun.get(request.runId) ??
            new Map<string, readonly DiligenceFollowUp[]>();
          byCompany.set(companyId, followUps);
          followUpsByRun.set(request.runId, byCompany);
          boundedRunState();
          const note = reassessmentNote({
            company: read.data.counterpart.name ?? "the company",
            followUps,
          });
          if (note === null) return;
          namedCompanies.push({
            scope: "RELATIONSHIP_CONTEXT",
            statement: note.slice(0, 7_000),
            truthClass: "VERIFIED",
            evidenceStatus: "PLATFORM_VERIFIED",
            source: "Capital Q diligence requests and what came back",
          });
        }),
      );
    };
    /**
     * Live rerun on bab915357 (16 Nov 2026, turn 1: 23.1 s, 21 tools): the
     * listing waited for every named read (profile, figures and deck) and
     * the page reads for the listing, one hop after another, and each page
     * read took the whole document. A company's listing now starts the
     * moment its id is known (on screen at once; a named company as its
     * search or their standing resolves it), beside its profile reads, and
     * its page reads follow the listing straight away, bounded to the pages
     * the question needs (sharedPageRange). Same tools, same plan, as them.
     */
    type SharedRead = {
      readonly listing: QToolCallOutcome | null;
      readonly documents: readonly ListedDocument[] | null;
      readonly reads: readonly {
        readonly document: ListedDocument;
        readonly outcome: QToolCallOutcome | null;
        /**
         * Live 17 Nov 2026 (Savanna on Nixo): the further pages read when
         * no page of the first read stated an asked measure, and which
         * measures were still missing then (shared-documents.ts MEASURES).
         */
        readonly further?:
          | {
              readonly outcome: QToolCallOutcome | null;
              readonly missing: readonly number[];
            }
          | undefined;
      }[];
    };
    const sharedStarted = new Map<string, Promise<SharedRead>>();
    /** The deck each company's read gave (for the difference fact). */
    const deckByCompany = new Map<string, unknown>();
    let sharedWasRead = false;
    /** By company name (lower case): the shared documents read for it. */
    const sharedReadTitles = new Map<string, string[]>();
    const sharedReconcile =
      asksToReconcile(latest.content) || readAsComparison(request);
    const sharedRange = sharedPageRange({
      question: latest.content,
      reconcile: sharedReconcile,
    });
    const sharedOnScreenRead = new Set(
      dataRoomDocumentReads({
        screen: plan.screen,
        question: latest.content,
      }).map((read) => read.documentId),
    );
    /**
     * Live rerun on bab915357: an investor's question about a company's
     * figures (cash, burn, runway...), the company on screen or named, and
     * not a question about the web. Only narrows what this turn waits on.
     */
    const figuresAboutACompany =
      askerSideOf(request) === "INVESTOR" &&
      asksForFigures(latest.content) &&
      !asksForTheWeb(latest.content) &&
      (counterparty?.kind === "COMPANY" ||
        request.namedOther?.kind === "COMPANY");
    const sharedEligible = (): boolean =>
      askerSideOf(request) === "INVESTOR" &&
      prefetchTools.has("read_company_data_room");
    const startShared = (rawId: string): void => {
      if (!sharedEligible()) return;
      const companyId = rawId.toLowerCase();
      if (
        sharedStarted.has(companyId) ||
        sharedStarted.size >= SHARED_LISTINGS_MAX
      ) {
        return;
      }
      const index = sharedStarted.size;
      sharedStarted.set(
        companyId,
        (async (): Promise<SharedRead> => {
          const listing = await tools
            .execute(
              {
                callId: `q-shared-documents-${String(index)}`,
                name: "read_company_data_room",
                arguments: { companyId },
              },
              toolContext,
            )
            .catch(() => null);
          const documents =
            listing === null || !listing.result.ok
              ? null
              : listedDocumentsOf(listing.result.data);
          if (
            documents === null ||
            documents.length === 0 ||
            !prefetchTools.has("read_document_pages")
          ) {
            return { listing, documents, reads: [] };
          }
          const chosen = sharedDocumentReads({
            documents,
            question: latest.content,
            alreadyRead: sharedOnScreenRead,
            // Whether two sources agree is read from the most evidential
            // one, with the room the pages of both periods need.
            ...(sharedReconcile ? { max: 1 } : {}),
          });
          const reads = await Promise.all(
            chosen.map(async (document, at) => ({
              document,
              outcome: await tools
                .execute(
                  {
                    callId: `q-shared-document-${String(index)}-${String(at)}`,
                    name: "read_document_pages",
                    arguments: {
                      companyId,
                      documentId: document.documentId,
                      ...(sharedRange ?? {}),
                    },
                  },
                  toolContext,
                )
                .catch(() => null),
            })),
          );
          // Live 17 Nov 2026 (Savanna on Nixo): a figures read is bounded
          // to the first pages; an asked measure none of the pages read
          // states sends the read on, a few pages further into the most
          // evidential document that has more (once per company), before
          // anything is said to be not established.
          if (sharedRange === null) return { listing, documents, reads };
          const firstRead = reads.map((read) =>
            read.outcome !== null && read.outcome.result.ok
              ? pagesOfRead(read.outcome.result.data)
              : { pages: [], pageCount: null },
          );
          const missing = measuresMissing(
            latest.content,
            firstRead.flatMap((read) => read.pages),
          );
          if (missing.length === 0) return { listing, documents, reads };
          const at = firstRead.findIndex(
            (read) =>
              furtherPageRange({
                readTo: sharedRange.toPage,
                pageCount: read.pageCount,
              }) !== null,
          );
          const target = reads[at];
          const further =
            target === undefined
              ? null
              : furtherPageRange({
                  readTo: sharedRange.toPage,
                  pageCount: firstRead[at]?.pageCount ?? null,
                });
          if (target === undefined || further === null) {
            return { listing, documents, reads };
          }
          const outcome = await tools
            .execute(
              {
                callId: `q-shared-document-${String(index)}-further`,
                name: "read_document_pages",
                arguments: {
                  companyId,
                  documentId: target.document.documentId,
                  ...further,
                },
              },
              toolContext,
            )
            .catch(() => null);
          return {
            listing,
            documents,
            reads: reads.map((read, readAt) =>
              readAt === at ? { ...read, further: { outcome, missing } } : read,
            ),
          };
        })(),
      );
    };
    /**
     * Live 16 Nov 2026 (shared-documents.ts; Savanna on Tensorgate): on an
     * investor's turn about a company (on screen, or named this turn or in
     * Q's last reply), the documents that company has made open to them are
     * listed through read_company_data_room -- their own Data room tab, as
     * them, so another investor's grants and founder-private documents are
     * never in it -- and the most evidential ones are read through
     * read_document_pages (a shared highly confidential one under its grant,
     * ADR 0078), before the model is asked. Documents the screen lane read
     * already are not read twice. startShared began the reads; this turns
     * them into facts once the companies' names are known.
     */
    const sharedDocumentsRead = async (): Promise<void> => {
      if (!sharedEligible()) return;
      const onScreen =
        counterparty?.kind === "COMPANY" ? counterparty.companyId : null;
      for (const id of [
        ...(onScreen === null ? [] : [onScreen]),
        ...namedIds,
      ]) {
        startShared(id);
      }
      const started = [...sharedStarted.entries()];
      const results = await Promise.all(
        started.map(([, read]) => read.catch(() => null)),
      );
      started.forEach(([companyId], at) => {
        const result = results[at];
        if (result === null || result === undefined) return;
        const { listing, documents, reads } = result;
        if (listing !== null) {
          namedCompanyCalls.push({
            toolName: listing.toolName,
            providerName: "read_company_data_room",
            status: listing.status,
            failureCode: listing.failureCode,
            latencyMs: listing.latencyMs,
          });
        }
        if (documents === null || documents.length === 0) return;
        const byCompany =
          sharedDocumentsByRun.get(request.runId) ??
          new Map<string, readonly ListedDocument[]>();
        byCompany.set(companyId, documents);
        sharedDocumentsByRun.set(request.runId, byCompany);
        boundedRunState();
        const known = runCompanies.read(request.runId);
        const name =
          known.companyNames.get(companyId) ??
          known.profiles.get(companyId) ??
          namedNames.get(companyId) ??
          (companyId === onScreen?.toLowerCase()
            ? onScreenCompanyName
            : null) ??
          "The company";
        const listed = sharedDocumentsFact(name, documents);
        if (listed !== null) namedCompanies.push(listed);
        if (reads.length === 0) return;
        const share = Math.floor(
          DATA_ROOM_FACTS_MAX_CHARS / (reads.length * started.length),
        );
        let differenceGiven = false;
        for (const { document, outcome, further } of reads) {
          if (outcome === null) continue;
          namedCompanyCalls.push({
            toolName: outcome.toolName,
            providerName: "read_document_pages",
            status: outcome.status,
            failureCode: outcome.failureCode,
            latencyMs: outcome.latencyMs,
          });
          if (!outcome.result.ok) continue;
          const facts = dataRoomDocumentFacts(
            outcome.result.data,
            {
              companyId,
              documentId: document.documentId,
              open: false,
              shared: true,
            },
            share,
          );
          if (facts.length === 0) continue;
          sharedWasRead = true;
          namedCompanies.push(...facts);
          const titles = sharedReadTitles.get(name.toLowerCase()) ?? [];
          if (!titles.includes(document.title)) titles.push(document.title);
          sharedReadTitles.set(name.toLowerCase(), titles);
          // Live 17 Nov 2026 (Savanna on Nixo): the further pages read for
          // a measure the first pages did not state; only the pages that
          // state one are given (the rest stay one read away).
          if (further !== undefined && further.outcome !== null) {
            namedCompanyCalls.push({
              toolName: further.outcome.toolName,
              providerName: "read_document_pages",
              status: further.outcome.status,
              failureCode: further.outcome.failureCode,
              latencyMs: further.outcome.latencyMs,
            });
            if (further.outcome.result.ok) {
              const data = further.outcome.result.data;
              const carried = pagesCarrying(
                pagesOfRead(data).pages,
                further.missing,
              );
              if (
                carried.length > 0 &&
                typeof data === "object" &&
                data !== null
              ) {
                namedCompanies.push(
                  ...dataRoomDocumentFacts(
                    { ...data, pages: carried },
                    {
                      companyId,
                      documentId: document.documentId,
                      open: false,
                      shared: true,
                    },
                    share,
                  ),
                );
              }
            }
          }
          // Live rerun on bab915357 (turn 2): the deck's figures and the
          // document's, side by side with their periods and the document's
          // own notes, so a difference is explained from the document.
          if (differenceGiven) continue;
          const read = outcome.result.data as {
            readonly title?: unknown;
            readonly pages?: unknown;
          } | null;
          const pages: { page: number; text: string }[] = Array.isArray(
            read?.pages,
          )
            ? (read.pages as readonly unknown[]).flatMap((page) => {
                if (typeof page !== "object" || page === null) return [];
                const number: unknown = Reflect.get(page, "page");
                const words: unknown = Reflect.get(page, "text");
                return typeof number === "number" && typeof words === "string"
                  ? [{ page: number, text: words }]
                  : [];
              })
            : [];
          const difference = documentDeckDifferenceFact({
            company: name,
            deck: deckByCompany.get(companyId),
            document: {
              title:
                typeof read?.title === "string" ? read.title : document.title,
              pages,
            },
          });
          if (difference !== null) {
            namedCompanies.push(difference);
            differenceGiven = true;
          }
        }
      });
    };
    /**
     * Owner QA I7 (cheque-fit-fact.ts): "does my cheque fit X's round?"
     * reads X's computed fit -- the company on screen, or the one the turn
     * names -- so the cheque row and its dated FX estimate are the answer.
     */
    const chequeRead = async (): Promise<void> => {
      if (
        ownInvestor === null ||
        !asksChequeFit(latest.content) ||
        !prefetchTools.has("fit_profile")
      ) {
        return;
      }
      const onScreen =
        counterparty?.kind === "COMPANY" ? counterparty.companyId : null;
      const known = runCompanies.read(request.runId);
      const ids = [
        ...[...namedIds].filter((id) => {
          const name = known.companyNames.get(id) ?? known.profiles.get(id);
          return (
            name !== undefined &&
            name.length > 0 &&
            containsCompanyName(latest.content, name)
          );
        }),
        ...(onScreen === null ? [] : [onScreen]),
      ]
        .filter((id, index, all) => all.indexOf(id) === index)
        .slice(0, 2);
      await Promise.all(
        ids.map(async (companyId, index) => {
          const outcome = await tools
            .execute(
              {
                callId: `q-cheque-fit-${String(index)}`,
                name: "fit_profile",
                arguments: { companyId },
              },
              toolContext,
            )
            .catch(() => null);
          if (outcome === null || !outcome.result.ok) return;
          const data: unknown = outcome.result.data;
          const named: unknown =
            typeof data === "object" && data !== null
              ? Reflect.get(data, "name")
              : null;
          const statement = chequeFitStatement(
            typeof named === "string" ? named : "this company",
            data,
          );
          if (statement === null) return;
          namedCompanies.push({
            scope: "NETWORK_VISIBLE_DATA",
            statement,
            truthClass: "Q_INFERENCE",
            evidenceStatus: "SELF_REPORTED",
            source: "Capital Q's computed fit against their mandate",
          });
        }),
      );
    };
    /**
     * The Q Daily on their screen, read for them (founder live
     * 2026-10-01: "summarize everything here" on the Daily never read the
     * edition). Their own edition, through the tool the model would use.
     */
    let onScreenDaily: AuthorisedFact | null = null;
    let onScreenDailyCall: QToolCallObservation | null = null;
    const dailyRead = (async (): Promise<void> => {
      if (plan.screen?.route !== "DAILY" || !prefetchTools.has("get_q_daily")) {
        return;
      }
      const call = {
        callId: "q-on-screen-daily",
        name: "get_q_daily",
        arguments: {},
      };
      const outcome = await tools.execute(call, toolContext);
      onScreenDailyCall = {
        toolName: outcome.toolName,
        providerName: call.name,
        status: outcome.status,
        failureCode: outcome.failureCode,
        latencyMs: outcome.latencyMs,
      };
      if (outcome.result.ok) {
        onScreenDaily = onScreenDailyFact(outcome.result.data);
      }
    })();
    /**
     * Their day: now in their zone, calls and reminders for 7 days, what
     * waits for their approval, Q's work for them, their last rehearsals
     * (founder demo 2026-10-02). Own records only, through the tools the
     * model would call under the same plan, plus their own rehearsals.
     */
    let ownDay: AuthorisedFact | null = null;
    const ownDayCalls: QToolCallObservation[] = [];
    let ownDayReads: WideReads["ownDayReads"] = null;
    const dayRead = async (): Promise<void> => {
      if (!prefetchTools.has("list_schedule")) return;
      const read = async (name: string): Promise<unknown> => {
        if (!prefetchTools.has(name)) return null;
        const outcome = await tools
          .execute(
            { callId: `q-own-day-${name}`, name, arguments: {} },
            toolContext,
          )
          .catch(() => null);
        if (outcome === null) return null;
        ownDayCalls.push({
          toolName: outcome.toolName,
          providerName: name,
          status: outcome.status,
          failureCode: outcome.failureCode,
          latencyMs: outcome.latencyMs,
        });
        return outcome.result.ok ? outcome.result.data : null;
      };
      const [schedule, approvals, work, own] = await Promise.all([
        read("list_schedule"),
        read("list_pending_approvals"),
        read("list_q_work"),
        dependencies.ownDay?.(request.actor).catch(() => null) ?? null,
      ]);
      const zone = personTimeZone(own?.timeZone, plan.screen?.timeZone);
      ownDayReads = { approvals, timeZone: zone };
      ownDay = ownDayFact({
        now: (dependencies.now ?? (() => new Date()))(),
        timeZone: zone,
        schedule,
        approvals,
        work,
        rehearsals: own?.rehearsals ?? [],
      });
    };
    const relationshipRead = (async (): Promise<void> => {
      if (counterparty !== undefined && prefetchTools.has("get_relationship")) {
        const call = {
          callId: "q-relationship",
          name: "get_relationship",
          arguments:
            counterparty.kind === "RELATIONSHIP"
              ? { relationshipId: counterparty.relationshipId }
              : counterparty.kind === "COMPANY"
                ? { companyId: counterparty.companyId }
                : counterparty.kind === "INVESTOR_ORGANISATION"
                  ? {
                      investorOrganisationId:
                        counterparty.investorOrganisationId,
                    }
                  : {},
        };
        const outcome = await tools.execute(call, toolContext);
        relationshipCall = {
          toolName: outcome.toolName,
          providerName: call.name,
          status: outcome.status,
          failureCode: outcome.failureCode,
          latencyMs: outcome.latencyMs,
        };
        if (outcome.result.ok) {
          relationship = relationshipFact(outcome.result.data);
        }
      }
    })();
    let ownStanding: AuthorisedFact | null = null;
    let ownStandingCall: QToolCallObservation | null = null;
    let ownIndex: AuthorisedFact | null = null;
    const indexDone = async (): Promise<void> => {
      if (dependencies.ownIndex === undefined) return;
      const index = await dependencies
        .ownIndex({ actor: request.actor, runId: request.runId, plan })
        .catch(() => null);
      ownIndex = ownIndexFact(index);
    };
    const standingDone = async (): Promise<void> => {
      const standingCall = standingOf();
      if (standingCall !== null) {
        const outcome = await standingCall.catch(() => null);
        if (outcome !== null) {
          ownStandingCall = {
            toolName: outcome.toolName,
            providerName: "list_my_relationships",
            status: outcome.status,
            failureCode: outcome.failureCode,
            latencyMs: outcome.latencyMs,
          };
          if (outcome.result.ok) {
            const onScreen =
              counterparty?.kind === "COMPANY"
                ? counterparty.companyId
                : counterparty?.kind === "INVESTOR_ORGANISATION"
                  ? counterparty.investorOrganisationId
                  : null;
            // Their companies this message names, as typed or as heard
            // ("TALUM" for Tallyloom; live 2026-10-02), are the turn's
            // focus too: each gets its direction line.
            const named = companiesNamedIn(
              latest.content,
              knownCompaniesOf(outcome.result.data),
            ).map((company) => company.companyId);
            ownStanding = ownStandingFact(outcome.result.data, [
              ...(onScreen === null ? [] : [onScreen]),
              ...named.filter((id) => id !== onScreen),
            ]);
          }
        }
      }
    };
    /**
     * Where the person is in the pitch they are watching, and what is
     * said there (R18). Only when the plan carries the viewing moment --
     * the Q API authorised that pitch for this person and the firewall
     * bound its company -- and read through get_pitch_moment itself, so
     * the media context applies the playback rule once more. A refusal
     * adds nothing; no transcript adds a fact that says so.
     */
    let pitchMoment: AuthorisedFact | null = null;
    const pitchRead = (async (): Promise<void> => {
      if (plan.viewing !== undefined && prefetchTools.has("get_pitch_moment")) {
        const outcome = await tools.execute(
          {
            callId: "q-pitch-moment",
            name: "get_pitch_moment",
            arguments: {
              pitchId: plan.viewing.mediaAssetId,
              atSeconds: plan.viewing.positionSeconds,
              windowSeconds: 20,
            },
          },
          toolContext,
        );
        if (outcome.result.ok) {
          pitchMoment = pitchMomentFact(outcome.result.data, null);
        }
        return;
      }
      // QA F-99: a founder asking about their own pitch video gets a review
      // from its transcript, read by code (own-pitch-review.ts).
      if (
        latest !== undefined &&
        asksAboutOwnPitch(latest.content) &&
        prefetchTools.has("read_company_pitches")
      ) {
        await ownCompanyRead;
        if (ownCompanyId === null) return;
        const outcome = await tools.execute(
          {
            callId: "q-own-pitch",
            name: "read_company_pitches",
            arguments: { companyId: ownCompanyId },
          },
          toolContext,
        );
        if (asksOnlyToReviewOwnPitch(latest.content)) {
          markReviewOnly(request.runId);
        }
        if (outcome.result.ok) {
          pitchMoment = ownPitchReviewFact(outcome.result.data);
        }
      }
    })();
    /**
     * Who they are, from their own setup (CQ-QX-007): their name, the
     * role they gave, and how far along they are. Only when the firewall
     * granted OWN_ONBOARDING, which it grants to nobody but the person;
     * a read that fails costs this answer the facts, never the answer.
     */
    let onboardingFacts: readonly AuthorisedFact[] = [];
    const onboardingRead = async (): Promise<void> => {
      if (
        dependencies.ownOnboarding !== undefined &&
        ownsOnboarding({ actor: request.actor, plan })
      ) {
        try {
          onboardingFacts = ownOnboardingFacts(
            await dependencies.ownOnboarding.read(request.actor),
          );
        } catch (error: unknown) {
          logger?.warn(
            { err: error, qRunId: request.runId },
            "the person's own onboarding was not read for this answer",
          );
        }
      }
    };
    await Promise.all([
      timed("mandate", mandateRead),
      timed("ownCompany", ownCompanyRead),
      timed("ownFigures", ownFiguresRead),
      timed("relationship", relationshipRead),
      timed("pitch", pitchRead),
      timed("company", companyRead),
      timed("daily", dailyRead),
      timed("document", documentRead),
      timed("attachments", attachmentRead),
      timed("data-room-documents", dataRoomDocumentRead),
      timed("compare", compareRead),
      timed("data-room", dataRoomRead),
      timed("page", pageRead),
      timed("gateq-application", gateqApplicationRead),
    ]);
    // The data room's documents ride with the attached ones: both are
    // documents read for them, as them, before the model is asked.
    if (dataRoomDocuments.length > 0) {
      attachedDocuments = [...attachedDocuments, ...dataRoomDocuments];
    }
    prepareMs["reads"] = Date.now() - prepareStarted;
    /**
     * S2: the wide reads -- their standing, the companies a message names,
     * their day, the index of what they own, their setup -- are context for
     * the model's prompt and nothing else. A turn answered by code from an
     * app query (companies of a kind, fit, what needs them) or from a fact
     * already prepared (their mandate, the record on screen, their own
     * company) never reads them; every other turn does, once, here. Taken
     * on first use and shared by whoever asks (a warmed prepare and the
     * answer that takes it).
     */
    let wideRead: Promise<WideReads> | undefined;
    const wide = (): Promise<WideReads> => {
      wideRead ??= (async (): Promise<WideReads> => {
        const wideStarted = Date.now();
        // Live rerun on bab915357: the company on screen's shared documents
        // are listed and read from the first moment, beside every other read.
        if (counterparty?.kind === "COMPANY") {
          startShared(counterparty.companyId);
        }
        const ownNamed = namedRead();
        // RC3 item 3 (independent reads side by side): the cheque fit and
        // the diligence follow-ups need only the companies named (namedIds),
        // so they start as soon as the named reads land, beside the day,
        // standing, index, setup and arrival reads -- not after all of them.
        const named = Promise.all([
          timed("named", ownNamed),
          timed("named-visible", visibleNamedRead(ownNamed)),
        ]);
        const afterNamed = named.then(() =>
          Promise.all([
            timed("cheque", chequeRead()),
            timed("followUps", followUpRead()),
            timed("sharedDocuments", sharedDocumentsRead()),
          ]),
        );
        await Promise.all([
          timed("standing", phased("standing", standingDone)),
          timed("index", phased("index", indexDone)),
          timed("onboarding", phased("onboarding", onboardingRead)),
          named,
          // Live rerun on bab915357 (turn 1, 23.1 s): an investor's figures
          // question about a company is answered from that company's
          // records and the documents it shared; their schedule, approvals
          // and Q's work list say nothing to it, so they are not read for it
          // (still one tool call away).
          figuresAboutACompany
            ? Promise.resolve()
            : timed("day", phased("day", dayRead)),
          timed("arrival", phased("arrival", arrivalRead)),
          afterNamed,
        ]);
        prepareMs["wide"] = Date.now() - wideStarted;
        const reads: WideReads = {
          namedCompanies,
          capitalQAsCompany,
          namedCompanyCalls,
          ownDay,
          ownDayCalls,
          ownDayReads,
          ownStanding,
          ownStandingCall,
          ownIndex,
          onboardingFacts,
          arrival,
          sharedListings: [
            ...(sharedDocumentsByRun.get(request.runId) ?? new Map()),
          ],
          sharedRead: sharedWasRead,
          sharedReadTitles: [...sharedReadTitles],
        };
        // RC3: kept for a short follow-up of this conversation, with the
        // reads that produced it (provenance); facts keep their own.
        evidence.keep(evidenceScope, "WIDE", reads, {
          runId: request.runId,
          reads: [
            ...namedCompanyCalls,
            ...ownDayCalls,
            ...(ownStandingCall === null ? [] : [ownStandingCall]),
          ].flatMap((call) => (call.toolName === null ? [] : [call.toolName])),
        });
        return reads;
      })();
      return wideRead;
    };
    /**
     * RC3: the wide reads for a turn of this execution class. A class that
     * reuses evidence takes this conversation's fresh, unchanged wide reads
     * (same actor and access context) instead of reading them again; no
     * call is reported for them, since none was made this turn. Any other
     * class, or no such evidence, reads them as before.
     */
    const wideFor = async (
      executionClass: TurnExecutionClass | undefined,
    ): Promise<WideReads> => {
      if (
        wideRead === undefined &&
        executionClass !== undefined &&
        EXECUTION_LANES[executionClass].reuseEvidence
      ) {
        const kept = await evidence
          .take<WideReads>(evidenceScope, "WIDE")
          .catch(() => null);
        if (kept !== null) {
          logger?.info(
            {
              qRunId: request.runId,
              executionClass,
              readByRun: kept.provenance.runId,
              reads: kept.provenance.reads.length,
              ageMs: Date.now() - kept.readAt,
            },
            "q wide reads answered from this conversation's evidence",
          );
          if ((kept.value.sharedListings?.length ?? 0) > 0) {
            sharedDocumentsByRun.set(
              request.runId,
              new Map(kept.value.sharedListings),
            );
            boundedRunState();
          }
          return {
            ...kept.value,
            namedCompanyCalls: [],
            ownDayCalls: [],
            ownStandingCall: null,
          };
        }
      }
      return wide();
    };
    return {
      wide,
      wideFor,
      nudgePeek,
      settleEvidence: settleDigest,
      /**
       * DECISIONS 104: the sources this turn's full answer was given, kept
       * for this conversation's contextual follow-ups (same person, access
       * context and conversation; TTL and watermark as above).
       */
      keepAnswerContext: (sources: readonly string[]): void => {
        keepAnswerContext(evidence, evidenceScope, request.runId, sources);
      },
      prepareMs,
      history,
      conversationId,
      openDocumentTitle,
      latest,
      earlier,
      earlierPages,
      toolContext,
      assembled,
      profile,
      offeredForRun,
      availableForRun,
      memory,
      recalledOwnWords,
      memoryCallback,
      recalledSummaries,
      ownProfile,
      ownProfileCall,
      ownMandateData: (): unknown => ownMandateData,
      ownCompany,
      ownFigures,
      ownCompanyId,
      ownInvestor,
      relationship,
      relationshipCall,
      onScreenCompany,
      onScreenCompanyCall,
      onScreenCompanyName,
      onScreenCompanyFigures,
      onScreenCompanyFigureCalls,
      onScreenDaily,
      onScreenDailyCall,
      onScreenDocument,
      attachedDocuments,
      attachedTitles,
      attachedNow: (): AttachedNow | null => attachedThisTurn.now,
      compareFacts,
      compareIds,
      dataRoomFacts,
      gateqFacts,
      compareTable,
      compareVerdict,
      compareLate: compareFor,
      chartFigures: chartFiguresFor,
      onScreenDocumentCall,
      onScreenPage,
      onScreenDossier,
      onScreenPageCalls,
      arrival,
      arrivalAnswer,
      /** The semantic arrival reading still running beside the reads. */
      arrivalLate: arrivalByCode ? null : arrivalDecision,
      arrivalSnapshotOnce: async (): Promise<ArrivalSnapshot | null> => {
        await arrivalRead();
        return arrivalData;
      },
      asked,
      counterparty,
      pitchMoment,
      fitSweep,
      sweptAtPrepare: sweepAsk !== null,
      /** v56: the prepared sweep already left the shown companies out. */
      sweptExcludingShown: (sweepAsk?.exclude?.length ?? 0) > 0,
      /** v88: the prepared sweep already left their relationships out. */
      sweptExcludingRelationships: sweepAsk?.excludeRelationships === true,
      accountDigest,
      shownInConversation,
      discoverFor,
      /** Why the network's fit ranking failed this run, once it has. */
      networkRankFailedOf: () => networkRankFailed,
      factFor,
      mapFor,
      shownBefore,
      standingOf,
      personFor,
      knownInvestorFor,
      investorsFor,
      webDiscoveryFor,
      prospectsFor,
      conditionedProspectsFor,
      conditionedListFor,
      sweepForReading,
      // Owner 2026-10-23: the investor's own candidates, ranked by fit,
      // for a recommendation ask and for "rank them" over what nobody
      // could score.
      sweepCandidates: (count: number | null) =>
        sweepable
          ? sweepFor({
              scope: "CANDIDATES",
              place: null,
              fitAsked: true,
              count,
            })
          : Promise.resolve(null),
      investorAsking: ownInvestor !== null,
      attention,
    };
  }
  type PreparedTurn = Awaited<ReturnType<typeof prepareTurn>>;

  /**
   * Arrival row 22: the arrival follow-up answered before the rest of the
   * turn is prepared. The same words, blocks and stored message as the
   * full path's W1 answer (`persistCodeAnswer` there): no tool ran and no
   * public page was read, so only the screen-move and miss-line rules of
   * `persistAnswer` apply, and they are applied here the same way.
   */
  async function answerArrivalEarly(
    request: QAnswerRequest,
    early: EarlyArrival,
    leadLines: string | undefined,
    startedAt: number,
  ): Promise<QAnswerOutcome> {
    const { reply, conversationId, latest, earlier } = early;
    const open = reply.open;
    const given: QResultBlock[] =
      open === undefined
        ? []
        : [
            {
              kind: "UI_INTENT",
              intent: {
                kind: "OPEN_RECORD_PAGE",
                page: open.page,
                id: open.id,
                ...(open.anchor === undefined ? {} : { anchor: open.anchor }),
              },
            },
          ];
    let content =
      leadLines === undefined ? reply.text : `${leadLines}\n\n${reply.text}`;
    const localise = dependencies.localiseWords;
    if (localise !== undefined) {
      const said = await localise(
        {
          tenantId: request.tenantId,
          userId: request.actorUserId,
          runId: request.runId,
        },
        [content],
      ).catch(() => null);
      const prose = said?.[0];
      if (prose !== null && prose !== undefined) content = prose;
    }
    const carried = withoutUnaskedMoves(
      withFitIntegrity(given, {
        asked: latest.content,
        previous: previousCardCompanyIds(earlier),
        // QA U2: a mandate fit is an investor's; none for anyone else.
        mandate: askerSideOf(request) === "INVESTOR",
      }),
      latest.content,
    );
    const answerBlocks = carried.length === 0 ? undefined : carried;
    const missed = screenActMissLine(
      missFacts(dependencies, request.actor, earlier),
      [...earlier].reverse().find((message) => message.role === "Q")?.content ??
        null,
    );
    if (missed !== null && !content.includes("didn't go through")) {
      const rest = withoutLandedClaims(content);
      content = (rest.length === 0 ? missed : `${missed}\n\n${rest}`).slice(
        0,
        ANSWER_LIMIT_CHARS,
      );
    }
    // The caller may have streamed the lead under this answer's id already.
    const messageId =
      request.leadLinesSaid?.answerMessageId ??
      QMessageIdSchema.parse(randomUUID());
    // W4: the page pane's move joins the answer before it is stored.
    const blocks = await movedBlocks(request, answerBlocks);
    const message = await transactions.run(async (tx) => {
      const stored = await repositories.messages.insert(tx, {
        id: messageId,
        tenantId: request.tenantId,
        conversationId,
        runId: request.runId,
        role: "Q",
        content,
        ...(blocks === undefined ? {} : { blocks }),
      });
      await appendRunEvent(
        repositories,
        tx,
        { id: request.runId, tenantId: request.tenantId },
        {
          type: "q.message.completed",
          data: {
            message: boundedCompletedMessage({
              ...(toQMessage(stored) as QResponseMessage),
              ...(blocks === undefined ? {} : { blocks }),
            }).message,
          },
        },
      );
      return stored;
    });
    logger?.info(
      {
        qRunId: request.runId,
        itemKey: reply.itemKey,
        modelCalls: 0,
        toolCalls: 0,
        early: true,
        totalMs: Date.now() - startedAt,
      },
      "q answered an arrival follow-up from the arrival snapshot",
    );
    return {
      kind: "ANSWERED",
      messageId: message.id,
      modelPolicyVersion: "none",
      // No prompt was rendered for this answer; the bundle it would have
      // been rendered from is named, as the full path's code answers do.
      promptBundleVersion: bundleVersionOf(
        registry.getActive("Q_SYSTEM").versionId,
        registry.getActive("COMPANY_ANALYST").versionId,
      ),
    };
  }
  /**
   * Turns being prepared while they are read (speed sweep 2026-10-01: the
   * turn reader's ~1 s and these reads' ~0.5 s ran one after the other).
   * Bounded; one the answer never takes is dropped, and its reads only
   * ever read.
   */
  const warming = new Map<string, Promise<PreparedTurn>>();
  /**
   * Owner 2026-10-21 (visible stages): each step's stage goes out as the
   * step starts, in order, and never holds the step up. One tracker per
   * run, shared by the reads prepared for it and its answer: writes are
   * queued (stored in the order they happened) and a stage already showing
   * is not written again. A speculative answer keeps its own (its stages
   * wait with its text and vanish if it is cancelled).
   */
  const runStages = new Map<
    string,
    { now: string | undefined; queue: Promise<void> }
  >();
  const stagesOf = (runId: string) => {
    let stages = runStages.get(runId);
    if (stages === undefined) {
      stages = { now: undefined, queue: Promise.resolve() };
      runStages.set(runId, stages);
      while (runStages.size > WARMING_MAX) {
        const oldest = runStages.keys().next().value;
        if (oldest === undefined) break;
        runStages.delete(oldest);
      }
    }
    return stages;
  };
  /** A real step of this run (never a speculative answer's) begins. */
  const stepStarts = (request: QAnswerRequest, stage: QVisibleStage): void => {
    if (request.speculation !== undefined) return;
    const stages = stagesOf(request.runId);
    const key = stageKey(stage, undefined);
    if (stages.now === key) return;
    stages.now = key;
    stages.queue = stages.queue.then(() => showStage(request, stage));
  };
  const WARMING_MAX = 64;

  return {
    lastObservation: () => last,
    warm: (request: QAnswerRequest): void => {
      if (warming.has(request.runId)) return;
      const started = prepareTurn(request);
      // Never an unhandled rejection: the answer that takes it re-awaits
      // the same promise and sees the failure there.
      started.catch(() => undefined);
      /**
       * S3 (lane S, live 2026-10-15 run f854c339, a GateQ dossier
       * question): the wide reads (standing, work, schedule, named
       * companies; ~1 s) started only after the turn was read, on the
       * critical path before the model. On a screen focused on one record
       * the answer almost always takes them, so they start here, beside
       * the readers: the same memoised read, the same tools and plan, read
       * only; a turn answered by code simply never uses them.
       */
      // Owner 2026-10-21 (no serial wait that can run beside another): a
      // message that names a company has that company read while the turn
      // is still being read, not after; the same memoised, read-only reads.
      started
        .then((prepared) => {
          if (prepared === null) return undefined;
          // Live re-check of 9913a5b64 (turn C): right after Q showed
          // company cards, a turn that names nothing beyond them is most
          // likely a follow-up on those cards, which the answer may take
          // from the card alone (no wide reads); the reading decides, so
          // the reads wait for it rather than start here.
          // Live re-check of cb28c00e5 (turn D): a why about a card of an
          // earlier list ("why is MedTrail ranked first in the earlier
          // list?") is a card follow-up too: every card Q showed here.
          const cardNames = asksReasonForPlace(prepared.latest.content)
            ? new Set(
                companyCardNamesInConversation(prepared.earlier).map(nameKey),
              )
            : companyCardNamesOfLastQ(prepared.earlier);
          const candidates = [
            ...companyNameCandidates(
              prepared.latest.content,
              2,
              heardNames(request),
            ),
            ...(followsReplyAboutACompany(prepared.earlier)
              ? []
              : lowercaseNameCandidates(prepared.latest.content)),
          ].filter((name) => !cardNames.has(nameKey(name)));
          if (cardNames.size > 0 && candidates.length === 0) return undefined;
          if (
            candidates.length === 0 &&
            request.plan.screen?.manifest?.focus === undefined
          ) {
            return undefined;
          }
          return prepared.wide();
        })
        .catch(() => undefined);
      warming.set(request.runId, started);
      while (warming.size > WARMING_MAX) {
        const oldest = warming.keys().next().value;
        if (oldest === undefined) break;
        warming.delete(oldest);
      }
    },
    answer: async (request: QAnswerRequest): Promise<QAnswerOutcome> => {
      last = undefined;
      /**
       * Where a turn's seconds go.
       *
       * Model latency is already in the usage ledger; everything around it
       * was invisible, and a turn measured at thirteen seconds turned out
       * to hold three and a half seconds of model and the rest here. A
       * breakdown on every answer costs one log line and ends that class
       * of guesswork.
       */
      const startedAt = Date.now();
      let mark = startedAt;
      const phases: Record<string, number> = {};
      // Step 11: the checks every sentence passes, summed per stage.
      const stageClock = createStageClock();
      /** Step 11: the model's first words, from the seam's start. */
      let firstTextMs: number | null = null;
      /**
       * Code's opening lines for this answer: the caller's (readiness), or
       * an early grounded line this answer composes from its own reads
       * (early-lead.ts), said the moment the model is asked.
       */
      let leadLines: string | undefined = request.leadLines;
      if (request.offerTakenUnrecorded === true) markUnmoved(request.runId);
      // Addendum 14 Nov 2026: a yes to an uncertainty offer carries what it
      // resolves onto its request (slice 5); a turn about a named company
      // or person not theirs says what was checked (slice 0).
      if (request.offerTaken !== undefined) {
        offerToolByRun.set(request.runId, request.offerTaken.action);
      }
      if (request.offerTaken?.about !== undefined) {
        const standing = UncertaintyStandingSchema.safeParse(
          request.offerTaken.about.standing,
        );
        if (standing.success) {
          offerAboutByRun.set(request.runId, {
            statement: request.offerTaken.about.statement,
            standing: standing.data,
          });
        }
      }
      if (request.openResolution !== undefined) {
        openResolutionByRun.set(request.runId, request.openResolution);
      }
      if (
        request.askedAction !== undefined &&
        UNCERTAINTY_VEHICLES.has(request.askedAction)
      ) {
        askedVehicleByRun.set(request.runId, request.askedAction);
      }
      const meetingIntent = meetingIntentOf(request.askedAction);
      if (meetingIntent !== null) {
        meetingIntentByRun.set(request.runId, meetingIntent);
      }
      if (request.aboutNamedOther === true) {
        codeSaysCheckedRuns.add(request.runId);
      }
      boundedRunState();
      const took = (phase: string): void => {
        const now = Date.now();
        phases[phase] = now - mark;
        mark = now;
      };
      const plan: PermittedContextPlan = request.plan;
      const sensitivity: ModelSensitivity =
        sensitivityPolicy.kind === "FROM_PLAN"
          ? plan.maxSensitivity
          : sensitivityPolicy.sensitivity;
      // Prepared while the turn was being read, when the caller warmed it
      // (speed sweep 2026-10-01); otherwise now.
      const warmed = warming.get(request.runId);
      // A speculative answer leaves the warmed reads where they are: if it
      // is cancelled, the turn's own answer takes them up (they only read).
      const gate = speculationGate(request.speculation);
      /**
       * Owner 2026-10-21 (visible stages): each step's stage goes out as
       * the step starts, in order, and never holds the step up. Writes are
       * queued (one after another, so they are stored in the order they
       * happened) and a stage already showing is not written again. While
       * the answer is speculative the stage waits with its text.
       */
      const stages =
        gate === null
          ? stagesOf(request.runId)
          : {
              now: undefined as string | undefined,
              queue: Promise.resolve(),
            };
      const stageOnce = (
        stage: QVisibleStage,
        about?: QStageAbout,
      ): Promise<void> => {
        const key = stageKey(stage, about);
        if (key === stages.now) return stages.queue;
        stages.now = key;
        stages.queue = stages.queue.then(() =>
          gate === null
            ? showStage(request, stage, about)
            : gate.emit(() => showStage(request, stage, about)),
        );
        return stages.queue;
      };
      if (gate === null) warming.delete(request.runId);
      else
        void request.speculation?.decided.then(
          (adopted) => {
            if (adopted && warming.get(request.runId) === warmed) {
              warming.delete(request.runId);
            }
          },
          () => undefined,
        );
      const preparing = warmed ?? prepareTurn(request);
      // Arrival row 22: a snapshot answer by code goes out as soon as it
      // is known. Never for a speculative answer, which stores nothing
      // until it is adopted.
      const early = gate === null ? arrivalEarly.get(request.runId) : undefined;
      if (gate === null) arrivalEarly.delete(request.runId);
      if (early !== undefined) {
        const first = await Promise.race([
          preparing.then(
            () => null,
            () => null,
          ),
          early,
        ]);
        if (first !== null) {
          return answerArrivalEarly(request, first, leadLines, startedAt);
        }
      }
      const prepared = await preparing;
      if (prepared === null) {
        return { kind: "FAILED", diagnosticCode: "INTERNAL_ERROR" };
      }
      // RC3: the turn is read now; a warmed prepare's evidence decision is
      // taken from its execution class (absent: read as before).
      prepared.settleEvidence(request.executionClass);
      const {
        history,
        conversationId,
        openDocumentTitle,
        latest,
        earlier,
        earlierPages,
        toolContext: preparedToolContext,
        assembled: warmedAssembled,
        profile,
        offeredForRun,
        availableForRun,
        memory,
        recalledOwnWords,
        memoryCallback,
        recalledSummaries,
        ownProfile,
        ownCompany,
        ownFigures,
        ownProfileCall,
        relationship,
        relationshipCall,
        onScreenCompany,
        onScreenCompanyCall,
        onScreenCompanyName,
        onScreenCompanyFigures,
        onScreenCompanyFigureCalls,
        ownCompanyId,
        onScreenDaily,
        onScreenDailyCall,
        onScreenDocument,
        attachedDocuments,
        attachedTitles,
        attachedNow,
        compareFacts: preparedCompareFacts,
        compareIds: preparedCompareIds,
        dataRoomFacts,
        gateqFacts,
        compareTable: preparedCompareTable,
        compareVerdict: preparedCompareVerdict,
        compareLate,
        onScreenDocumentCall,
        onScreenPage,
        onScreenDossier,
        onScreenPageCalls,
        pitchMoment,
        fitSweep,
        sweptAtPrepare,
        sweptExcludingShown,
        sweptExcludingRelationships,
        accountDigest,
        shownInConversation,
        discoverFor,
        networkRankFailedOf,
        factFor,
        mapFor,
        shownBefore,
        standingOf,
        personFor,
        knownInvestorFor,
        investorsFor,
        webDiscoveryFor,
        prospectsFor,
        conditionedProspectsFor,
        conditionedListFor,
        sweepForReading,
        sweepCandidates,
        investorAsking,
        attention,
        counterparty,
      } = prepared;
      // Live 2026-11-06: whom this turn's public pages must tie to a record.
      if (
        request.namedOther?.kind === "PERSON" &&
        request.namedOtherAnchor !== undefined
      ) {
        notePersonAnchor(request.runId, {
          person: request.namedOther.name,
          company: request.namedOtherAnchor.company,
        });
      }
      // QA F-114: what this turn may put on their Discover filters. Noted
      // here, from the read turn: the turn is warmed before it is read
      // (answer.ts), so a rule noted while preparing never saw the reading
      // and refused nothing live (F-109/F-110, run 4dbd529e).
      noteDiscoverRule(request.runId, {
        discover: request.discoverCompanies ?? null,
        // Any list of companies in Q's newest answer is "the list" (cards,
        // comparison cards, a table): F-109/F-110 narrowed comparison cards.
        narrowing:
          request.discoverCompanies?.previous === true ||
          ((request.discoverCompanies !== undefined ||
            request.askedAction === SET_DISCOVER_FILTERS_TOOL) &&
            newestAnswerListsCompanies(earlier)),
        // A narrowing read as "set the filters" away from Discover is still a
        // question about the list; the page changes when they are on it or
        // asked to go there.
        asked:
          request.askedAction === "open_page" ||
          plan.screen?.route === "DISCOVER",
      });
      // The turn's own reading decides a comparison: a prepare warmed before
      // the reading built none, so its reads run now (see compareFor).
      // A2 (live 2026-11-04): explicit places bound after the warm prepare
      // ("the second and third") decide the set; a warmed top-two table of
      // other companies is replaced, never shown.
      const placed = request.referencedCompanyIds ?? [];
      const placedDiffers =
        placed.length >= 2 &&
        (preparedCompareIds.length !== placed.length ||
          preparedCompareIds.some((id, index) => id !== placed[index]));
      // Live 18 Nov 2026 (run cce59657): bound places make a comparison
      // only when one was asked for; "am I in contact with any of those?"
      // binds the same places and asks something else. The reading decides
      // (comparisonAsked): the words only when the turn was not read.
      const askedToCompare = comparisonAsked(
        request,
        latest.content,
        asksToCompare,
      );
      const lateCompare =
        placedDiffers && askedToCompare
          ? await compareLate(
              request.compare ?? { count: null, names: [] },
              placed,
            ).catch(() => null)
          : preparedCompareTable === null && request.compare !== undefined
            ? await compareLate(request.compare).catch(() => null)
            : null;
      // TURN_READER v94: a question about their contact with these
      // companies is answered from their relationships, never with a table
      // a prepare warmed on the words; only a comparison also heard keeps it.
      const keepsPrepared =
        request.contactStatusAsked !== true || askedToCompare;
      const compareFacts =
        lateCompare?.facts ?? (keepsPrepared ? preparedCompareFacts : []);
      const compareIds =
        lateCompare?.ids ?? (keepsPrepared ? preparedCompareIds : []);
      const compareTable =
        lateCompare?.table ?? (keepsPrepared ? preparedCompareTable : null);
      // A8 (owner directive 13 Nov 2026, no keyword routing): the chart
      // asked for is the reader's typed intent (TURN_READER v82 `chart`).
      // Its companies are resolved by code (authorised exact search, the
      // conversation's previous chart or bound references) and their
      // figures read before the answer is composed (chartFiguresFor).
      const chartAsked =
        request.asksForChart === true || request.chartIntent !== undefined;
      const chartResolution = chartAsked
        ? await prepared.chartFigures(request).catch(() => null)
        : null;
      const chartMetric: ChartMetricAsked =
        chartResolution?.metric ?? chartMetricOf(request.chartIntent?.metric);
      const chartPeriod: ChartPeriod =
        chartResolution?.period ?? request.chartIntent?.period ?? null;
      /** What the asked chart came to: code decides; the words follow it. */
      const chartAskOutcome = (
        blocks: readonly QResultBlock[],
        read: RunRead = runCompanies.read(request.runId),
      ): ChartOutcome => {
        if (chartResolution?.ambiguous != null) {
          return { kind: "AMBIGUOUS", ...chartResolution.ambiguous };
        }
        if (chartResolution != null && chartResolution.notFound.length > 0) {
          return { kind: "NOT_FOUND", said: chartResolution.notFound };
        }
        return answerChartOutcome({
          read,
          metric: chartMetric,
          asked: true,
          compareIds,
          blocks,
          chartIds: chartResolution?.ids,
          period: chartPeriod,
        });
      };
      /** The one chart this answer carries, asked for or beside a table. */
      const chartFor = (
        blocks: readonly QResultBlock[],
        read: RunRead = runCompanies.read(request.runId),
      ): QResultBlock | null => {
        if (!chartAsked) {
          return answerChart({
            read,
            metric: chartMetric,
            asked: false,
            compareIds,
            blocks,
          });
        }
        const outcome = chartAskOutcome(blocks, read);
        return outcome.kind === "DRAWN" ? outcome.block : null;
      };
      // The chart code will draw, as a fact for the words (chartFactOf), or
      // why none is drawn and the one question to ask (chartNotDrawnFact).
      const chartFact = chartAsked
        ? ((outcome: ChartOutcome) =>
            outcome.kind === "DRAWN"
              ? chartFactOf(outcome.block)
              : chartNotDrawnFact(outcome))(
            chartAskOutcome(compareTable === null ? [] : [compareTable]),
          )
        : null;
      const compareVerdict =
        lateCompare?.verdict ?? (keepsPrepared ? preparedCompareVerdict : null);
      /**
       * Step 11 (A2): the warmed prepare searched the documents before the
       * turn was read, with the person's words alone. The reading's
       * binding (step 5's ledger focus) and its compound parts arrive on
       * this request; the search is asked again with them, started now
       * and awaited only when the prompt is assembled. The evidence port
       * keeps one result per run and query plan, so a reading that changes
       * nothing about the searches costs nothing. A failed refinement
       * keeps the warmed result.
       *
       * Live re-check of 6f9b63cc5 (Phase 3 latency): a follow-up answered
       * from the card Q showed (coveredFollowUp below) takes none of the
       * documents' passages, so it never waits for a second search after
       * the reading (it held the answer call ~1.5 s behind the reader).
       */
      const coveredCard =
        request.executionClass === "CONTEXTUAL_FOLLOW_UP" &&
        request.writingDocument !== true &&
        request.askedAction === undefined &&
        (request.turnKind === undefined ||
          request.turnKind === "QUESTION_TO_Q") &&
        request.followUpCompanyId !== undefined
          ? shownCompanyCard(earlier, request.followUpCompanyId)
          : null;
      const refinesRetrieval =
        warmed !== undefined &&
        coveredCard === null &&
        (request.retrievalFocus !== undefined ||
          (request.askParts?.length ?? 0) >= 2);
      let retrievalRefineMs: number | null = null;
      const assembledRead: Promise<typeof warmedAssembled> = refinesRetrieval
        ? (() => {
            const refineStarted = Date.now();
            const refined = phased("assemble-refined", () =>
              context.assemble(request),
            )
              .catch(() => warmedAssembled)
              .finally(() => {
                retrievalRefineMs = Date.now() - refineStarted;
              });
            // Live 18 Nov 2026 (production 2da3e3357, run 7aac4d85,
            // Savanna "And what is the biggest risk in that?"): the refined
            // search was awaited without a bound after the reading; its
            // hybrid retrieval took 5 s for no hits (lexical 4.2 s) and the
            // whole assemble about 9 s, with no model call in that time.
            // The warmed result is already in hand: the refinement gets a
            // bounded wait, then the warmed one answers.
            return boundedRefinement(refined, warmedAssembled, () =>
              logger?.warn(
                { qRunId: request.runId, waitedMs: REFINE_WAIT_MS },
                "q refined retrieval was slow; the warmed retrieval answers",
              ),
            );
          })()
        : Promise.resolve(warmedAssembled);
      /** The selected company, for who "they" is in a research follow-up. */
      const selectedForResearch = (): SelectedCompany | null => {
        const subject = request.subjects.find(
          (candidate) => candidate.kind === "COMPANY",
        );
        if (subject?.kind !== "COMPANY") return null;
        return {
          companyId: subject.companyId,
          name:
            counterparty?.kind === "COMPANY" &&
            counterparty.companyId === subject.companyId
              ? onScreenCompanyName
              : null,
          own: ownCompanyId !== null && subject.companyId === ownCompanyId,
        };
      };
      // S2b: one declared profile fact about a company named outright.
      const companyFactAsk =
        request.writingDocument !== true &&
        request.askedAction === undefined &&
        (request.turnKind === undefined || request.turnKind === "QUESTION_TO_Q")
          ? companyFactAskOf(latest.content)
          : null;
      // Grows only by what use_capability loads (lead 2026-10-04).
      // Live 17 Nov 2026 (run 0f483277): the reading decides whether this
      // turn asks for any action; a warmed prepare began before it was
      // read, so the turn's own answer carries it into every tool call.
      let toolContext: QToolExecutionContext = {
        ...preparedToolContext,
        ...(request.asksNoAction === true ? { asksNoAction: true } : {}),
        // ADR 0081: likewise whether this turn's words may be taken as
        // their own statement (decided from the reading, never the model).
        ...(request.ownStatementClear === true
          ? { ownStatementClear: true }
          : {}),
      };
      // Model spend 18 Nov 2026: the plan class's stable catalogue, sent as
      // the tool list so the provider's prompt cache holds it from turn to
      // turn; this turn's offer stays what may be called. Not authority.
      const catalogueRead: Promise<readonly QOfferedTool[] | null> = (
        tools.catalogue?.(toolContext) ?? Promise.resolve(null)
      ).catch(() => null);
      took(warmed === undefined ? "prepare-reads" : "prepare-reads-warmed");
      // The person's settings for this answer, read side by side with the
      // reading wait, the setup reminder and the readiness read below (L1
      // latency sweep: these three were read one after another, ~40-180 ms
      // of the "prepare" phase hosted). Never a rejection: a failed read
      // is simply no setting.
      const personalityRead =
        dependencies.personalityOf === undefined
          ? Promise.resolve(null)
          : dependencies
              .personalityOf({
                tenantId: request.tenantId,
                userId: request.actorUserId,
              })
              .catch(() => null);
      const languageRead =
        dependencies.languageOf === undefined
          ? Promise.resolve(null)
          : dependencies
              .languageOf({
                tenantId: request.tenantId,
                userId: request.actorUserId,
              })
              .catch(() => null);
      const situationRead =
        dependencies.situationOf === undefined
          ? Promise.resolve(null)
          : dependencies
              // R2: the record on their screen, as the firewall passed
              // it on (plan.screen), so the situation can name it.
              .situationOf(request.actor, screenIdsOf(request.plan.screen))
              .catch(() => null);
      const askerRead =
        dependencies.askerOf === undefined
          ? Promise.resolve(null)
          : dependencies
              .askerOf({
                tenantId: request.tenantId,
                userId: request.actorUserId,
                firstAnswer: !earlier.some((message) => message.role === "Q"),
              })
              .catch(() => null);
      const receiptsRead =
        dependencies.receipts === undefined
          ? Promise.resolve([])
          : collectReceipts(history, dependencies.receipts, request.actor);
      // Awaited where it is used; a failure still fails the answer there.
      receiptsRead.catch(() => undefined);
      const etiquetteRead =
        dependencies.etiquetteOf === undefined
          ? Promise.resolve(null)
          : dependencies
              .etiquetteOf({
                tenantId: request.tenantId,
                userId: request.actorUserId,
              })
              .catch(() => null);
      /**
       * Whether this turn may reach the public web (CQ-QX-005), decided by
       * the conversation core from its reading of the turn, which has been
       * running alongside everything above. NEVER takes the research tool
       * out of the model's hands for this turn altogether: "what else
       * should I look for?" is not a search, and a company's name being
       * in the sentence is not one either. Absent (no reader composed):
       * the model keeps the tool and nothing is forced.
       */
      // Lane S: "put those three in a table" re-renders what was shown; it
      // never reaches the public web (re-render.ts).
      // C10 (audit item 6): with a reading, the reader decides (it read
      // the turn as answered from what was shown); the words decide only
      // when there is no reading, as a bounded fallback.
      const reRender =
        request.turnKind !== undefined
          ? request.answersFromShown === true
          : reRenderAskOf(
              latest.content,
              earlier.some((message) => message.role === "Q"),
            );
      /**
       * A turn about someone nobody in this conversation named: neither the
       * person nor Q said the name the reader gave. Someone they pointed at
       * ("Why might the top one pass on us?", after Q listed their
       * investors) is searched by the name Q showed them (owner 2026-10-23:
       * "find out who the top one is, get the name, and pass that to the
       * search"); a name nobody said is not looked up.
       */
      const pointedAtOnly =
        request.aboutNamedOther === true &&
        request.namedOther !== undefined &&
        request.namedOther !== null &&
        !namedInTheirWords(request.namedOther.name, [
          latest.content,
          ...earlier
            .filter((message) => message.role === "USER")
            .slice(-3)
            .map((message) => message.content),
          ...earlier
            .filter((message) => message.role === "Q")
            .slice(-3)
            .map((message) => message.content),
        ]);
      const research: Awaited<QAnswerRequest["research"]> =
        reRender || pointedAtOnly
          ? { mode: "NEVER", announceSourceChange: false }
          : request.research === undefined
            ? undefined
            : await request.research;
      took("reading");
      // A question to Q (fallback) keeps the web in the model's hands even
      // when nothing forces a search (web search 2026-10-06: "three
      // YC-backed companies that fit my mandate" was read as a question
      // about options, the tool was taken away, and Q answered from what
      // little it held). Only a turn that asks nothing loses it.
      // Live 2026-10-29 (run B): an unread "proper evidence-backed brief"
      // became a two-search chat answer, because the unread turn kept the
      // web in the model's hands. Research a request no reader understood
      // is never run inline: Q says it could not read it and offers to
      // start it (TURN_UNREAD_NOTE).
      // Live 17 Nov 2026 (run 0f483277): a question that asks for no
      // action is never offered a tool that prepares an approval card,
      // whatever a warmed offer (made before the reading) held.
      const offeredThisTurn =
        request.asksNoAction === true
          ? offeredForRun.filter((tool) => tool.preparesCard !== true)
          : offeredForRun;
      /**
       * The run could act for them (a change it prepares, a capability it
       * loads) but this answer was written without tools (the answer path
       * above): the notes say so, rather than that Q can do nothing.
       */
      let actsHeldBack = false;
      let offered =
        reRender || request.turnUnread === true
          ? offeredThisTurn.filter(
              (tool) => !PUBLIC_WEB_TOOLS.has(tool.definition.name),
            )
          : research?.mode === "NEVER" && research.fallback !== true
            ? offeredThisTurn.filter(
                (tool) => tool.definition.name !== "research_public_web",
              )
            : offeredThisTurn;
      // K8: the cheapest correct path. A question about what is already
      // prepared for this turn is answered over that context with no tool
      // round; everything uncertain keeps the full path.
      // S2: whether this turn needs the wide reads at all. Settled from the
      // request alone (never from what the reads would find): an app query
      // (companies of a kind, fit, what needs them) and a question about
      // something already prepared (their mandate, the record on screen,
      // their own company) are answered without them. Their work (Q_WORK)
      // is read from the day, so that subject takes it.
      const provisionalRoute = answerPathOf({
        turnKind: request.turnKind,
        questionKind: request.questionKind,
        preparedSubject: request.preparedSubject,
        discover: request.discoverCompanies !== undefined,
        fit: request.fitQuestion !== undefined,
        attention: false,
        writingDocument: request.writingDocument === true,
        askedAction: request.askedAction !== undefined,
        researchMode: research?.mode ?? "NEVER",
        aboutNamedOther: request.aboutNamedOther === true,
        discoveryQuestion: request.discovery?.kind === "ASK",
        prepared: {
          mandate: ownProfile !== null,
          onScreenRecord: onScreenCompany !== null || onScreenDocument !== null,
          focusDossier: onScreenDossier,
          qWork: true,
          ownCompany: ownCompany !== null,
          comparison: compareTable !== null,
        },
      });
      // A named person, company or body is answered by code from the
      // lookup tool; if the lookup finds nothing, the wide reads are taken
      // below before the model is asked.
      const personByCode =
        (request.personSearch !== undefined ||
          request.discoverInvestors !== undefined ||
          companyFactAsk !== null) &&
        request.writingDocument !== true &&
        request.askedAction === undefined &&
        (request.turnKind === undefined ||
          request.turnKind === "QUESTION_TO_Q");
      /**
       * Live re-check 15 Nov 2026 (T3): "Why the first one?" after a fit
       * list still read their day, relationships, the company and its
       * relationship (6 reads) and the model read its fit again (a second
       * call). A contextual follow-up about one company Q already showed
       * on a card is answered from that card: no wide reads, no tool round.
       */
      const coveredFollowUp = coveredCard;
      const withoutWideReads =
        coveredFollowUp !== null ||
        personByCode ||
        provisionalRoute.path === "APP_QUERY" ||
        (provisionalRoute.path === "PREPARED_CONTEXT" &&
          request.preparedSubject !== "Q_WORK") ||
        (request.writingDocument !== true &&
          request.askedAction === undefined &&
          (request.turnKind === undefined ||
            request.turnKind === "QUESTION_TO_Q") &&
          asksWhatNeedsThem(latest.content));
      /**
       * The public-web call code makes for this turn: the person's own words
       * (or, for a follow-up, the subject it points back to), with the
       * further phrasings planned by the research service.
       */
      /**
       * Whom the turn is about, as the turn reader understood it (v58), when
       * it is someone other than them: the only name this turn's public web
       * search and its pictures are made for.
       */
      const namedOther =
        request.aboutNamedOther === true ? (request.namedOther ?? null) : null;
      const researchFollowUp = () =>
        publicResearchFollowUp({
          history: earlier,
          question: latest.content,
          aboutNamedOther: request.aboutNamedOther === true,
          selected: selectedForResearch(),
        });
      const researchCallOf = (maxSources: number) => {
        const followUp = researchFollowUp();
        // Someone not theirs, as the turn reader understood whom the turn
        // is about (v58): searched as that name (pages checked to be about
        // them, their public profiles looked for), and attached to no record
        // of theirs. Never a name guessed from the words' capital letters
        // (production 2026-10-23: "Yes" was searched as a company).
        // Investors for a company are what is searched for, never the
        // company itself (owner's own conversation, 2026-10-24: "three
        // Qatari investors interested in Capital Q" was searched as a
        // lookup of Capital Q, and every page about an investor was
        // dropped for not naming it).
        const named =
          request.investorProspects !== undefined ||
          request.discoverInvestors !== undefined
            ? null
            : (namedOther?.name ?? null);
        const query = latest.content.trim().slice(0, 200);
        return {
          callId: "q-research",
          name: PUBLIC_WEB_TOOL,
          arguments: {
            ...(followUp ??
              (named !== null
                ? { target: "GENERAL", query, entityName: named }
                : { query })),
            maxSources,
          },
        };
      };
      /**
       * Owner 2026-10-23: "search Capital Q's database AND the web IN
       * PARALLEL, not one then the other." On a turn that asks for something
       * real, current or public, or about a company or person not theirs
       * (EXPLICIT), the public web is asked as soon as the turn is read,
       * beside every read of Capital Q's own records, instead of after the
       * model's tool round (which took seconds, and was skipped altogether
       * when that round answered without a tool). Same tool, same plan,
       * authorisation and egress policy, and still once per turn: the first
       * public-web call the model makes is answered by this one. A turn
       * code answers by itself (a company's fact, investors) keeps its own
       * path; a follow-up on
       * what was just found ("what did those sources say?") keeps the
       * model's own call, answered from what this person already read.
       */
      /**
       * The message is named before its text exists, so every fragment
       * that goes out early and the message that is finally stored are
       * one thing to whoever is reading.
       */
      // The caller streamed code's lead under this id (leadLinesSaid): what
      // follows, and the stored message, are the same message.
      const messageId =
        request.leadLinesSaid?.answerMessageId ??
        QMessageIdSchema.parse(randomUUID());
      /** When the first words went out, from the turn's start. */
      let firstPublishedMs: number | null = null;
      /** The early web search's line was said as the search started. */
      let researchingSaid = false;
      const earlyWebTool = offered.find(
        (tool) => tool.definition.name === PUBLIC_WEB_TOOL,
      );
      const earlyWeb: {
        readonly call: ReturnType<typeof researchCallOf>;
        readonly outcome: Promise<QToolCallOutcome>;
        readonly startedAt: number;
        /** The same subject's earlier empty search in this conversation. */
        readonly remembered?: true;
        claimed: boolean;
      } | null =
        research?.mode === "EXPLICIT" &&
        // Live re-check of 3b7145616 (turn C): a follow-up answered from
        // the card Q showed is answered from that card alone -- the web
        // search ran beside it all the same.
        coveredFollowUp === null &&
        // Web discovery plans its own searches from the mandate (owner
        // 2026-11-06): one search on the person's words is not it.
        request.webDiscovery === undefined &&
        // A person search's own lookup (W2) runs beside it: when the lane
        // finds no one, the answer has the web already (production
        // 2026-10-23: "Tell me about Zino Aviation and its team" went to the
        // lane, found nothing, and asked the web only after a model round:
        // 9 s to the first word).
        request.discoverInvestors === undefined &&
        companyFactAsk === null &&
        provisionalRoute.path === "DEEP_ANALYSIS" &&
        earlyWebTool !== undefined &&
        researchFollowUp() === null &&
        !followsUpPublicSources({
          history: earlier,
          question: latest.content,
          aboutNamedOther: request.aboutNamedOther === true,
          researchedNames: earlierResearchSubjects({
            history: earlier,
            fetched: request.fetchedInConversation ?? [],
          }),
          namedEntity: namedOther?.name ?? null,
        })
          ? (() => {
              const call = researchCallOf(4);
              const entity = (
                call.arguments as { readonly entityName?: unknown }
              ).entityName;
              const emptyKey =
                typeof entity === "string"
                  ? JSON.stringify([
                      request.tenantId,
                      latest.conversationId,
                      entity.trim().toLowerCase(),
                    ])
                  : null;
              const earlier =
                emptyKey === null || asksForFresh(latest.content)
                  ? undefined
                  : searchedEmpty.get(emptyKey);
              if (
                earlier !== undefined &&
                Date.now() - earlier.at < SEARCHED_EMPTY_TTL_MS
              ) {
                logger?.info(
                  { qRunId: request.runId, entity },
                  "q early web search: this conversation already found nothing on it",
                );
                return {
                  call,
                  outcome: Promise.resolve(earlier.outcome),
                  startedAt: Date.now(),
                  remembered: true as const,
                  claimed: false,
                };
              }
              const stage = earlyWebTool?.visibleStage;
              if (stage !== undefined && stage !== null) void stageOnce(stage);
              took("webStarted");
              // As callTool below: a speculative answer runs only reads.
              const outcome = (async () => {
                if (
                  gate !== null &&
                  !gate.adopted() &&
                  earlyWebTool?.classification !== "READ_ONLY"
                ) {
                  await gate.ready();
                }
                return tools.execute(call, toolContext);
              })();
              // Landed (or dropped) later; a turn that ends first must not
              // leave a rejection nobody handles.
              outcome.catch(() => undefined);
              const webStarted = Date.now();
              void outcome.then(
                (settled) => {
                  const data = settled.result.ok
                    ? (settled.result.data as {
                        readonly status?: unknown;
                        readonly sources?: readonly unknown[];
                      })
                    : null;
                  logger?.info(
                    {
                      qRunId: request.runId,
                      status: data?.status ?? settled.failureCode,
                      sources: data?.sources?.length ?? 0,
                      webMs: Date.now() - webStarted,
                      sinceStartMs: Date.now() - startedAt,
                    },
                    "q early web search landed",
                  );
                  if (emptyKey !== null && data !== null) {
                    searchedEmpty.delete(emptyKey);
                    // A search that could not run is not "found nothing":
                    // never remembered as empty (2026-10-25).
                    if (
                      (data.sources?.length ?? 0) === 0 &&
                      data.status !== "PROVIDER_UNAVAILABLE"
                    ) {
                      searchedEmpty.set(emptyKey, {
                        outcome: settled,
                        at: Date.now(),
                      });
                      while (searchedEmpty.size > SEARCHED_EMPTY_MAX) {
                        const oldest = searchedEmpty.keys().next().value;
                        if (oldest === undefined) break;
                        searchedEmpty.delete(oldest);
                      }
                    }
                  }
                },
                () => undefined,
              );
              // The first words go out as the search starts (owner
              // 2026-10-23: "it doesn't need to find every single thing
              // before it starts talking"), not once the reads and the
              // prompt behind them are ready (live: 6.4 s).
              if (
                request.leadLines === undefined &&
                readCache.get(call, toolContext) === null
              ) {
                // Claimed now, said only while a provider is really asked.
                researchingSaid = true;
                whileSearching(outcome, () => {
                  if (firstPublishedMs !== null) return;
                  firstPublishedMs = Date.now() - startedAt;
                  const delta = {
                    runId: request.runId,
                    tenantId: request.tenantId,
                    messageId,
                    text: `${researchLead(
                      typeof entity === "string" ? entity.slice(0, 60) : null,
                    )} `,
                    holding: true as const,
                  };
                  if (gate === null) deltas?.publish(delta);
                  else gate.emit(() => deltas?.publish(delta));
                });
              }
              logger?.info(
                {
                  qRunId: request.runId,
                  entity: entity ?? null,
                  personLane: request.personSearch !== undefined,
                  said: researchingSaid,
                  sinceStartMs: Date.now() - startedAt,
                },
                "q early web search started",
              );
              return { call, outcome, startedAt: webStarted, claimed: false };
            })()
          : null;
      /**
       * Owner 2026-10-23: when the turn's web search is about one named
       * company or person, their pictures from public pages are looked for
       * beside it, from the same name; they join the answer after its words.
       */
      // Whatever the research mode (live 2026-10-23: the picture search
      // started only with the early web search, so a turn read as their
      // own records, or a person search, showed no picture at all): the
      // web search's name, else the person search's, else whom the turn
      // reader understood the turn to be about. Only ever a name a model
      // read by meaning, never one guessed from the words (production
      // 2026-10-23: "Yes" drew a stock picture of the word).
      const earlyWebName = (
        earlyWeb?.call.arguments as
          { readonly entityName?: unknown } | undefined
      )?.entityName;
      const namedForPictures =
        typeof earlyWebName === "string"
          ? earlyWebName
          : (request.personSearch?.name.trim() ?? namedOther?.name);
      // Owner's spend rule 2026-10-25: the picture search is paid for only
      // when the answer can show a picture of them -- once a search matched
      // pages to them, Capital Q holds their website, or the person lookup
      // found them -- never on every turn that names someone. Started once,
      // when first asked for (as the early web search lands, else as the
      // answer is put together).
      const pictureSearch = dependencies.publicPictures;
      let picturesStarted: ReturnType<QPublicPicturePort["find"]> | null = null;
      const webPictures =
        pictureSearch !== undefined &&
        !reRender &&
        typeof namedForPictures === "string" &&
        namedForPictures.length > 1
          ? () =>
              (picturesStarted ??= pictureSearch
                .find({
                  name: namedForPictures,
                  ...(request.personSearch?.organization
                    ? { organisation: request.personSearch.organization }
                    : {}),
                  userText: latest.content,
                  earlierUserText:
                    toolContext.conversation?.earlierUserText ?? [],
                  shownText: toolContext.conversation?.earlierQText ?? [],
                  privateText: toolContext.conversation?.privateText?.() ?? [],
                  signal: request.signal,
                  runId: request.runId,
                })
                .catch(() => []))
          : null;
      // As the early web search lands with pages matched to them, their
      // pictures are asked for beside the answer being written.
      if (webPictures !== null && earlyWeb !== null) {
        void earlyWeb.outcome.then(
          (landed) => {
            if (pagesMatchThem(landed)) void webPictures();
          },
          () => undefined,
        );
      }
      /** The early web search is still to be put in front of the model. */
      const earlyWebPending = (): boolean =>
        earlyWeb !== null && !earlyWeb.claimed;
      let wideReads: WideReads =
        coveredFollowUp !== null
          ? { ...NO_WIDE_READS, namedCompanies: [coveredFollowUp] }
          : withoutWideReads
            ? NO_WIDE_READS
            : await prepared.wideFor(request.executionClass);
      // The records lane's landing, beside the web lane's (owner
      // 2026-10-23: both start with the turn; each one's time is logged).
      logger?.info(
        {
          qRunId: request.runId,
          wide: !withoutWideReads,
          namedCompanies: wideReads.namedCompanies.length,
          webStarted: earlyWeb !== null,
          sinceStartMs: Date.now() - startedAt,
        },
        "q records lane landed",
      );
      const route = answerPathOf({
        turnKind: request.turnKind,
        questionKind: request.questionKind,
        preparedSubject: request.preparedSubject,
        discover: request.discoverCompanies !== undefined,
        fit: request.fitQuestion !== undefined,
        attention: false,
        writingDocument: request.writingDocument === true,
        askedAction: request.askedAction !== undefined,
        researchMode: research?.mode ?? "NEVER",
        aboutNamedOther: request.aboutNamedOther === true,
        discoveryQuestion: request.discovery?.kind === "ASK",
        prepared: {
          mandate: ownProfile !== null,
          onScreenRecord: onScreenCompany !== null || onScreenDocument !== null,
          focusDossier: onScreenDossier,
          qWork: wideReads.ownDay !== null,
          ownCompany: ownCompany !== null,
          comparison: compareTable !== null,
        },
      });
      // T3: the card Q showed is the evidence; one answer call, no tools.
      if (route.path === "PREPARED_CONTEXT" || coveredFollowUp !== null) {
        actsHeldBack = offered.some(canActFor);
        offered = [];
      }
      // Coordinator 2026-10-26 (B, run 42cecfd2: 18.3 s, three ~48k-token
      // rounds): an asked note or email is offered only the reads that
      // find the person and their records, and the tool that prepares it,
      // so a round carries a fraction of the catalogue.
      else if (
        asksForMessage(request.askedAction) &&
        request.writingDocument !== true
      ) {
        offered = offered.filter((tool) =>
          MESSAGE_TURN_TOOLS.has(tool.definition.name),
        );
      }
      // Live rerun on bab915357 (turn 1, 23.1 s): an investor's figures
      // question about one company, answered from documents that company
      // shared with them (read above), waited for the public web search
      // begun with the turn and was then asked again with it. The web
      // search has nothing to add to a private company's own accounts: when
      // those were read and their words do not ask about the web, the
      // answer neither waits for it nor is asked again with it, and the
      // model is not handed the web tool for this turn. Decided from what
      // code read (the shared pages), not the model's words.
      if (
        earlyWeb !== null &&
        !earlyWeb.claimed &&
        wideReads.sharedRead === true &&
        askerSideOf(request) === "INVESTOR" &&
        asksForFigures(latest.content) &&
        !asksForTheWeb(latest.content)
      ) {
        earlyWeb.claimed = true;
        offered = offered.filter(
          (tool) => !PUBLIC_WEB_TOOLS.has(tool.definition.name),
        );
        /**
         * Voice audit Phase 3 (live 16 Nov 2026, run b0ea3d06): this
         * figures answer was offered 112 tools, ~28k of its 53.9k input
         * tokens, none of them cached, for an answer written from pages code
         * had already read. It is offered the reads of that company and its
         * documents, and the on-demand loader: any other tool this run may
         * use (its purpose, plan and actor decide, unchanged) is still one
         * use_capability call away. Only when the loader is in the offer, so
         * nothing the run may use goes out of reach.
         */
        if (
          offered.some((tool) => tool.definition.name === USE_CAPABILITY_TOOL)
        ) {
          offered = offered.filter((tool) =>
            SHARED_FIGURES_TURN_TOOLS.has(tool.definition.name),
          );
        }
        logger?.info(
          { qRunId: request.runId, sinceStartMs: Date.now() - startedAt },
          "q early web search not waited on: answered from shared documents",
        );
      }
      logger?.info(
        {
          qRunId: request.runId,
          path: route.path,
          because: route.because,
          tools: offered.length,
          sinceStartMs: Date.now() - startedAt,
        },
        "q answer path",
      );
      const offeredByName = new Map(
        offered.map((tool) => [tool.definition.name, tool] as const),
      );
      const catalogue = await catalogueRead;
      /**
       * Every tool call this answer makes. While the answer is speculative
       * only a READ_ONLY tool runs; any other (or one not known to be
       * READ_ONLY) waits until the turn is read and the answer adopted, and
       * never runs if it is cancelled.
       */
      const classificationOf = (name: string) =>
        (
          offered.find((tool) => tool.definition.name === name) ??
          (availableForRun ?? offeredForRun).find(
            (tool) => tool.definition.name === name,
          )
        )?.classification;
      const callTool: QToolPort["execute"] = async (proposal, context) => {
        if (
          gate !== null &&
          !gate.adopted() &&
          classificationOf(proposal.name) !== "READ_ONLY"
        ) {
          logger?.info(
            { qRunId: request.runId, tool: proposal.name },
            "a speculative answer's tool call is held until the turn is read",
          );
          await gate.ready();
        }
        return tools.execute(proposal, context);
      };
      /**
       * A setup reminder (founder directive 2026-09-27), only at a natural
       * pause: never while Q is putting a series of questions to them and
       * never on a turn that could not be read. Due-ness is the policy's,
       * under the same own-only scope; a failed read is simply no reminder.
       */
      let onboardingNudge: QOnboardingNudge | null = null;
      const nudgeRead = (async (): Promise<void> => {
        if (
          dependencies.onboardingNudge !== undefined &&
          // S2: a turn answered by code or from a prepared fact carries no
          // setup reminder (it is a note in the model's prompt).
          !withoutWideReads &&
          request.questionSequence === undefined &&
          request.turnUnread !== true &&
          ownsOnboarding({ actor: request.actor, plan })
        ) {
          try {
            // Phase 3: begun with the prepared reads when it could be.
            onboardingNudge = await (prepared.nudgePeek ??
              dependencies.onboardingNudge.peek(request.actor, conversationId));
          } catch (error: unknown) {
            logger?.warn(
              { err: error, qRunId: request.runId },
              "the setup reminder was not read for this answer",
            );
          }
        }
      })();
      /**
       * "What should I do next?" (ADVICE): their own readiness leads the
       * answer (QA 2026-10-03, run 2cba241a). Read through read_my_record,
       * under this plan, only for advice and own-record questions; a person
       * with no company of their own gets nothing here.
       */
      const composeEarlyLead = async (): Promise<string | null> => {
        // Coordinator 2026-10-25 (I21): a comparison code resolved opens
        // with code's verdict, said with its table before Q's reasoning.
        if (compareTable !== null && compareVerdict !== null) {
          return verdictSentence(compareVerdict);
        }
        if (asksForPipelineSummary(latest.content)) {
          const outcome = await (standingOf() ?? Promise.resolve(null));
          return outcome !== null && outcome.result.ok
            ? pipelineLead(outcome.result.data, latest.content)
            : null;
        }
        // F-45 (QA 2026-10-23): a question about one company is not opened
        // with a fixed line of its declared stage and place; the answer's
        // own first sentence, written for this question, leads.
        if (!comparisonAsked(request, latest.content, asksForComparison))
          return null;
        // The named companies this run already read in full (prepare's
        // named-visible reads): read again from the run's own kept reads.
        const named = [...runCompanies.read(request.runId).profiles].filter(
          ([, name]) => containsCompanyName(latest.content, name),
        );
        if (named.length < 2) return null;
        const read = await Promise.all(
          named.slice(0, 4).map(([companyId], index) =>
            tools
              .execute(
                {
                  callId: `q-early-lead-${String(index)}`,
                  name: "get_company",
                  arguments: { companyId },
                },
                toolContext,
              )
              .catch(() => null),
          ),
        );
        return comparisonLead(
          read.flatMap((outcome) => {
            const profile = profileOf(outcome);
            return profile === null ? [] : [profile];
          }),
        );
      };
      let ownReadiness: AuthorisedFact | null = null;
      let ownHeldBack: AuthorisedFact | null = null;
      const prefetchable = new Set(
        offeredForRun.map((tool) => tool.definition.name),
      );
      // Live 16 Nov (own-documents.ts, Halyard on b156a9cd1): a founder's
      // own evidence question lists what their company uploaded and
      // pre-reads its most useful pages (ADR 0079), beside the reads below.
      const ownDocumentsRead = ownEvidenceTurn({
        side: askerSideOf(request),
        questionKind: request.questionKind,
        executionClass: request.executionClass,
        turnKind: request.turnKind,
        writingDocument: request.writingDocument,
        aboutSomeoneElse:
          counterparty !== undefined &&
          !(
            counterparty.kind === "COMPANY" &&
            counterparty.companyId === ownCompanyId
          ),
      })
        ? readOwnDocuments({
            execute: (proposal) => callTool(proposal, toolContext),
            available: new Set(
              (availableForRun ?? offeredForRun).map(
                (tool) => tool.definition.name,
              ),
            ),
            ownCompanyId,
            question: latest.content,
          })
        : Promise.resolve([]);
      if (
        (request.questionKind === "ADVICE" ||
          request.questionKind === "THEIR_OWN_RECORDS") &&
        prefetchable.has("read_my_record") &&
        // Lead 2026-10-16: a company's marketplace readiness, never an
        // investor's (live: ~600 ms spent before every investor's
        // own-records answer on a read that has nothing for them).
        !(askerSideOf(request) === "INVESTOR" && ownCompanyId === null)
      ) {
        const outcome = await callTool(
          {
            callId: "q-own-readiness",
            name: "read_my_record",
            arguments: { record: "MARKETPLACE_READINESS" },
          },
          toolContext,
        ).catch(() => null);
        if (outcome?.result.ok === true) {
          const data = outcome.result.data as {
            data?: { companyId?: unknown };
          };
          const ownCompanyId =
            typeof data.data?.companyId === "string"
              ? data.data.companyId
              : null;
          // It leads only when the question is not about someone else.
          const aboutSomeoneElse =
            counterparty !== undefined &&
            !(
              counterparty.kind === "COMPANY" &&
              counterparty.companyId === ownCompanyId
            );
          ownReadiness = ownReadinessFact(outcome.result.data, {
            // RC4 (audit 15 Nov): an analysis, comparison or document they
            // asked for is answered as asked; the gaps are facts, not its
            // opening.
            lead:
              request.questionKind === "ADVICE" &&
              !aboutSomeoneElse &&
              request.answerKind !== "ANALYSIS" &&
              request.answerKind !== "COMPARISON" &&
              request.answerKind !== "DOCUMENT",
            alreadySaid: leadLines !== undefined,
            // Code closes this answer with its own offer: one offer per
            // answer, so a yes binds to it (live 2026-10-30, run 2 offered
            // both a move and a plan, and the yes started the plan).
            closingOffer: request.closingLines !== undefined,
          });
          ownHeldBack = heldBackDocumentsFact(outcome.result.data);
        }
        took("own-readiness");
      }
      // Their own team counts, when they ask about their team: read from
      // the canonical team facts, never left to be inferred (live
      // 2026-10-16: "1 founder and 1 person" for a company of 2 and 14).
      let ownTeam: AuthorisedFact | null = null;
      if (
        prefetchable.has("read_my_record") &&
        ASKS_ABOUT_OWN_TEAM.test(latest.content) &&
        !(askerSideOf(request) === "INVESTOR" && ownCompanyId === null)
      ) {
        const outcome = await callTool(
          {
            callId: "q-own-team",
            name: "read_my_record",
            arguments: { record: "COMPANY_TEAM" },
          },
          toolContext,
        ).catch(() => null);
        if (outcome?.result.ok === true) {
          ownTeam = ownTeamFact(outcome.result.data);
        }
        took("own-team");
      }
      // Read beside the readiness read above, not before it (L1).
      await nudgeRead;
      took("nudge");
      // Lead 2026-10-16: one grounded opening line for an analysis answer,
      // from reads this run already holds (early-lead.ts); said when the
      // model is asked, and the model is told it was said.
      const earlyLead: string | null =
        leadLines !== undefined ||
        request.writingDocument === true ||
        request.askedAction !== undefined ||
        (request.turnKind !== undefined &&
          request.turnKind !== "QUESTION_TO_Q" &&
          // A web question opens from the record too, before the web.
          request.turnKind !== "RESEARCH_REQUEST")
          ? null
          : await composeEarlyLead().catch(() => null);
      took("early-lead");
      // S2: the prompt is assembled from the facts in hand and can be
      // assembled again once the wide reads land (a turn that skipped them
      // and was not, after all, answered by code).
      // D3 (owner review 12 Nov): the standing of every fact the model is
      // given, so no finding outranks the facts it cites.
      let suppliedStandings: ReadonlyMap<string, SuppliedStanding> = new Map();
      // Gap 2 (12 Nov): the same facts, for code to set their figures
      // beside the public pages' (figure-conflicts.ts).
      let suppliedFacts: readonly ConflictFact[] = [];
      // The documents read for this turn, as the last prompt carried them:
      // a sentence calling a figure they state unknown is said as they
      // state it (document-stated-figures.ts; live 13279c88).
      let documentsThisTurn: readonly ReadDocument[] = [];
      // How many retrieved passages, and code's row facts beside them, the
      // prompt carried: the claim check's diagnostic line (counts only).
      let retrievedPassages = 0;
      let documentRowFactCount = 0;
      // How many document texts (passages, pages reads) the run held.
      let documentTextCount = 0;
      const assemblePrompt = async (w: WideReads) => {
        /**
         * Live re-check of 6f9b63cc5 (Phase 3 latency, d): a follow-up
         * answered from the card Q showed is answered from that card, its
         * list's title (conditions) and words (order) and the question --
         * not their documents' passages, which only lengthen the call. The
         * firewall's facts that remain are unchanged; the account digest
         * is still in the situation below.
         */
        const searched = await assembledRead;
        const assembled =
          coveredCard === null
            ? searched
            : {
                ...searched,
                facts: [],
                subjectDescription: CARD_FOLLOW_UP_SUBJECT,
              };
        const ownDocuments = await ownDocumentsRead;
        retrievedPassages = assembled.facts.length;
        // Live 17 Nov 2026 (Savanna on Nixo): a figures-limit fact names
        // the shared documents read for its company (company-fact.ts).
        const heldFacts: readonly AuthorisedFact[] =
          withSharedDocumentsInLimits(
            [
              // Their readiness first when it leads this answer.
              ...(ownReadiness === null ? [] : [ownReadiness]),
              ...(ownHeldBack === null ? [] : [ownHeldBack]),
              ...ownDocuments,
              ...(ownTeam === null ? [] : [ownTeam]),
              ...w.onboardingFacts,
              ...(ownProfile === null ? [] : [ownProfile]),
              ...(ownCompany === null ? [] : [ownCompany]),
              ...ownFigures,
              ...(onScreenCompany === null ? [] : [onScreenCompany]),
              ...onScreenCompanyFigures,
              ...w.namedCompanies,
              ...(onScreenDaily === null ? [] : [onScreenDaily]),
              ...(onScreenDocument === null ? [] : [onScreenDocument]),
              ...attachedDocuments,
              ...compareFacts,
              ...(chartFact === null ? [] : [chartFact]),
              ...dataRoomFacts,
              ...gateqFacts,
              ...onScreenPage,
              ...(w.ownDay === null ? [] : [w.ownDay]),
              ...(w.arrival === null ? [] : [w.arrival]),
              ...(relationship === null ? [] : [relationship]),
              ...(w.ownStanding === null ? [] : [w.ownStanding]),
              ...(w.ownIndex === null ? [] : [w.ownIndex]),
              ...(pitchMoment === null ? [] : [pitchMoment]),
              ...assembled.facts,
            ],
            new Map(w.sharedReadTitles ?? []),
          );
        // Live f65877e3 / 7e866011 (17 Nov 2026): every document text the
        // run holds -- a retrieved passage, code's own pre-read of a shared
        // or on-screen document, an attached one, and the pages an earlier
        // turn of this conversation read -- has its count table's rows read
        // by code and said plainly beside it (document-rows.ts), so the
        // model answers from the rows, not from what Q said before.
        const rowFacts = distinctFacts([
          ...documentRowFacts(heldFacts),
          ...fetchedDocumentRowFacts(request.fetchedInConversation ?? []),
        ]);
        documentRowFactCount = rowFacts.length;
        documentTextCount =
          heldFacts.filter(
            (fact) =>
              fact.scope === "DATA_ROOM" || fact.scope === "OWN_DOCUMENT",
          ).length +
          assembled.facts.length +
          fetchedDocumentTexts(request.fetchedInConversation ?? []).length;
        const facts: readonly AuthorisedFact[] = [
          ...heldFacts,
          // A document's count table, its rows read by code and said plainly
          // beside it (document-rows.ts; live runs 91bb8564, f65877e3).
          ...rowFacts,
        ];
        // D3 and slice 1: every fact citable by label, and what each is
        // (the prompt the model answers is the last one assembled).
        const citable = withFactLabels(facts);
        suppliedStandings = suppliedStandingsOf(citable);
        suppliedFacts = citable;
        // Live 13279c88 (17 Nov 2026): what Q said before ("burn and runway
        // aren't established") never outweighs a page read this turn that
        // states the figure; such a sentence is labelled as superseded by
        // that read (document-stated-figures.ts). As said, label added.
        const documentsNow = documentsReadOf(facts);
        documentsThisTurn = documentsNow;

        const variables: Omit<
          CompanyAnalystV4Variables,
          | "operatingMode"
          | "communicationProfile"
          | "communicationGuidance"
          | "environmentNotes"
        > = {
          capability: request.capability,
          userMessage: latest.content,
          conversation: earlier.map((m) => ({
            role: m.role,
            content:
              m.role === "Q"
                ? supersededByDocuments(m.content, documentsNow)
                : m.content,
          })),
          authorisedFacts: [...citable],
          subjectDescription: assembled.subjectDescription,
          institutionalNotes:
            assembled.institutionalNotes ??
            "Nothing was established in advance for this request.",
          memory: supersededByDocuments(memory, documentsNow),
          // Filled below, once the notes are composed.
          turnNotes: "",
        };
        const personality = await personalityRead;
        const language = await languageRead;
        const asker = await askerRead;
        // Step 1: the date, their time and who is asking, on every answer.
        const situationNow = (dependencies.now ?? (() => new Date()))();
        const situationAsker = await situationRead;
        const situation = situationWithAccount({
          header: situationHeader({
            now: situationNow,
            asker: situationAsker,
            deviceTimeZone: plan.screen?.timeZone,
            surface: situationSurfaceOf(
              request.spoken === true,
              plan.screen?.surface,
            ),
            page: plan.screen?.route ?? null,
          }),
          // Owner 14 Nov 2026: what is happening in their account, the
          // same digest for a typed and a spoken turn.
          digest: await accountDigest,
          now: situationNow,
          timeZone: personTimeZone(
            situationAsker?.timeZone ?? null,
            plan.screen?.timeZone ?? null,
          ),
        });
        const noteOptions: NoteOptions = {
          situation,
          // Only when the firewall actually granted it. The plan has
          // said so all along; nothing was reading it.
          generalKnowledge: plan.scopes.some(
            (scope) => scope.kind === "GENERAL_MODEL_KNOWLEDGE",
          ),
          ...(openDocumentTitle === undefined ? {} : { openDocumentTitle }),
          ...(request.turnUnread === true ? { turnUnread: true } : {}),
          ...(actsHeldBack ? { actsHeldBack: true } : {}),
          ...(request.offerTaken === undefined
            ? {}
            : { offerTaken: request.offerTaken }),
          ...(request.offerTakenUnrecorded === true
            ? { offerUnrecorded: true }
            : {}),
          ...(request.choiceUnclear === true ? { choiceUnclear: true } : {}),
          // HQ-7: one callback at most, only one this turn bears on.
          ...(memoryCallback === null
            ? {}
            : { memoryCallback: memoryCallbackNote(memoryCallback) }),
          ...(request.excludedSubjects === undefined
            ? {}
            : { excluded: request.excludedSubjects }),
          ...(request.closingLines === undefined
            ? {}
            : { closingLine: request.closingLines }),
          ...(nextStepTurn(request) ? {} : { noNextStep: true }),
          ...(request.writingDocument === true
            ? {
                writingDocument: true,
                ...(asksForOnePage(latest.content) ? { onePage: true } : {}),
              }
            : {}),
          ...(request.spoken === true ? { spoken: true } : {}),
          ...(request.questionSequence === undefined
            ? {}
            : { questionSequence: request.questionSequence }),
          // HQ-1: the answer's shape, picked by code from the reading.
          ...(() => {
            const shape = answerShapeNoteOf(request);
            return shape === null ? {} : { answerShape: shape };
          })(),
          ...(modelOfferAllowed(request) === false
            ? { offerAllowed: false }
            : {}),
          ...(onboardingNudge === null ? {} : { onboardingNudge }),
          ...(wideReads.capitalQAsCompany ? { capitalQCompany: true } : {}),
          ...(personality === null ? {} : { personality }),
          ...(language === null ? {} : { language }),
          ...(asker === null ? {} : { asker }),
          // Lane 8 (owner, 23 Oct): a summary first unless they asked
          // for a critique; read from their words by code.
          ...(attachedNow() !== null
            ? {
                attachedDocument: {
                  titles: attachedNow()?.titles ?? [],
                  intent: attachedDocumentIntent(latest.content),
                  state: attachedNow()?.state,
                },
              }
            : attachedTitles.length === 0
              ? {}
              : {
                  attachedDocument: {
                    titles: attachedTitles,
                    intent: attachedDocumentIntent(latest.content),
                  },
                }),
        };
        let noteParts = environmentNoteParts(
          facts,
          offered,
          request.subjects,
          noteOptions,
        );
        // D16: the notes added to this turn's part below are counted
        // against its bound once they are all known (fittedTurnNotes).
        const baseNoteParts = noteParts;
        // S3a (live 2026-10-15, #107): the named company read ahead of the
        // model was looked up again (company.search, company.get: two
        // NORMAL rounds, ~3.5 s) because the turn note told it to resolve
        // the name. A named company whose complete authorised profile this
        // run already holds is said to be among the facts, with its id.
        const screenFocus =
          plan.screen?.route === "COMPANY" || plan.screen?.route === "DISCOVER"
            ? (plan.screen.companyId ?? null)
            : null;
        const namedAlreadyRead = [
          ...runCompanies.read(request.runId).profiles,
        ].filter(
          ([companyId, name]) =>
            companyId !== screenFocus &&
            containsCompanyName(latest.content, name),
        );
        const alreadyReadNote =
          namedAlreadyRead.length === 0
            ? null
            : `Already read for this turn through get_company, with complete authorized profiles among the facts: ${namedAlreadyRead
                .map(([companyId, name]) => `${name} (company id ${companyId})`)
                .join(
                  "; ",
                )}. Use those facts and ids without calling search_companies or get_company for them again. Resolve through search_companies and get_company only a named company not listed here.`;
        if (earlyLead !== null) {
          noteParts = {
            ...noteParts,
            turn: [
              noteParts.turn,
              `This answer already opens with this line, said to them by code from their records: "${earlyLead}" Continue after it with the analysis; do not repeat it or restate its counts.`,
              ...(asksForPipelineSummary(latest.content)
                ? [PIPELINE_NOTE]
                : []),
            ].join(" "),
          };
        }
        // F-91 (QA re-score 24 Oct, run 3a213c7a): "Draft a short note to
        // Basketari's founders asking about their repeat-order rate" was
        // offered, not prepared: no message tool was called, so the first
        // contact (Express Interest carrying the note) never ran. When the
        // reader read a note or message as the asked action, it is called.
        if (
          request.askedAction !== undefined &&
          (MESSAGE_TOOLS.has(request.askedAction) ||
            request.askedAction === FIRST_CONTACT_TOOL)
        ) {
          noteParts = {
            ...noteParts,
            turn: [
              noteParts.turn,
              `THEY ASKED FOR A NOTE OR MESSAGE: call ${request.askedAction} now, with the note drafted in their voice as its body, for the company they named. If they are not connected yet, Capital Q prepares it as Express Interest carrying that note, for their one approval; nothing is sent until they approve. Never describe the note or offer to prepare it instead of calling the tool.`,
            ].join(" "),
          };
        }
        if (othersInterestAsked(request, latest.content)) {
          noteParts = {
            ...noteParts,
            turn: [noteParts.turn, OTHERS_INTEREST_NOTE].join(" "),
          };
        }
        if (request.aboutNamedOther !== true && alreadyReadNote !== null) {
          noteParts = {
            ...noteParts,
            turn: [alreadyReadNote, noteParts.turn].join(" "),
          };
        }
        if (request.aboutNamedOther === true) {
          // A reader may call an investor's selected company "other" even
          // for "the risks for this company". Its complete profile was
          // already freshly authorized above: forcing name search here
          // caused two paid selection rounds and another get_company
          // (live 2026-10-12: 3,752 ms in the selection calls alone).
          // Reuse only one successful, schema-valid profile bound to the
          // selected subject. Different names, comparisons, ambiguous or
          // unread/revoked targets keep the existing resolution rule.
          const read = runCompanies.read(request.runId);
          const screenCompanyId =
            plan.screen?.route === "COMPANY" ||
            plan.screen?.route === "DISCOVER"
              ? (plan.screen.companyId ?? null)
              : null;
          const selectedTarget =
            screenCompanyId !== null &&
            read.profiles.size === 1 &&
            read.profiles.has(screenCompanyId) &&
            request.subjects.some(
              (subject) =>
                subject.kind === "COMPANY" &&
                subject.companyId === screenCompanyId,
            ) &&
            (isSingleCompanyQuestion(latest.content) ||
              namesOnlyCompany(
                latest.content,
                read.profiles.get(screenCompanyId) ?? null,
              )) &&
            !readAsComparison(request);
          noteParts = {
            ...noteParts,
            turn: [
              selectedTarget
                ? "The current single-company question refers to the selected company whose complete, freshly read authorized profile is already among the facts. Use those facts without searching for its identity or reading the same profile again. If the question instead names a different target, resolve it through search_companies and get_company; never substitute the selected company's facts. A visible profile contains declared claims, not private founder onboarding responses. Missing authorised evidence stays unknown; public web material must be labelled separately."
                : alreadyReadNote !== null
                  ? `${alreadyReadNote} The company visible on screen is navigation context; do not substitute its facts for the named target. A visible profile contains declared claims, not private founder onboarding responses. Missing authorised evidence stays unknown; public web material must be labelled separately.`
                  : "Resolve the company named in the current question through search_companies and get_company before answering from its records. The company visible on screen is navigation context; do not substitute its facts for the named target. A visible profile contains declared claims, not private founder onboarding responses. Missing authorised evidence stays unknown; public web material must be labelled separately.",
              noteParts.turn,
            ].join(" "),
          };
        }
        // Q intelligence step 4: a compound ask the reader split into parts
        // is answered part by part; first, so the bounded notes never cut it.
        const partsNote = askPartsNote(request.askParts);
        const inFactsTexts = [
          latest.content,
          ...(request.askParts ?? []).map((part) => part.ask),
          // Whom their pointing words were bound to ("the first one").
          ...(request.references === undefined ? [] : [request.references]),
        ];
        // The turn's notes have a hard bound (COMPANY_ANALYST turnNotes):
        // the facts' note shrinks to fit -- whole, then without its quoted
        // facts, then left out -- and never costs the other notes.
        const withNotes = (inFacts: string | null): string =>
          [partsNote, inFacts, noteParts.turn]
            .filter((note): note is string => note !== null && note !== "")
            .join(" ");
        const inFactsNote = [
          namedInFactsNote(inFactsTexts, facts),
          namedInFactsNote(inFactsTexts, facts, { quote: false }),
        ].find(
          (note) =>
            note !== null && withNotes(note).length <= TURN_NOTES_MAX_CHARS,
        );
        if (partsNote !== null || inFactsNote !== undefined) {
          noteParts = {
            ...noteParts,
            turn: withNotes(inFactsNote ?? null),
          };
        }
        // COMPANY_ANALYST v16 (prompt-cache order): this turn's notes ride in
        // the task's tail and the charter keeps only what is the same from
        // turn to turn; an earlier version still gets them all in the charter.
        // D16 (live 15 Nov 2026, run f1f8cf19): the account digest beside
        // the situation, the two-part note and the named-company note
        // together passed turnNotes' bound and the render failed.
        noteParts = fittedTurnNotes(noteParts, baseNoteParts, (turnBudget) =>
          environmentNoteParts(facts, offered, request.subjects, {
            ...noteOptions,
            turnBudget,
          }),
        );
        const notesInTail = registry
          .getActive("COMPANY_ANALYST")
          .definition.template.includes("{{turnNotes}}");
        const environmentNotes = notesInTail
          ? noteParts.standing
          : joinedNoteParts(noteParts);
        const etiquetteGuides = await etiquetteRead;
        const renderWith = (
          taskVariables: Omit<
            CompanyAnalystV4Variables,
            | "operatingMode"
            | "communicationProfile"
            | "communicationGuidance"
            | "environmentNotes"
          >,
        ) =>
          renderPrompt<CompanyAnalystV4Variables>(registry, {
            task: "COMPANY_ANALYST",
            ...(etiquetteGuides === null
              ? {}
              : {
                  etiquette: {
                    guides: etiquetteGuides,
                    purpose: "STYLE_ONLY" as const,
                  },
                }),
            operatingMode: operatingModeForCapability(request.capability),
            communicationProfile: profile,
            environmentNotes,
            variables: taskVariables,
          });
        const taskVariables = {
          ...variables,
          turnNotes: notesInTail ? noteParts.turn : "",
        };
        let rendered: ReturnType<typeof renderWith>;
        try {
          rendered = renderWith(taskVariables);
        } catch (error: unknown) {
          if (!(error instanceof PromptRenderError)) throw error;
          // D16: a variable past its bound is shortened, saying so, and the
          // turn is answered from what fits; never an internal error for
          // the person. Anything else invalid still fails, loudly.
          const fitted = fittedVariables(
            registry.getActive("COMPANY_ANALYST").definition.variables.schema,
            taskVariables,
          );
          logger?.warn(
            { qRunId: request.runId, shortened: fitted.shortened },
            "a prompt variable was past its bound; shortened, with a marker",
          );
          rendered = renderWith(fitted.variables as typeof taskVariables);
        }
        // Counted only when the note actually reached the model: the notes
        // are bounded, and a reminder cut off was never offered.
        const nudgeOffered =
          onboardingNudge !== null &&
          joinedNoteParts(noteParts).includes(
            onboardingNudgeNote(onboardingNudge),
          );
        return { facts, rendered, nudgeOffered };
      };
      let assembled0 = await assemblePrompt(wideReads);
      let facts = assembled0.facts;
      let rendered = assembled0.rendered;
      let nudgeOffered = assembled0.nudgeOffered;

      // RECOVERY-2026-10 B4 (audit B-04): an analytical answer gets the
      // synthesis budget -- room to finish one long JSON object -- decided
      // by code from the capability and the reader's fields (step 4: never
      // their words). Routing keeps the capability's class: which model serves
      // synthesis is the routing policy's decision (F-09), and a class
      // with no eligible route must never turn an answer into a failure.
      const taskClass = taskClassForCapability(request.capability);
      const budgetClass = answerTaskClass(request);
      const budget = budgetForTaskClass(budgetClass);
      // Step 7: how hard the answer thinks follows what the reader read,
      // and the routing policy has the last word on the level.
      const answerThinking = answerReasoning(request);
      const unthinking = {
        taskClass,
        sensitivity,
        dataPosture,
        budget,
        attribution: {
          tenantId: request.tenantId,
          userId: request.actorUserId,
          qRunId: request.runId,
          // The request's own correlation id, so a model call is traceable
          // to the HTTP request that caused it; the run id is already
          // attributed separately above.
          correlationId: request.correlationId,
        },
        ...(dependencies.tenantPolicy === undefined
          ? {}
          : { tenantPolicy: dependencies.tenantPolicy }),
      };
      const base = { ...unthinking, ...answerThinking };

      /**
       * The answer, going out a sentence at a time as the model writes it.
       *
       * Three things have to be true of a fragment before a person can
       * have it, and all three are why the unit is a sentence rather than
       * a token. It has to be the ANSWER and not the JSON object around
       * it, so it is read out of the document by key. It has to be whole,
       * because the guard that removes an invented recommendation removes
       * a sentence and cannot judge half of one. And it has to have been
       * through those guards, because on a voice call it is about to be
       * said out loud and nothing said can be unsaid.
       *
       * A turn that reaches for a tool publishes nothing: a tool call
       * carries no text, and text that is not the analyst's object never
       * matches the key. The last, unfinished sentence is never published
       * either — it arrives with the completed message, which is the
       * durable form and the one that decides what was said.
       */
      const partial = createPartialAnswerReader();
      /**
       * Progressive findings (round 5, with lane 3): each finding the
       * answer finishes is shown at once as `q.finding.available`, under
       * the id the completed message's FINDING block then carries. It is
       * the same block the message builds (`findingBlockOf`, the same
       * schema); the completed message stays authoritative and its
       * set-wide checks only remove or merge. Keyed by statement, since an
       * invalid item dropped from the final list shifts every place.
       */
      const liveFindings = createPartialFindingsReader();
      const liveFindingIds = new Map<string, string>();
      /** Findings held back from the live display by the count check. */
      const liveWithheld = new Set<string>();
      const findingKey = (statement: string): string =>
        statement.trim().replace(/\s+/gu, " ").toLowerCase();
      const showLive = (raw: unknown): void => {
        const parsed = ModelFindingSchema.safeParse(raw);
        if (!parsed.success) return;
        const key = findingKey(parsed.data.statement);
        if (liveFindingIds.has(key) || liveWithheld.has(key)) return;
        // Live a1777c9a: "15 people ...: five in Q1, ..." was shown the
        // moment it was written, before any check. A finding stating a
        // count the document's rows contradict is not shown; the stored
        // message leaves it out the same way.
        if (
          claims.contradictsCounts(parsed.data.statement) ||
          // A change's fate is the record's to say (live 17 Nov 2026).
          claimsChangeStatus(parsed.data.statement)
        ) {
          liveWithheld.add(key);
          return;
        }
        const id = randomUUID();
        const block = findingBlockOf(
          parsed.data,
          // A named other's subjects are settled with the message.
          request.aboutNamedOther === true
            ? []
            : askedSubjects(request.subjects, plan),
          id,
          suppliedStandings,
        );
        if (block === null) return;
        liveFindingIds.set(key, id);
        stages.queue = stages.queue.then(() =>
          gate === null
            ? showFinding(request, block.finding)
            : gate.emit(() => showFinding(request, block.finding)),
        );
      };
      const cutter = createSentenceCutter();
      let streamedText = "";
      /** HQ-6: each sentence as it was published, for the retraction count. */
      const streamedSentences: string[] = [];
      let seenText = "";
      /**
       * The answer's prose as far as it has been read, sentences finished
       * or not. Kept apart from what was published because it has one
       * more use: when the object around it is refused after the person
       * has already heard it (below), this is the answer they heard.
       */
      let seenAnswer = "";
      let firstSentence = true;
      /**
       * A sentence that only promises to act is held back until the next
       * sentence shows it was not the last. Said at the end of an answer,
       * "Give me a moment to look that up." is a promise nothing follows;
       * the finished answer drops it, and so a listener must never have
       * heard it. In the middle it is a sentence about a next step, and
       * it is released the moment the answer goes on.
       */
      let heldPromise: string | null = null;
      /** A question of the model's, held while code closes with its offer. */
      let heldAsk: string | null = null;
      /** HQ-2 slice 3: whether this answer may end on an offer of more. */
      const offerAllowed = modelOfferAllowed(request);
      /** Code's lead list was the last thing said (see publish below). */
      let leadListOpen = leadLines !== undefined;
      /** When the person got the first sentence, from the seam's start. */
      /** Out now, or held with the speculation until it is adopted. */
      const send = (delta: Parameters<QLiveDeltaBus["publish"]>[0]): void => {
        if (gate === null) deltas?.publish(delta);
        else gate.emit(() => deltas?.publish(delta));
      };
      // Artifacts live: a sentence that names a subject this run read puts
      // that subject's card up as the sentence goes out, not after the
      // whole answer (the preview rides ahead of the sentence's own text).
      const announcer = createSubjectAnnouncer({
        read: () => runCompanies.read(request.runId),
        question: latest.content,
      });
      /**
       * Coordinator 2026-10-25 (I21: "how do the top two stack up?" showed
       * nothing for 8.5 s): a comparison code resolved is on screen first.
       * Its table, built from this run's authorised reads, goes up the
       * moment the answer can speak, and every later preview keeps it, so
       * Q's words stream in under it. Nothing in it is a model's.
       */
      const tableFirst =
        compareTable?.kind === "TABLE" &&
        !comparisonOnScreen(earlier, compareTable)
          ? {
              layout: "TABLE" as const,
              table: compareTable,
              subjects: compareTable.columns.flatMap((column) =>
                column.subject === null
                  ? []
                  : [{ subject: column.subject, name: column.label }],
              ),
            }
          : null;
      const sendSaid = (text: string): void => {
        const named = announcer.sentence(text);
        const preview =
          tableFirst === null || named === null
            ? named
            : { ...named, layout: tableFirst.layout, table: tableFirst.table };
        send({
          runId: request.runId,
          tenantId: request.tenantId,
          messageId,
          text,
          ...(preview === null ? {} : { preview }),
        });
      };
      /** Code's opening lines, once, before anything else is said. */
      let leadSaid = false;
      // Already streamed by the caller as soon as code composed them
      // (leadLinesSaid): heard, so counted as said, and never sent twice.
      if (
        request.leadLinesSaid !== undefined &&
        request.leadLines !== undefined
      ) {
        leadSaid = true;
        firstPublishedMs ??= 0;
        for (const line of request.leadLines.split("\n")) {
          const said = line.trim();
          if (said.length > 0) streamedText += `${said} `;
        }
      }
      const sayLeadLines = (): void => {
        // After the early web search's line, code's own opening still
        // follows it; after anything else, it is past.
        if (leadSaid || leadLines === undefined) return;
        if (firstPublishedMs !== null && !researchingSaid) return;
        leadSaid = true;
        firstPublishedMs ??= Date.now() - startedAt;
        for (const line of leadLines.split("\n")) {
          const said = line.trim();
          if (said.length === 0) continue;
          streamedText += `${said} `;
          sendSaid(`${said} `);
        }
      };
      // The table, then code's verdict as its opening line (the model is
      // told that line was said and continues after it).
      /** I21: when the comparison's table went up, from the seam's start. */
      let tableFirstMs: number | null = null;
      /**
       * QA 2026-10-25 (table at 9 s from Enter, tableMs 695 from the seam):
       * the same moment from the run's start, the person's message.
       */
      const sinceRun = (): number | null => {
        const at = Date.parse(latest.createdAt);
        return Number.isFinite(at) ? Date.now() - at : null;
      };
      let tableSinceRunMs: number | null = null;
      if (tableFirst !== null) {
        tableFirstMs = Date.now() - startedAt;
        tableSinceRunMs = sinceRun();
        send({
          runId: request.runId,
          tenantId: request.tenantId,
          messageId,
          text: "",
          preview: tableFirst,
        });
        if (earlyLead !== null && leadLines === undefined) {
          leadLines = earlyLead;
          leadListOpen = true;
          sayLeadLines();
        }
        logger?.info(
          {
            qRunId: request.runId,
            tableMs: tableFirstMs,
            tableSinceRunMs,
            // Whether anyone was listening, and whether a speculative
            // answer held the frame until it was adopted.
            subscribers: deltas?.subscriberCount(request.runId) ?? null,
            heldBySpeculation: gate !== null && !gate.adopted(),
            verdict: earlyLead !== null,
          },
          "q comparison table went up first",
        );
      }
      /**
       * Owner 2026-10-21 (time to the first word): a public-web search
       * takes seconds, so when nothing has been said yet, what Q is doing
       * is said as the search starts -- true then, because the call is
       * being made. Streamed only: the stored answer opens with what was
       * found, not with a line that is past by then.
       */
      const sayResearching = (
        args: unknown,
        search: Promise<unknown>,
      ): void => {
        if (firstPublishedMs !== null || leadLines !== undefined) return;
        const entity = (args as { readonly entityName?: unknown } | null)
          ?.entityName;
        const named =
          typeof entity === "string" && entity.trim().length > 1
            ? entity.trim().slice(0, 60)
            : (namedOther?.name ?? null);
        whileSearching(search, () => {
          if (firstPublishedMs !== null || leadLines !== undefined) return;
          firstPublishedMs = Date.now() - startedAt;
          send({
            runId: request.runId,
            tenantId: request.tenantId,
            messageId,
            text: `${researchLead(named)} `,
            holding: true,
          });
        });
      };
      // The early web search is said as it runs; where code has its own
      // opening line from their records, that line is said now instead,
      // rather than once the web has landed (production 2026-10-23: the
      // opening waited for the whole search).
      if (earlyWeb !== null) {
        const said =
          earlyLead !== null && leadLines === undefined
            ? "LEAD"
            : !researchingSaid &&
                earlyWeb.remembered !== true &&
                readCache.get(earlyWeb.call, toolContext) === null
              ? "RESEARCHING"
              : null;
        if (said === "LEAD" && earlyLead !== null) {
          leadLines = earlyLead;
          leadListOpen = true;
          sayLeadLines();
        } else if (said === "RESEARCHING") {
          sayResearching(earlyWeb.call.arguments, earlyWeb.outcome);
        }
        logger?.info(
          {
            qRunId: request.runId,
            said,
            firstWordMs: firstPublishedMs,
          },
          "q early web search first words",
        );
      }
      const publish = (text: string): void => {
        // Code's opening lines come first on every surface that listens to
        // the stream (voice parity, lead 2026-10-03: a spoken "what should
        // I do next?" heard the model's words and never the readiness
        // lines the stored answer opens with).
        sayLeadLines();
        firstPublishedMs ??= Date.now() - startedAt;
        // A heading or list item opens its own line (live6: "## Key Gaps
        // and Risks" was glued to the sentence before it).
        const piece = streamedPiece(
          text,
          streamedText.length === 0,
          streamedSentences.at(-1),
        );
        streamedText += piece;
        // HQ-6: what went out, for the retraction count at the end.
        streamedSentences.push(text);
        sendSaid(piece);
      };
      // Backed only by a screen move a tool of this run authorised.
      // Or by cards that will render: the model's own card set begun in
      // its object, or two or more fits this run computed (code lays those
      // out when the model wrote none).
      const caveats = createCaveatGuard();
      // Lane A: a table, map, chart or timeline is said to be shown only
      // once a block of that kind exists; the visuals code builds after
      // the prose are not known yet, so such a sentence is held back here
      // and the finished answer says the truth.
      const artifactClaims = createArtifactClaimGuard(
        () =>
          new Set([
            ...drawnArtifacts(clientActionBlocks),
            ...drawnOnScreen(plan.screen?.manifest?.drawn?.kinds),
          ]),
        "stream",
      );
      const screenClaims = createScreenClaimGuard(
        () =>
          clientActionBlocks.some((block) =>
            DRAWN_BLOCK_KINDS.has(block.kind),
          ) ||
          seenText.includes('"answerCards":{') ||
          extrasSeen.includes('"answerCards":{') ||
          runFits.read(request.runId).length >= 2,
        askedToOpen(latest.content),
      );
      /**
       * Step 6: what this run was given, for the claim check. Filled in
       * once the model's messages exist (below); the charter and Capital
       * Q's own instruction notes are left out, so a number in an
       * instruction never grounds a figure about a company.
       */
      let claimSources: () => readonly string[] = () =>
        facts.map((fact) => fact.statement);
      /**
       * Live re-check on 927f25ddd (conversation e7e3c866): Q's own
       * earlier replies and its record of the conversation are not what
       * a document says. They still ground a figure by value, but a count
       * of a named item is never bound to them (claimCorpus `echoes`), so
       * a wrong count is not grounded by having been said before.
       */
      let claimEchoes: () => readonly string[] = () => [];
      /** What the check's sources and echoes are, by kind (counts only). */
      const claimSourceKinds = {
        read: (): Readonly<Record<string, number>> => ({
          facts: facts.length,
        }),
      };
      const claims = createClaimChecker(
        () => claimSources(),
        new Date(),
        () => claimEchoes(),
      );
      /**
       * Live 13279c88 (17 Nov 2026): a sentence that says a figure is
       * unknown, not established or not stated, when a document read for
       * this turn states it, is said as the document states it (title,
       * page, figure, period); a second such sentence is not said again.
       */
      const documentDenials = createDocumentDenialGuard(
        () => documentsThisTurn,
      );
      /** Findings the count check examined and left out (diagnostic line). */
      const findingsChecked = { examined: 0, dropped: 0 };
      /**
       * Live scenario F, defect 5: "GateQ" is said only about a GateQ
       * application reading this run holds (gateq-application-fact.ts);
       * an investor's sentence that credits GateQ without one is not
       * published as written. The tool round's results are read once the
       * model's messages exist (below).
       */
      let gateqToolResults: () => readonly ModelMessage[] = () => [];
      const gateqHeld = (): boolean =>
        gateqReadingHeld({ facts, toolResults: gateqToolResults() });
      const gateqLabels = createGateqLabelGuard(
        askerSideOf(request) === "INVESTOR",
        gateqHeld,
      );
      /**
       * Step 8: what backs a sentence claiming an action -- this run's
       * successful acting tool results, read at each sentence -- and the
       * promise check over Q's own sentences (promise-check.ts).
       */
      const promiseGrounds = (): PromiseGrounds => ({
        actions: runActions.read(request.runId),
        writingDocument: request.writingDocument === true,
        remembering: rememberConfirmation(request.rememberAsk) !== null,
      });
      const promised = createPromiseChecker(promiseGrounds);
      const logUnbacked = (
        unbacked: readonly ActionClaimKind[],
        where: "stream" | "answer",
      ): void => {
        if (unbacked.length === 0) return;
        logger?.warn(
          {
            qRunId: request.runId,
            where,
            unbacked: unbacked.length,
            kinds: [...new Set(unbacked)],
            toolsActed: runActions.read(request.runId).length,
          },
          "unbacked action claims rewritten in a Q answer",
        );
      };
      const logUngrounded = (
        ungrounded: readonly ClaimKind[],
        where: "stream" | "answer",
      ): void => {
        if (ungrounded.length === 0) return;
        // Kinds only: the figure itself may be private or echo a private one.
        logger?.warn(
          {
            qRunId: request.runId,
            where,
            ungrounded: ungrounded.length,
            kinds: [...new Set(ungrounded)],
          },
          "ungrounded claims left out of a Q answer",
        );
      };
      /** One whole sentence through the guards and out; see the note above. */
      const takeSentence = (sentence: string): void => {
        // Code said the comparison's verdict first: a sentence of the
        // model's that only says it again is not said twice (live
        // 2026-10-26, run 0adc1c1e).
        if (
          compareVerdict !== null &&
          restatesVerdict(sentence, compareVerdict)
        )
          return;
        // The tool loop has already run, so the grounds -- if the
        // model asked for them -- are known before the first sentence
        // is published.
        // Fact labels are rewritten before a sentence goes out, not only
        // in the stored answer: on a voice call it is said aloud (H3b).
        const labelled = gateqLabels.sentence(sentence);
        if (labelled === null) return;
        const sentenceGuarded = guardSentence(
          citeAuthorisedFacts(labelled, facts),
          firstSentence,
          groundsNow(),
        );
        firstSentence = false;
        // Nothing is "on your screen" unless a tool put it there (R0).
        const screenGuarded =
          sentenceGuarded === null
            ? null
            : screenClaims.sentence(sentenceGuarded);
        const guarded =
          screenGuarded === null
            ? null
            : artifactClaims.sentence(screenGuarded);
        // One boilerplate disclaimer at most (lead live replay 2026-10-07).
        const caveatedRaw = guarded === null ? null : caveats.sentence(guarded);
        // No figure, date or name the run was not given is said aloud or
        // shown (step 6); checked before publish, so voice never speaks it.
        const restated =
          caveatedRaw === null || caveatedRaw.length === 0
            ? null
            : documentDenials.sentence(caveatedRaw);
        const claimed =
          restated === null || restated.length === 0
            ? null
            : stageClock.time("claimCheck", () => claims.sentence(restated));
        if (claimed !== null) logUngrounded(claimed.ungrounded, "stream");
        // No action is said done that no tool of this run did (step 8).
        const claimedText = claimed?.text;
        const kept =
          claimedText === null || claimedText === undefined
            ? null
            : stageClock.time("promiseCheck", () =>
                promised.sentence(claimedText),
              );
        if (kept !== null) logUnbacked(kept.unbacked, "stream");
        const caveated = kept?.text ?? null;
        if (caveated === null || caveated.length === 0) {
          return;
        }
        // While code's lead list is what was last said, a sentence of
        // the model's that only repeats one of its items is not said
        // again (lead 2026-10-03; the stored answer drops it the same
        // way, afterLeadLines).
        let said = caveated;
        if (leadListOpen && leadLines !== undefined) {
          said = afterLeadLines(caveated, leadLines).trim();
          // A bare item number cut off as its own sentence ("1.").
          if (said.length === 0 || /^\d+[.)]$/u.test(said)) return;
          leadListOpen = false;
        }
        if (heldPromise !== null) {
          publish(heldPromise);
          heldPromise = null;
        }
        // Code closes this answer with its own offer (request.closingLines):
        // a question of the model's is held until a sentence follows it, so
        // a closing ask of its own never reaches anyone (see
        // withoutTrailingAsks). One ask per answer, so a yes binds to code's.
        if (heldAsk !== null) {
          publish(heldAsk);
          heldAsk = null;
        }
        if (request.closingLines !== undefined && isAsk(said)) {
          heldAsk = said;
          return;
        }
        // HQ-2 slice 3: no closing offer where code allows none; an offer
        // is held until a sentence follows it (the stored answer drops a
        // trailing one the same way, withoutTrailingOffers).
        if (offerAllowed === false && endsWithOffer(said)) {
          heldAsk = said;
          return;
        }
        if (isEmptyPromise(said)) {
          heldPromise = said;
          return;
        }
        // HQ-7: a callback is a paraphrase; one that quotes is not said.
        if (quotesCallback(said, memoryCallback)) return;
        publish(said);
      };
      /**
       * The answer's last sentence, once the answer's closing quote has
       * been read.
       *
       * The analyst writes `answer` first and the rest of its object
       * (profile changes, knowledge, action talk, cards) after it, which
       * is often longer than the answer itself. The last sentence used to
       * wait for that whole tail; a one-sentence answer therefore reached
       * nobody until the turn was over. The closing quote makes the
       * sentence whole, so it goes through the same guards as the rest.
       *
       * Only on a turn that offered no tools: a round that reaches for a
       * tool may carry a closing sentence of its own ("Checking now.") that
       * the next round's answer replaces, and nothing said can be unsaid.
       * Tool turns keep the earlier rule (the last sentence arrives with
       * the completed message).
       *
       * Held back too when it is a sentence about preparing, approving or
       * having saved something: that is exactly the one the stored answer
       * may replace with the engine's status line, and a spoken sentence
       * cannot be taken back.
       */
      let lastReleased = false;
      const releaseLastSentence = (): void => {
        if (lastReleased || !partial.complete()) return;
        lastReleased = true;
        const last = cutter.rest();
        if (last === null) return;
        if (
          offered.length > 0 ||
          request.askedAction !== undefined ||
          request.writingDocument === true ||
          withoutStatusTalk(last).removed > 0
        ) {
          return;
        }
        takeSentence(last);
      };
      /** Set once the turn knows whether its extras are written apart. */
      let onAnswerBegins: (() => void) | null = null;
      /** What the extras' writer has written so far (parallel-extras.ts). */
      let extrasSeen = "";
      const onTextDelta = (fragment: string): void => {
        if (firstTextMs === null && fragment.length > 0) {
          firstTextMs = Date.now() - startedAt;
        }
        seenText += fragment;
        for (const raw of liveFindings.push(seenText)) showLive(raw);
        const fresh = partial.push(seenText);
        if (fresh.length > 0) {
          // Prose means this round is answering, not reaching for a tool:
          // the extras' writer starts now, beside it.
          onAnswerBegins?.();
          seenAnswer += fresh;
          for (const sentence of cutter.push(fresh)) {
            takeSentence(sentence);
          }
        }
        releaseLastSentence();
      };

      /**
       * The writer's own fields only when code resolved the comparison
       * (compare-answer.ts): the table, verdict and cards are code's, and
       * every field the schema asks for is time the person waits.
       */
      const answerSchema =
        compareTable !== null ? COMPARE_ANSWER_SCHEMA : ANALYST_RESULT_SCHEMA;
      const answerOutput = (): typeof rendered.output =>
        compareTable !== null
          ? compareAnswerOutput(rendered.output)
          : conversationAnswerOutput(rendered.output, splitExtras);
      const options: ModelGatewayExecuteOptions<CompanyAnalystV30Result> = {
        signal: request.signal,
        // The schema the prompt in use (COMPANY_ANALYST v26, schema v26) writes to: live
        // 2026-10-09, v17 refused every answer carrying v22's `visual` as an
        // unknown key, and each refusal re-ran the answer (10-15 s a turn).
        schema: answerSchema,
        onTextDelta,
        // The analyst's lists are independent readings: one statement with
        // a malformed knowledge key must not throw away the profile change
        // beside it (CQ-QX-007 A5).
        invalidListItems: "DROP",
        // An answer whose only fault is an auxiliary field's shape is kept
        // (live 2026-10-01: actionTalk as a string, and a malformed
        // recommendation, each refused the whole reading; with a tool's
        // proposal already prepared, the person was told Q's reasoning
        // service was unreachable).
        lenientFields: ANALYST_LENIENT_FIELDS,
        // A root key the reading does not define (live 2026-10-13: a root
        // `followUps`) is left out, not a reason to regenerate the answer.
        unknownRootKeys: "DROP",
      };
      /**
       * While the turn's web search runs, a tool round that begins writing
       * prose is answering without what the web found: it is stopped at its
       * first words (nothing of it is said), and the answer is written once,
       * after the web result lands, by the call that holds no tools (a
       * retrieved page never precedes a round that holds tools).
       */
      let roundStop: AbortController | null = null;
      const roundOptions =
        (): ModelGatewayExecuteOptions<CompanyAnalystV30Result> => {
          if (!earlyWebPending()) {
            roundStop = null;
            return options;
          }
          const stop = new AbortController();
          roundStop = stop;
          return {
            ...options,
            signal:
              request.signal === undefined
                ? stop.signal
                : AbortSignal.any([request.signal, stop.signal]),
            onTextDelta: (fragment: string): void => {
              if (fragment.trim().length > 0) stop.abort();
            },
          };
        };
      /** The round was stopped because it began answering (above). */
      const roundStoppedForWeb = (): boolean =>
        roundStop?.signal.aborted === true && request.signal?.aborted !== true;

      // The message and its durable completion event commit together
      // (CQ-Q-009 §16-§18): the event carries the persisted message, so a
      // client that missed every live delta converges on this text.
      // What client-action tools allowed this turn (R20/R33): carried as
      // UI_INTENT blocks on the answer, which the screen performs once as
      // it arrives. Only from a tool's own authorised result, never words.
      // U4/F8: a move their words asked for beside the question goes with
      // this answer, as a screen act like any other.
      const clientActionBlocks: QResultBlock[] = [
        ...(request.leadBlocks ?? []),
      ];
      // "What are you doing?": their Work page, with the cards waiting for
      // them, opens with the answer (founder 2026-10-06). Code's reading of
      // their own words, and only where this run may open Work.
      const workQuestion =
        latest !== undefined &&
        asksAboutQWork(latest.content) &&
        (request.capabilities?.navigate ?? []).includes("WORK");
      if (workQuestion) {
        clientActionBlocks.push({
          kind: "UI_INTENT",
          intent: { kind: "NAVIGATE", destination: "WORK" },
        });
      }
      const collectClientAction = (outcome: QToolCallOutcome): void => {
        if (!outcome.result.ok) return;
        const read = QClientActionToolResultSchema.safeParse(
          outcome.result.data,
        );
        // Q room R5: a calendar answer carries its connect card (display
        // only; the person starts the connect flow from it).
        const card = read.success
          ? null
          : CalendarConnectCarrierSchema.safeParse(outcome.result.data);
        const language =
          read.success || card?.success === true
            ? null
            : LanguageCarrierSchema.safeParse(outcome.result.data);
        const room =
          read.success || card?.success === true || language?.success === true
            ? null
            : RoomCardCarrierSchema.safeParse(outcome.result.data);
        const intent = read.success
          ? read.data.clientAction
          : card?.success === true
            ? card.data.clientAction
            : language?.success === true
              ? language.data.clientAction
              : room?.success === true
                ? room.data.clientAction
                : null;
        if (intent === null) return;
        const block: QResultBlock = { kind: "UI_INTENT", intent };
        if (
          !clientActionBlocks.some(
            (known) => JSON.stringify(known) === JSON.stringify(block),
          )
        ) {
          clientActionBlocks.push(block);
        }
      };
      // A document the person asked Q to change, filed as a new version by
      // `revise_my_document`: its card rides on the answer, from the tool's
      // own authorised result only (founder directive 2026-09-28).
      const collectDocument = (outcome: QToolCallOutcome): void => {
        if (!outcome.result.ok) return;
        const read = QDocumentToolResultSchema.safeParse(outcome.result.data);
        if (!read.success) return;
        const block: QResultBlock = {
          kind: "ARTIFACT_REFERENCE",
          artifactId: read.data.document.artifactId,
          type: read.data.document.type,
          status: read.data.document.status,
          title: read.data.document.title,
        };
        const at = clientActionBlocks.findIndex(
          (known) =>
            known.kind === "ARTIFACT_REFERENCE" &&
            known.artifactId === block.artifactId,
        );
        // The latest revision's card replaces an earlier one in this answer.
        if (at >= 0) clientActionBlocks.splice(at, 1, block);
        else clientActionBlocks.push(block);
        // Q room W5: an edit by slide takes the room's viewer to that slide.
        if (read.data.slide !== undefined) {
          const go: QResultBlock = {
            kind: "UI_INTENT",
            intent: {
              kind: "DOCUMENT_ACT",
              act: "GO_TO_PAGE",
              page: read.data.slide,
            },
          };
          const seen = clientActionBlocks.findIndex(
            (known) =>
              known.kind === "UI_INTENT" &&
              known.intent.kind === "DOCUMENT_ACT" &&
              known.intent.act === "GO_TO_PAGE",
          );
          if (seen >= 0) clientActionBlocks.splice(seen, 1, go);
          else clientActionBlocks.push(go);
        }
      };
      /**
       * Live 2026-10-28 ("what's on my schedule today?" was words alone):
       * when the model reads their schedule this turn, the read's own
       * result becomes their schedule card, with what waits for their
       * approval from the day's reads beside it. Built by code from the
       * tool's authorised result; the model chose only to read it.
       */
      const collectSchedule = (name: string, outcome: QToolCallOutcome) => {
        if (name !== "list_schedule" || !outcome.result.ok) return;
        const block = scheduleBlock({
          schedule: outcome.result.data,
          approvals: wideReads.ownDayReads?.approvals,
          now: new Date(),
          timeZone: wideReads.ownDayReads?.timeZone ?? null,
        });
        if (block === null) return;
        const at = clientActionBlocks.findIndex(
          (known) => known.kind === "SCHEDULE",
        );
        if (at >= 0) clientActionBlocks.splice(at, 1, block);
        else clientActionBlocks.push(block);
      };
      // Public sources this run read, attached to the answer as structured
      // sources (CQ-Q-VOICE-001 R3; R23). Public fields only.
      const publicSources: PublicSourceLike[] = [];
      /**
       * Round 6 (live 2026-11-06): a web discovery's answer names Capital
       * Q's top 3 in its own line; a tie line about cards the person may
       * not see (Chat shows no cards) is never appended to it.
       */
      let tieLineAllowed = true;
      /**
       * Every page this turn's public searches read, with the research's
       * verdict on whether it is about whom it searched for: the evidence a
       * picture of them must stand on (QA QO-09).
       */
      const webEvidence: SearchEvidence[] = [];
      // Slice 2 (12 Nov): whether the research matched each page to the
      // subject asked about, by page, so a namesake's page is never placed
      // on that subject's public-record timeline.
      const pageSubjectMatch = new Map<string, string>();
      // C's receipts (UI acts and moves), read once for the whole turn.
      const screenReceipts: readonly string[] =
        dependencies.uiActReceipts?.(request.actor) ?? [];
      /**
       * Owner 2026-10-23: "rank them by my mandate" over companies nobody
       * could score is answered with the mandate's ranking, said as such;
       * those cards are not the set just shown, by design.
       */
      let rankedPastShown = false;
      /**
       * QA F-96 (24 Oct 2026): an Arabic "best three for my mandate" answer
       * ended with code's English "They're on screen." Whatever path wrote a
       * line in English (an on-screen line, a verdict lead, a tie, a status
       * line), a turn that is not in English gets it in theirs, through the
       * shared translation layer (names and figures kept). English turns,
       * and lines already in their language, are left as they are.
       */
      const inTheirLanguage = async (text: string): Promise<string> => {
        const localise = dependencies.localiseWords;
        if (localise === undefined) return text;
        return inTurnLanguage(text, latest.content, (texts) =>
          localise(
            {
              tenantId: request.tenantId,
              userId: request.actorUserId,
              runId: request.runId,
              turn: latest.content,
            },
            texts,
          ),
        );
      };
      // The comparison's lead, decided by code (prepare's table, or the
      // model path's own table below when the prepare built none).
      let answerVerdict: ComparisonVerdict | null = compareVerdict;
      const persistAnswer = async (
        content: string,
        /**
         * What the analyst produced beside the prose, as blocks
         * (QX-002/003 §C). Carried on the durable completion event, which
         * is the event a client converges on and the one it replays after
         * a reconnect. The message store stays plain text on purpose: an
         * unbounded column there is where a provider's whole response
         * object would eventually land.
         */
        given?: QResponseMessage["blocks"],
        /**
         * PRESENCE: what Q's particles form for which sentence, clamped to
         * the reply. On the live completion event only; never stored.
         */
        gestures?: QResponseMessage["gestures"],
        /**
         * RC3 / Phase 5: the analyst's concise spoken form of this answer,
         * as written in the same call. Kept on the live completion event
         * only when every figure and name in it is in what is stored
         * (spokenFormWithin); otherwise the voice derives its words from
         * the text as before. Never stored.
         */
        spokenCandidate?: string | null,
      ) => {
        // Every public page read for this answer travels with it as a
        // structured source (R23, R38): the prose stays answer-first and
        // the provenance is one tap away, never lost.
        // INC-1: one card per canonical record across every block, exactly
        // the count asked for, "them" held to the set just shown, and every
        // score labelled mandate fit with how it was made.
        // Live 23 Oct 2026 (three readings of "compare the top two side by
        // side", three answer paths, no table): a comparison the prepare
        // resolved goes out with its table whichever path answered, and is
        // done, never offered.
        const tableHere =
          compareTable !== null &&
          // live6: the table already on their screen is not drawn again.
          !comparisonOnScreen(earlier, compareTable) &&
          !(given ?? []).some(
            (block) =>
              block.kind === "TABLE" && block.title !== COMPANIES_TABLE_TITLE,
          );
        if (tableHere) {
          given = given?.filter(
            (block) =>
              block.kind !== "TABLE" || block.title !== COMPANIES_TABLE_TITLE,
          );
        }
        // QA F-107: how a tool failed is never said to the person.
        content = withoutInternalFailureLines(content);
        // RC4 (audit 15 Nov): Q's notes speak of them in the third person;
        // the answer speaks to them.
        content = inSecondPerson(content);
        // QA F-44: other investors' interest is withheld, never denied.
        if (othersInterestAsked(request, latest.content)) {
          content = withOthersInterestWithheld(content).slice(
            0,
            ANSWER_LIMIT_CHARS,
          );
        }
        if (compareTable !== null) {
          const done = withoutMarkdownTables(withoutCompareOffers(content));
          const spoken = tableHere ? comparisonSpokenLine(compareTable) : null;
          content = (
            spoken === null
              ? done.length === 0
                ? content
                : done
              : done.length === 0
                ? spoken
                : `${spoken}\n\n${done}`
          ).slice(0, ANSWER_LIMIT_CHARS);
        }
        // Coordinator 24 Oct: code decides who a comparison leads with. Last,
        // so the table's spoken line never goes before the verdict (live on
        // bbb4b677: the lead was applied, then "Side by side, …" put first).
        if (answerVerdict !== null) {
          content = ledByVerdict(content, answerVerdict).slice(
            0,
            ANSWER_LIMIT_CHARS,
          );
        }
        const chart = chartFor([
          ...(given ?? []),
          ...(tableHere && compareTable !== null ? [compareTable] : []),
        ]);
        const carried = withoutUnaskedMoves(
          withFitIntegrity(
            [
              ...(given ?? []),
              ...(tableHere && compareTable !== null ? [compareTable] : []),
              ...(chart === null ? [] : [chart]),
              ...publicSources.map((source) => ({
                kind: "PUBLIC_SOURCE" as const,
                ...publicSourceBlockFields(source),
              })),
              ...clientActionBlocks,
            ],
            {
              asked: latest.content,
              // "Them" is held to the set just shown, except where the
              // answer says it is the mandate's ranking instead (below).
              previous: rankedPastShown ? [] : previousCardCompanyIds(earlier),
              // QA U2: a mandate fit is an investor's; none for anyone else.
              mandate: askerSideOf(request) === "INVESTOR",
            },
          ),
          // A map they asked to see is not replaced by a page they did not.
          latest.content,
        );
        // v88 (owner live 14 Nov 2026, D1): a stated "not the ones I'm
        // already in touch with" holds on every path. Any company card of
        // their own relationships still in the answer is dropped and the
        // answer says so -- the digest's relationships, and those this
        // turn's own read found, as them.
        let answerBlocks = carried.length === 0 ? undefined : carried;
        // Owner live 18 Nov 2026 (run faecd30a): "the three best candidates
        // with no recorded contact are Kazikit, Portside and Watchly" --
        // two of them relationships. An answer that itself says it left
        // out their contacts is held to it, as a stated exclusion is.
        if (
          request.excludeRelationships === true ||
          claimsLeftOutContacts(content)
        ) {
          const standing = await (standingOf() ?? Promise.resolve(null)).catch(
            () => null,
          );
          // in-contact.ts: the one rule, from the digest and this turn's
          // own relationships read.
          const inTouch = inContactOf(
            await accountDigest,
            standing !== null && standing.result.ok
              ? standing.result.data
              : null,
          );
          const checked = withoutExcludedCompanies(answerBlocks, inTouch);
          answerBlocks =
            checked.blocks === undefined || checked.blocks.length === 0
              ? undefined
              : checked.blocks;
          const said = withExclusionChecked(
            content,
            checked.dropped,
            answerCardCompanies(answerBlocks ?? []).length,
          );
          if (said !== null) {
            content = said.slice(0, ANSWER_LIMIT_CHARS);
            logger?.warn(
              { qRunId: request.runId, dropped: checked.dropped.length },
              "q answer listed companies the person asked to leave out; dropped by code",
            );
          }
        }
        // A tie is said as a tie, with why (INC-1: three cards at 8.8 read
        // as a ranking) -- on the cards still shown after the check above
        // (live 18 Nov 2026: a tie of the three companies it had dropped).
        const ranked = (answerBlocks ?? []).find(
          (block): block is QAnswerCardsBlock =>
            block.kind === "ANSWER_CARDS" && block.shape === "RANKED",
        );
        // Only where they asked for fit or for companies (QA F-71, live
        // 2026-10-24: "Show my pipeline" ended with "Ajopot and Maji Loop
        // are tied on mandate fit at 7", about cards they had not asked to
        // rank). Any other turn says the tie on its cards only.
        const tie =
          ranked === undefined || !tieIsAsked(request) || !tieLineAllowed
            ? null
            : tieLine(ranked);
        content =
          tie === null || /\btied\b/iu.test(content)
            ? content
            : `${content}\n\n${tie}`.slice(0, ANSWER_LIMIT_CHARS);
        // C's follow-up: a move or screen act that did not land is said
        // first, plainly, once (never left for the model to smooth over).
        const missed = screenActMissLine(
          missFacts(dependencies, request.actor, earlier, screenReceipts),
          [...earlier].reverse().find((message) => message.role === "Q")
            ?.content ?? null,
        );
        if (missed !== null && !content.includes("didn't go through")) {
          const rest = withoutLandedClaims(content);
          content = (rest.length === 0 ? missed : `${missed}\n\n${rest}`).slice(
            0,
            ANSWER_LIMIT_CHARS,
          );
        }
        // RC4 (voice audit 15 Nov): a stated relationship stage about a
        // named counterpart matches the canonical projection (the digest),
        // or the sentence is replaced by the stage as recorded.
        {
          const staged = withRelationshipStagesChecked(
            content,
            await accountDigest,
            // A pipeline denial naming no one is about whom they asked.
            latest.content,
          );
          if (staged.corrected.length > 0) {
            content = staged.content.slice(0, ANSWER_LIMIT_CHARS);
            logger?.warn(
              { qRunId: request.runId, corrected: staged.corrected.length },
              "q answer stated a relationship stage the projection contradicts; corrected by code",
            );
          }
        }
        // RC4: a place they pointed at is said with the list it was
        // counted in (never a silent guess at "the first one").
        content = withReferenceLead(content, request.referenceLead).slice(
          0,
          ANSWER_LIMIT_CHARS,
        );
        // F-96: every line code wrote, in the language of their turn.
        content = await inTheirLanguage(content);
        // Nothing of a speculative answer is stored until it is adopted.
        if (gate !== null) await gate.ready();
        // The stages and live findings already queued are stored first, so
        // the completed message is the last word (lane 3 reconciles on it).
        await stages.queue;
        // W4: the page pane's move joins the answer before it is stored.
        const blocks = await movedBlocks(request, answerBlocks);
        // Voice directive 15 Nov: the spoken form goes through the same
        // sentence rewrites the answer just did (failure lines, person,
        // others' interest, relationship stages) before it is held to it.
        let spokenHeld: string | null = null;
        if (spokenCandidate !== undefined && spokenCandidate !== null) {
          let said = inSecondPerson(
            withoutInternalFailureLines(spokenCandidate),
          );
          if (othersInterestAsked(request, latest.content)) {
            said = withOthersInterestWithheld(said);
          }
          said = withRelationshipStagesChecked(
            said,
            await accountDigest,
            latest.content,
          ).content;
          spokenHeld = said.trim().length === 0 ? null : said;
        }
        const spokenForm: QSpokenForm | null = spokenFormWithin(
          spokenHeld,
          content,
        );
        if (
          spokenCandidate !== undefined &&
          spokenCandidate !== null &&
          spokenForm === null
        ) {
          logger?.info(
            { qRunId: request.runId },
            "q spoken form left out: it said what the answer does not",
          );
        }
        return transactions.run(async (tx) => {
          const stored = await repositories.messages.insert(tx, {
            id: messageId,
            tenantId: request.tenantId,
            conversationId,
            runId: request.runId,
            role: "Q",
            content,
            // Stored as well as streamed (CQ-Q-BLOCKS-HISTORY-001). The
            // event is what a live client converges on; this is what a
            // refresh, a reopened conversation and the chats list read.
            ...(blocks === undefined ? {} : { blocks }),
          });
          // The record holds everything; the event is bounded (the run
          // failed on a ten-card answer, production 2026-10-28).
          const bounded = boundedCompletedMessage({
            ...(toQMessage(stored) as QResponseMessage),
            ...(blocks === undefined ? {} : { blocks }),
            ...(gestures === undefined || gestures.length === 0
              ? {}
              : { gestures: [...gestures] }),
            ...(spokenForm === null ? {} : { spoken: spokenForm }),
          });
          if (bounded.trimmed !== "NONE") {
            logger?.warn(
              { qRunId: request.runId, trimmed: bounded.trimmed },
              "completed-message event over the run-event bound; the record keeps what the event leaves",
            );
          }
          await appendRunEvent(
            repositories,
            tx,
            { id: request.runId, tenantId: request.tenantId },
            {
              type: "q.message.completed",
              data: { message: bounded.message },
            },
          );
          return stored;
        });
      };
      /**
       * An answer composed by code, in the person's language (any
       * language): the prose and each card set's title and follow-ups go
       * through the shared translation layer with their data lifted out.
       * The prose decides: untranslated, everything stays English.
       */
      const persistCodeAnswer = async (
        content: string,
        given?: QResponseMessage["blocks"],
      ) => {
        const localise = dependencies.localiseWords;
        if (localise === undefined) return persistAnswer(content, given);
        const cardSets = (given ?? []).filter(
          (block): block is QAnswerCardsBlock => block.kind === "ANSWER_CARDS",
        );
        const texts = [
          content,
          ...cardSets.flatMap((block) => [block.title, ...block.followUps]),
        ];
        const said = await localise(
          {
            tenantId: request.tenantId,
            userId: request.actorUserId,
            runId: request.runId,
            turn: latest.content,
          },
          texts,
        ).catch(() => null);
        const prose = said?.[0];
        if (said === null || prose === null || prose === undefined) {
          return persistAnswer(content, given);
        }
        let at = 1;
        const next = (english: string) => {
          const words = said[at];
          at += 1;
          return words === null || words === undefined ? english : words;
        };
        const blocks = given?.map((block) =>
          block.kind === "ANSWER_CARDS"
            ? {
                ...block,
                title: next(block.title).slice(0, 120),
                followUps: block.followUps.map((chip) =>
                  next(chip).slice(0, 120),
                ),
              }
            : block,
        );
        return persistAnswer(prose, blocks);
      };
      // Owner live 17 Nov 2026 (conversation 9995dcca): a ranked list said
      // "no source documents yet" for companies with documents open to the
      // investor. Each company card a code-composed list shows counts what
      // its data room holds open to them, read as them; a room not read
      // stays uncounted, and nothing claims zero.
      const withReaderSourceCounts = async (
        block: QAnswerCardsBlock,
      ): Promise<QAnswerCardsBlock> =>
        askerSideOf(request) !== "INVESTOR"
          ? block
          : withReadableSourceCounts(
              block,
              await readableDocumentCounts({
                companyIds: block.cards.flatMap((card) =>
                  card.subject?.kind === "COMPANY"
                    ? [card.subject.companyId]
                    : [],
                ),
                read: (companyId, index) =>
                  tools.execute(
                    {
                      callId: `q-list-documents-${String(index)}`,
                      name: "read_company_data_room",
                      arguments: { companyId },
                    },
                    toolContext,
                  ),
              }),
            );
      // A fit question over a set they own (lead live replay 2026-10-07:
      // 36 s and "I can't provide mandate scores"): the fits were computed
      // by code beside the reads above, and the answer is the cards plus a
      // short spoken summary, both from those fits -- no model round.
      // RECOVERY-2026-10 B1 (founder Scenario F, live T3): what needs them
      // is said from the attention report by code -- every item, and every
      // source that could not be read named as unread -- so no model can
      // say "nothing is waiting" while something waits or went unread.
      const attentionOutcome = await attention;
      const attentionReport =
        attentionOutcome !== null && attentionOutcome.result.ok
          ? attentionReportOf(attentionOutcome.result.data)
          : null;
      if (
        attentionReport !== null &&
        request.writingDocument !== true &&
        request.askedAction === undefined &&
        (request.turnKind === undefined || request.turnKind === "QUESTION_TO_Q")
      ) {
        const text = attentionAnswerText(attentionReport);
        const message = await persistCodeAnswer(
          leadLines === undefined ? text : `${leadLines}\n\n${text}`,
          // G-R4: the report itself, for the screen (items and unread).
          [{ kind: "ATTENTION", report: attentionReport }],
        );
        logger?.info(
          {
            qRunId: request.runId,
            items: attentionReport.items.length,
            unread: attentionReport.unread,
            totalMs: Date.now() - startedAt,
          },
          "q answered what needs them from the attention report",
        );
        return {
          kind: "ANSWERED",
          messageId: message.id,
          modelPolicyVersion: "none",
          promptBundleVersion: rendered.bundle.bundleVersion,
        };
      }
      // TURN_READER v94 (live 18 Nov 2026, fictional Savanna, run
      // cce59657): "Am I in contact with any of those?" is answered from
      // their own relationships by the one in-contact rule, each company
      // named with its stage -- never a comparison, never a model's word
      // on who they are in touch with. A compound ask, an action or a
      // comparison also heard takes the path below.
      if (
        request.contactStatusAsked === true &&
        request.turnKind === "QUESTION_TO_Q" &&
        compareIds.length < 2 &&
        (request.askParts?.length ?? 0) <= 1 &&
        request.writingDocument !== true &&
        request.askedAction === undefined
      ) {
        const digest = await accountDigest;
        const standing = await (standingOf() ?? Promise.resolve(null)).catch(
          () => null,
        );
        const own =
          standing !== null && standing.result.ok ? standing.result.data : null;
        const subjects = contactSubjectsOf({
          referenced: request.referencedCompanyIds ?? [],
          shown: newestAnswerCards(earlier),
          namedOther: request.aboutNamedOther === true,
          digest,
          own,
        });
        const said =
          subjects === null
            ? null
            : contactStatusAnswer(
                subjects,
                inContactOf(digest, own),
                contactStagesOf(digest, own),
              );
        if (said !== null && subjects !== null) {
          const message = await persistCodeAnswer(said);
          logger?.info(
            {
              qRunId: request.runId,
              companies: subjects.length,
              ownRead: own !== null,
              digest: digest !== null,
              totalMs: Date.now() - startedAt,
            },
            "q answered their contact with the companies meant, from the in-contact rule",
          );
          return {
            kind: "ANSWERED",
            messageId: message.id,
            modelPolicyVersion: "none",
            promptBundleVersion: rendered.bundle.bundleVersion,
          };
        }
      }
      // K6: "what is my mandate?" is a read of the person's own declared
      // record, already prepared: composed by code, no model round (the
      // dialogue call it replaced took ~8 s). Unknown fields stay unknown.
      if (
        ownProfile !== null &&
        request.writingDocument !== true &&
        request.askedAction === undefined &&
        (request.turnKind === undefined ||
          request.turnKind === "QUESTION_TO_Q") &&
        asksForOwnMandate(latest.content)
      ) {
        const recall = ownMandateAnswer(prepared.ownMandateData());
        if (recall !== null) {
          const message = await persistCodeAnswer(
            leadLines === undefined ? recall : `${leadLines}\n\n${recall}`,
          );
          logger?.info(
            {
              qRunId: request.runId,
              modelCalls: 0,
              toolCalls: ownProfileCall === null ? 0 : 1,
              totalMs: Date.now() - startedAt,
            },
            "q answered a mandate recall by code",
          );
          return {
            kind: "ANSWERED",
            messageId: message.id,
            modelPolicyVersion: "none",
            promptBundleVersion: rendered.bundle.bundleVersion,
          };
        }
      }
      // W1: a follow-up on what Q told them on arrival ("what's the
      // request?", "what did they say?", "did they accept?") is answered
      // from the Arrival Snapshot by code: no tool, no model round. Read on
      // its own, so S2's route gating of the wide reads cannot skip it.
      // A follow-up the reading bound to a card Q showed is that card's,
      // never the arrival skim's (live re-check of 6f9b63cc5).
      const followUp =
        prepared.arrivalAnswer ??
        (prepared.arrivalLate === null || coveredCard !== null
          ? null
          : await settledWithin(
              prepared.arrivalLate,
              dependencies.arrivalSkimGraceMs ?? ARRIVAL_SKIM_GRACE_MS,
            ));
      if (followUp !== null) {
        const message = await persistCodeAnswer(
          leadLines === undefined
            ? followUp.text
            : `${leadLines}\n\n${followUp.text}`,
          followUp.open === undefined
            ? undefined
            : [
                {
                  kind: "UI_INTENT",
                  intent: {
                    kind: "OPEN_RECORD_PAGE",
                    page: followUp.open.page,
                    id: followUp.open.id,
                    ...(followUp.open.anchor === undefined
                      ? {}
                      : { anchor: followUp.open.anchor }),
                  },
                },
              ],
        );
        logger?.info(
          {
            qRunId: request.runId,
            itemKey: followUp.itemKey,
            modelCalls: 0,
            toolCalls: 0,
            totalMs: Date.now() - startedAt,
          },
          "q answered an arrival follow-up from the arrival snapshot",
        );
        return {
          kind: "ANSWERED",
          messageId: message.id,
          modelPolicyVersion: "none",
          promptBundleVersion: rendered.bundle.bundleVersion,
        };
      }
      // W2: a named person, company or body is identified from public
      // sources by code (a prepared entity instantly, anyone else in a few
      // seconds); the analyst never describes them from general knowledge.
      if (
        request.personSearch !== undefined &&
        request.writingDocument !== true &&
        request.askedAction === undefined &&
        (request.turnKind === undefined || request.turnKind === "QUESTION_TO_Q")
      ) {
        const personStarted = Date.now();
        // Artifacts live (L-15): the identity's card frame goes up as soon
        // as the name is known, while the public lookup runs (seconds),
        // with initials until the card lands. Only a name in the person's
        // own words, never one a model wrote.
        const askedName = request.personSearch.name.trim().slice(0, 80);
        if (
          askedName.length > 0 &&
          containsCompanyName(latest.content, askedName)
        ) {
          const ahead = announcer.ahead({
            subject: null,
            name: askedName,
            kind:
              request.personSearch.entityKind === "PERSON"
                ? "PERSON"
                : "ORGANISATION",
          });
          if (ahead !== null) {
            send({
              runId: request.runId,
              tenantId: request.tenantId,
              messageId,
              text: "",
              preview: ahead,
            });
          }
        }
        // Their picture from public pages, looked for beside the lookup
        // (owner 2026-10-23): the turn's own picture search when the web
        // search began with their name, else one for the name they asked.
        // Asked for only once the lookup found them (spend rule 2026-10-25).
        let laneStarted: ReturnType<QPublicPicturePort["find"]> | null = null;
        const lanePictures =
          webPictures ??
          (pictureSearch !== undefined && askedName.length > 0
            ? () =>
                (laneStarted ??= pictureSearch
                  .find({
                    name: askedName,
                    userText: latest.content,
                    earlierUserText:
                      toolContext.conversation?.earlierUserText ?? [],
                    shownText: toolContext.conversation?.earlierQText ?? [],
                    privateText:
                      toolContext.conversation?.privateText?.() ?? [],
                    signal: request.signal,
                    runId: request.runId,
                  })
                  .catch(() => []))
            : null);
        // Live 2026-10-28: for a founder, an organisation they named is
        // looked for among Capital Q's own investors they may see before
        // any public search; found, the answer is its card (public profile
        // and published gate only), and no web page is read.
        const founderAsking = !investorAsking && prepared.ownCompanyId !== null;
        const known =
          founderAsking &&
          request.personSearch.entityKind !== "PERSON" &&
          askedName.length > 0
            ? await knownInvestorFor(askedName)
            : null;
        if (known !== null) {
          const message = await persistCodeAnswer(known.text, [
            ...known.blocks,
          ]);
          logger?.info(
            {
              qRunId: request.runId,
              investorOrganisationId: known.investorOrganisationId,
              modelCalls: 0,
              prepareMs: prepared.prepareMs,
              personMs: Date.now() - personStarted,
              totalMs: Date.now() - startedAt,
            },
            "q answered a named investor from Capital Q's own investors",
          );
          return {
            kind: "ANSWERED",
            messageId: message.id,
            modelPolicyVersion: "none",
            promptBundleVersion: rendered.bundle.bundleVersion,
          };
        }
        const found = await personFor(
          request.personSearch,
          founderAsking && request.personSearch.entityKind !== "PERSON",
        );
        if (found !== null) {
          for (const source of found.sources) {
            if (!publicSources.some((known) => known.url === source.url)) {
              publicSources.push(source);
            }
          }
          // QA F-17: pictures only of someone the lookup found.
          const foundThem =
            found.result.card !== null || found.result.candidates.length > 0;
          const soleFound =
            found.result.candidates.length === 1
              ? found.result.candidates[0]
              : undefined;
          const placedAt = (
            found.result.card?.subject.organization ??
            soleFound?.organization ??
            ""
          ).trim();
          // QA QO-09: only on a site the lookup found them on, or the own
          // site of the organisation it placed them at.
          const theirs = (
            candidates: Parameters<typeof corroboratedPictures>[0],
          ) =>
            corroboratedPictures(candidates, {
              name: askedName,
              sources: [
                ...webEvidence,
                ...found.sources.map((source) => ({
                  domain: source.domain,
                  subjectMatch: "MATCH",
                })),
              ],
              organisations: placedAt.length > 0 ? [placedAt] : [],
            });
          let pictures =
            lanePictures === null || !foundThem
              ? []
              : publicPictureBlocks(
                  theirs(
                    (await settledWithin(lanePictures(), PICTURE_WAIT_MS)) ??
                      [],
                  ),
                  new Date().toISOString(),
                );
          // A person's name alone often finds namesakes' pictures, which
          // the page check drops (live 2026-10-23: "captain zino mario"
          // found game art). Where the lookup placed them at an
          // organisation, its pages are asked too (a company's page about
          // its founder, a press interview).
          // From the matched card, or from the one candidate a name alone
          // found (live 2026-10-23: "Captain Zino Mario" found one plausible
          // candidate, Zino Mario-Ghae of Zino Aviation, which a name alone
          // never makes a confirmed identity, so there was no card).
          const soleCandidate =
            found.result.candidates.length === 1
              ? found.result.candidates[0]
              : undefined;
          const organisation = (
            found.result.card?.subject.organization ??
            soleCandidate?.organization ??
            ""
          ).trim();
          if (
            foundThem &&
            pictures.length === 0 &&
            organisation.length > 0 &&
            dependencies.publicPictures !== undefined &&
            askedName.length > 0
          ) {
            pictures = publicPictureBlocks(
              theirs(
                (await settledWithin(
                  dependencies.publicPictures.find({
                    name: askedName,
                    organisation,
                    userText: latest.content,
                    earlierUserText:
                      toolContext.conversation?.earlierUserText ?? [],
                    shownText: toolContext.conversation?.earlierQText ?? [],
                    privateText:
                      toolContext.conversation?.privateText?.() ?? [],
                    signal: request.signal,
                    runId: request.runId,
                  }),
                  PICTURE_WAIT_MS,
                )) ?? [],
              ),
              new Date().toISOString(),
            );
          }
          const message = await persistCodeAnswer(found.text, [
            ...(found.block === null ? [] : [found.block]),
            ...pictures,
          ]);
          logger?.info(
            {
              qRunId: request.runId,
              pictures: pictures.length,
              outcome: found.result.outcome,
              source: found.source,
              confidence: found.result.card?.subject.confidence ?? null,
              candidates: found.result.candidates.length,
              searchMs: found.result.elapsedMs,
              modelCalls: 0,
              prepareMs: prepared.prepareMs,
              personMs: Date.now() - personStarted,
              totalMs: Date.now() - startedAt,
            },
            "q answered a person search",
          );
          return {
            kind: "ANSWERED",
            messageId: message.id,
            modelPolicyVersion: "none",
            promptBundleVersion: rendered.bundle.bundleVersion,
          };
        }
      }
      // Lead 2026-10-16 (live: a map of known companies took 22 s through a
      // public web search, or came back as cards with no map): drawn by
      // code from what the companies declare, before any model is asked.
      const companiesMapAsk = mayDrawCompaniesMap(request)
        ? companiesMapAskOf(latest.content, shownBefore)
        : null;
      if (companiesMapAsk !== null) {
        const mapStarted = Date.now();
        const drawn = await mapFor(companiesMapAsk);
        if (drawn !== null) {
          const message = await persistCodeAnswer(drawn.text, [
            ...drawn.blocks,
          ]);
          logger?.info(
            {
              qRunId: request.runId,
              scope: companiesMapAsk.scope,
              places: drawn.blocks.length,
              toolCalls: drawn.calls.length,
              modelCalls: 0,
              prepareMs: prepared.prepareMs,
              mapMs: Date.now() - mapStarted,
              totalMs: Date.now() - startedAt,
            },
            "q drew a map of companies from their declared locations",
          );
          return {
            kind: "ANSWERED",
            messageId: message.id,
            modelPolicyVersion: "none",
            promptBundleVersion: rendered.bundle.bundleVersion,
          };
        }
      }
      // S2b (live 2026-10-15: 8-13 s, 3-4 model calls for one field): a
      // basic profile fact about a company named outright, from its own
      // declared profile, said as declared. Null (not exactly one visible
      // company, or not admitted): the full path answers.
      if (companyFactAsk !== null) {
        const factStarted = Date.now();
        const fact = await factFor(companyFactAsk);
        if (fact !== null) {
          const message = await persistCodeAnswer(fact.text, [
            { kind: "COMPANY_REFERENCE", companyId: fact.companyId },
          ]);
          logger?.info(
            {
              qRunId: request.runId,
              aspect: companyFactAsk.aspect,
              toolCalls: fact.calls.length,
              modelCalls: 0,
              prepareMs: prepared.prepareMs,
              factMs: Date.now() - factStarted,
              totalMs: Date.now() - startedAt,
            },
            "q answered a company fact from its declared profile",
          );
          return {
            kind: "ANSWERED",
            messageId: message.id,
            modelPolicyVersion: "none",
            promptBundleVersion: rendered.bundle.bundleVersion,
          };
        }
      }
      // Owner 2026-11-06 (Savanna Seed Partners): companies found out on
      // the public web. A plan of targeted searches from the mandate, the
      // pages read, the companies they name admitted only when a fetched
      // page names them, founders searched for; composed by code, labelled
      // public and unverified. Never one search on the words, never a name
      // from model memory.
      if (
        request.webDiscovery !== undefined &&
        request.writingDocument !== true &&
        request.askedAction === undefined
      ) {
        const discoveryStarted = Date.now();
        // The search takes a while (two rounds of searches and page
        // reads): they see the web search's own stage meanwhile.
        const webStage = offeredForRun.find(
          (tool) => tool.definition.name === PUBLIC_WEB_TOOL,
        )?.visibleStage;
        if (webStage !== undefined && webStage !== null) {
          void stageOnce(webStage);
        }
        // Owner's account 2026-11-06: "find me new companies online that i
        // would be interested in" -- Capital Q's own top matches by mandate
        // fit first, in one line, then the web's; both side by side.
        // Round 4 (live 2026-11-06): what Q already listed here, from its
        // own replies. "More" leaves those out, and a follow-up shows the
        // web's list only: no top-3 cards, no ranking line again.
        const alreadyListed = priorListings(
          earlier
            .filter((message) => message.role === "Q")
            .map((message) => message.content),
        );
        const onCapitalQ =
          request.webDiscovery.alsoOnCapitalQ === true &&
          investorAsking &&
          alreadyListed.length === 0
            ? discoverFor({
                text: request.webDiscovery.text,
                sectors: [],
                countries: [],
                stages: [],
                count: 3,
                ranking: "FIT",
                mandateRelevant: true,
                previous: false,
                raising: false,
              }).catch(() => null)
            : Promise.resolve(null);
        const [found, catalog] = await Promise.all([
          webDiscoveryFor(
            request.webDiscovery,
            prepared.ownMandateData(),
            alreadyListed,
          ),
          onCapitalQ,
        ]);
        if (found !== null) {
          for (const source of found.sources) {
            if (!publicSources.some((known) => known.url === source.url)) {
              publicSources.push(source);
            }
          }
          const topCards =
            catalog !== null &&
            catalog.basis === "FIT" &&
            catalog.block !== null
              ? catalog.block.cards.slice(0, 3)
              : [];
          const topNames = topCards.map((card) => `**${card.name}**`);
          const lead =
            topNames.length === 0
              ? null
              : `On Capital Q, your top ${String(topNames.length)} by mandate fit: ${
                  topNames.length === 1
                    ? (topNames[0] ?? "")
                    : `${topNames.slice(0, -1).join(", ")} and ${topNames.at(-1) ?? ""}`
                }. From the public web:`;
          tieLineAllowed = false;
          const message = await persistCodeAnswer(
            lead === null ? found.text : `${lead}\n\n${found.text}`,
            lead === null || catalog === null || catalog.block === null
              ? []
              : [{ ...catalog.block, cards: topCards }],
          );
          logger?.info(
            {
              qRunId: request.runId,
              outcome: found.outcome,
              readerFailed: found.readerFailed,
              listed: found.companies.length,
              withFounders: found.companies.filter(
                (company) => company.founders.length > 0,
              ).length,
              onCapitalQ: found.companies.filter(
                (company) => company.onCapitalQ,
              ).length,
              queries: found.queries.length,
              founderSearches: found.founderQueries.length,
              toolCalls: found.toolCalls,
              sources: found.sources.length,
              prepareMs: prepared.prepareMs,
              discoveryMs: Date.now() - discoveryStarted,
              totalMs: Date.now() - startedAt,
            },
            "q answered a web discovery",
          );
          return {
            kind: "ANSWERED",
            messageId: message.id,
            modelPolicyVersion: "none",
            promptBundleVersion: rendered.bundle.bundleVersion,
          };
        }
      }
      // D1: investors of a region or kind, no name given, are found by
      // code (prepared investors, then one bounded public search); the
      // analyst never lists them from general knowledge.
      if (
        request.discoverInvestors !== undefined &&
        request.writingDocument !== true &&
        request.askedAction === undefined &&
        (request.turnKind === undefined || request.turnKind === "QUESTION_TO_Q")
      ) {
        const investorsStarted = Date.now();
        const found = await investorsFor(
          request.discoverInvestors,
          prepared.ownCompanyId,
        );
        if (found !== null) {
          const message = await persistCodeAnswer(
            found.text,
            found.block === null ? [] : [found.block],
          );
          logger?.info(
            {
              qRunId: request.runId,
              outcome: found.outcome,
              shown: found.shown,
              webSearched: found.webSearched,
              modelCalls: 0,
              prepareMs: prepared.prepareMs,
              investorsMs: Date.now() - investorsStarted,
              totalMs: Date.now() - startedAt,
            },
            "q answered an investor discovery",
          );
          return {
            kind: "ANSWERED",
            messageId: message.id,
            modelPolicyVersion: "none",
            promptBundleVersion: rendered.bundle.bundleVersion,
          };
        }
      }
      /**
       * RC2 (audit 2026-11-15): a ranked list with a condition the person
       * stated -- "only the ones with actual revenue", "outside my
       * preferred sectors", "which would be poor fits", a founder's "leave
       * out the investors I'm already talking to" -- is answered with the
       * condition applied by code before ranking, never the plain ranking.
       * The conditions are the reading's (v89 listConditions, v88
       * excludeRelationships). When no lane here can honour them, every
       * code-composed list below stands down and the full path answers.
       */
      // T7 (live re-check 15 Nov 2026): "And the poor fits?" after "leaving
      // out the ones I'm already talking to" named one of them. Conditions
      // kept with the list Q showed just before carry to a list ask on the
      // same side; what this turn's reading states replaces them.
      const listSide: "INVESTOR" | "FOUNDER" = investorAsking
        ? "INVESTOR"
        : "FOUNDER";
      const previousQ = [...earlier].reverse().find((m) => m.role === "Q");
      const carriedConditions =
        previousQ === undefined
          ? null
          : (listConditionsByMessage.get(
              listConditionsKey(request, conversationId, previousQ.id),
            ) ?? null);
      const listAskThisTurn =
        request.fitQuestion !== undefined ||
        request.discoverCompanies !== undefined ||
        request.investorProspects !== undefined;
      // Owner live 17 Nov 2026 (9995dcca): only a refinement of the list
      // just shown keeps its conditions; a new list ("outside my sectors,
      // keep them separate") starts from what it states (v91).
      const conditionsCarried =
        listAskThisTurn &&
        carriedConditions?.side === listSide &&
        refinesShownList(request);
      const listConditions = carriedListConditions(
        listConditionsOf(request),
        conditionsCarried ? (carriedConditions?.conditions ?? null) : null,
      );
      const conditionedTurn =
        request.writingDocument !== true &&
        request.askedAction === undefined &&
        (request.turnKind === undefined ||
          request.turnKind === "QUESTION_TO_Q") &&
        request.aboutNamedOther !== true &&
        (request.compare ?? null) === null &&
        compareTable === null;
      const founderListAsk =
        request.investorProspects ??
        (request.fitQuestion !== undefined && askerSideOf(request) === "FOUNDER"
          ? {
              text: request.fitQuestion.text,
              count: request.fitQuestion.count,
            }
          : undefined);
      const founderConditioned =
        !investorAsking &&
        hasAnyCondition(listConditions) &&
        founderListAsk !== undefined &&
        prepared.ownCompanyId !== null;
      const investorConditioned =
        investorAsking &&
        (needsConditionedLane(listConditions) ||
          // A carried exclusion: the conditioned lane applies it.
          (conditionsCarried && hasAnyCondition(listConditions))) &&
        (request.fitQuestion !== undefined ||
          request.discoverCompanies !== undefined);
      let listConditionsUnhonoured = false;
      if (
        conditionedTurn &&
        listConditions !== null &&
        (founderConditioned || investorConditioned)
      ) {
        const conditionedStarted = Date.now();
        const found =
          founderConditioned &&
          founderListAsk !== undefined &&
          prepared.ownCompanyId !== null
            ? await conditionedProspectsFor(
                founderListAsk,
                listConditions,
                prepared.ownCompanyId,
              )
            : await conditionedListFor({
                conditions: listConditions,
                within:
                  (request.fitQuestion?.previous === true ||
                    request.discoverCompanies?.previous === true) &&
                  shownBefore.length > 0
                    ? shownBefore
                    : null,
                count:
                  request.fitQuestion?.count ??
                  request.discoverCompanies?.count ??
                  null,
                discover:
                  request.discoverCompanies === undefined
                    ? null
                    : {
                        sectors: request.discoverCompanies.sectors,
                        countries: request.discoverCompanies.countries,
                        stages: request.discoverCompanies.stages,
                      },
              });
        if (found !== null) {
          const message = await persistCodeAnswer(
            found.text,
            found.block === null ? [] : [found.block],
          );
          keepListConditions(
            listConditionsKey(request, conversationId, message.id),
            { side: listSide, conditions: listConditions },
          );
          logger?.info(
            {
              qRunId: request.runId,
              side: founderConditioned ? "FOUNDER" : "INVESTOR",
              conditions: listConditions,
              carried: conditionsCarried,
              shown: Array.isArray(found.shown)
                ? found.shown.length
                : found.shown,
              unknown: found.unknown,
              excludedInContact: found.excludedInContact,
              toolCalls: found.calls.length,
              modelCalls: 0,
              conditionedMs: Date.now() - conditionedStarted,
              totalMs: Date.now() - startedAt,
            },
            "q answered a ranked list under the stated conditions",
          );
          return {
            kind: "ANSWERED",
            messageId: message.id,
            modelPolicyVersion: "none",
            promptBundleVersion: rendered.bundle.bundleVersion,
          };
        }
        // No lane can honour the condition: the full path answers, never
        // the plain list that ignores it.
        listConditionsUnhonoured = true;
        logger?.info(
          { qRunId: request.runId, conditions: listConditions },
          "q could not apply the stated list conditions by code; full path answers",
        );
      }
      // v58 (owner 2026-10-23): which investors their own company should
      // approach -- investors already interested, then likely fits from
      // what investors publish -- found by code, never from the company
      // record alone and never from an investor's private mandate.
      // F-133 (live bf1dcaa8, "Which investors fit me?" from a founder,
      // read as FIT): a fit question is fit with one's own mandate, and only
      // an investor has one. Asked by a founder with a company and no
      // investor side, it can only be which investors fit that company, so
      // it is that question, decided by who is asking, never by the words.
      // About one named investor, the full path answers it.
      const prospectsAsk =
        request.investorProspects ??
        (request.fitQuestion !== undefined &&
        // How they fit one named investor is not a list of investors.
        request.aboutNamedOther !== true &&
        askerSideOf(request) === "FOUNDER"
          ? {
              text: request.fitQuestion.text,
              count: request.fitQuestion.count,
            }
          : undefined);
      if (
        prospectsAsk !== undefined &&
        !listConditionsUnhonoured &&
        prepared.ownCompanyId !== null &&
        request.writingDocument !== true &&
        request.askedAction === undefined &&
        (request.turnKind === undefined || request.turnKind === "QUESTION_TO_Q")
      ) {
        const prospectsStarted = Date.now();
        const found = await prospectsFor(prospectsAsk, prepared.ownCompanyId);
        if (found !== null) {
          const message = await persistCodeAnswer(
            found.text,
            found.block === null ? [] : [found.block],
          );
          logger?.info(
            {
              qRunId: request.runId,
              shown: found.shown,
              modelCalls: 0,
              prepareMs: prepared.prepareMs,
              prospectsMs: Date.now() - prospectsStarted,
              totalMs: Date.now() - startedAt,
            },
            "q answered which investors to approach",
          );
          return {
            kind: "ANSWERED",
            messageId: message.id,
            modelPolicyVersion: "none",
            promptBundleVersion: rendered.bundle.bundleVersion,
          };
        }
      }
      /**
       * Owner 2026-10-23 (investor Zino Aviation): "find me three companies
       * I should look into" got three by name from the catalog. What they
       * want is the turn reader's to understand, never a phrase list: a
       * DISCOVER reading that ranks by fit with their mandate (ranking FIT
       * or mandateRelevant), naming no sector, country or stage, is ranked
       * by fit with their mandate, never the catalog's first companies by
       * name. F-60: the catalog's fit ranking answers it (below); the fit
       * sweep over their own candidates only when the catalog cannot.
       */
      const recommendAll =
        investorAsking &&
        request.discoverCompanies !== undefined &&
        request.discoverCompanies.previous !== true &&
        (request.discoverCompanies.ranking === "FIT" ||
          request.discoverCompanies.mandateRelevant) &&
        request.discoverCompanies.sectors.length === 0 &&
        request.discoverCompanies.countries.length === 0 &&
        request.discoverCompanies.stages.length === 0 &&
        // F-10: "raising now" is a filter only the catalog applies.
        request.discoverCompanies.raising !== true;
      /**
       * F-60 (QA 2026-10-23, savanna-seed): typed "five best fits" and
       * spoken "three that fit my mandate" ranked different companies at
       * the same moment: one reading reached the catalog's fit ranking
       * (every visible match), the other the fit sweep over the investor's
       * own candidates only. One ranking truth: an investor's unscoped ask
       * for the companies that fit them best -- a DISCOVER reading with no
       * filters, or a FIT question about no company in particular and not
       * about the cards shown -- is the catalog's fit ranking, the same
       * fit service's scores over every match. The sweep answers only
       * when the catalog cannot.
       */
      // Live 2026-11-13 (savanna-seed, "Compare Ajopot, Ledgerline and
      // Clinicrest side by side: ... fit with my mandate"): the reader read
      // a FIT question naming no single company, so the catalog's top ten
      // was appended under the comparison. A turn that compares the
      // companies it names is about those companies, never the catalog.
      const comparingNamed =
        (request.compare ?? null) !== null || compareTable !== null;
      const unscopedFit =
        investorAsking &&
        !comparingNamed &&
        request.discoverCompanies === undefined &&
        request.fitQuestion !== undefined &&
        request.fitQuestion.previous !== true &&
        request.fitQuestion.excludeShown !== true &&
        // v88: the sweep leaves their relationships out; the catalog's
        // ranking does not know them.
        request.excludeRelationships !== true &&
        request.aboutNamedOther !== true &&
        (request.namedOther ?? null) === null;
      const catalogAsk =
        request.discoverCompanies ??
        (unscopedFit && request.fitQuestion !== undefined
          ? {
              text: request.fitQuestion.text,
              sectors: [],
              countries: [],
              stages: [],
              count: request.fitQuestion.count,
              ranking: "FIT" as const,
              mandateRelevant: true,
              previous: false,
              raising: false,
            }
          : undefined);
      // K1 (live 2026-10-09 15:57): companies of a kind are listed from
      // the catalog by code; the analyst is never asked to describe cards.
      // Null (no catalog here): the full path answers.
      // F-109/F-110: a narrowing of Q's own list they did not ask to see on
      // Discover is answered here by code, whatever kind of turn it was
      // read as -- never by model rounds that refuse a filter and then
      // list the companies (16-28 s live).
      const rule = discoverRuleByRun.get(request.runId);
      const narrowingHere = rule?.narrowing === true && !rule.asked;
      if (
        catalogAsk !== undefined &&
        !listConditionsUnhonoured &&
        request.writingDocument !== true &&
        (narrowingHere ||
          // F-114: a narrowing read as "set the Discover filters" away
          // from Discover is answered here, in the thread.
          ((request.askedAction === undefined ||
            (request.askedAction === SET_DISCOVER_FILTERS_TOOL &&
              plan.screen?.route !== "DISCOVER")) &&
            (request.turnKind === undefined ||
              request.turnKind === "QUESTION_TO_Q")))
      ) {
        const discoverStarted = Date.now();
        const found = await discoverFor(catalogAsk);
        if (found !== null) {
          // Stress 2026-10-28 (J3): the question also named a company the
          // list does not hold ("…and whether LedgerBridge qualifies");
          // that half is answered too, from Capital Q's fit for it.
          const named = request.namedOther?.name.trim() ?? "";
          const onCards = answerCardCompanies(
            found.block === null ? [] : [found.block],
          ).some((card) => nameKey(card.name) === nameKey(named));
          const namedLine =
            investorAsking && named.length > 0 && !onCards
              ? await namedCompanyFitLine({
                  name: named,
                  tools,
                  context: toolContext,
                  // The executor authorises each read under this run's plan.
                  available: new Set([
                    "search_companies",
                    "fit_profile",
                    "get_company",
                  ]),
                  mandate: prepared.ownMandateData() ?? undefined,
                }).catch(() => null)
              : null;
          const message = await persistCodeAnswer(
            namedLine === null ? found.text : `${found.text}\n\n${namedLine}`,
            found.block === null
              ? []
              : [await withReaderSourceCounts(found.block)],
          );
          logger?.info(
            {
              qRunId: request.runId,
              basis: found.basis,
              asked: catalogAsk.count,
              cards: found.shown,
              toolCalls: found.calls.length,
              modelCalls: 0,
              sharedReads: singleFlight.takeShared(request.runId),
              prepareMs: prepared.prepareMs,
              discoverMs: Date.now() - discoverStarted,
              // Owner 2026-10-25: where discover's time went (ms by phase).
              discoverPhasesMs: found.phasesMs ?? null,
              totalMs: Date.now() - startedAt,
            },
            "q answered companies of a kind from the catalog",
          );
          return {
            kind: "ANSWERED",
            messageId: message.id,
            modelPolicyVersion: "none",
            promptBundleVersion: rendered.bundle.bundleVersion,
          };
        }
      }
      // The reader's FIT reading decides when the words alone did not
      // (live 2026-10-09: "three good examples of companies I can invest
      // in" was researched on the public web for 23-30 s).
      // K1: "which of those are strongest" over the cards just shown is the
      // same sweep, over exactly those companies.
      const readFit =
        request.fitQuestion ??
        (recommendAll && request.discoverCompanies !== undefined
          ? {
              text: request.discoverCompanies.text,
              count: request.discoverCompanies.count,
              previous: false,
            }
          : undefined) ??
        (request.discoverCompanies?.previous === true
          ? {
              text: request.discoverCompanies.text,
              count: request.discoverCompanies.count,
              previous: true,
            }
          : undefined);
      // v56: "three new ones" read after a prepare warmed on the words
      // alone: that sweep ranks the shown companies again, so the reading's
      // own sweep, which leaves them out, answers instead.
      const pastShown =
        readFit?.excludeShown === true &&
        shownInConversation.length > 0 &&
        !sweptExcludingShown;
      // v88: a prepare warmed on the words alone ranked their own
      // relationships in; the reading's sweep leaves them out.
      const pastRelationships =
        request.excludeRelationships === true && !sweptExcludingRelationships;
      // D17: the reading's exclusion, from this turn's own request (the
      // prepare's may predate the reading). With no fit question read
      // (a DISCOVER reading), their words are swept with it.
      const readSweepFit =
        request.excludeRelationships === true
          ? {
              ...(readFit ?? {
                text: latest.content,
                count: request.discoverCompanies?.count ?? null,
              }),
              excludeRelationships: true,
            }
          : readFit;
      // v90: "why do they fit?" is about the companies just shown; a sweep
      // warmed on the words alone may have read another set.
      const reasonsElsewhere =
        request.fitQuestion?.reasons === true &&
        shownBefore.length > 0 &&
        (await fitSweep)?.ask.scope !== "PREVIOUS";
      const swept = listConditionsUnhonoured
        ? null
        : (pastShown || pastRelationships || reasonsElsewhere) &&
            readSweepFit !== undefined
          ? await sweepForReading(readSweepFit)
          : recommendAll && readSweepFit !== undefined
            ? // The reading decides: the words' sweep may have read
              // "those" or nothing at all.
              await sweepForReading(readSweepFit)
            : ((await fitSweep) ??
              (readSweepFit === undefined || sweptAtPrepare
                ? null
                : await sweepForReading(readSweepFit)));
      /**
       * Owner 2026-10-23: "rank them, the top three based on my mandate"
       * after a list nobody could score came back as the same three,
       * unscored. Ranking against their mandate is the mandate's ranking:
       * when none of the companies shown can be scored, the sweep over
       * their candidates answers, and says why it is not those three.
       */
      const shownUnscorable =
        swept !== null &&
        swept.ask.scope === "PREVIOUS" &&
        (swept.ask.within?.length ?? 0) > 0 &&
        // The reader understood it as ranking against their mandate.
        (request.fitQuestion?.mandateRelevant === true ||
          request.discoverCompanies?.mandateRelevant === true) &&
        (fitSweepCardsBlock(
          swept.fits,
          "Fit against your mandate",
        )?.cards.every((card) => card.fit === null) ??
          true);
      // F-60: the mandate's ranking is the catalog's, as for any unscoped
      // ask, so "rank them by my mandate" names the same companies as
      // "top three that fit my mandate". The sweep is the fallback.
      if (
        shownUnscorable &&
        swept !== null &&
        investorAsking &&
        request.writingDocument !== true &&
        request.askedAction === undefined &&
        (request.turnKind === undefined || request.turnKind === "QUESTION_TO_Q")
      ) {
        const ranked = await discoverFor({
          text: latest.content,
          sectors: [],
          countries: [],
          stages: [],
          count: swept.ask.count,
          ranking: "FIT",
          mandateRelevant: true,
          previous: false,
          raising: false,
        });
        if (
          ranked !== null &&
          ranked.basis === "FIT" &&
          ranked.block !== null
        ) {
          rankedPastShown = true;
          const message = await persistCodeAnswer(
            `None of the companies I just listed has enough on record to score against your mandate yet. ${ranked.text}`,
            [ranked.block],
          );
          logger?.info(
            {
              qRunId: request.runId,
              cards: ranked.shown,
              toolCalls: ranked.calls.length,
              totalMs: Date.now() - startedAt,
            },
            "q answered a fit question from the catalog's ranking past unscorable cards",
          );
          return {
            kind: "ANSWERED",
            messageId: message.id,
            modelPolicyVersion: "none",
            promptBundleVersion: rendered.bundle.bundleVersion,
          };
        }
      }
      const reRanked =
        shownUnscorable && swept !== null
          ? await sweepCandidates(swept.ask.count)
          : null;
      const sweep =
        reRanked !== null && reRanked.fits.length > 0 ? reRanked : swept;
      const beyondShown =
        sweep !== null && (sweep.ask.exclude?.length ?? 0) > 0
          ? { count: sweep.ask.count }
          : undefined;
      // Live 23 Oct 2026 (run f5415b0c): "compare the top two side by
      // side", read as a fit question, was answered here by code from the
      // sweep's scores alone; the compare reads and the table never reached
      // it. A comparison resolved to its companies goes to the answer that
      // speaks from the table.
      const comparing = compareIds.length >= 2;
      if (
        !comparing &&
        // Owner live 18 Nov 2026: with their contacts left out and nothing
        // left, the model was handed the unfiltered list; said by code.
        (beyondShown !== undefined ||
          sweep?.ask.excludeRelationships === true) &&
        sweep !== null &&
        sweep.fits.length === 0 &&
        sweep.calls.some((call) => call.result.ok) &&
        request.questionKind === "FIT" &&
        request.writingDocument !== true &&
        request.askedAction === undefined &&
        (request.turnKind === undefined || request.turnKind === "QUESTION_TO_Q")
      ) {
        // Every company Capital Q can rank for them was already shown:
        // said plainly, never the same cards again (v56).
        const message = await persistCodeAnswer(
          sweep.ask.excludeRelationships === true
            ? "Leaving out the companies you're already in touch with, I don't have another one I can put against your mandate right now."
            : "Beyond the companies I've already shown you, I don't have another one I can put against your mandate right now.",
        );
        logger?.info(
          {
            qRunId: request.runId,
            scope: sweep.ask.scope,
            cards: 0,
            excluded: sweep.excluded,
            totalMs: Date.now() - startedAt,
          },
          "q answered a fit question: nothing left beyond those shown",
        );
        return {
          kind: "ANSWERED",
          messageId: message.id,
          modelPolicyVersion: "none",
          promptBundleVersion: rendered.bundle.bundleVersion,
        };
      }
      // TURN_READER v90 (owner live 17 Nov 2026, run 333d9645): "why are
      // they the strongest fits?" about the list just shown is answered
      // with the reasons from their fit profiles: no re-ranking, no tie
      // line and no card set again (the cards are on screen), so the
      // voice says the reasons too, never the list.
      const reasons =
        !comparing &&
        request.fitQuestion?.reasons === true &&
        request.questionKind === "FIT" &&
        sweep !== null &&
        sweep.ask.scope === "PREVIOUS" &&
        request.writingDocument !== true &&
        request.askedAction === undefined &&
        (request.turnKind === undefined || request.turnKind === "QUESTION_TO_Q")
          ? fitReasonsAnswer(sweep.fits)
          : null;
      if (reasons !== null && sweep !== null) {
        const message = await persistCodeAnswer(reasons);
        logger?.info(
          {
            qRunId: request.runId,
            explained: reasonSubjects(sweep.fits).length,
            fitCalls: sweep.calls.length,
            totalMs: Date.now() - startedAt,
          },
          "q answered why the companies shown fit, from their fit profiles",
        );
        return {
          kind: "ANSWERED",
          messageId: message.id,
          modelPolicyVersion: "none",
          promptBundleVersion: rendered.bundle.bundleVersion,
        };
      }
      if (
        !comparing &&
        sweep !== null &&
        sweep.ask.fitAsked &&
        // Only the existing structured reading can certify ranking alone.
        // A warmed lexical sweep must not erase a compound question.
        (request.questionKind === "FIT" || recommendAll) &&
        sweep.fits.length > 0 &&
        // Read again on the turn's own reading: the prepare may have been
        // warmed before the turn was read.
        request.writingDocument !== true &&
        request.askedAction === undefined &&
        (request.turnKind === undefined ||
          request.turnKind === "QUESTION_TO_Q" ||
          restatedListAsk(request))
      ) {
        // D17 (live 15 Nov 2026, run bef9a7f4): the card set is final
        // before a word of the summary is written. A company they asked to
        // leave out never reaches the cards or the prose, so the answer's
        // last check has nothing to drop and nothing contradicts it.
        const inTouchNow =
          request.excludeRelationships === true
            ? inContactOf(await accountDigest)
            : inContactOf(null);
        const inTouchFit = (fit: RunFit) =>
          inContactWith(inTouchNow, { id: fit.companyId, name: fit.name });
        const leftOutNow = new Set([
          ...sweep.excludedRelationships,
          ...sweep.fits.filter(inTouchFit).map((fit) => fit.companyId),
        ]);
        const finalFits = sweep.fits.filter((fit) => !inTouchFit(fit));
        // voice-cards: "the top three" is three cards, not ten.
        const swept = fitSweepCardsBlock(
          sweep.ask.count === null
            ? finalFits
            : finalFits.slice(0, sweep.ask.count),
          sweep.ask.place === null
            ? "Fit against your mandate"
            : `Fit against your mandate: ${sweep.ask.place}`,
        );
        // D7: "compare Ledgerfold and F2" is the comparison table, in the
        // order named, and is said as a comparison, never "ranked".
        const shaped =
          swept === null ? null : asComparison(swept, latest.content);
        const block =
          shaped === null ? null : await withReaderSourceCounts(shaped);
        if (block !== null) {
          const summary = fitSweepSummary({
            block,
            scope: sweep.ask.scope,
            place: sweep.ask.place,
            considered: sweep.considered,
            asked: latest.content,
            beyondShown,
            // The count as read, so "the five that best fit" names five.
            requested: sweep.ask.count,
          });
          const shownCount =
            sweep.ask.count === null
              ? finalFits.length
              : Math.min(sweep.ask.count, finalFits.length);
          // The network's ranking failed twice (logged above): what follows
          // is their own pipeline, and it is said to be.
          const fromPipeline =
            networkRankFailedOf() === null || sweep.ask.scope !== "CANDIDATES"
              ? ""
              : `I couldn't rank the whole network just now; here ${shownCount === 1 ? "is one" : `are ${String(shownCount)}`} from your own pipeline. `;
          // v88 (D1, D2): the answer itself says the exclusion it applied,
          // so nothing downstream can claim one that was not made.
          const leftOutLine =
            sweep.ask.excludeRelationships !== true &&
            request.excludeRelationships !== true
              ? ""
              : leftOutNow.size > 0
                ? `I've left out the ${leftOutNow.size === 1 ? "company" : `${String(leftOutNow.size)} companies`} you're already in touch with. `
                : "None of these is a company you're already in touch with. ";
          const text =
            leftOutLine +
            fromPipeline +
            (sweep === reRanked
              ? `None of the companies I just listed has enough on record to score against your mandate yet. Ranked by fit with your mandate, these are the strongest. ${summary}`
              : summary);
          rankedPastShown = sweep === reRanked;
          const message = await persistCodeAnswer(text, [block]);
          logger?.info(
            {
              qRunId: request.runId,
              scope: sweep.ask.scope,
              place: sweep.ask.place !== null,
              cards: block.cards.length,
              considered: sweep.considered,
              excluded: sweep.excluded,
              excludedRelationships: leftOutNow.size,
              fitCalls: sweep.calls.length,
              totalMs: Date.now() - startedAt,
            },
            "q answered a fit question from computed fits",
          );
          return {
            kind: "ANSWERED",
            messageId: message.id,
            modelPolicyVersion: "none",
            promptBundleVersion: rendered.bundle.bundleVersion,
          };
        }
      }
      // S2: reaching the model after skipping the wide reads because a code-
      // composed answer was expected (and above did not apply): read them now and prompt with
      // the same facts a turn that always read them would have had.
      if (
        withoutWideReads &&
        // T3: a follow-up answered from the card Q showed reads nothing more.
        coveredFollowUp === null &&
        (provisionalRoute.path !== "PREPARED_CONTEXT" || personByCode)
      ) {
        wideReads = await prepared.wide();
        assembled0 = await assemblePrompt(wideReads);
        facts = assembled0.facts;
        rendered = assembled0.rendered;
        nudgeOffered = assembled0.nudgeOffered;
      }
      const toolCalls: QToolCallObservation[] = [];
      // A platform lookup that found nobody. It is the whole reason the
      // research hop below exists: a company Capital Q does not hold is
      // usually a company that exists in the world, and answering "I have
      // no information" without looking is the failure people actually
      // hit. Set from the tool's own result, never from the model's words.
      let platformLookupFoundNothing = false;
      // Prospecting the platform could not answer well: the model asked who
      // might invest, and Capital Q holds fewer than a handful who fit.
      let prospectsThin = false;
      const notePlatformLookup = (outcome: QToolCallOutcome): void => {
        if (!outcome.result.ok) return;
        if (outcome.toolName === "investor.prospects") {
          const data = outcome.result.data as {
            prospects?: readonly unknown[];
          };
          if ((data.prospects?.length ?? 0) < PROSPECT_RESEARCH_BELOW) {
            prospectsThin = true;
          }
          return;
        }
        if (
          outcome.toolName !== "company.search" &&
          outcome.toolName !== "discovery.slate"
        ) {
          return;
        }
        const data = outcome.result.data as {
          items?: readonly unknown[];
          companies?: readonly unknown[];
          investors?: readonly unknown[];
        };
        const found =
          (data.items?.length ?? 0) +
          (data.companies?.length ?? 0) +
          (data.investors?.length ?? 0);
        if (found === 0) platformLookupFoundNothing = true;
      };

      // The public-web research hop's tool and trigger (below the loop),
      // also read inside it so a chained round never pre-empts it.
      const researchToolNow = (): QOfferedTool | undefined =>
        offeredByName.get("research_public_web") ??
        (prospectsThin && research?.fallback === true
          ? offeredForRun.find(
              (tool) => tool.definition.name === "research_public_web",
            )
          : undefined);
      const researchHopDue = (): boolean =>
        // An empty platform lookup earns a trip to the public web only
        // when the words name something to look up. A lookup comes back
        // empty for "what's up" too, and small talk was being followed
        // by three seconds on the web for nothing.
        (research?.mode === "EXPLICIT" ||
          (research?.mode === "ONLY_IF_EMPTY" &&
            platformLookupFoundNothing &&
            // An empty search is not an empty answer when the companies
            // the turn is about are already among the facts (live
            // 2026-10-01: 11-21 s on the public web for companies
            // Capital Q holds).
            onScreenCompany === null &&
            wideReads.namedCompanies.length === 0 &&
            // Coordinator 2026-10-25 (live 792fe626, "how do the top two
            // stack up?": three web searches, 6 s): a comparison code
            // resolved holds its companies' profiles, figures and fits;
            // it skips the wide reads, so it is not "empty" for that.
            compareTable === null) ||
          // The model asked the platform who might invest; it holds too
          // few. Investors exist in the world, so the world is asked too.
          (prospectsThin &&
            (research?.mode !== "NEVER" || research.fallback === true))) &&
        !toolCalls.some(
          (call) =>
            call.providerName === "research_public_web" ||
            // Filling the profile's gaps already searched.
            call.providerName === FILL_PROFILE_GAPS_TOOL,
        );

      // What the ranking engine produced for this turn, if the model asked
      // (CQ-REC-007R B). It is the recommendation guard's licence: with
      // these dimensions in hand, saying a company was surfaced and why is
      // a supported claim, and without them it is an invented one. Read
      // from the tool's own result, never from the model's words -- the
      // whole point is that the model does not get to decide whether a
      // recommendation happened.
      let recommendationGrounds: RecommendationGrounds | null = null;
      const noteRecommendationGrounds = (outcome: QToolCallOutcome): void => {
        if (!outcome.result.ok) return;
        if (outcome.toolName !== "recommendation.explanation") return;
        const data = outcome.result.data as {
          status?: string;
          matched?: readonly { dimension?: string }[];
          notMatched?: readonly { dimension?: string }[];
          unknown?: readonly { dimension?: string }[];
        };
        if (data.status !== "EXPLAINED") return;
        const dimensions = [
          ...(data.matched ?? []),
          ...(data.notMatched ?? []),
          ...(data.unknown ?? []),
        ]
          .map((factor) => factor.dimension)
          .filter((d): d is string => typeof d === "string" && d.length > 0);
        if (dimensions.length === 0) return;
        recommendationGrounds = {
          ...(recommendationGrounds ?? {}),
          dimensions,
        };
      };
      // ADR 0059: a score out of 10 or a band the fit tool computed this
      // turn may be repeated; it is Capital Q's number, not the model's.
      const noteFitGrounds = (outcome: QToolCallOutcome): void => {
        const computed = groundedFitWords(fitsInOutcome(outcome));
        if (computed.length === 0) return;
        recommendationGrounds = {
          dimensions: recommendationGrounds?.dimensions ?? [],
          computed: [
            ...new Set([
              ...(recommendationGrounds?.computed ?? []),
              ...computed,
            ]),
          ],
        };
      };

      /**
       * The guard's grounds now: what the model's own tool calls returned,
       * and every fit this run read, code's reads included (live
       * 2026-10-26: "How do the top two stack up?" read the two fits by
       * code, outside the model's tool round, so the scores on the cards
       * on screen were not Capital Q's own to the guard, and the true
       * sentence repeating one was removed).
       */
      const groundsNow = (): RecommendationGrounds | null => {
        const fits = groundedFitWords(runFits.read(request.runId));
        if (fits.length === 0) return recommendationGrounds;
        return {
          dimensions: recommendationGrounds?.dimensions ?? [],
          computed: [
            ...new Set([...(recommendationGrounds?.computed ?? []), ...fits]),
          ],
        };
      };

      const collectSources = (outcome: QToolCallOutcome): void => {
        if (
          (outcome.toolName !== "public_web.search" &&
            outcome.toolName !== "profile.gaps.fill") ||
          !outcome.result.ok
        ) {
          return;
        }
        const data = outcome.result.data as {
          sources?: readonly (PublicSourceLike & {
            readonly subjectMatch?: unknown;
            readonly mentionedCountries?: unknown;
            readonly excerpt?: unknown;
          })[];
        };
        for (const source of data.sources ?? []) {
          if (typeof source.domain === "string") {
            webEvidence.push({
              domain: source.domain,
              subjectMatch:
                typeof source.subjectMatch === "string"
                  ? source.subjectMatch
                  : null,
              countries: Array.isArray(source.mentionedCountries)
                ? source.mentionedCountries.filter(
                    (country): country is string => typeof country === "string",
                  )
                : [],
              text: typeof source.excerpt === "string" ? source.excerpt : null,
              title: typeof source.title === "string" ? source.title : null,
            });
          }
          // Only a well-formed public source is presentable; anything else
          // stays in the tool transcript as data and is never cited.
          if (
            typeof source.url !== "string" ||
            typeof source.domain !== "string" ||
            typeof source.retrievedAt !== "string" ||
            typeof source.index !== "number"
          ) {
            continue;
          }
          if (
            typeof source.url === "string" &&
            typeof source.subjectMatch === "string"
          ) {
            pageSubjectMatch.set(source.url, source.subjectMatch);
          }
          if (!publicSources.some((known) => known.url === source.url)) {
            publicSources.push({
              index: source.index,
              url: source.url,
              domain: source.domain,
              title: source.title,
              publishedAt: source.publishedAt,
              retrievedAt: source.retrievedAt,
            });
          }
        }
      };
      let modelCalls = 0;
      // What Capital Q says about a change approved by conversation this
      // turn, from the approve tool's result (live 2026-09-27 #1, #2).
      let approvalLine: string | null = null;
      /**
       * fill_profile_gaps (HARDEN P0, live 2026-10-02): the reply is the
       * tool's own line. A first call's line ("couldn't settle values")
       * stands only when no second call followed.
       */
      /** ADR 0040: what each app action that ran said, in its own words. */
      const actedLines: string[] = [];
      /** XLSX-002: what a document tool made, in its own words; said first. */
      const madeLines: string[] = [];
      /**
       * An app action prepared a card this turn: the engine says its status
       * after the turn, so the model's own approval talk goes (lead
       * 2026-10-03: one status per card per answer).
       */
      let preparedByTool = false;
      // Batch 19: each prepared change's own line (what it will change, in
      // the card's words), and whether every change acted on was their own.
      const preparedLines: string[] = [];
      let ownRecordsOnly: boolean | null = null;
      /**
       * A card is waiting for their approval from this turn (any tool's,
       * the email's Capital Q message instead, or a first contact): the
       * card is the answer's substance, so no second writer adds findings
       * beside it (coordinator 2026-10-26, run 42cecfd2: the extras call
       * ran 0.9 s past the answer on an email card).
       */
      let cardPrepared = false;
      /** Code prepared the first contact this run (QO-08): the reply is code's, not the model's. */
      let firstContactPrepared = false;
      /** B2: the message they asked for is on its card; the reply is code's. */
      let askedMessageReply: string | null = null;
      /** Their interest already stands (sent, or connected): its own line. */
      let firstContactAlready: string | null = null;
      /** Their own Q Card as get_q_card read it this turn (batch 9). */
      let qCardRead: QCardRead | null = null;
      /** QA F10: the claim really was prepared, so a card is on screen. */
      let qCardClaimPrepared = false;
      let gaps: { readonly status: string; readonly line: string } | null =
        null;
      // The order matters more than the words: a model handed tools and a
      // response shape at once reaches for the shape first.
      // What this run can do and what the conversation already produced,
      // as facts: the model claims neither more nor less (CQ-QX-008).
      // Right after the prompt, so the tools-first note stays last.
      const receipts = await receiptsRead;
      const capabilities = capabilityNote(
        request.capabilities,
        offered.map((tool) => ({
          name: tool.definition.name,
          description: tool.definition.description,
          classification: tool.classification,
        })),
        receipts,
        plan.screen,
      );
      const workNote: readonly ModelMessage[] = workQuestion
        ? [{ role: "SYSTEM", content: Q_WORK_LINE }]
        : [];
      let messages: ModelMessage[] =
        offered.length === 0
          ? [
              ...rendered.messages,
              capabilities,
              ...workNote,
              CONVERSATION_FINDINGS_NOTE,
            ]
          : [
              ...rendered.messages,
              capabilities,
              ...workNote,
              CONVERSATION_FINDINGS_NOTE,
              // Owner 2026-10-21: a typed answer stays short and a long one
              // becomes an offered document; said with the answer's own
              // instructions, outside the bounded notes.
              request.spoken !== true &&
              request.writingDocument !== true &&
              request.turnUnread !== true
                ? {
                    ...TOOLS_FIRST_NOTE,
                    content: `${TOOLS_FIRST_NOTE.content} ${LONG_ANSWER_NOTE}`,
                  }
                : TOOLS_FIRST_NOTE,
            ];
      // Step 6: the claim check's sources, read live as tool rounds add
      // their results. Everything the model was given except Capital Q's
      // own instructions, plus the lines code itself said in this answer.
      const instructionMessages = new Set<ModelMessage>([
        ...rendered.messages.filter((message) => message.role === "SYSTEM"),
        capabilities,
        ...workNote,
        CONVERSATION_FINDINGS_NOTE,
      ]);
      // Step 10: the task message's template is instructions too; only
      // the values rendered into it are sources (templateValues).
      // A task whose fixed rules travel as instructions (rulesEndBefore)
      // renders its user message from the template's remainder.
      const analystDefinition =
        registry.getActive("COMPANY_ANALYST").definition;
      const analystRules = templateRulesHead(analystDefinition);
      const taskTemplate =
        analystRules === null
          ? analystDefinition.template
          : analystDefinition.template.slice(analystRules.length).trimStart();
      gateqToolResults = () => messages;
      // Q's own record of this conversation (its summary and ledger): an
      // echo of what Q said, never a source a count is bound to.
      const ownRecordNotes = new Set<ModelMessage>();
      claimEchoes = () => [
        ...earlier
          .filter((message) => message.role === "Q")
          .map((message) => message.content),
        ...[...ownRecordNotes].map((message) => message.content),
        // Live re-check on a65386689 (run 91bb8564): recall carried Q's
        // own replies and summaries from two earlier conversations ("Q
        // said: ... 4 public-sector account managers"), rendered into the
        // task message, and they bound the wrong count as if a document
        // had said it. What memory recalls is talk, not the document: an
        // echo. Their own past words still ground (recalledOwnWords).
        memory,
      ];
      claimSources = () => [
        ...facts.map((fact) => fact.statement),
        latest.content,
        // Step 9: their own words from earlier conversations, verbatim.
        ...recalledOwnWords,
        // The pages earlier turns of this conversation read: the document
        // a follow-up's counts are held to (live 7e866011).
        ...fetchedDocumentTexts(request.fetchedInConversation ?? []),
        ...earlier
          .filter((message) => message.role !== "Q")
          .map((message) => message.content),
        ...messages
          .filter(
            (message) =>
              !instructionMessages.has(message) && !ownRecordNotes.has(message),
          )
          .map((message) =>
            rendered.messages.includes(message)
              ? templateValues(message.content, taskTemplate)
              : message.content,
          ),
        ...(leadLines === undefined ? [] : [leadLines]),
        ...(earlyLead === null ? [] : [earlyLead]),
        ...(compareVerdict === null ? [] : [JSON.stringify(compareVerdict)]),
      ];
      claimSourceKinds.read = () => ({
        facts: facts.length,
        retrieved: retrievedPassages,
        documentRows: documentRowFactCount,
        documents:
          documentTextCount +
          messages.filter(
            (message) =>
              message.role === "TOOL" && message.content.includes('"pages":['),
          ).length,
        toolResults: messages.filter(
          (message) =>
            message.role === "TOOL" && !instructionMessages.has(message),
        ).length,
        ownWords: recalledOwnWords.length,
        memory: memory.trim().length > 0 ? 1 : 0,
        earlierReplies: earlier.filter((message) => message.role === "Q")
          .length,
        ownRecord: ownRecordNotes.size,
      });

      // Owner 2026-10-22: typed answers have their findings and cards
      // written beside them (parallel-extras.ts). Not spoken (three
      // findings at most, and the speculation gate), not a document.
      // Coordinator 2026-10-25 (I21): a comparison code resolved has no
      // second writer. Its table and verdict are the comparison; the
      // extras' cards and findings restated it (849 tokens, and the settle
      // waited 8.75 s for them), so the one writer leaves them out.
      // Coordinator 2026-10-26 (B): an asked note or email has no second
      // writer. The prepared card is the answer; the extras restated it,
      // and one started on the round's prose was cancelled when that
      // round turned to its tools (run 42cecfd2, a 0-token call).
      const splitExtras =
        !asksForMessage(request.askedAction) &&
        dependencies.parallelExtras === true &&
        request.spoken !== true &&
        request.writingDocument !== true &&
        request.turnUnread !== true &&
        compareTable === null &&
        // RC3: a lane budgeted at one answer call (a short follow-up, an
        // acknowledgement, a question about what is prepared) is written by
        // one call, never split into a second writer.
        (request.executionClass === undefined ||
          EXECUTION_LANES[request.executionClass].answerModelCalls > 1);
      // Before the tools-first note, which stays last where there is one.
      const whoWritesExtras = splitExtras
        ? EXTRAS_ELSEWHERE_NOTE
        : compareTable !== null
          ? TABLE_IS_THE_COMPARISON
          : null;
      if (whoWritesExtras !== null) {
        messages =
          offered.length === 0
            ? [...messages, whoWritesExtras]
            : [
                ...messages.slice(0, -1),
                whoWritesExtras,
                ...messages.slice(-1),
              ];
      }

      if (ownProfileCall !== null) {
        toolCalls.push(ownProfileCall);
      }
      if (relationshipCall !== null) {
        toolCalls.push(relationshipCall);
      }
      if (onScreenCompanyCall !== null) {
        toolCalls.push(onScreenCompanyCall);
      }
      toolCalls.push(...onScreenCompanyFigureCalls);
      toolCalls.push(...wideReads.namedCompanyCalls);
      if (onScreenDocumentCall !== null) {
        toolCalls.push(onScreenDocumentCall);
      }
      toolCalls.push(...onScreenPageCalls);
      if (onScreenDailyCall !== null) {
        toolCalls.push(onScreenDailyCall);
      }
      toolCalls.push(...wideReads.ownDayCalls);
      if (wideReads.ownStandingCall !== null) {
        toolCalls.push(wideReads.ownStandingCall);
      }
      if (ownProfile !== null || wideReads.onboardingFacts.length > 0) {
        messages = [...messages, OWN_MANDATE_NOTE];
      }
      // RECOVERY-2026-10 B6: what their words point at, bound by code to
      // records they already saw ("the second one", "compare those two",
      // "him"). Ids, so a tool can read the record; it grants nothing.
      if (request.references !== undefined) {
        messages = [...messages, referencesNote(request.references)];
      }
      // Q intelligence step 2: who and what this conversation has named,
      // in order, with corrections, as Capital Q's own record.
      if (request.conversationState !== undefined) {
        const stateNote = conversationStateNote(request.conversationState);
        ownRecordNotes.add(stateNote);
        messages = [...messages, stateNote];
      }
      // Owner live 2026-10-17: what Q already showed here, as context.
      // The earlier research goes in its own note (below), whole; the
      // compact record would cut its pages to a few words each.
      const shownNote = shownContextNote(
        earlier,
        earlierPages.length === 0
          ? request.fetchedInConversation
          : request.fetchedInConversation?.filter(
              (fetch) => fetch.toolName !== RESEARCH_TOOL_NAME,
            ),
      );
      if (shownNote !== null) messages = [...messages, shownNote];
      const pagesNote = earlierResearchNote(earlierPages);
      if (pagesNote !== null) messages = [...messages, pagesNote];
      // C's request: whether Q's last screen acts happened, from the
      // browser's receipts, so Q says so honestly next turn.
      const screenActs = screenActsNote(screenReceipts);
      if (screenActs !== null) messages = [...messages, screenActs];

      type AnswerResult = Awaited<
        ReturnType<typeof gateway.execute<CompanyAnalystV30Result>>
      >;

      /**
       * The extras' writer for the round that is answering. Started from
       * that round's own messages, so it reads exactly what the answer's
       * writer reads; cancelled when the round turns out not to be the
       * answer (one more round is asked), and with the run.
       */
      let roundMessages: readonly ModelMessage[] | null = null;
      let extras: {
        readonly started: number;
        readonly read: readonly ModelMessage[];
        readonly stop: AbortController;
        readonly result: Promise<AnswerResult | null>;
      } | null = null;
      let extrasFindings = createPartialFindingsReader();
      const cancelExtras = (): void => {
        extras?.stop.abort();
        extras = null;
        extrasSeen = "";
      };
      const startExtras = (): void => {
        if (
          !splitExtras ||
          extras !== null ||
          roundMessages === null ||
          preparedByTool ||
          cardPrepared
        ) {
          return;
        }
        const read = extrasMessages(roundMessages);
        const stop = new AbortController();
        const started = Date.now();
        extrasFindings = createPartialFindingsReader();
        modelCalls += 1;
        const result = gateway
          .execute<CompanyAnalystV30Result>(
            // The side fields run beside the answer and must not become
            // the slowest call: they never think (step 7).
            {
              ...unthinking,
              messages: read,
              output: extrasOutput(rendered.output),
            },
            {
              ...options,
              // Its own fields only (parallel-extras.ts); code fills the rest.
              schema: NARROWED_ANALYST_SCHEMA,
              signal:
                request.signal === undefined
                  ? stop.signal
                  : AbortSignal.any([request.signal, stop.signal]),
              onTextDelta: (fragment: string): void => {
                if (stop.signal.aborted) return;
                extrasSeen += fragment;
                for (const raw of extrasFindings.push(extrasSeen)) {
                  showLive(raw);
                }
              },
            },
          )
          .catch((error: unknown): null => {
            if (!stop.signal.aborted) {
              logger?.warn(
                {
                  qRunId: request.runId,
                  failure: isModelGatewayError(error)
                    ? error.failureClass
                    : "UNKNOWN",
                },
                "the extras' call failed; the answer goes without its findings and cards",
              );
            }
            return null;
          });
        extras = { started, read, stop, result };
      };
      onAnswerBegins = startExtras;
      const currentExtras = (): typeof extras => extras;

      try {
        let final: AnswerResult | undefined;
        let analyst: CompanyAnalystV30Result | undefined;
        // Lead 2026-10-16: the early grounded line is said now, as the
        // model is asked, not after its tool round (first text 6-8 s).
        if (earlyLead !== null && leadLines === undefined) {
          leadLines = earlyLead;
          leadListOpen = true;
          sayLeadLines();
        }
        // Owner 2026-10-30 ("What should I do today?", answer at 11-13 s):
        // the caller's own opening lines (their priorities, composed by
        // code before the model is asked) waited for the model's first
        // sentence, which comes only after its tool rounds (2-6 s, nothing
        // streamed). They are code's, true now and opening the stored
        // answer whatever the model writes, so they go out now.
        if (request.leadLines !== undefined && leadLines !== undefined) {
          sayLeadLines();
          took("lead-said");
        }

        /**
         * The public web read by code (see below), once per turn: the
         * stage, the call under this run's tool context, and its result in
         * front of the model as Capital Q's own read.
         */
        const researchHop = async (
          researchTool: QOfferedTool,
        ): Promise<void> => {
          // The stage goes out as the search starts, beside it.
          const stageWrite =
            researchTool.visibleStage === undefined ||
            researchTool.visibleStage === null
              ? null
              : stageOnce(researchTool.visibleStage);
          // Enough pages to answer from, not only to compare.
          const call = researchCallOf(prospectsThin ? 5 : 4);
          took("beforeResearch");
          const fresh = readCache.get(call, toolContext) === null;
          const searching = callTool(call, toolContext);
          if (fresh) sayResearching(call.arguments, searching);
          const [outcome] = await Promise.all([searching, stageWrite]);
          took("research");
          landResearch(call, outcome);
        };
        /** A public-web result code fetched, put in front of the model. */
        const landResearch = (
          call: { readonly name: string; readonly arguments?: unknown },
          landed: QToolCallOutcome,
        ): void => {
          // Again as it reaches the answer: their record may have been read
          // only after the search returned.
          const outcome = aboutThemOnly(
            {
              callId: "q-research",
              name: call.name,
              arguments: call.arguments,
            },
            request.runId,
            landed,
            latest.content,
          );
          toolCalls.push({
            toolName: outcome.toolName,
            providerName: call.name,
            status: outcome.status,
            failureCode: outcome.failureCode,
            latencyMs: outcome.latencyMs,
          });
          collectSources(outcome);
          // Owner 2026-10-24 ("Which is better, Anchor or Afyascan?" was
          // answered with "the web search added nothing relevant about
          // either company"): a search that found nothing about them, on a
          // turn whose Capital Q records were read, is not put in front of
          // the answer at all -- the records answer it, and nothing is said
          // about the web. Recorded above, so it is not asked again.
          if (
            webFoundNothing(outcome) &&
            runCompanies.read(request.runId).profiles.size > 0
          ) {
            logger?.info(
              { qRunId: request.runId },
              "q public search found nothing; answered from the records alone",
            );
            return;
          }
          messages = [
            ...messages,
            fetchedForYouMessage(call.name, outcome),
            ...(prospectsThin && outcome.result.ok
              ? [PROSPECT_RESEARCH_NOTE]
              : []),
            earlyWeb?.remembered === true && call === earlyWeb.call
              ? ALREADY_SEARCHED_NOTE
              : WEB_BESIDE_RECORDS_NOTE,
          ];
        };
        const writingStage: QVisibleStage =
          request.writingDocument === true
            ? "PREPARING_DOCUMENT"
            : "PREPARING_ANALYSIS";
        // The companies the turn names were read by code, beside the web
        // search already running: the answer is written from both in one
        // call, with no tool round in front of it (a round would only
        // answer without the web, and every round pays the whole prompt).
        const readsAndWebSuffice =
          earlyWebPending() && wideReads.namedCompanies.length > 0;
        if (offered.length > 0 && !readsAndWebSuffice) {
          took("prepare");
          let rounds = 0;
          let calls = 0;
          // Step 8: a turn read as deep work (analysis, comparison, a
          // document) may chain up to five rounds within a time budget;
          // every other turn keeps the standard two. Same tools, same
          // authorisation, same firewall (tool-loop-budget.ts).
          const loopBudget = toolLoopBudget({
            kinds: readAnswerKinds(request),
            taskClass: budgetClass,
            standardRounds: Q_TOOL_LOOP_MAX_ROUNDS,
            standardCalls: Q_TOOL_LOOP_MAX_CALLS,
            startedAt: Date.now(),
          });
          /**
           * Guard run on 2632e2cb9 (runs 5728c8df, 0ce9c2bc): a tool the run
           * may use but did not offer up front (it loads on demand) is
           * loaded when code's follow-on needs it, or when a refusal names
           * it as the right one, exactly as use_capability loads it: offered
           * to the model, and named in the focus it executes under.
           */
          const offerFromRun = (
            names: readonly string[],
          ): readonly QOfferedTool[] => {
            const loaded = (availableForRun ?? []).filter(
              (tool) =>
                names.includes(tool.definition.name) &&
                !offeredByName.has(tool.definition.name) &&
                // Never an approval card on a turn that asks for no action.
                !(
                  request.asksNoAction === true && tool.preparesCard === true
                ) &&
                // An unread turn never loads the public web either.
                !(
                  request.turnUnread === true &&
                  PUBLIC_WEB_TOOLS.has(tool.definition.name)
                ),
            );
            if (loaded.length === 0) return [];
            offered = [...offered, ...loaded].slice(0, MODEL_TOOLS_MAX);
            for (const tool of loaded) {
              offeredByName.set(tool.definition.name, tool);
            }
            const focus = toolContext.focus ?? { areas: [], tools: [] };
            toolContext = {
              ...toolContext,
              focus: {
                ...focus,
                tools: [
                  ...focus.tools,
                  ...loaded.map((tool) => tool.definition.name),
                ],
              },
            };
            return loaded;
          };
          /** Offered now, or loaded for this follow-on from the run's tools. */
          const canOffer = (name: string): boolean =>
            offeredByName.has(name) || offerFromRun([name]).length > 0;
          /**
           * Profiles code read after a search resolved to one company
           * (chained-read.ts), by company id: a later get_company for the
           * same id is answered from here rather than read again.
           */
          const chainedReads = new Map<string, Promise<QToolCallOutcome>>();
          const runCall = (call: ModelToolCall): Promise<QToolCallOutcome> => {
            // The model is sent its plan class's whole catalogue (cache);
            // only what this turn offers runs. The gateway refuses anything
            // else first; this is the same rule where the call executes.
            if (!offeredByName.has(call.name)) {
              return Promise.resolve(notOfferedThisTurn(call));
            }
            // The model's first public-web call is the search already
            // running for this turn: answered by it, not asked again.
            if (
              call.name === PUBLIC_WEB_TOOL &&
              earlyWeb !== null &&
              !earlyWeb.claimed
            ) {
              earlyWeb.claimed = true;
              const early = earlyWeb.call;
              return earlyWeb.outcome.then((outcome) => ({
                ...aboutThemOnly(early, request.runId, outcome, latest.content),
                callId: call.callId,
              }));
            }
            // Said only when the web is really asked (not answered from
            // what this person already read).
            const researching =
              call.name === PUBLIC_WEB_TOOL &&
              readCache.get(call, toolContext) === null;
            const companyId = (
              call.arguments as { readonly companyId?: unknown } | null
            )?.companyId;
            const kept =
              CHAINED_READ_TOOLS.includes(call.name) &&
              typeof companyId === "string"
                ? chainedReads.get(chainedKey(call.name, companyId))
                : undefined;
            const called =
              kept !== undefined
                ? kept.then((outcome) => ({ ...outcome, callId: call.callId }))
                : callTool(
                    {
                      callId: call.callId,
                      name: call.name,
                      arguments: call.arguments,
                    },
                    toolContext,
                  );
            if (researching) sayResearching(call.arguments, called);
            return called;
          };
          // One more round, once, when every call of a round was refused
          // or failed: the model picked the wrong tool and has no way to
          // pick again (live smoke 2026-10-01: "which documents have you
          // made me" called relationship.get, was denied, and the answer
          // could only promise "I'll check"). Costs a call only then.
          let recoveryRounds = 0;
          // One more round, once, when the answer described doing
          // something instead of calling the tool that does it.
          let sayDoRounds = 0;
          /** Q's line before this turn: what a "yes" here says yes to. */
          const lastQText =
            [...earlier].reverse().find((message) => message.role === "Q")
              ?.content ?? null;
          /** What they asked: this turn and their last few before it. */
          const askedNow = askedOf(latest.content, earlier);
          /** Work this turn started or prepared (a non-read tool succeeded). */
          const startedWork = (): boolean =>
            toolCalls.some((call) => {
              const kind = offeredByName.get(call.providerName)?.classification;
              return (
                call.status === "SUCCEEDED" &&
                kind !== undefined &&
                kind !== "READ_ONLY" &&
                kind !== "ANALYTICAL"
              );
            });
          // One more round, once, after fill_profile_gaps searched: the
          // second call carries the values the sources support.
          let gapsRounds = 0;
          // One more round, once, after use_capability loaded a tool: the
          // model calls it in the next step of the same turn.
          let loadRounds = 0;
          // One more round, once, after a refusal named the right tool.
          let redirectRounds = 0;
          let textRound = false;
          /** A read of their own records found something (owned-first.ts). */
          let ownedFound = false;
          /**
           * The chained look-up rounds beyond the first
           * (Q_TOOL_LOOP_MAX_ROUNDS). Never after public-web content was
           * read (D/E: a retrieved page is data; the round after it holds
           * no tools), and never in place of the research hop below: when
           * the platform came back empty, the world is asked before Q
           * answers.
           */
          const chainedRoundAllowed = (): boolean =>
            !toolCalls.some(
              (call) => call.providerName === "research_public_web",
            ) && !(researchToolNow() !== undefined && researchHopDue());
          /**
           * Guard F-106-reshown-card (2026-10-26, run 61b1fa6d): "Draft a
           * short reply … then send it" spent both rounds on reads, and the
           * answer after them, with no tools, wrote the reply out instead
           * of preparing it. The message they asked for, not yet tried:
           * one more round, once, to prepare it on its card.
           */
          let askedRounds = 0;
          const askedRoundDue = (): boolean => {
            const asked = request.askedAction;
            if (
              askedRounds > 0 ||
              // Told once already, by the draft round below.
              sayDoRounds > 0 ||
              asked === undefined ||
              !MESSAGE_TOOLS.has(asked) ||
              !offeredByName.has(asked) ||
              toolCalls.some(
                (call) =>
                  MESSAGE_TOOLS.has(call.providerName) ||
                  call.providerName === FIRST_CONTACT_TOOL,
              ) ||
              calls >= loopBudget.maxCalls ||
              request.signal?.aborted === true
            ) {
              return false;
            }
            askedRounds = 1;
            messages = [...messages, prepareMessageNote(asked)];
            logger?.info(
              { qRunId: request.runId, asked },
              "the message they asked for, not tried: one more round to prepare it",
            );
            return true;
          };
          while (
            (rounds <
              1 +
                (chainedRoundAllowed()
                  ? loopBudget.maxRounds(Date.now()) - 1
                  : 0) +
                recoveryRounds +
                sayDoRounds +
                gapsRounds +
                loadRounds +
                redirectRounds +
                askedRounds &&
              calls < loopBudget.maxCalls) ||
            askedRoundDue()
          ) {
            modelCalls += 1;
            // A round that began answering and was asked again: its extras
            // were for an answer nobody gets.
            cancelExtras();
            roundMessages = messages;
            // Visible stages: the model is now working on the answer.
            if (rounds === 0) void stageOnce(writingStage);
            let result: Awaited<
              ReturnType<typeof gateway.execute<CompanyAnalystV30Result>>
            >;
            try {
              result = await gateway.execute<CompanyAnalystV30Result>(
                {
                  ...base,
                  messages,
                  /**
                   * The answer's schema beside the tools (live 2026-10-01:
                   * as text, 5 of 8 first rounds came back in a shape the
                   * schema refused, and each paid a second full call). The
                   * OpenAI adapter sends both; the Gemini and Groq ones,
                   * which refuse that pairing, send the tools and leave the
                   * shape to the prompt. Either way the reply is accepted by
                   * the same Zod schema as the call below.
                   */
                  // After a structured refusal this turn, the round asks
                  // in text, tools kept (parity eval 2026-10-02).
                  output: textRound
                    ? ({ kind: "TEXT" } as const)
                    : answerOutput(),
                  // K7 and model spend 18 Nov: the plan class's stable
                  // catalogue in one order; this turn's offer is what may
                  // be called.
                  ...toolBlockFor(catalogue, offered, MODEL_TOOLS_MAX),
                },
                roundOptions(),
              );
            } catch (error: unknown) {
              if (roundStoppedForWeb()) {
                logger?.info(
                  { qRunId: request.runId, rounds },
                  "q round began answering while the web search ran; answered once the web lands",
                );
                break;
              }
              // Groq validates a model's tool call against the declared
              // schema and refuses the whole request when the model got it
              // wrong (tool_use_failed) — including on turns that never
              // needed a tool at all. That is the model's output failing,
              // not the person's question: the answer is produced without
              // tools instead of the run failing (CQ-PRE-REC-001 §8).
              if (
                isModelGatewayError(error) &&
                error.failureClass === "INVALID_MODEL_OUTPUT"
              ) {
                // A structured answer the schema refused (parity eval
                // 2026-10-02: "answer:too_small" -- an empty answer where
                // the model meant to act) is not a reason to take the tools
                // away: the round is asked once more in text, tools kept,
                // and only then is the answer written without them.
                if (!textRound) {
                  textRound = true;
                  logger?.warn(
                    { qRunId: request.runId, rounds, calls },
                    "tool round's structured answer refused; asking again in text with the tools",
                  );
                  continue;
                }
                logger?.warn(
                  { qRunId: request.runId, rounds, calls },
                  "tool round refused by the provider; answering without tools",
                );
                break;
              }
              cancelExtras();
              throw error;
            }
            took(`round${String(rounds)}`);
            /**
             * Said instead of done. The answer talks about doing something
             * (actionTalk) while tools that could do it are in hand and
             * nothing was called: one more round, with a trusted note to do
             * it rather than describe it (founder live 2026-10-01: "what
             * are these companies, can you list them" was answered "I need
             * to retrieve your discovery slate first" instead of calling
             * discovery_slate). Read from the answer's own structure, never
             * from its words; once. Talk about a change that was in fact
             * prepared this turn (a PREPARE or SIDE_EFFECT tool succeeded)
             * is not a gap.
             */
            /**
             * Owner conversation 2026-10-24: asked for (or told yes to) a
             * look-up, the answer offered to do it or promised it for
             * later, with nothing started. One round to do it now.
             */
            const deferredInsteadOfDone = (
              value: CompanyAnalystV30Result,
            ): boolean =>
              defersAskedWork(value.answer, askedNow, lastQText) &&
              !startedWork() &&
              sayDoRounds === 0 &&
              calls < loopBudget.maxCalls &&
              request.signal?.aborted !== true;
            const saidInsteadOfDone = (
              value: CompanyAnalystV30Result,
              dropped: readonly string[] | undefined,
            ): boolean =>
              (value.actionTalk.length > 0 ||
                (dropped ?? []).some((path) =>
                  path.startsWith("actionTalk"),
                )) &&
              !toolCalls.some((call) => {
                const kind = offeredByName.get(
                  call.providerName,
                )?.classification;
                return (
                  call.status === "SUCCEEDED" &&
                  kind !== undefined &&
                  kind !== "READ_ONLY" &&
                  kind !== "ANALYTICAL"
                );
              }) &&
              sayDoRounds === 0 &&
              calls < loopBudget.maxCalls &&
              request.signal?.aborted !== true;
            /**
             * Asked what the screen already answers. The answer puts a
             * question back to the person while their screen shows a
             * company, investor or document (founder live 2026-10-01: on
             * Kazikit's page "get me a meeting with this person" got "who
             * should I arrange the meeting with?"). One more round, with
             * the screen's subject named as the referent; a question about
             * something else (a time, an amount) is kept. From the
             * answer's structure and the screen, never the words; once.
             */
            const screenNote = screenSubjectNote(plan.screen);
            const askedWhatScreenShows = (
              value: CompanyAnalystV30Result,
            ): boolean =>
              screenNote !== null &&
              value.clarifyingQuestions.length > 0 &&
              sayDoRounds === 0 &&
              calls < loopBudget.maxCalls &&
              request.signal?.aborted !== true;
            /**
             * Guard run 1 (2026-10-25, run b6f9236c): "Draft a short update
             * email to Savanna Seed Partners…" was answered with the whole
             * email written out, then "I didn't prepare that". The reading
             * named the message tool (askedAction), it was offered, and
             * nothing was prepared: one more round to put those words on
             * the card for their approval. Never sent without it.
             */
            const draftedNotPrepared = (): boolean => {
              const asked = request.askedAction;
              return (
                asked !== undefined &&
                MESSAGE_TOOLS.has(asked) &&
                offeredByName.has(asked) &&
                !toolCalls.some(
                  (call) =>
                    MESSAGE_TOOLS.has(call.providerName) ||
                    call.providerName === FIRST_CONTACT_TOOL,
                ) &&
                sayDoRounds === 0 &&
                askedRounds === 0 &&
                calls < loopBudget.maxCalls &&
                request.signal?.aborted !== true
              );
            };
            const askToDoIt = (
              said: string,
              note: ModelMessage = SAY_DO_NOTE,
            ): void => {
              // Live 2026-10-31 ("What should I do today?", run 50326c66):
              // a round that began answering was asked again (5.5 s, then
              // 3.8 s more) and nothing said why. Which check asked it.
              logger?.info(
                {
                  qRunId: request.runId,
                  rounds,
                  calls,
                  reason:
                    note === SAY_DO_NOTE
                      ? "SAID_NOT_DONE"
                      : note === DO_IT_NOW_NOTE
                        ? "DEFERRED"
                        : note === screenNote
                          ? "SCREEN_SUBJECT"
                          : "NOT_PREPARED",
                },
                "q round asked again",
              );
              sayDoRounds = 1;
              rounds += 1;
              messages = [
                ...messages,
                { role: "ASSISTANT", content: said },
                note,
              ];
            };
            if (result.output.kind === "STRUCTURED") {
              if (draftedNotPrepared()) {
                askToDoIt(
                  JSON.stringify(result.output.value),
                  prepareMessageNote(request.askedAction ?? ""),
                );
                continue;
              }
              if (deferredInsteadOfDone(result.output.value)) {
                askToDoIt(JSON.stringify(result.output.value), DO_IT_NOW_NOTE);
                continue;
              }
              if (
                saidInsteadOfDone(result.output.value, result.output.dropped)
              ) {
                askToDoIt(JSON.stringify(result.output.value));
                continue;
              }
              if (
                screenNote !== null &&
                askedWhatScreenShows(result.output.value)
              ) {
                askToDoIt(JSON.stringify(result.output.value), screenNote);
                continue;
              }
              // Nothing to look up, and the answer in the task's shape.
              final = result;
              analyst = result.output.value;
              break;
            }
            if (result.output.kind === "TEXT") {
              /**
               * Nothing (more) to look up, so this is the answer.
               *
               * This round carries the analyst's own prompt, so an answer
               * written here is written under the analyst's rules, and it
               * is accepted only if it satisfies the task's schema —
               * exactly as the structured call below would accept it.
               * Anything else falls through to that call.
               *
               * The alternative, asking a cheap throwaway prompt whether a
               * tool is wanted and then asking again for the answer, was
               * measured: the small prompt saved almost nothing, because
               * the cost of a turn is how many calls it makes rather than
               * how large they are, and it put a second and a half in
               * front of every question that needed no tool at all.
               */
              const accepted = acceptStructuredOutput(
                result.output.text,
                answerSchema,
                {
                  invalidListItems: "DROP",
                  lenientFields: ANALYST_LENIENT_FIELDS,
                  unknownRootKeys: "DROP",
                },
              );
              // Whether or not the text fits the task's shape: a draft
              // written instead of prepared (guard run 0527cfb8).
              if (draftedNotPrepared()) {
                askToDoIt(
                  result.output.text,
                  prepareMessageNote(request.askedAction ?? ""),
                );
                continue;
              }
              if (accepted.ok && deferredInsteadOfDone(accepted.value)) {
                askToDoIt(result.output.text, DO_IT_NOW_NOTE);
                continue;
              }
              if (
                accepted.ok &&
                saidInsteadOfDone(accepted.value, accepted.dropped)
              ) {
                askToDoIt(result.output.text);
                continue;
              }
              if (
                accepted.ok &&
                screenNote !== null &&
                askedWhatScreenShows(accepted.value)
              ) {
                askToDoIt(result.output.text, screenNote);
                continue;
              }
              if (accepted.ok) {
                final = result;
                analyst = accepted.value;
                if ((accepted.dropped?.length ?? 0) > 0) {
                  logger?.warn(
                    { qRunId: request.runId, dropped: accepted.dropped },
                    "analyst reading kept; refused list elements were dropped",
                  );
                }
              } else {
                // Info, not debug: every such turn pays a second full
                // model call for the structured answer (live 2026-10-01:
                // ~1.6-2.2 s on most Home Q turns). The stage and the
                // refused paths say why; never the model's text.
                logger?.info(
                  {
                    qRunId: request.runId,
                    stage: accepted.stage,
                    refusals: (accepted.refusals ?? []).slice(0, 8),
                    chars: result.output.text.length,
                  },
                  "a tool round answered outside the task's shape",
                );
              }
              break;
            }
            if (result.output.kind !== "TOOL_CALLS") {
              break;
            }
            rounds += 1;
            took(`round${String(rounds)}`);
            // Also never more than one assistant message may carry: the
            // round's own message goes back in the next request, and a
            // ninth call made that request one the gateway refuses (QA
            // 2026-10-24, "show my pipeline": 1 + 9 calls, run FAILED).
            const proposed = result.output.calls.slice(
              0,
              Math.min(MODEL_TOOL_CALLS_MAX, loopBudget.maxCalls - calls),
            );
            const assistant: ModelMessage = {
              role: "ASSISTANT",
              content: result.output.text,
              toolCalls: [...proposed],
            };
            // Speed lane C (owned-first.ts): under ONLY_IF_EMPTY a web call
            // beside a read of their own records goes last, waits for it,
            // and runs only if every such read came back empty.
            const holdWeb = holdsWebForOwned({
              researchMode: research?.mode,
              proposals: proposed.map((call) => ({
                name: call.name,
                classification: classificationOf(call.name),
              })),
              ownedFoundEarlier: ownedFound,
            });
            const proposals = holdWeb
              ? [
                  ...proposed.filter((call) => call.name !== PUBLIC_WEB_TOOL),
                  ...proposed.filter((call) => call.name === PUBLIC_WEB_TOOL),
                ]
              : proposed;
            const results: ModelMessage[] = [];
            // Reads run side by side (Zino live 2026-10-07: eight fit.profile
            // reads in a row, one after another). Only when every call in
            // the round is READ_ONLY and none changes what is offered; any
            // other round keeps its order, one at a time, as before. The
            // outcomes are still handled below in the order proposed.
            const together =
              proposals.length > 1 &&
              proposals.every(
                (call) =>
                  call.name !== USE_CAPABILITY_TOOL &&
                  classificationOf(call.name) === "READ_ONLY",
              );
            const early = together
              ? proposals.map((call) =>
                  holdWeb && call.name === PUBLIC_WEB_TOOL
                    ? undefined
                    : runCall(call).then(
                        (outcome) => ({ ok: true as const, outcome }),
                        (error: unknown) => ({ ok: false as const, error }),
                      ),
                )
              : null;
            let heldThisRound = 0;
            // A first contact prepared by code this round (first-contact.ts).
            let firstContact: Promise<QToolCallOutcome> | null = null;
            let firstContactWithNote = false;
            /** RC4: told when code refused a first contact to a connected counterpart. */
            const inTouchNotes: ModelMessage[] = [];
            /** An email their mailbox could not send, as a Capital Q message instead (QA F-32). */
            let chatInstead: Promise<QToolCallOutcome> | null = null;
            let chatInsteadWhy: "NO_MAILBOX" | "NO_ADDRESS" = "NO_MAILBOX";
            /** B2: this round put a message on its card (a message tool's own, or the chat instead). */
            let messagePrepared = false;
            let chatInsteadPrepared = false;
            /** Their Q Card, prepared for approval when none is made (QA F-34). */
            let cardOffer: {
              readonly handle: string;
              readonly outcome: Promise<QToolCallOutcome>;
            } | null = null;
            const chainedThisRound: {
              readonly name: string;
              readonly read: Promise<QToolCallOutcome>;
            }[] = [];
            for (const [index, call] of proposals.entries()) {
              if (holdWeb && call.name === PUBLIC_WEB_TOOL && ownedFound) {
                // Answered by their own records: the web is not asked, and
                // the model is told so in the call's own result.
                heldThisRound += 1;
                results.push({
                  role: "TOOL",
                  callId: call.callId,
                  name: call.name,
                  content: JSON.stringify({
                    ok: false,
                    error: {
                      code: OWNED_FIRST_CODE,
                      safeMessage: OWNED_FIRST_MESSAGE,
                    },
                  }),
                });
                logger?.info(
                  { qRunId: request.runId, round: rounds },
                  "q public web held: their own records answered first",
                );
                continue;
              }
              calls += 1;
              const tool = offeredByName.get(call.name);
              // Turn latency row 16: the stage is written once when it
              // changes (eight fit.profile reads wrote it eight times, one
              // after another), and beside the read rather than before it.
              const stage = tool?.visibleStage ?? null;
              const about =
                stage === null
                  ? undefined
                  : stageAbout({
                      stage,
                      args: call.arguments,
                      read: runCompanies.read(request.runId),
                    });
              // Round 4: the stage names what it is about when this run has
              // read it ("Looking at Nixo"); written again only when the
              // stage or its names change.
              const stageWrite =
                stage === null ? null : stageOnce(stage, about);
              const settled = await early?.[index];
              if (settled !== undefined && !settled.ok) {
                await stageWrite;
                throw settled.error;
              }
              const [ran] = await Promise.all([
                settled !== undefined
                  ? Promise.resolve(settled.outcome)
                  : runCall(call),
                stageWrite,
              ]);
              // A search beside the round's reads of their records is
              // checked once those reads are in: its pages must be about
              // whom the person named (live 2026-10-24, "Who founded
              // Duplo?": LEGO DUPLO reached the answer).
              if (call.name === PUBLIC_WEB_TOOL && early !== null) {
                await Promise.all(
                  early.flatMap((one) => (one === undefined ? [] : [one])),
                );
              }
              const outcome =
                call.name === PUBLIC_WEB_TOOL
                  ? aboutThemOnly(call, request.runId, ran, latest.content)
                  : ran;
              toolCalls.push({
                toolName: outcome.toolName,
                providerName: call.name,
                status: outcome.status,
                failureCode: outcome.failureCode,
                latencyMs: outcome.latencyMs,
              });
              if (
                research?.mode === "ONLY_IF_EMPTY" &&
                classificationOf(call.name) === "READ_ONLY" &&
                ownedReadFound(outcome)
              ) {
                ownedFound = true;
              }
              collectSources(outcome);
              collectClientAction(outcome);
              collectDocument(outcome);
              collectSchedule(call.name, outcome);
              notePlatformLookup(outcome);
              noteRecommendationGrounds(outcome);
              noteFitGrounds(outcome);
              // Turn latency row 16: a search that found one company has
              // its profile read now, beside the rest of the round, rather
              // than in a model round of its own (chained-read.ts).
              // The profile and, beside it, the published figures (owner
              // 2026-10-23): both start now and run in parallel, each only
              // when offered, within the loop's call budget.
              // A message or email to a company they are not connected with:
              // the first contact, Express Interest, prepared now for their
              // approval, through its own authorize step (first-contact.ts).
              qCardRead = qCardReadOf(call, outcome) ?? qCardRead;
              const offer = qCardOfferOf(call, outcome);
              // QA F10 (25 Oct, a7b99c46): "Show me my Q Card" is a
              // question, so the claim tool was not in its offer and nothing
              // was prepared, while the reply said "approve the claim on the
              // card". The claim is prepared whatever the turn's focus; the
              // executor still refuses it where the purpose does not allow it.
              if (
                offer !== null &&
                cardOffer === null &&
                !proposals.some((other) => other.name === Q_CARD_CLAIM_TOOL) &&
                calls + chainedThisRound.length + 1 < loopBudget.maxCalls
              ) {
                cardOffer = {
                  handle: offer.handle,
                  outcome: callTool(
                    {
                      callId: "q-card-offer",
                      name: Q_CARD_CLAIM_TOOL,
                      arguments: offer,
                    },
                    toolContext,
                  ),
                };
              }
              const instead = chatInsteadOf(call, outcome);
              if (
                instead !== null &&
                chatInstead === null &&
                canOffer(CHAT_INSTEAD_TOOL) &&
                !proposals.some((other) => other.name === CHAT_INSTEAD_TOOL) &&
                calls + chainedThisRound.length + 1 <=
                  loopBudget.maxCalls + OUTWARD_FOLLOW_ON_RESERVE
              ) {
                chatInsteadWhy =
                  outcome.result.ok &&
                  (outcome.result.data as { readonly status?: unknown } | null)
                    ?.status === "NO_RECIPIENT"
                    ? "NO_ADDRESS"
                    : "NO_MAILBOX";
                chatInstead = callTool(
                  {
                    callId: "q-chat-instead",
                    name: CHAT_INSTEAD_TOOL,
                    arguments: instead,
                  },
                  toolContext,
                );
              }
              const contactAsked = firstContactOf(call, outcome);
              // RC4 (investor audit, Nixo 9 Nov): a counterpart the
              // projection shows connected or further along never gets a
              // first contact, and "not connected yet" is never said of it.
              const inTouch =
                contactAsked === null
                  ? null
                  : connectedAlready(await accountDigest, contactAsked);
              if (inTouch !== null) {
                logger?.warn(
                  { qRunId: request.runId, stage: inTouch.stage },
                  "first contact refused by code: the relationship is already connected",
                );
                inTouchNotes.push({
                  role: "USER",
                  content: `[Capital Q, not the person] They are already ${inTouch.stage.toLowerCase().replace(/_/gu, " ")} with ${inTouch.counterpart.name} (relationship ${inTouch.relationshipId}); this is not a first contact and no expression of interest is prepared. If a message is asked for, prepare it with that relationshipId. Never say they are not connected.`,
                });
              }
              const contact = inTouch === null ? contactAsked : null;
              if (
                contact !== null &&
                firstContact === null &&
                canOffer(FIRST_CONTACT_TOOL) &&
                !proposals.some((other) => other.name === FIRST_CONTACT_TOOL) &&
                calls + chainedThisRound.length + 1 <=
                  loopBudget.maxCalls + OUTWARD_FOLLOW_ON_RESERVE
              ) {
                firstContactWithNote = "note" in contact;
                firstContact = callTool(
                  {
                    callId: "q-first-contact",
                    name: FIRST_CONTACT_TOOL,
                    arguments: contact,
                  },
                  toolContext,
                );
              }
              const chainedId = chainedCompanyOf(call, outcome);
              for (const name of chainedId === null ? [] : CHAINED_READ_TOOLS) {
                if (
                  chainedId === null ||
                  chainedReads.has(chainedKey(name, chainedId)) ||
                  !offeredByName.has(name) ||
                  proposals.some(
                    (other) =>
                      other.name === name &&
                      (
                        other.arguments as {
                          readonly companyId?: unknown;
                        } | null
                      )?.companyId === chainedId,
                  ) ||
                  calls + chainedThisRound.length >= loopBudget.maxCalls
                ) {
                  continue;
                }
                const read = callTool(
                  {
                    callId:
                      name === CHAINED_GET_TOOL
                        ? `q-chained-${chainedId}`
                        : `q-chained-${name}-${chainedId}`,
                    name,
                    arguments: { companyId: chainedId },
                  },
                  toolContext,
                );
                chainedReads.set(chainedKey(name, chainedId), read);
                chainedThisRound.push({ name, read });
              }
              if (call.name === APPROVE_PENDING_TOOL && outcome.result.ok) {
                approvalLine =
                  approvalStatusLine(outcome.result.data) ?? approvalLine;
              }
              if (call.name === FILL_PROFILE_GAPS_TOOL && outcome.result.ok) {
                gaps = gapsLineOf(outcome.result.data) ?? gaps;
              }
              // A refusal that names the tool that does what was asked
              // ("…prepare it with propose_profile_answer_change instead"):
              // that tool is loaded and the model gets one more step.
              if (outcome.status === "DENIED" && !outcome.result.ok) {
                const named = (availableForRun ?? [])
                  .map((tool) => tool.definition.name)
                  .filter(
                    (name) =>
                      name !== call.name &&
                      new RegExp(`\\b${name}\\b`, "u").test(
                        outcome.result.ok
                          ? ""
                          : outcome.result.error.safeMessage,
                      ),
                  );
                const loadedNamed = offerFromRun(named);
                if (
                  (loadedNamed.length > 0 ||
                    named.some((name) => offeredByName.has(name))) &&
                  redirectRounds === 0
                ) {
                  redirectRounds = 1;
                }
              }
              if (call.name === USE_CAPABILITY_TOOL && outcome.result.ok) {
                // What was loaded may execute this turn exactly as a tool
                // the turn named (the registry's own rule).
                const loaded = offerFromRun(
                  loadCapabilities(
                    outcome.result.data,
                    availableForRun ?? [],
                    offeredByName,
                  ).map((tool) => tool.definition.name),
                );
                if (loaded.length > 0 && loadRounds === 0) loadRounds = 1;
                logger?.info(
                  {
                    key: "q.capability_loaded",
                    qRunId: request.runId,
                    need: ((need: unknown) =>
                      typeof need === "string" ? need.slice(0, 120) : "")(
                      (call.arguments as { need?: unknown } | null)?.need,
                    ),
                    loaded: loaded.map((tool) => tool.definition.name),
                    offered: offered.length,
                    round: rounds,
                  },
                  "q loaded a tool on demand",
                );
              }
              // ADR 0040: an app action that ran (or could not) says so in
              // Capital Q's own words, from the tool -- the model's talk
              // about acting is removed below, so this is what is said.
              const acted = outcome.result.ok
                ? appActionLineOf(outcome.result.data)
                : null;
              // XLSX-002: a document tool's own receipt (what it made, what
              // it could not fill) is said ahead of the model's words.
              const made = outcome.result.ok
                ? documentReceiptOf(call.name, outcome.result.data)
                : null;
              if (made !== null) {
                // The newest receipt of a tool replaces its earlier one.
                madeLines.splice(0, madeLines.length, made);
              }
              if (
                outcome.result.ok &&
                (outcome.result.data as { readonly status?: unknown } | null)
                  ?.status === "PREPARED"
              ) {
                preparedByTool = true;
                if (asksForMessage(call.name)) messagePrepared = true;
                const line = preparedLineOf(outcome.result.data);
                if (line !== null && !preparedLines.includes(line)) {
                  preparedLines.push(line);
                }
              }
              if (outcome.result.ok) {
                const own = ownRecordOf(outcome.result.data);
                if (own !== null)
                  ownRecordsOnly = (ownRecordsOnly ?? true) && own;
              }
              if (acted !== null && !actedLines.includes(acted)) {
                actedLines.push(acted);
              }
              // K9: a staged proposal reads as pending confirmation.
              results.push(
                toolResultMessage(
                  call,
                  forModelReading(outcome, classificationOf(call.name)),
                ),
              );
            }
            const chainedResults: ModelMessage[] = [...inTouchNotes];
            if (chainedThisRound.length > 0) {
              const stage = offeredByName.get(CHAINED_GET_TOOL)?.visibleStage;
              const stageWrite =
                stage === undefined || stage === null ? null : stageOnce(stage);
              const [read] = await Promise.all([
                Promise.allSettled(chainedThisRound.map((c) => c.read)),
                stageWrite,
              ]);
              for (const [index, settled] of read.entries()) {
                // A chained read that failed is simply not added: the
                // model can still ask for the profile itself.
                if (settled.status !== "fulfilled") continue;
                const name = chainedThisRound[index]?.name ?? CHAINED_GET_TOOL;
                const outcome = settled.value;
                calls += 1;
                toolCalls.push({
                  toolName: outcome.toolName,
                  providerName: name,
                  status: outcome.status,
                  failureCode: outcome.failureCode,
                  latencyMs: outcome.latencyMs,
                });
                // Figures the firewall denied, or none to read, add
                // nothing: the profile answer stands on its own.
                if (
                  name === CHAINED_FIGURES_TOOL &&
                  outcome.status !== "SUCCEEDED"
                ) {
                  continue;
                }
                collectSources(outcome);
                notePlatformLookup(outcome);
                noteRecommendationGrounds(outcome);
                noteFitGrounds(outcome);
                chainedResults.push(
                  readForYouMessage(
                    name,
                    forModelReading(outcome, classificationOf(name)),
                  ),
                );
              }
            }
            if (cardOffer !== null) {
              const { handle } = cardOffer;
              const outcome = await cardOffer.outcome.catch(() => null);
              if (outcome !== null) {
                calls += 1;
                toolCalls.push({
                  toolName: outcome.toolName,
                  providerName: Q_CARD_CLAIM_TOOL,
                  status: outcome.status,
                  failureCode: outcome.failureCode,
                  latencyMs: outcome.latencyMs,
                });
                const told = qCardOfferMessage(outcome, handle);
                if (told !== null) {
                  qCardClaimPrepared = true;
                  chainedResults.push(told);
                }
              }
            }
            if (chatInstead !== null) {
              const outcome = await chatInstead.catch(() => null);
              if (outcome !== null) {
                calls += 1;
                toolCalls.push({
                  toolName: outcome.toolName,
                  providerName: CHAT_INSTEAD_TOOL,
                  status: outcome.status,
                  failureCode: outcome.failureCode,
                  latencyMs: outcome.latencyMs,
                });
                const told = chatInsteadMessage(outcome, chatInsteadWhy);
                if (told !== null) {
                  chainedResults.push(told);
                  chatInsteadPrepared = true;
                }
                if (
                  outcome.result.ok &&
                  (outcome.result.data as { readonly status?: unknown } | null)
                    ?.status === "PREPARED"
                ) {
                  cardPrepared = true;
                }
              }
            }
            if (firstContact !== null) {
              const outcome = await firstContact.catch(() => null);
              if (outcome !== null) {
                calls += 1;
                toolCalls.push({
                  toolName: outcome.toolName,
                  providerName: FIRST_CONTACT_TOOL,
                  status: outcome.status,
                  failureCode: outcome.failureCode,
                  latencyMs: outcome.latencyMs,
                });
                const told = firstContactMessage(outcome, firstContactWithNote);
                if (told !== null) {
                  chainedResults.push(told);
                  firstContactPrepared = true;
                  cardPrepared = true;
                }
              }
            }
            messages = [...messages, assistant, ...results, ...chainedResults];
            // B2 (coordinator 2026-10-26, run 42cecfd2): the message they
            // asked for is on its card. What any later round wrote about
            // it was replaced by the card's status, so the loop ends and
            // the reply is code's; the card keeps the model's words.
            if (
              asksForMessage(request.askedAction) &&
              (messagePrepared || chatInsteadPrepared || firstContactPrepared)
            ) {
              askedMessageReply = firstContactPrepared
                ? FIRST_CONTACT_REPLY
                : chatInsteadPrepared
                  ? chatInsteadReply(chatInsteadWhy)
                  : MESSAGE_PREPARED_REPLY;
              final = result;
              analyst = ANALYST_RESULT_SCHEMA.parse({
                answer: askedMessageReply,
                responseShape: "CONCISE",
                findings: [],
                missingEvidence: [],
                contradictions: [],
                insufficientEvidence: false,
                recommendation: null,
                clarifyingQuestions: [],
                declined: false,
              });
              logger?.info(
                { qRunId: request.runId, rounds },
                "the message they asked for is on its card: the reply is code's",
              );
              break;
            }
            if (
              gapsRounds === 0 &&
              (gaps as { readonly status: string } | null)?.status ===
                "RESEARCHED" &&
              calls < loopBudget.maxCalls
            ) {
              gapsRounds = 1;
            }
            const ran = proposals.length - heldThisRound;
            const roundOutcomes = ran > 0 ? toolCalls.slice(-ran) : [];
            if (
              recoveryRounds === 0 &&
              ran > 0 &&
              roundOutcomes.every((outcome) => outcome.status !== "SUCCEEDED")
            ) {
              recoveryRounds = 1;
            }
            // The next round continues the real transcript: the small
            // gathering prompt existed only to ask the first question.
            if (request.signal?.aborted === true) {
              return { kind: "FAILED", diagnosticCode: "RUN_CANCELLED" };
            }
          }
        }

        // Q decides when to research from the conversation core's reading
        // of the turn and from what the platform actually returned — never
        // from the model's mood and never from a word list (CQ-QX-005;
        // CQ-Q-RESEARCH-001 §26). Two triggers: the turn explicitly asked
        // for something real, current or public (EXPLICIT); or it asked
        // about their own records or a named company, and the platform
        // lookup came back empty (ONLY_IF_EMPTY). The second is the one
        // that matters in practice: a small model reliably searches
        // Capital Q, finds nothing, and stops, and the person reads "I
        // have no information" about a company with a Wikipedia page. The
        // tool composes the outbound query from the person's words and
        // authorised identity; the result joins the transcript as data,
        // never as instruction.
        // On a NEVER turn that asks nothing the model never holds the
        // research tool; the prospects fallback is code's decision, from
        // the platform's own thin result, so code takes it from the run's
        // offer.
        // The turn's web search, begun with the turn, joins what Capital Q's
        // own records returned. A round that answered without it (an
        // adapter that does not stream) is answered again with it; nothing
        // of that round was said.
        if (
          earlyWeb !== null &&
          !earlyWeb.claimed &&
          askedMessageReply === null
        ) {
          earlyWeb.claimed = true;
          // The web lands within its own budget or is dropped: the answer
          // never waits on it past that (owner 2026-10-23).
          const outcome = await settledWithin(
            earlyWeb.outcome,
            (dependencies.webLaneBudgetMs ?? WEB_LANE_BUDGET_MS) -
              (Date.now() - earlyWeb.startedAt),
          );
          took("research");
          if (request.signal?.aborted === true) {
            return { kind: "FAILED", diagnosticCode: "RUN_CANCELLED" };
          }
          if (outcome === null) {
            logger?.warn(
              {
                qRunId: request.runId,
                budgetMs: dependencies.webLaneBudgetMs ?? WEB_LANE_BUDGET_MS,
                sinceStartMs: Date.now() - startedAt,
              },
              "q early web search dropped: over its budget",
            );
            messages = [...messages, WEB_LANE_DROPPED_NOTE];
            // Recorded as the turn's web call, so nothing asks it again.
            toolCalls.push({
              toolName: "public_web.search",
              providerName: PUBLIC_WEB_TOOL,
              status: "FAILED",
              failureCode: "OVER_BUDGET",
              latencyMs: Date.now() - earlyWeb.startedAt,
            });
          } else {
            landResearch(earlyWeb.call, outcome);
          }
          analyst = undefined;
          final = undefined;
        }
        const researchTool = researchToolNow();
        if (
          analyst === undefined &&
          researchTool !== undefined &&
          researchHopDue()
        ) {
          await researchHop(researchTool);
          if (request.signal?.aborted === true) {
            return { kind: "FAILED", diagnosticCode: "RUN_CANCELLED" };
          }
        }

        // They asked about their own records and Capital Q's context was
        // not enough, so the answer draws on the public web: said out
        // loud as a change of source, never silently (CQ-QX-005).
        if (
          research?.announceSourceChange === true &&
          toolCalls.some((call) => call.providerName === "research_public_web")
        ) {
          messages = [...messages, SOURCE_CHANGE_NOTE];
        }
        // The model's own call was answered by the remembered empty search
        // in a tool round: still not said again.
        if (
          earlyWeb?.remembered === true &&
          earlyWeb.claimed &&
          !messages.includes(ALREADY_SEARCHED_NOTE)
        ) {
          messages = [...messages, ALREADY_SEARCHED_NOTE];
        }
        // QA I11 (batch-7 re-score): "Draft a short note to Basketari's
        // founders…" was answered "it would need to be sent through your
        // connected Basketari relationship" and then "I didn't prepare
        // that": they are not connected, and their Express Interest in
        // Basketari was already waiting. A message asked for (the reader's
        // askedAction) that the model never tried goes the way a refused
        // one does: the first contact for the one company their words
        // name, among those this run read. The engine returns a card
        // already waiting as that card; an interest already sent is said
        // as it stands.
        if (
          !firstContactPrepared &&
          request.askedAction !== undefined &&
          MESSAGE_TOOLS.has(request.askedAction) &&
          offeredByName.has(FIRST_CONTACT_TOOL) &&
          !toolCalls.some(
            (call) =>
              MESSAGE_TOOLS.has(call.providerName) ||
              call.providerName === FIRST_CONTACT_TOOL,
          ) &&
          request.signal?.aborted !== true
        ) {
          // The run's read companies, by lower-cased name to id.
          const named = [...runCompanies.read(request.runId)].filter(([name]) =>
            containsCompanyName(latest.content, name),
          );
          const only = named.length === 1 ? named[0] : undefined;
          // RC4: never a first contact to a counterpart already connected.
          if (
            only !== undefined &&
            connectedAlready(await accountDigest, { companyId: only[1] }) ===
              null
          ) {
            const outcome = await callTool(
              {
                callId: `first-contact-${request.runId}`,
                name: FIRST_CONTACT_TOOL,
                arguments: { companyId: only[1] },
              },
              toolContext,
            ).catch(() => null);
            if (outcome !== null) {
              toolCalls.push({
                toolName: outcome.toolName,
                providerName: FIRST_CONTACT_TOOL,
                status: outcome.status,
                failureCode: outcome.failureCode,
                latencyMs: outcome.latencyMs,
              });
              const data = outcome.result.ok
                ? (outcome.result.data as {
                    readonly status?: unknown;
                    readonly awaitingApprovalOf?: unknown;
                  } | null)
                : null;
              if (data?.status === "PREPARED") {
                firstContactPrepared = true;
                cardPrepared = true;
              } else if (
                data?.status === "ALREADY_EXPRESSED" &&
                typeof data.awaitingApprovalOf === "string"
              ) {
                firstContactAlready = data.awaitingApprovalOf;
              }
              logger?.info(
                { qRunId: request.runId, status: data?.status ?? null },
                "a message they asked for, not tried: the first contact by code",
              );
            }
          }
        }
        // Guard run 1 (2026-10-25, run 88075f4a): "Show me my Q Card and the
        // share link" was answered "I don't have the saved share link yet.
        // Want me to claim @maji-loop?" with the card never read. Asked
        // about their own card and not read this turn: code reads it, and
        // with none made prepares the claim (its card already waiting is
        // that card), so the answer says how it stands from the read.
        if (
          qCardRead === null &&
          offeredByName.has(Q_CARD_READ_TOOL) &&
          asksAboutOwnQCard(latest.content) &&
          toolCalls.length + 2 <= Q_TOOL_LOOP_MAX_CALLS &&
          request.signal?.aborted !== true
        ) {
          const readCall = {
            callId: `q-card-read-${request.runId}`,
            name: Q_CARD_READ_TOOL,
            arguments: {
              subject:
                askerSideOf(request) === "FOUNDER"
                  ? "COMPANY"
                  : "INVESTOR_ORGANISATION",
            },
          };
          const read = await callTool(readCall, toolContext).catch(() => null);
          if (read !== null) {
            toolCalls.push({
              toolName: read.toolName,
              providerName: Q_CARD_READ_TOOL,
              status: read.status,
              failureCode: read.failureCode,
              latencyMs: read.latencyMs,
            });
            qCardRead = qCardReadOf(readCall, read);
            const offer = qCardOfferOf(readCall, read);
            if (
              offer !== null &&
              offeredByName.has(Q_CARD_CLAIM_TOOL) &&
              !toolCalls.some((call) => call.providerName === Q_CARD_CLAIM_TOOL)
            ) {
              const claimed = await callTool(
                {
                  callId: `q-card-claim-${request.runId}`,
                  name: Q_CARD_CLAIM_TOOL,
                  arguments: offer,
                },
                toolContext,
              ).catch(() => null);
              if (claimed !== null) {
                toolCalls.push({
                  toolName: claimed.toolName,
                  providerName: Q_CARD_CLAIM_TOOL,
                  status: claimed.status,
                  failureCode: claimed.failureCode,
                  latencyMs: claimed.latencyMs,
                });
                // Its card is on screen only once the claim was prepared.
                if (qCardOfferMessage(claimed, offer.handle) !== null) {
                  qCardClaimPrepared = true;
                }
              }
            }
          }
        }
        if (analyst === undefined || final === undefined) {
          modelCalls += 1;
          void stageOnce(writingStage);
          // This call is the answer, so its extras start with it.
          cancelExtras();
          roundMessages = messages;
          const answering = gateway.execute<CompanyAnalystV30Result>(
            { ...base, messages, output: answerOutput() },
            options,
          );
          startExtras();
          final = await answering.catch((error: unknown) => {
            cancelExtras();
            throw error;
          });
          if (final.output.kind !== "STRUCTURED") {
            return { kind: "FAILED", diagnosticCode: "INTERNAL_ERROR" };
          }
          analyst = final.output.value;
        }

        // The extras, joined to the answer after the pair checks.
        let extrasUsage: AnswerResult | null = null;
        let extrasJoin: string | null = null;
        // An answer that arrived without streaming prose (an adapter that
        // does not stream) never started its extras: they are written now,
        // after it, rather than lost.
        if (
          currentExtras() === null &&
          splitExtras &&
          !analyst.declined &&
          analyst.clarifyingQuestions.length === 0 &&
          analyst.findings.length === 0 &&
          analyst.answerCards === null &&
          analyst.comparisonCards === null
        ) {
          startExtras();
        }
        // Read through a function: it is set in callbacks, which the
        // compiler's narrowing does not follow.
        const pending = currentExtras();
        if (pending !== null) {
          const written = await pending.result;
          took("extras");
          extrasUsage = written;
          const value =
            written === null
              ? null
              : written.output.kind === "STRUCTURED"
                ? written.output.value
                : (() => {
                    const accepted = acceptStructuredOutput(
                      written.output.text,
                      NARROWED_ANALYST_SCHEMA,
                      {
                        invalidListItems: "DROP",
                        lenientFields: ANALYST_LENIENT_FIELDS,
                        unknownRootKeys: "DROP",
                      },
                    );
                    return accepted.ok ? accepted.value : null;
                  })();
          const joined = joinExtras(
            analyst,
            value,
            pending.read,
            claimEchoes(),
          );
          analyst = joined.value;
          extrasJoin = joined.join;
          // Left out at the join: examined and dropped there.
          findingsChecked.examined += joined.ungrounded;
          findingsChecked.dropped += joined.ungrounded;
          if (joined.ungrounded > 0) {
            logger?.warn(
              { qRunId: request.runId, ungrounded: joined.ungrounded },
              "findings stating a number neither writer was given were left out",
            );
          }
        }
        // Whichever writer wrote them, findings are held to the document's
        // rows and tables against this run's sources, Q's recalled and
        // earlier words binding no count (live a1777c9a: the answer's own
        // findings went unchecked when the extras did not join).
        {
          const before = analyst.findings.length;
          // What became of one of Q's own changes is never a finding (live
          // 17 Nov 2026: "The question … was approved and sent.", truth
          // class Q_INFERENCE, no evidence): the record says it.
          const held = analyst.findings.filter(
            (finding) =>
              !claims.contradictsCounts(finding.statement) &&
              !claimsChangeStatus(finding.statement),
          );
          findingsChecked.examined += before;
          findingsChecked.dropped += before - held.length;
          if (held.length !== before) analyst = { ...analyst, findings: held };
          // Live 7e866011: an UNCERTAINTY card said "four public-sector
          // account managers" beside the answer. What it says is held to
          // the same rows (missing evidence and contradictions alike).
          const contradictions = (analyst.contradictions ?? []).filter(
            (statement) => !claims.contradictsCounts(statement),
          );
          const missingEvidence = (analyst.missingEvidence ?? []).filter(
            (statement) => !claims.contradictsCounts(statement),
          );
          const said =
            (analyst.contradictions ?? []).length +
            (analyst.missingEvidence ?? []).length;
          const cut = said - contradictions.length - missingEvidence.length;
          findingsChecked.examined += said;
          findingsChecked.dropped += cut;
          if (cut > 0) {
            analyst = { ...analyst, contradictions, missingEvidence };
          }
        }
        if (request.signal?.aborted === true) {
          return { kind: "FAILED", diagnosticCode: "RUN_CANCELLED" };
        }

        // The last surface before a person reads it (CQ-Q-023). Capital Q
        // has no deterministic recommendation factors yet, so any sentence
        // explaining why something was recommended, ranked or matched was
        // invented. COMPANY_ANALYST forbids writing one; a prompt is not
        // the boundary, so the text is checked rather than trusted.
        // Source labels become the one human-safe presentation (R3);
        // the recommendation guard runs on the text a person will read.
        // An answer IS the checking, so a sentence in front of it that
        // announces the checking is either redundant or untrue. The
        // charter forbids writing one and a prompt is not a boundary, so
        // it is removed here rather than hoped for.
        // A speculative answer stops here until the turn is read: what
        // follows records statements, notes changes and stores the answer.
        if (gate !== null) await gate.ready();
        took("answer");
        // A8 (live 14 Nov, 4d5ab3ac2): a figure of their own company the
        // run read (statedFigures) and did not prepare is prepared here,
        // through the run's own tool port and so the figure action's own
        // authorize step and checks: the card is the approval, nothing is
        // recorded before it (stated-figure-card.ts). No model call.
        const figureCard = statedFigureCard({
          readings:
            "statedFigures" in analyst ? analyst.statedFigures : undefined,
          offered: offeredByName.has(STATED_FIGURE_TOOL),
          modelCalled: toolCalls.some(
            (call) => call.providerName === STATED_FIGURE_TOOL,
          ),
          theirWords: [latest.content],
        });
        // The card's own line, said after the model's words: the model wrote
        // without knowing code would prepare it.
        let figureCardLine: string | null = null;
        if (figureCard.kind === "PREPARE") {
          const outcome = await callTool(
            {
              callId: `stated-figure-${request.runId}`,
              name: STATED_FIGURE_TOOL,
              arguments: figureCard.arguments,
            },
            toolContext,
          );
          toolCalls.push({
            toolName: outcome.toolName,
            providerName: STATED_FIGURE_TOOL,
            status: outcome.status,
            failureCode: outcome.failureCode,
            latencyMs: outcome.latencyMs,
          });
          const prepared =
            outcome.result.ok &&
            (outcome.result.data as { readonly status?: unknown } | null)
              ?.status === "PREPARED";
          if (prepared) {
            preparedByTool = true;
            const line = preparedLineOf(outcome.result.data);
            if (line !== null && !preparedLines.includes(line)) {
              preparedLines.push(line);
            }
            figureCardLine = line;
            const own = ownRecordOf(outcome.result.data);
            if (own !== null) ownRecordsOnly = (ownRecordsOnly ?? true) && own;
          }
          // ADR 0081: their own statement, recorded at once (no card): the
          // tool's own line says what was recorded and how to undo it.
          const recordedNow = outcome.result.ok
            ? appActionLineOf(outcome.result.data)
            : null;
          if (
            !prepared &&
            recordedNow !== null &&
            !actedLines.includes(recordedNow)
          ) {
            figureCardLine = recordedNow;
            const own = outcome.result.ok
              ? ownRecordOf(outcome.result.data)
              : null;
            if (own !== null) ownRecordsOnly = (ownRecordsOnly ?? true) && own;
          }
          logger?.info(
            {
              qRunId: request.runId,
              metric: figureCard.arguments.metric,
              status: outcome.status,
              failureCode: outcome.failureCode,
              prepared,
            },
            "a figure the run read was prepared for their approval by code",
          );
        } else if (figureCard.reason !== "NOT_OFFERED") {
          logger?.info(
            { qRunId: request.runId, reason: figureCard.reason },
            "no figure card from the run's reading",
          );
        }
        // What the analyst said about acting is Capital Q's to say, from
        // the action it actually holds (CQ-QX-007): the sentences the
        // model itself named as such are removed before anything else.
        // C3: the offer the answer closes with is bound to a tool this
        // run holds, or it is not said: Q never offers what it cannot then
        // do, and a yes binds to the record, never to the words.
        let offerBinding = bindOffer(analyst.offer, {
          holdsTool: (name) => classificationOf(name) !== undefined,
          documents: dependencies.artifacts !== undefined,
        });
        // A correction of Q's own mistake (uncertaintyOfferTurn): the
        // analyst's offer to ask the company something is not said either.
        const correctionOutreach =
          request.turnKind === "CORRECTION" &&
          offerBinding.kind === "BOUND" &&
          (UNCERTAINTY_VEHICLES.has(offerBinding.offer.action) ||
            MESSAGE_TO_COMPANY_TOOLS.has(offerBinding.offer.action))
            ? offerBinding.offer.said
            : null;
        if (correctionOutreach !== null) {
          offerBinding = { kind: "NONE" };
          logger?.info(
            { qRunId: request.runId },
            "an outreach offer on a correction of Q was not said",
          );
        }
        if (offerBinding.kind === "UNBOUND") {
          logger?.info(
            { qRunId: request.runId, action: offerBinding.action },
            "an offer no tool of this run can carry out was not said",
          );
        }
        /**
         * Addendum 14 Nov 2026 (slices 3-4): an offer to resolve an
         * uncertainty stands only for a material one, through the vehicle
         * the relationship allows; with no route, the plain step is said
         * instead. Read from the analyst's fields and the relationship
         * tool's own state, never from the words.
         */
        const uncertainties = uncertaintiesOf(analyst);
        const offerRemoved: string[] =
          offerBinding.kind === "UNBOUND"
            ? [offerBinding.said]
            : correctionOutreach !== null
              ? [correctionOutreach]
              : [];
        const uncertaintyLines: string[] = [];
        /**
         * D11 (live 396ebc21): code closes with the stage line, so a
         * sentence of the answer that restates that stage is dropped
         * (stageRestatements: against the stage code read, never the
         * person's words). The answer was told so before it was written.
         */
        const stageSaidByCode = (
          vehicle: StageVehicleChoice | null,
          company: string | null,
        ): void => {
          if (vehicle?.kind !== "NONE" || vehicle.stage === undefined) return;
          const restated = stageRestatements(
            analyst.answer,
            vehicle.stage,
            company,
          );
          if (restated.length === 0) return;
          offerRemoved.push(...restated);
          logger?.info(
            { qRunId: request.runId, dropped: restated.length },
            "the answer restated the stage code closes with: dropped by code",
          );
        };
        /** Q's own earlier answers in this conversation (code's record). */
        const earlierAnswers = earlier
          .filter((message) => message.role === "Q")
          .map((message) => message.content);
        const investorTurn = ownInvestorOrganisationIn(plan) !== null;
        /** The one company this run read in full, if exactly one. */
        const subjectCompany = (): {
          readonly companyId: string;
          readonly name: string | null;
        } | null => {
          const known = runCompanies.read(request.runId);
          // Root cause 14 Nov (audit 2026-11-14-uncertainty-offer-root-
          // cause.md): whom the turn is about is the reader's own reading
          // (namedOther) wherever this run read that company, not "the only
          // profile it happened to read" -- a second company read alongside
          // left the route unknown and the offer a plain message.
          const named =
            request.namedOther?.kind === "COMPANY"
              ? nameKey(request.namedOther.name)
              : "";
          const namedId =
            named.length === 0
              ? undefined
              : (known.get(named) ??
                [...known.profiles].find(
                  ([, name]) => nameKey(name) === named,
                )?.[0] ??
                [...known.relationships.values()].find(
                  (read) =>
                    read.counterpart.kind === "COMPANY" &&
                    read.counterpart.name !== null &&
                    nameKey(read.counterpart.name) === named,
                )?.counterpart.id);
          if (namedId !== undefined) {
            return {
              companyId: namedId,
              name:
                known.companyNames.get(namedId) ??
                known.profiles.get(namedId) ??
                request.namedOther?.name ??
                null,
            };
          }
          const ids = [...known.profiles.keys()];
          const only = ids.length === 1 ? ids[0] : undefined;
          if (only === undefined) {
            // D5: on a relationship page the run may read the relationship
            // and not the profile; the one company relationship it read is
            // then whom the turn is about. Several, or none: unknown.
            const related = [...known.relationships.values()].filter(
              (read) => read.counterpart.kind === "COMPANY",
            );
            const one = ids.length === 0 ? related[0] : undefined;
            if (related.length !== 1 || one === undefined) return null;
            return {
              companyId: one.counterpart.id,
              name:
                known.companyNames.get(one.counterpart.id) ??
                one.counterpart.name ??
                null,
            };
          }
          return {
            companyId: only,
            name:
              known.companyNames.get(only) ?? known.profiles.get(only) ?? null,
          };
        };
        /** Their side's standing with it: read already, or read now. */
        const standingWith = async (
          companyId: string,
        ): Promise<RelationshipStanding | undefined> => {
          const key = `COMPANY:${companyId}`;
          if (
            !runCompanies.read(request.runId).relationships.has(key) &&
            classificationOf("get_relationship") !== undefined
          ) {
            await callTool(
              {
                callId: "q-uncertainty-relationship",
                name: "get_relationship",
                arguments: { companyId },
              },
              toolContext,
            ).catch(() => null);
          }
          const read = runCompanies.read(request.runId).relationships.get(key);
          if (read === undefined) return undefined;
          return read.relationship === null
            ? {
                yourSide: read.yourSide ?? null,
                state: null,
                milestones: [],
              }
            : {
                yourSide: read.yourSide ?? null,
                state: read.relationship.state,
                milestones: read.relationship.milestones,
              };
        };
        const vehicleOf = (
          subject: { readonly name: string | null },
          standing: RelationshipStanding,
        ) =>
          chooseVehicle({
            standing,
            onRequestTitle: onRequestSeenRuns.has(request.runId),
            holds: (name) => classificationOf(name) !== undefined,
            company: subject.name,
          });
        /**
         * D15 (live 15 Nov 2026, run e7ba2a79): after Ajopot answered the
         * request, the same question was offered again and the status
         * line was the action's ("... is saved"). The item an offer would
         * settle, already asked for of this company (open or answered):
         * that request and the line saying where it stands. Null: never
         * asked, or declined.
         */
        let requestStateSaid = false;
        const alreadyAsked = (
          subject: {
            readonly companyId: string;
            readonly name: string | null;
          } | null,
          about: string | null,
        ): {
          readonly followUp: DiligenceFollowUp;
          readonly line: string;
        } | null => {
          if (subject === null) return null;
          // This turn's relationship read (standingWith reads it first),
          // else what the prepared follow-up read held.
          const followUps =
            runCompanies
              .read(request.runId)
              .relationships.get(`COMPANY:${subject.companyId}`)?.diligence
              ?.followUps ??
            followUpsByRun.get(request.runId)?.get(subject.companyId) ??
            [];
          if (followUps.length === 0) return null;
          const backing = offerBacking(uncertainties, about);
          if (backing === null) return null;
          const followUp = existingRequestFor(backing.statement, followUps);
          return followUp === null
            ? null
            : {
                followUp,
                // D19: days as a person says them, in their calendar.
                line: requestStateLine(
                  subject.name ?? "the company",
                  followUp,
                  {
                    now: (dependencies.now ?? (() => new Date()))(),
                    timeZone: personTimeZone(null, plan.screen?.timeZone),
                  },
                ),
              };
        };
        /**
         * Live 16 Nov 2026 (T4: Q asked Tensorgate for "the latest
         * management accounts" its founder had already shared with this
         * investor): before any offer to request a document, what this
         * run listed as already shared with them is checked. A document
         * that answers the item is named instead, and nothing is requested.
         */
        const alreadyShared = (
          subject: {
            readonly companyId: string;
            readonly name: string | null;
          } | null,
          about: string | null,
          asked: unknown,
        ): { readonly line: string } | null => {
          const byCompany =
            sharedDocumentsByRun.get(request.runId) ??
            new Map<string, readonly ListedDocument[]>();
          // The subject the answer is about; else the one company whose
          // documents this turn listed.
          const documents =
            subject !== null
              ? byCompany.get(subject.companyId.toLowerCase())
              : byCompany.size === 1
                ? [...byCompany.values()][0]
                : undefined;
          // Live b0a877f8: what this run read is checked too, listed or
          // not (a document the model read in its tool round).
          const readTitles = documentsReadIn({
            facts: suppliedFacts,
            toolResults: gateqToolResults(),
          }).filter(
            (title) =>
              documents === undefined ||
              documents.some((document) => document.title === title),
          );
          if (documents === undefined && readTitles.length === 0) return null;
          const backing = offerBacking(uncertainties, about);
          const said = [
            about ?? "",
            backing?.statement ?? "",
            typeof asked === "string"
              ? asked
              : asked === undefined || asked === null
                ? ""
                : JSON.stringify(asked).slice(0, 2_000),
          ].join(" ");
          const document =
            documents === undefined ? null : sharedDocumentFor(said, documents);
          const read =
            document === null ? readDocumentFor(said, readTitles) : null;
          if (document === null && read === null) return null;
          const name =
            subject?.name ??
            (subject === null
              ? null
              : (runCompanies
                  .read(request.runId)
                  .companyNames.get(subject.companyId.toLowerCase()) ??
                null)) ??
            "The company";
          if (document !== null) {
            return { line: alreadySharedLine(name, document) };
          }
          return read === null ? null : { line: alreadyReadLine(name, read) };
        };
        /** Whom an offer to resolve the item goes to (D13, D14). */
        const counterpartyOf = (subject: {
          readonly companyId: string;
          readonly name: string | null;
        }) => ({
          kind: "COMPANY" as const,
          id: subject.companyId,
          name: subject.name,
        });
        if (
          offerBinding.kind === "BOUND" &&
          (UNCERTAINTY_VEHICLES.has(offerBinding.offer.action) ||
            // Live ec736742: an investor's message offer for a material
            // uncertainty is held to the same route (uncertainty.ts).
            (investorTurn &&
              MESSAGE_TO_COMPANY_TOOLS.has(offerBinding.offer.action)))
        ) {
          const bound = offerBinding.offer;
          const subject = subjectCompany();
          const offerAbout = (
            analyst.offer as { readonly about?: unknown } | null
          )?.about;
          const about = typeof offerAbout === "string" ? offerAbout : null;
          const standing =
            subject === null
              ? undefined
              : await standingWith(subject.companyId);
          const vehicle =
            subject === null || standing === undefined
              ? null
              : vehicleOf(subject, standing);
          const sharedBefore = alreadyShared(subject, about, bound.request);
          const askedBefore =
            sharedBefore === null ? alreadyAsked(subject, about) : null;
          const decision = decideUncertaintyOffer({
            action: bound.action,
            about,
            uncertainties,
            vehicle,
            company: subject?.name ?? null,
            askedVehicle:
              request.askedAction !== undefined &&
              UNCERTAINTY_VEHICLES.has(request.askedAction),
          });
          logger?.info(
            {
              qRunId: request.runId,
              action: bound.action,
              decision: decision.kind,
              // Which predicate decided (live 06910b145 said only PASS).
              ...offerDecisionTrace({
                about,
                uncertainties,
                vehicle,
                standing,
                subjectKnown: subject !== null,
              }),
              holdsDiligence:
                classificationOf(DILIGENCE_DOCUMENTS_TOOL) !== undefined,
            },
            "an offer to resolve an uncertainty was held against its materiality and route",
          );
          if (sharedBefore !== null) {
            // Already shared with them: named, never requested again.
            offerRemoved.push(bound.said);
            if (!saidEarlier(sharedBefore.line, earlierAnswers)) {
              uncertaintyLines.push(sharedBefore.line);
            }
            requestStateSaid = true;
            offerBinding = { kind: "NONE" };
          } else if (askedBefore !== null) {
            // D15: the same item was already asked for; where that request
            // stands is said instead of a second offer.
            offerRemoved.push(bound.said);
            if (!saidEarlier(askedBefore.line, earlierAnswers)) {
              uncertaintyLines.push(askedBefore.line);
            }
            requestStateSaid = true;
            offerBinding = { kind: "NONE" };
          } else
            switch (decision.kind) {
              case "KEEP":
                offerBinding = {
                  kind: "BOUND",
                  offer: {
                    ...bound,
                    request: offerRequestFor({
                      tool: bound.action,
                      request: bound.request,
                      about: decision.about,
                      company: subject?.name ?? null,
                    }),
                    about: decision.about,
                    ...(subject === null
                      ? {}
                      : { counterparty: counterpartyOf(subject) }),
                  },
                };
                break;
              case "REBIND":
                offerRemoved.push(bound.said);
                uncertaintyLines.push(decision.said);
                offerBinding = {
                  kind: "BOUND",
                  offer: {
                    action: decision.tool,
                    request: offerRequestFor({
                      tool: decision.tool,
                      request: bound.request,
                      about: decision.about,
                      company: subject?.name ?? null,
                    }),
                    said: decision.said,
                    about: decision.about,
                    ...(subject === null
                      ? {}
                      : { counterparty: counterpartyOf(subject) }),
                  },
                };
                break;
              case "NO_ROUTE":
                offerRemoved.push(bound.said);
                // Said once: not beside code's own closing line (D7's stage
                // limit already says what the relationship allows).
                // Owner directive 14 Nov (point 4): the relationship step is
                // said once in a conversation, not on every answer about them.
                if (
                  decision.line !== null &&
                  request.closingLines === undefined &&
                  !saidEarlier(decision.line, earlierAnswers)
                ) {
                  uncertaintyLines.push(decision.line);
                  stageSaidByCode(vehicle, subject?.name ?? null);
                }
                offerBinding = { kind: "NONE" };
                break;
              case "DROP":
                offerRemoved.push(bound.said);
                offerBinding = { kind: "NONE" };
                break;
              case "PASS":
                break;
            }
        }
        if (
          uncertaintyLines.length === 0 &&
          investorTurn &&
          offerBinding.kind !== "BOUND" &&
          uncertainties.some(
            (one) =>
              one.material &&
              one.resolveBy.some(
                (way) => way === "ASK_FOUNDER" || way === "REQUEST_DOCUMENT",
              ),
          )
        ) {
          const subject = subjectCompany();
          const standing =
            subject === null
              ? undefined
              : await standingWith(subject.companyId);
          const vehicle =
            subject === null || standing === undefined
              ? null
              : vehicleOf(subject, standing);
          // D12: a question about the company the reader named is not a
          // lookup of their own records (uncertaintyOfferTurn).
          const offerTurn = uncertaintyOfferTurn(request);
          // D5 (live run 8039bfd5): a material uncertainty the founder can
          // settle, a route this run may use, and no offer of the answer's
          // own: code offers that route, bound and carrying `about`. Not
          // where code already closes the answer (a plan offer, a stage
          // limit), on a turn that wants no next step, or beside a change
          // this turn prepared.
          // D15: an item already asked for of this company (open or
          // answered) is never offered again; its request's state is said.
          const sharedBefore = alreadyShared(subject, null, null);
          if (sharedBefore !== null) {
            if (!saidEarlier(sharedBefore.line, earlierAnswers)) {
              uncertaintyLines.push(sharedBefore.line);
            }
            requestStateSaid = true;
          }
          const askedBefore =
            sharedBefore === null ? alreadyAsked(subject, null) : null;
          if (askedBefore !== null) {
            if (!saidEarlier(askedBefore.line, earlierAnswers)) {
              uncertaintyLines.push(askedBefore.line);
            }
            requestStateSaid = true;
            logger?.info(
              {
                qRunId: request.runId,
                status: askedBefore.followUp.status,
              },
              "a material uncertainty already asked for: its request's state, no new offer",
            );
          }
          const own =
            askedBefore === null &&
            sharedBefore === null &&
            request.closingLines === undefined &&
            offerTurn &&
            !preparedByTool
              ? codeUncertaintyOffer({
                  uncertainties,
                  vehicle,
                  company: subject?.name ?? null,
                })
              : null;
          if (own !== null) {
            uncertaintyLines.push(own.said);
            offerBinding = {
              kind: "BOUND",
              offer:
                subject === null
                  ? own
                  : { ...own, counterparty: counterpartyOf(subject) },
            };
            logger?.info(
              { qRunId: request.runId, action: own.action },
              "a material uncertainty with an open route: code made the offer",
            );
          } else {
            // Which predicate held the offer back, so a live run says so.
            logger?.info(
              {
                qRunId: request.runId,
                closingLines: request.closingLines !== undefined,
                nextStep: nextStepTurn(request),
                offerTurn,
                preparedByTool,
                ...offerDecisionTrace({
                  about: null,
                  uncertainties,
                  vehicle,
                  // Live 78f8d72d5: the trace logged state and
                  // diligenceOpen null here; the standing was read.
                  standing,
                  subjectKnown: subject !== null,
                }),
                holdsDiligence:
                  classificationOf(DILIGENCE_DOCUMENTS_TOOL) !== undefined,
              },
              "a material uncertainty closed with no offer of code's",
            );
          }
          if (own === null && request.closingLines === undefined) {
            const step = stepLineWithoutOffer({ uncertainties, vehicle });
            if (step !== null && !saidEarlier(step, earlierAnswers)) {
              uncertaintyLines.push(step);
              stageSaidByCode(vehicle, subject?.name ?? null);
            }
          }
        }
        // Slice 0: on a turn about someone not theirs, what was checked --
        // only where it changes how the answer reads (checkedLine).
        if (codeSaysCheckedRuns.has(request.runId)) {
          // Live 16 Nov 2026 (T4: "What would resolve the remaining
          // question on Tensorgate?" closed with "The public web search was
          // unavailable this turn"): a turn about a company whose data room
          // this run read for them is a records / data-room question, not a
          // web one. What was checked is said only when their own words ask
          // about the public web or news (the reader's flag is not their
          // words), as for a shown-list explanation (6f9b63cc5).
          const fromDataRoom =
            [...(sharedDocumentsByRun.get(request.runId)?.values() ?? [])]
              .flat()
              .some(
                (document) =>
                  document.access === "SHARED" || document.access === "OPEN",
              ) && !asksForTheWeb(latest.content);
          const need: CheckedLineNeed = fromDataRoom
            ? {
                ...checkedLineNeedOf(analyst, request),
                askedPublic: false,
                recordsQuestion: true,
              }
            : checkedLineNeedOf(analyst, request);
          const line = checkedLine({
            check: publicCheckOf({
              seen: publicWebByRun.get(request.runId) ?? [],
              dropped: toolCalls.some(
                (call) =>
                  call.providerName === PUBLIC_WEB_TOOL &&
                  call.failureCode === "OVER_BUDGET",
              ),
            }),
            subject: request.namedOther?.name ?? null,
            need,
          });
          // D3 (live 76234bfc): said once -- not again when the answer
          // already says the public web was not looked at this turn. Owner
          // directive 14 Nov (point 4): nor again in a conversation that
          // already heard it, unless they ask about public sources now.
          if (
            line !== null &&
            !answerSaysPublicCheck(analyst.answer) &&
            (need.askedPublic || !saidEarlier(line, earlierAnswers))
          ) {
            uncertaintyLines.unshift(line);
          }
        }
        const spoken = withoutActionTalk(
          analyst.answer,
          [...analyst.actionTalk, ...offerRemoved],
          requestedChangeValues(analyst, latest.content),
        );
        if (spoken.removed > 0) {
          logger?.info(
            { qRunId: request.runId, removed: spoken.removed },
            "sentences claiming an action were removed from a Q answer",
          );
        }
        // Owner conversation 2026-10-24: an offer to do what they asked,
        // or a promise of a look-up this turn did not start, is not said
        // (the round above asked for it to be done; what is left stands).
        const startedThisTurn = toolCalls.some((call) => {
          const kind = offeredByName.get(call.providerName)?.classification;
          return (
            call.status === "SUCCEEDED" &&
            kind !== undefined &&
            kind !== "READ_ONLY" &&
            kind !== "ANALYTICAL"
          );
        });
        const undeferred = startedThisTurn
          ? { text: spoken.text, removed: 0 }
          : withoutDeferredWork(
              spoken.text,
              askedOf(latest.content, earlier),
              [...earlier].reverse().find((message) => message.role === "Q")
                ?.content ?? null,
            );
        if (undeferred.removed > 0) {
          logger?.info(
            { qRunId: request.runId, removed: undeferred.removed },
            "an offer or promise to do what was asked was not said",
          );
        }
        // QA I18 (batch-7 re-score): "What happened in my last meeting…?"
        // opened "I couldn't prepare the Clinicrest reply from this
        // conversation." A turn that asked for no action and tried none has
        // no failure of its own to report; an old one is not said.
        const unfailed =
          request.turnKind !== "TOOL_REQUEST" &&
          toolCalls.every(
            (call) =>
              offeredByName.get(call.providerName)?.classification ===
                "READ_ONLY" ||
              offeredByName.get(call.providerName)?.classification ===
                "ANALYTICAL",
          )
            ? withoutStaleFailures(undeferred.text)
            : { text: undeferred.text, removed: 0 };
        if (unfailed.removed > 0) {
          logger?.info(
            { qRunId: request.runId, removed: unfailed.removed },
            "a failure this turn did not have was not said",
          );
        }
        // QA F13 (re-score, 24 Oct): a founder's drafted answer opened
        // "There isn't a matching open investor question to record this
        // against." With the answer tool refused for that, the draft leads
        // and the note about the question is said last.
        const answerRefused = toolCalls.some(
          (call) =>
            call.providerName === "answer_investor_question" &&
            call.status !== "SUCCEEDED",
        );
        const promises = stripEmptyPromises(
          answerRefused ? noMatchLast(unfailed.text) : unfailed.text,
        );
        if (promises.removed.length > 0) {
          logger?.warn(
            {
              qRunId: request.runId,
              removed: promises.removed.length,
              toolsExecuted: toolCalls.length,
            },
            "an answer opened by promising to act; the promise was removed",
          );
        }
        // Natural register (Zino live 2026-10-07): "Capital Q records
        // that you have…" is said in Q's own first person.
        const gateqLabelled = withoutUnsourcedGateqLabels(
          promises.text,
          askerSideOf(request) === "INVESTOR",
          gateqHeld(),
        );
        if (gateqLabelled.changed > 0) {
          logger?.info(
            { qRunId: request.runId, changed: gateqLabelled.changed },
            "GateQ wording without a GateQ reading was not published as written",
          );
        }
        const recommendationGuarded = withoutRecommendationClaims(
          withOneCaveat(
            inFirstPerson(
              citeAuthorisedFacts(
                withoutPublicSourceLabels(gateqLabelled.text, publicSources),
                facts,
              ),
            ).text,
          ).text,
          groundsNow(),
        );
        // Live 13279c88: the stored answer is held to the documents read
        // as the streamed sentences were (document-stated-figures.ts).
        const restated = correctDocumentDenials(
          recommendationGuarded.text,
          documentsThisTurn,
        );
        if (restated.corrected > 0 || documentDenials.corrected() > 0) {
          logger?.warn(
            {
              qRunId: request.runId,
              stream: documentDenials.corrected(),
              answer: restated.corrected,
              documents: documentsThisTurn.length,
            },
            "a figure the documents read this turn state was said to be unknown; said as they state it",
          );
        }
        // Step 6: the stored answer is held to the same check the streamed
        // sentences were, so the screen never shows what voice withheld.
        const answerClaims = stageClock.time("claimCheckAnswer", () =>
          checkAnswer(
            restated.text,
            claimCorpus(claimSources(), new Date(), claimEchoes()),
          ),
        );
        logUngrounded(answerClaims.ungrounded, "answer");
        // DECISIONS 104: what this answer was given, for a follow-up of
        // this conversation to answer from (context-follow-up.ts). A run
        // aborted before here has already returned.
        prepared.keepAnswerContext(claimSources());
        // Every answer says what its claim check did (live a1777c9a: three
        // fixes passed their replays, and production showed no line at all
        // when nothing was flagged). Counts and kinds only, no text.
        {
          const streamed = claims.stats();
          logger?.info(
            {
              qRunId: request.runId,
              sources: claimSourceKinds.read(),
              corpus: streamed.corpus,
              stream: {
                sentences: streamed.sentences,
                dropped: streamed.dropped,
                rewritten: streamed.rewritten,
                ...streamed.counts,
              },
              answer: {
                sentences: answerClaims.stats.sentences,
                dropped: answerClaims.stats.dropped,
                rewritten: answerClaims.stats.rewritten,
                ...answerClaims.stats.counts,
              },
              findings: {
                examined: findingsChecked.examined,
                dropped: findingsChecked.dropped,
                withheldLive: liveWithheld.size,
              },
            },
            "q claim check",
          );
        }
        // Thames Arc, 16 Nov 2026: Q's wrong counts sat in earlier
        // conversations' summaries and were recalled into later ones. A
        // recalled summary whose counts this run's documents contradict is
        // superseded by a new revision with them put right (the stale one
        // stays as history). Detached; counts only in the log, no text.
        {
          const supersede = dependencies.memory?.supersedeSummaries;
          const corrections =
            supersede === undefined
              ? []
              : summaryCorrections(
                  recalledSummaries,
                  claimSources(),
                  claimEchoes(),
                );
          if (supersede !== undefined && corrections.length > 0) {
            logger?.info(
              {
                qRunId: request.runId,
                summaries: corrections.length,
                corrected: corrections.reduce((n, c) => n + c.corrected, 0),
                dropped: corrections.reduce((n, c) => n + c.dropped, 0),
              },
              "q earlier summaries superseded",
            );
            void supersede({
              actor: request.actor,
              runId: request.runId,
              corrections,
            }).catch((error: unknown) => {
              logger?.warn(
                { err: error, qRunId: request.runId },
                "earlier summaries were not superseded",
              );
            });
          }
        }
        // Step 8: the stored answer is held to the same promise check.
        const answerPromises = stageClock.time("promiseCheckAnswer", () =>
          checkPromises(answerClaims.text, promiseGrounds()),
        );
        logUnbacked(answerPromises.unbacked, "answer");
        // Live 18 Nov 2026 (run 82921afe): code says what an action did,
        // once; the model's own restatement of that line is not said too.
        const unrestated = withoutRestatedLines(answerPromises.text, [
          ...actedLines,
          ...(figureCardLine === null ? [] : [figureCardLine]),
        ]);
        if (unrestated.removed > 0) {
          logger?.info(
            { qRunId: request.runId, removed: unrestated.removed },
            "sentences restating code's own action line were not said twice",
          );
        }
        const guarded = {
          ...recommendationGuarded,
          text: unrestated.text,
        };
        if (guarded.removed > 0) {
          logger?.warn(
            { qRunId: request.runId, removed: guarded.removed },
            "recommendation claims removed from a Q answer",
          );
        }
        // Owner directive 15 Nov (voice): one authoritative result, with a
        // spoken form. The spoken form is held to the same sentence guards,
        // with the same sources, as the answer above, so a figure the
        // answer corrects is said corrected, a sentence it drops is not
        // said, and "unknown" is never said of a figure a document read
        // this turn states. spokenFormWithin then holds it to the final
        // answer (persistAnswer). Applied once the model's reply is whole,
        // before anything is handed to the voice: no first-audio cost.
        const spokenChecked = spokenHeldToAnswerGuards(
          analystSpokenOf(analyst),
          {
            actionTalk: [...analyst.actionTalk, ...offerRemoved],
            requestedValues: requestedChangeValues(analyst, latest.content),
            deferred: startedThisTurn
              ? null
              : {
                  asked: askedOf(latest.content, earlier),
                  previous:
                    [...earlier].reverse().find((m) => m.role === "Q")
                      ?.content ?? null,
                },
            staleFailures:
              request.turnKind !== "TOOL_REQUEST" &&
              toolCalls.every(
                (call) =>
                  offeredByName.get(call.providerName)?.classification ===
                    "READ_ONLY" ||
                  offeredByName.get(call.providerName)?.classification ===
                    "ANALYTICAL",
              ),
            investor: askerSideOf(request) === "INVESTOR",
            gateqHeld: gateqHeld(),
            publicSources,
            grounds: groundsNow(),
            documents: documentsThisTurn,
            corpus: () =>
              claimCorpus(claimSources(), new Date(), claimEchoes()),
            promiseGrounds: promiseGrounds(),
          },
        );
        if (spokenChecked.changed > 0) {
          logger?.info(
            { qRunId: request.runId, changed: spokenChecked.changed },
            "q spoken form held to the answer's guards; sentences corrected or left out",
          );
        }
        // What the person stated about their own company, recorded as their
        // claim through the knowledge gate — only when the quote is their own
        // words and the conversation is about a company they own
        // (CQ-Q-RESEARCH-001 §21, §40). The answer says so, deterministically.
        took("guards");
        // Only a turn that states something puts a statement on the
        // record: an instruction, a permission or talk about the
        // conversation is not a claim about their company (live
        // 2026-10-02: "I'm giving you full permission…" came back as
        // "Noted as your statement").
        const recordedStatements = statesSomething(request.turnKind)
          ? await recordUserStatements(
              dependencies.statements,
              request,
              latest.content,
              analyst.userStatements,
              logger,
            )
          : [];
        /**
         * A change the person asked for to their own profile (ADR 0011).
         * The model read it; only a reading whose quote is actually in the
         * person's message, about the one company this conversation is
         * about, is handed on. The proposer, the Approval Engine and the
         * owning context decide the rest; this answer only says it is
         * ready for them.
         */
        const companies = request.subjects.filter((s) => s.kind === "COMPANY");
        const ownCompany = companies.length === 1 ? companies[0] : undefined;
        const said = latest.content.toLowerCase();
        // Read again through the schema: the field is a model's, defaulted
        // by the parse in production and absent from a hand-built result.
        const readUpdates = z
          .array(ProfileUpdateSchema)
          .safeParse(analyst.profileUpdates);
        const quoted = readUpdates.success
          ? readUpdates.data.filter((update) =>
              said.includes(update.quote.toLowerCase()),
            )
          : [];
        const kept = await Promise.all(
          quoted.map((update) =>
            clearsOnPurpose(update, dependencies.clearCheck, request.tenantId),
          ),
        );
        const profileUpdates = quoted.filter((_, index) => kept[index]);
        const proposed =
          dependencies.profileUpdates !== undefined &&
          ownCompany !== undefined &&
          ownCompany.kind === "COMPANY" &&
          profileUpdates.length > 0;
        if (proposed && ownCompany.kind === "COMPANY") {
          dependencies.profileUpdates?.note({
            runId: request.runId,
            tenantId: request.tenantId,
            companyId: ownCompany.companyId,
            updates: profileUpdates,
          });
          logger?.info(
            {
              qRunId: request.runId,
              fields: profileUpdates.map((u) => u.field),
            },
            "profile change read from the person's words; handed to the proposer",
          );
        }
        /**
         * Their own name (ADR 0011). Read the same way: through the schema,
         * quote in the message, and only where a proposer exists to carry
         * it. One proposal per run: a company change already noted wins,
         * and the name is asked for again next turn.
         */
        const readName = DisplayNameRequestSchema.nullable().safeParse(
          analyst.displayName,
        );
        const displayName =
          readName.success &&
          readName.data !== null &&
          said.includes(readName.data.quote.toLowerCase())
            ? readName.data
            : null;
        const proposedName =
          displayName !== null &&
          !proposed &&
          dependencies.profileUpdates?.noteDisplayName !== undefined;
        if (proposedName && displayName !== null) {
          dependencies.profileUpdates?.noteDisplayName?.({
            runId: request.runId,
            tenantId: request.tenantId,
            userId: request.actorUserId,
            displayName: displayName.value,
            quote: displayName.quote,
          });
          logger?.info(
            { qRunId: request.runId },
            "a change to what Q calls the person was read; handed to the proposer",
          );
        }
        // No "I've prepared that change" here (CQ-QACT-001, F7): noting a
        // request is not preparing one. The action port says it, from the
        // proposal it actually created or the refusal it actually got.
        /**
         * The answer is about whether a change is saved, approved or
         * waiting (v15 proposalStatus, the model's reading of meaning):
         * the status is stated from the Approval Engine's records, never
         * from the model's words, which went out as actionTalk. Not when
         * this turn already says it: an approval by conversation has its
         * own line, and a change prepared this turn shows its own card.
         */
        // A change read from their words this turn (proposed/proposedName)
        // is handed to the proposer and gets its own card after this
        // answer (live 2026-10-02: "write a description... save it, I
        // approve" was told "nothing is waiting", then shown the card).
        const preparedThisTurn =
          proposed ||
          proposedName ||
          toolCalls.some((call) => {
            const kind = offeredByName.get(call.providerName)?.classification;
            return (
              call.status === "SUCCEEDED" &&
              kind !== undefined &&
              kind !== "READ_ONLY" &&
              kind !== "ANALYTICAL"
            );
          });
        /**
         * A parity gap (HARDEN, ADR 0040 with QA, 2026-10-02): they asked Q
         * to do something and this answer did nothing -- no change
         * prepared, no screen action, no document, no approval. Every such
         * turn is logged under one key, with what was offered and what was
         * tried, so each miss is seen rather than found live.
         */
        let parityGap: string | null = null;
        if (
          request.turnKind === "TOOL_REQUEST" &&
          !preparedThisTurn &&
          clientActionBlocks.length === 0 &&
          approvalLine === null &&
          gaps === null &&
          request.writingDocument !== true
        ) {
          // Which kind of miss, from names only (TURN_READER v30
          // askedAction against this run's offer and calls): the registry
          // has no such action; it does, but this run did not offer it; it
          // was offered and not called; or called and it did nothing.
          const asked = request.askedAction;
          const gap =
            asked === undefined
              ? "NOT_IN_REGISTRY"
              : !offeredByName.has(asked)
                ? "DECLARED_NOT_OFFERED"
                : toolCalls.some((call) => call.providerName === asked)
                  ? "CALLED_DID_NOTHING"
                  : "NOT_CALLED";
          logger?.warn(
            {
              key: "q.parity_gap",
              gap,
              declaration: asked ?? null,
              qRunId: request.runId,
              offered: offered.length,
              called: toolCalls.map(
                (call) => `${call.providerName}:${call.status}`,
              ),
              refusedOrFailed: toolCalls
                .filter((call) => call.status !== "SUCCEEDED")
                .map((call) => call.failureCode ?? call.status),
              actionTalk: analyst.actionTalk.length,
            },
            "q.parity_gap",
          );
          parityGap = gap;
        }
        // D15: where a diligence request stands is the request's (said
        // above), never its approval card's "is saved".
        const onlyDiligence =
          requestStateSaid &&
          receipts.every(
            (receipt) =>
              receipt.kind !== "ACTION" ||
              receipt.actionType.startsWith("app.diligence."),
          );
        // Live 17 Nov 2026 (conversation 9995dcca, runs 6e9480e3 and
        // 2402ea97): the model's own proposalStatus flag was not set, so
        // "it was approved and sent" and, two minutes later, "the fee
        // question was never sent" both stood, from inference, about one
        // card. Whether a change of Q's was prepared, approved or sent is
        // said from the records this turn read (receipts), whenever the
        // draft says it at all -- never from the model's flag alone.
        const claimsRecordStatus =
          !preparedThisTurn &&
          receipts.some((receipt) => receipt.kind === "ACTION") &&
          claimsChangeStatus(guarded.text);
        if (claimsRecordStatus) {
          logger?.info(
            { qRunId: request.runId },
            "q's draft said what became of a change; the record says it instead",
          );
        }
        const statusLine =
          (analyst.proposalStatus || claimsRecordStatus) &&
          approvalLine === null &&
          !preparedThisTurn &&
          !onlyDiligence &&
          dependencies.receipts !== undefined
            ? proposalStatusLine(receipts)
            : null;
        // Live 2026-10-29: a reply to Q's other offer ("yes" to opening
        // Settings) acted elsewhere while a card still waited, and nothing
        // said so. The engine's waiting line follows such a turn; never
        // beside a status line, a decided approval or a new proposal.
        const proposedNow =
          proposed ||
          proposedName ||
          toolCalls.some(
            (call) =>
              call.status === "SUCCEEDED" &&
              call.providerName.startsWith("propose_"),
          );
        const actedElsewhere =
          clientActionBlocks.length > 0 ||
          toolCalls.some((call) => {
            const kind = offeredByName.get(call.providerName)?.classification;
            return (
              call.status === "SUCCEEDED" &&
              kind !== undefined &&
              kind !== "READ_ONLY" &&
              kind !== "ANALYTICAL"
            );
          });
        const waitingLine =
          statusLine === null &&
          approvalLine === null &&
          !proposedNow &&
          actedElsewhere &&
          (request.turnKind === "ANSWER" ||
            request.turnKind === "TOOL_REQUEST") &&
          dependencies.receipts !== undefined
            ? waitingCardLine(receipts)
            : null;
        // The engine's status replaces the model's: its status sentences
        // go, and its one offer follows the status line, so the answer
        // never says both "nothing is waiting" and "it needs your
        // approval" (QA run 5fd903d3).
        const statusTalk =
          statusLine === null && !preparedByTool && parityGap === null
            ? null
            : withoutStatusTalk(guarded.text);
        if (statusLine !== null) {
          logger?.info(
            {
              qRunId: request.runId,
              actionTalkRemoved: spoken.removed,
              statusTalkRemoved: statusTalk?.removed ?? 0,
            },
            "an answer about a change's status was given the engine's status",
          );
        }
        // Filling their profile's gaps: one short line from code, plus
        // the card -- never the model's argument about verification.
        const gapsSaid = gaps === null || gaps.line.length === 0 ? null : gaps;
        // A request is never answered with a status line alone (lead
        // 2026-10-03, run 5dd9bec5: "Ask Ledgerfold for their last 12
        // months of management accounts." was answered only "Nothing is
        // waiting for your approval…"). When nothing was done and nothing
        // else is said, Q says plainly what it could not do, and why.
        // Whatever else the model said: a request with nothing done gets
        // the could-not line, and the status of earlier changes never
        // stands in for it (lead 2026-10-03, run 9b4ef8d1: "…active and
        // shareable." plus "Nothing is waiting for your approval…").
        // QA 2026-10-24: the confirmation of a remember ask is said by
        // code, the same way every time ("You pass on tobacco
        // businesses." was the model's whole reply on one run, "I'll
        // remember that…" on the one before).
        const rememberLine = rememberConfirmation(request.rememberAsk);
        // A8 (owner priority, 13 Nov 2026): a chart they asked for (the
        // reader's asksForChart) is drawn by code from the figures this
        // run read under the firewall, never from the answer's words. None
        // honest to draw: the could-not line below says so plainly.
        const askedChart = chartAsked ? chartAskOutcome([]) : null;
        const couldNot =
          parityGap !== null &&
          // The record's status line answers a turn about one of Q's own
          // changes; "I didn't prepare that" beside it contradicted a card
          // Q had prepared (live 17 Nov 2026, run a7ea1414).
          !(claimsRecordStatus && statusLine !== null) &&
          actedLines.length === 0 &&
          madeLines.length === 0 &&
          gapsSaid === null &&
          !preparedByTool &&
          // The answer already says why nothing was done ("you're already
          // in diligence with Ajopot"): the could-not line after it would
          // contradict it (lead 2026-10-03, run 2078f553).
          !explainsNothingDone(statusTalk?.text ?? guarded.text) &&
          // A reply that asks them something ("Would you like me to…?")
          // is waiting on them; a could-not line after it contradicts the
          // question (QA run 4e3b1903).
          // Guard F-106 (2026-10-25, runs 891e2a3d, c6561774): "I drafted a
          // short traction update… Want me to show you the draft?" with no
          // draft anywhere. A question never shields a claim of work that
          // was not done.
          (claimsDone(statusTalk?.text ?? guarded.text) ||
            !asksThePerson(statusTalk?.text ?? guarded.text)) &&
          // QA 2026-10-23: the could-not line was appended in English
          // after the model's own reply in Arabic ("لم أستطع فتح صفحة
          // الاكتشاف"). The checks above read English words only, so a
          // reply in another script is taken as its own account of what
          // happened, in the person's language.
          !repliedInOtherScript(statusTalk?.text ?? guarded.text) &&
          // QA 2026-10-24: "Remember: I pass on gambling businesses." was
          // answered "I'll remember that…" and then "I didn't prepare
          // that…": what they tell Q to remember is kept from their words
          // (the memory write gate), with no tool to call: code says it
          // will remember (below), and that is the whole answer.
          rememberLine === null &&
          // No action named and the turn answered with what was asked for
          // (QA F-71: "Show my pipeline" answered with findings and cards,
          // then "I didn't get that done…"): an answer, not a miss.
          !(
            parityGap === "NOT_IN_REGISTRY" &&
            (analyst.findings.length > 0 || analyst.answerCards !== null)
          )
            ? parityGap === "NOT_CALLED" &&
              request.askedAction !== undefined &&
              MESSAGE_TOOLS.has(request.askedAction) &&
              // The draft is only "that draft" when it is still said.
              !claimsDone(statusTalk?.text ?? guarded.text)
              ? // Guard run 1 (2026-10-25, run b6f9236c): the draft was
                // written above; "I didn't prepare that" contradicted it.
                DRAFT_NOT_ON_CARD_LINE
              : askedChart?.kind === "DRAWN"
                ? // The chart they asked for is drawn: that is what was done.
                  null
                : couldNotLineFor(
                    parityGap,
                    chartAsked,
                    statusTalk?.text ?? guarded.text,
                    askedChart,
                  )
            : null;
        if (couldNot !== null) {
          logger?.warn(
            { qRunId: request.runId, gap: parityGap },
            "a request had nothing done and nothing said; Q says it could not",
          );
        }
        // The closing line streams after the model's last sentence, as the
        // stored answer has it, so a live reader does not wait for the
        // completed message to see it.
        if (
          request.closingLines !== undefined &&
          couldNot === null &&
          gapsSaid === null &&
          streamedText.length > 0
        ) {
          streamedText += `${request.closingLines} `;
          sendSaid(`${request.closingLines} `);
        }
        let content = (
          gapsSaid !== null
            ? [...(approvalLine === null ? [] : [approvalLine]), gapsSaid.line]
            : [
                ...(approvalLine === null ? [] : [approvalLine]),
                ...(rememberLine === null ? [] : [rememberLine.line]),
                // Code's opening lines for this answer, before the model's.
                ...(leadLines === undefined ? [] : [leadLines]),
                // XLSX-002: what a document tool made and could not fill,
                // in its own words, before the model's (one offer at most).
                ...madeLines,
                // Nothing was done: a model line that says it was is
                // false, and is not said beside the could-not line
                // (follow-55, Zino run 50159909: "Your investment stages
                // are now recorded…" then "I didn't prepare that").
                ...(couldNot !== null &&
                claimsDone(statusTalk?.text ?? guarded.text)
                  ? []
                  : [
                      ((said: string) =>
                        request.closingLines !== undefined
                          ? withoutTrailingAsks(said)
                          : madeLines.length === 0
                            ? said
                            : atMostOneOffer(said))(
                        // HQ-2 slice 3: no closing offer where none is allowed.
                        ((kept: string) =>
                          // HQ-5: a discovery turn asks one question.
                          // HQ-7: a callback that quotes is not kept.
                          withoutQuotedCallback(
                            discoveryAsked(
                              request,
                              modelOfferAllowed(request) === false
                                ? withoutTrailingOffers(kept)
                                : kept,
                            ),
                            memoryCallback,
                          ))(
                          withoutRememberTalk(
                            leadLines === undefined
                              ? (statusTalk?.text ?? guarded.text)
                              : afterLeadLines(
                                  statusTalk?.text ?? guarded.text,
                                  leadLines,
                                ),
                            rememberLine,
                          ),
                        ),
                      ),
                    ]),
                ...(couldNot === null ? [] : [couldNot]),
                // Code's closing line (the offer of a full plan), after the
                // model's words and only when the request was answered.
                ...(request.closingLines === undefined || couldNot !== null
                  ? []
                  : [request.closingLines]),
                ...actedLines,
                ...(figureCardLine === null ? [] : [figureCardLine]),
                // Addendum 14 Nov: what was checked, the relationship step,
                // or code's own offer through the authorised vehicle.
                ...uncertaintyLines,
                // The status of earlier changes is not an answer to this
                // request, and is not said in its place.
                ...(statusLine === null || couldNot !== null
                  ? []
                  : [statusLine]),
                ...(waitingLine === null || couldNot !== null
                  ? []
                  : [waitingLine]),
                // The card the engine shows is the offer when one was
                // prepared; otherwise the model's one offer follows.
                ...(statusTalk?.offer == null ||
                preparedByTool ||
                couldNot !== null
                  ? []
                  : [statusTalk.offer]),
                ...(recordedStatements.length === 0
                  ? []
                  : [quietlyNoted(recordedStatements)]),
              ]
        )
          // A part emptied by the guards above leaves no blank gap.
          .filter((part) => part.trim().length > 0)
          .join("\n\n")
          .slice(0, ANSWER_LIMIT_CHARS)
          .trim();
        // RECOVERY G-D3: a proposal prepared this turn is the answer even
        // when every sentence about it was Capital Q's to say and went
        // ("I've prepared that reminder for you to approve." failed the
        // turn and lost the card). Prepared, never done: the card waits.
        const proposalPrepared =
          preparedByTool ||
          toolCalls.some((call) => {
            const kind = offeredByName.get(call.providerName)?.classification;
            return (
              call.status === "SUCCEEDED" &&
              call.providerName.startsWith("propose_") &&
              kind !== undefined &&
              kind !== "READ_ONLY" &&
              kind !== "ANALYTICAL"
            );
          });
        if (content.length === 0 && proposalPrepared) {
          logger?.info(
            { qRunId: request.runId },
            "an answer emptied by the status guards kept its prepared change",
          );
          // Batch 19: what the change will change, before approval.
          content =
            preparedLines.length > 0
              ? preparedLines.join("\n\n")
              : PREPARED_FOR_APPROVAL_LINE;
        }
        if (content.length === 0 && spoken.removed === 0) {
          logger?.warn(
            { qRunId: request.runId },
            "an answer had nothing left to say after the guards; the turn failed",
          );
          return {
            kind: "FAILED",
            diagnosticCode: "MODEL_PROVIDER_UNAVAILABLE",
          };
        }
        /**
         * A change to a document Q already prepared (QX-003F; ADR 0013).
         *
         * Read from the same closed schema field the specialist seam
         * reads, checked against the person's own words, and acted on by
         * the artifact application service — which finds the document
         * from this conversation's own cards and re-authorises it. A
         * model that filled the field has asked, not acted.
         */
        const askedForArtifact =
          analyst.artifactRequest !== null &&
          analyst.artifactRequest !== undefined &&
          said.includes(analyst.artifactRequest.quote.toLowerCase())
            ? analyst.artifactRequest
            : null;
        const revisedArtifact =
          askedForArtifact === null ||
          askedForArtifact.kind !== "REVISE" ||
          dependencies.artifacts === undefined
            ? null
            : await dependencies.artifacts
                .reviseFromConversation({
                  actor: request.actor,
                  plan: request.plan,
                  runId: request.runId,
                  // Their own words when the model put the change in the
                  // quote and left the field empty. Acting on an empty
                  // instruction is not something to attempt.
                  instruction:
                    askedForArtifact.instruction.length > 0
                      ? askedForArtifact.instruction
                      : latest.content,
                  history,
                  ...(request.signal === undefined
                    ? {}
                    : { signal: request.signal }),
                })
                .catch((error: unknown) => {
                  // A document that could not be changed must not take
                  // the answer down with it, but it must not be silent
                  // either: this is the only place the failure is visible.
                  logger?.warn(
                    { qRunId: request.runId, err: error },
                    "artifact revision did not complete",
                  );
                  return null;
                });
        const companiesRead = runCompanies.take(request.runId);
        const namedSubjects = namedCompanySubjects(
          latest.content,
          companiesRead,
        );
        const mentionsReadName = [...companiesRead.profiles.values()].some(
          (name) => containsCompanyName(latest.content, name),
        );
        // The reader can mark an investor's selected company as "other".
        // A deictic single-company question still targets the authorized
        // screen profile. Explicit names take precedence; ambiguity stays
        // unbound. Never establish the screen target without a fresh read.
        const screenCompanyId =
          plan.screen?.route === "COMPANY" || plan.screen?.route === "DISCOVER"
            ? (plan.screen.companyId ?? null)
            : null;
        const selectedCompanySubjects =
          !mentionsReadName &&
          (isSingleCompanyQuestion(latest.content) ||
            (screenCompanyId !== null &&
              namesOnlyCompany(
                latest.content,
                companiesRead.profiles.get(screenCompanyId) ?? null,
              ))) &&
          !readAsComparison(request) &&
          screenCompanyId !== null &&
          companiesRead.profiles.has(screenCompanyId)
            ? askedSubjects(request.subjects, plan).filter(
                (subject) =>
                  subject.kind === "COMPANY" &&
                  subject.companyId === screenCompanyId,
              )
            : [];
        // Screen focus is not the target of a question naming another
        // company. Its reference must come from an exact name and a
        // successful authorised profile read, never a model-written id.
        // Ordinary screen questions retain the run's allowed subjects.
        // Batch 19 (owner live 9 Nov: "Company · 1" on a mandate change):
        // a turn whose only act was on their own records carries no
        // other subject's card -- the conversation's company was not
        // what it was about.
        const answerSubjects =
          ownRecordsOnly === true
            ? []
            : request.aboutNamedOther === true
              ? namedSubjects.length > 0
                ? namedSubjects
                : selectedCompanySubjects
              : askedSubjects(request.subjects, plan);
        // Scenario E: each company card counts the documents this run
        // listed as readable to them (shared, or open in the data room).
        const readableByCompany = (): ReadonlyMap<string, number> => {
          const counts = new Map<string, number>();
          for (const [companyId, documents] of sharedDocumentsByRun.get(
            request.runId,
          ) ?? []) {
            counts.set(
              companyId.toLowerCase(),
              readableListed(documents).length,
            );
          }
          return counts;
        };
        const modelBlocks = analystResultBlocks({
          result: withConversationFindings(analyst),
          question: latest.content,
          // Slice 1b: the public pages this run read are citable as S<n>.
          supplied: new Map([
            ...suppliedStandings,
            ...publicStandingsOf(publicSources),
            // Pages earlier research here read: citable by site or S1xx.
            ...publicStandingsOf(
              earlierPages.filter(
                (page) =>
                  !publicSources.some((known) => known.url === page.url),
              ),
            ),
          ]),
          // A finding already shown live keeps the id it was shown under.
          findingId: (_index, statement) =>
            liveFindingIds.get(findingKey(statement)) ?? randomUUID(),
          subjects: answerSubjects,
          // RECOVERY E4: investors and places this run's tools returned,
          // so investor cards and maps name only what was read.
          read: companiesRead,
        })?.map((block) =>
          block.kind === "ANSWER_CARDS"
            ? // QO-06: one fit scale, the platform's, where it computed one.
              // F-133: every card's levels are code's, never the model's.
              withReadableSourceCounts(
                withCodeFitMeasures(
                  withPlatformFit(
                    withCardSubjects(block, companiesRead),
                    runFits.read(request.runId),
                  ),
                  {
                    investorFit: (id) =>
                      [...companiesRead.investors.values()].find(
                        (investor) => investor.investorOrganisationId === id,
                      )?.fit,
                    isPlatform: isPlatformFitCard,
                  },
                ),
                readableByCompany(),
              )
            : block,
        );
        // Zino live 2026-10-07: a list with scores came back with no cards.
        // When the model wrote none and this run's tools computed two or
        // more fits, code lays them out from those fits (deterministic,
        // the platform's own scores and reasons).
        const fitsRead = runFits.take(request.runId);
        const fitCards = (modelBlocks ?? []).some(
          (block) => block.kind === "ANSWER_CARDS",
        )
          ? null
          : fitAnswerCardsBlock(fitsRead, content, {
              // Fits code read for a plain list question: cards only for
              // what the answer names.
              // RC2: a condition code could not apply never comes back
              // as the plain ranking's cards: only what the answer names.
              namedOnly:
                listConditionsUnhonoured ||
                (sweep !== null && !sweep.ask.fitAsked),
            });
        const builtCards =
          fitCards === null
            ? null
            : withReadableSourceCounts(fitCards, readableByCompany());
        if (builtCards !== null) {
          logger?.info(
            { qRunId: request.runId, cards: builtCards.cards.length },
            "answer cards built from this run's fits",
          );
        }
        // L-13: a picture only when the analyst asked for one, searched
        // with words composed from the person's own (never sent as the
        // model wrote them), and bounded so it cannot hold the turn.
        // QA F-17 and QO-09 (2026-10-23): a picture of whom the turn is
        // about only where evidence ties its site to them -- their website
        // on Capital Q, or a site this turn's searches matched to them
        // (said to be uncertain where those pages only may be them). A
        // namesake's (LEGO DUPLO on eBay, a bus air-conditioning maker for
        // "Spheros") never; and never a stock illustration in its place.
        const namedSubject =
          typeof namedForPictures === "string" ? namedForPictures : null;
        const held =
          namedSubject === null
            ? null
            : heldOnRecord(companiesRead, namedSubject);
        // F-135 (production 2026-10-26, run 57fbf492): Capital Q holds a
        // company by this name, but its identity was not read this run (the
        // profile read failed), so nothing could tell its pages from a
        // namesake's and "Lego Duplo - Wikipedia" was shown as Duplo. A
        // company on record is pictured only against its held identity,
        // never by its name alone. A name Capital Q does not hold keeps the
        // research's own verdict ("not sure this is them").
        const unheldOnRecord =
          namedSubject !== null &&
          held === null &&
          namedOnRecord(companiesRead, namedSubject);
        // Only when a picture could be shown (spend rule 2026-10-25): their
        // website on record, or pages this turn's searches matched to them.
        const couldShow =
          !unheldOnRecord &&
          ((held?.website ?? null) !== null ||
            webEvidence.some(
              (source) =>
                source.subjectMatch === "MATCH" ||
                source.subjectMatch === "POSSIBLE",
            ));
        const fromPages =
          webPictures === null || namedSubject === null || !couldShow
            ? []
            : publicPictureBlocks(
                corroboratedPictures(
                  (await settledWithin(webPictures(), PICTURE_WAIT_MS)) ?? [],
                  {
                    name: namedSubject,
                    website: held?.website ?? null,
                    held,
                    sources: webEvidence,
                  },
                ),
                new Date().toISOString(),
              );
        // A stock illustration only for a turn about no one in particular.
        const picture =
          fromPages.length > 0 || namedSubject !== null
            ? null
            : await pictureBlock({
                result: analyst,
                pictures: dependencies.pictures,
                userText: toolContext.conversation?.latestUserText ?? "",
                earlierUserText:
                  toolContext.conversation?.earlierUserText ?? [],
                withheld: namesReadByRun(companiesRead),
                privateText: toolContext.conversation?.privateText?.() ?? [],
                signal: request.signal,
              });
        // Owner 23 Oct 2026: "compare them side by side" is a table, built
        // by code from this run's authorised reads (profiles and fits).
        // QO-05: the generic "as each company states it" table yields to
        // the comparison built from fit, never sits beside it.
        const comparedTable = (modelBlocks ?? []).some(
          (block) =>
            block.kind === "TABLE" && block.title !== COMPANIES_TABLE_TITLE,
        )
          ? null
          : comparisonTableBlock({
              question: latest.content,
              read: companiesRead,
              fits: fitsRead,
              ...(compareIds.length >= 2 ? { only: compareIds } : {}),
              compareAsked: comparisonAsked(
                request,
                latest.content,
                asksToCompare,
              ),
              shown: answerCardCompanies([
                ...(modelBlocks ?? []),
                ...(builtCards === null ? [] : [builtCards]),
              ]).map((card) => card.companyId),
            });
        if (answerVerdict === null && comparedTable !== null) {
          answerVerdict = comparisonVerdict(comparedTable, fitsRead);
        }
        // live6: a follow-up about the companies already side by side on
        // their screen answers in words; the verdict above still holds.
        const tableToShow =
          comparedTable !== null && comparisonOnScreen(earlier, comparedTable)
            ? null
            : comparedTable;
        // Slice 2 (12 Nov): the dated public pages this turn read about the
        // one company or person it names, in date order -- code's layout of
        // what was read, never a date the model wrote. A model timeline wins.
        const publicRecord =
          namedSubject === null ||
          (modelBlocks ?? []).some((block) => block.kind === "TIMELINE")
            ? null
            : publicRecordTimeline({
                name: namedSubject,
                sources: publicSources,
                matched: (url) => {
                  const match = pageSubjectMatch.get(url);
                  return match === "MATCH" || match === "POSSIBLE";
                },
              });
        // Gap 2 (12 Nov): where the company's own figure and a public page
        // read this turn or earlier in the investigation disagree, both are
        // shown, unreconciled. Code's reading; no model call.
        const conflictPages = [
          ...webEvidence.map((source) => ({
            domain: source.domain,
            excerpt: source.text,
            subjectMatch: source.subjectMatch,
          })),
          ...earlierPages,
        ];
        const conflicts = [
          ...figureConflictBlocks(
            figureConflicts({ facts: suppliedFacts, pages: conflictPages }),
          ),
          // Slice 2 (14 Nov): independent public reports that disagree with
          // each other, both kept (decision 92). Code; no model call.
          ...pageFigureConflictBlocks(pageFigureConflicts(conflictPages)),
        ];
        if (conflicts.length > 0) {
          logger?.info(
            { qRunId: request.runId, conflicts: conflicts.length },
            "q figure conflicts shown",
          );
        }
        // A8: the chart they asked for, or one beside the comparison table
        // when a comparable metric exists; from this run's figure reads
        // only (the run's read is taken above, so it is drawn here).
        const chartToShow = chartFor(
          [
            ...(modelBlocks ?? []),
            ...(tableToShow === null ? [] : [tableToShow]),
          ],
          companiesRead,
        );
        // A8 (owner 13 Nov 2026): the company this answer is about, with
        // its own Capital Q picture and, when they asked to watch it, its
        // pitch -- asked for by the reading (v86), for the answer's own
        // authorised company subjects, and only what the media context
        // lets this reader see or play. Unread or unasked: nothing.
        const companyMedia = await companyMediaFor({
          ask: request.companyMediaAsk,
          subjects: answerSubjects,
          actor: request.actor,
          port: dependencies.companyMedia,
          names: companiesRead.profiles,
        });
        if (request.companyMediaAsk !== undefined) {
          logger?.info(
            {
              qRunId: request.runId,
              askedPitch: request.companyMediaAsk.pitch,
              askedPicture: request.companyMediaAsk.picture,
              mediaBlocks: companyMedia.length,
              pitches: companyMedia.filter((block) => block.pitch !== null)
                .length,
            },
            "q company media",
          );
        }
        // Live d96c63ee1: the pitch plays inline; a failed attempt to also
        // open it on screen, and the could-not line after it, are not said.
        const pitchPlayed = companyMedia.find((block) => block.pitch !== null);
        if (pitchPlayed !== undefined) {
          const kept = withoutPitchFailureTalk(
            content,
            couldNot,
            pitchPlayed.name,
          );
          if (kept.removed > 0) {
            logger?.info(
              { qRunId: request.runId, removed: kept.removed },
              "the pitch plays in the answer; its failed screen attempt is not said",
            );
            content = kept.text;
          }
        }
        // One picture per company: its own picture stands in for a public
        // page's or a stock illustration, never beside them.
        const ownPictureShown = companyMedia.some((block) => block.image);
        const codeBlocks = [
          ...conflicts,
          ...discoveryBlocks(request),
          ...(builtCards === null ? [] : [builtCards]),
          ...(tableToShow === null ? [] : [tableToShow]),
          ...(chartToShow === null ? [] : [chartToShow]),
          ...(publicRecord === null ? [] : [publicRecord]),
          ...companyMedia,
          ...(ownPictureShown ? [] : fromPages),
          ...(picture === null || companyMedia.length > 0 ? [] : [picture]),
        ];
        const keptModelBlocks =
          comparedTable === null
            ? modelBlocks
            : modelBlocks?.filter(
                (block) =>
                  block.kind !== "TABLE" ||
                  block.title !== COMPANIES_TABLE_TITLE,
              );
        const analystBlocks =
          codeBlocks.length === 0
            ? keptModelBlocks
            : [...(keptModelBlocks ?? []), ...codeBlocks];
        // An answer that was nothing but talk about acting leaves Capital
        // Q's own lines — the revision below, the action's own narration —
        // to say what happened. Alone, it is acknowledged and no more.
        // voiceq-63 (live 2026-10-04, run 87391453): "open the PDF…"
        // opened it, the claim was removed from the words, and the person
        // heard only "Understood.". A screen move that went through says so.
        const openedOnScreen = (analystBlocks ?? []).some(
          (block) =>
            block.kind === "UI_INTENT" &&
            block.intent.kind === "OPEN_RECORD_PAGE",
        );
        // R0 (Zino live 2026-10-06, run d6377e69): "now in view" with
        // nothing opened. The stored answer follows the spoken rule.
        const screenSafe = withoutUnbackedScreenClaims(
          content,
          openedOnScreen ||
            [...(analystBlocks ?? []), ...clientActionBlocks].some(
              // Cards, tables, pictures and documents are on their screen
              // as the answer arrives (QA F-111).
              (block) => DRAWN_BLOCK_KINDS.has(block.kind),
            ),
          askedToOpen(latest.content),
        );
        // Lane A: "here's the table" / "see the map" stands only when the
        // answer carries that kind of object (artifact-claims.ts).
        // What the browser confirms it has drawn backs a mention of it.
        const artifactSafe = withoutUnbackedArtifactClaims(
          screenSafe.text,
          [...(analystBlocks ?? []), ...clientActionBlocks],
          drawnOnScreen(plan.screen?.manifest?.drawn?.kinds),
        );
        if (artifactSafe.removed > 0) {
          logger?.warn(
            { qRunId: request.runId, removed: artifactSafe.removed },
            "an answer said a table, map, chart or timeline was shown that the answer did not carry; corrected",
          );
        }
        // The names went with the guard (orphan "Pros: …" sentences) and
        // code built the cards: say the gist, by name, and point at them.
        const cardsShown = (analystBlocks ?? []).some(
          (block) => block.kind === "ANSWER_CARDS",
        );
        // QO-08 (live 2026-10-23): with Express Interest prepared by code
        // for founders they are not connected with, the model still wrote
        // "this message tool only drafts notes to connected companies...
        // want me to?" -- naming a tool and asking permission for what was
        // asked and already prepared. The reply is code's own line; the
        // card's line (the note in full, "Ready to send") follows it.
        const answerText = firstContactPrepared
          ? FIRST_CONTACT_REPLY
          : firstContactAlready !== null
            ? firstContactAlready
            : askedMessageReply !== null
              ? askedMessageReply
              : builtCards !== null && hasOrphanListItems(artifactSafe.text)
                ? fitCardsSummary(builtCards)
                : request.spoken === true && cardsShown
                  ? spokenBeforeCards(artifactSafe.text)
                  : qCardRead !== null
                    ? withQCardLink(
                        artifactSafe.text,
                        qCardRead,
                        qCardClaimPrepared,
                      )
                    : artifactSafe.text;
        if (screenSafe.removed > 0) {
          logger?.warn(
            { qRunId: request.runId, removed: screenSafe.removed },
            "an answer said something was on screen that no tool opened; corrected",
          );
        }
        const reply =
          revisedArtifact === null
            ? answerText.length > 0
              ? answerText
              : openedOnScreen
                ? CLIENT_ACTION_DONE_LINE
                : (shownFindingsLine(analystBlocks) ?? "Understood.")
            : `${content}

I've updated **${revisedArtifact.title}** — that's version ${String(revisedArtifact.currentVersion)}. The previous version is still there, and nothing has been shared or sent.`.trim();
        const message = await persistAnswer(
          reply,
          revisedArtifact === null
            ? analystBlocks
            : [
                ...(analystBlocks ?? []),
                {
                  kind: "ARTIFACT_REFERENCE" as const,
                  artifactId: revisedArtifact.artifactId,
                  type: revisedArtifact.type,
                  status: revisedArtifact.status,
                  title: revisedArtifact.title,
                },
              ],
          gesturesForReply(reply, analyst.gestures),
          // A revised document's reply is code's own words: no spoken form.
          revisedArtifact === null ? spokenChecked.text : null,
        );
        last = {
          result: analyst,
          providerCode: final.providerCode,
          modelCode: final.modelCode,
          promptBundleVersion: rendered.bundle.bundleVersion,
          routingPolicyCode: final.routingPolicyCode,
          latencyMs: final.latencyMs,
          // Both writers' spend, when the extras were written apart.
          usage: {
            inputTokens:
              final.usage.inputTokens + (extrasUsage?.usage.inputTokens ?? 0),
            outputTokens:
              final.usage.outputTokens + (extrasUsage?.usage.outputTokens ?? 0),
          },
          costUsd: final.cost.amount + (extrasUsage?.cost.amount ?? 0),
          promptCharacters: rendered.characters,
          toolsOffered: offered.map((tool) => tool.definition.name),
          toolCalls,
          modelCalls,
        };
        logger?.info(
          {
            qRunId: request.runId,
            taskClass,
            budgetClass,
            reasoning: answerThinking.reasoning,
            reasoningKey: answerThinking.reasoningKey ?? null,
            promptBundleVersion: rendered.bundle.bundleVersion,
            promptCharacters: rendered.characters,
            provider: final.providerCode,
            model: final.modelCode,
            routingPolicy: final.routingPolicyCode,
            responseShape: analyst.responseShape,
            insufficientEvidence: analyst.insufficientEvidence,
            // HQ-2: what still reads robotic in the stored answer, by kind
            // only (never the words), and whether an offer was allowed.
            registerIssues: naturalRegisterIssues(content, {
              spoken: request.spoken === true,
              offerAllowed: modelOfferAllowed(request) ?? undefined,
            }),
            offerAllowed: modelOfferAllowed(request),
            attempts: final.attempts.length,
            fallbackUsed: final.fallbackUsed,
            latencyMs: final.latencyMs,
            costUsd: final.cost.amount,
            toolsOffered: offered.length,
            toolCalls: toolCalls.length,
            modelCalls,
            sharedReads: singleFlight.takeShared(request.runId),
            prepareMs: prepared.prepareMs,
            totalMs: Date.now() - startedAt,
            // I21: time to the comparison's table beside time to settle
            // (totalMs); null when none went up first.
            tableMs: tableFirstMs,
            tableSinceRunMs,
            totalSinceRunMs: sinceRun(),
            phases,
            // How much of the answer the person already had before the
            // turn finished. Zero means nobody was listening, or the
            // model wrote its object in an order this cannot read.
            streamedCharacters: streamedText.length,
            // HQ-6: streamed sentences the stored answer no longer holds,
            // by kind and count only (never the words; target 0 figures).
            retractions: streamRetractions(streamedSentences, content),
            firstPublishedMs,
            // Step 11: per-stage timing past the prepare. The model's first
            // words (seam start), the first sentence the person got counted
            // from their message (the p50/p95 bar), the reading-bound
            // search, and the per-sentence and final checks.
            firstTextMs,
            firstSentenceSinceMessageMs:
              firstPublishedMs === null
                ? null
                : (() => {
                    const at = Date.parse(latest.createdAt);
                    return Number.isFinite(at)
                      ? startedAt + firstPublishedMs - at
                      : null;
                  })(),
            retrievalRefineMs,
            checks: stageClock.snapshot(),
            // Round 5: the answer's output, and which parts it went to.
            outputTokens: final.usage.outputTokens,
            outputSplit: outputSplitOf(analyst),
            // Owner 2026-10-22: findings and cards written apart, and what
            // that second call cost.
            extrasJoin,
            extrasOutputTokens: extrasUsage?.usage.outputTokens ?? null,
            extrasCostUsd: extrasUsage?.cost.amount ?? null,
          },
          "q answer produced",
        );
        if (nudgeOffered && dependencies.onboardingNudge !== undefined) {
          // After the answer, never before: a failed answer offered nothing.
          await dependencies.onboardingNudge
            .markShown(request.actor, conversationId)
            .catch((error: unknown) => {
              logger?.warn(
                { err: error, qRunId: request.runId },
                "the setup reminder was not recorded as given",
              );
            });
        }
        const offerKept = offerStanding(offerBinding, reply);
        if (offerBinding.kind === "BOUND") {
          logger?.info(
            {
              qRunId: request.runId,
              action: offerBinding.offer.action,
              recorded: offerKept !== null,
            },
            "q answer closed with an offer",
          );
        }
        return {
          kind: "ANSWERED",
          messageId: message.id,
          modelPolicyVersion: final.routingPolicyCode,
          promptBundleVersion: rendered.bundle.bundleVersion,
          ...(offerKept === null ? {} : { offer: offerKept }),
        };
      } catch (error: unknown) {
        if (isModelGatewayError(error)) {
          /**
           * The answer was heard; the object around it was refused.
           *
           * Live, a person asked about their company, Q read the answer
           * out sentence by sentence, and then said it had hit a snag and
           * asked them to ask again. The final object had failed its
           * schema on a label in a citation list, a field the person never
           * sees. Nothing said can be unsaid, and an answer that was
           * delivered is not a failure: the prose that was read to them
           * stands as the answer, through the same guards as any other,
           * and the structured extras the schema refused are simply not
           * recorded for this turn. Only the prose the reader saw with
           * certainty is used: the whole answer when its closing quote was
           * seen, otherwise the sentences that were actually published.
           */
          if (error.failureClass === "INVALID_MODEL_OUTPUT") {
            const heard = partial.complete() ? seenAnswer : streamedText;
            /**
             * The structure was refused, so whatever the person asked Q
             * to change was not handed to anybody (CQ-QX-007 A5). Nothing
             * may then read as if it had been: the sentences the model
             * itself marked as talk about acting are removed, and when its
             * own reading carried a change, Capital Q says plainly that
             * nothing was changed. Read from the model's structured fields
             * where they parse, never from its words.
             */
            const unread = unreadActionOf(seenText);
            const salvaged = withoutRecommendationClaims(
              citeAuthorisedFacts(
                withoutPublicSourceLabels(
                  stripEmptyPromises(
                    withoutActionTalk(heard, unread.actionTalk).text,
                  ).text,
                  publicSources,
                ),
                facts,
              ),
              groundsNow(),
            )
              .text.concat(
                unread.requested ? `\n\n${UNPREPARED_CHANGE_LINE}` : "",
              )
              .slice(0, ANSWER_LIMIT_CHARS)
              .trim();
            // Founder live 2026-09-30: open_page opened the chat, then the
            // model's closing words came back empty and the whole turn
            // failed, so the screen never moved. What a tool already did
            // for them stands: it is said in a few plain words.
            const spoken =
              salvaged.length > 0
                ? salvaged
                : clientActionBlocks.length > 0
                  ? CLIENT_ACTION_DONE_LINE
                  : "";
            if (spoken.length > 0) {
              const message = await persistAnswer(spoken);
              logger?.warn(
                {
                  qRunId: request.runId,
                  taskClass,
                  promptBundleVersion: rendered.bundle.bundleVersion,
                  routingPolicy: error.routingPolicyCode,
                  answerComplete: partial.complete(),
                  streamedCharacters: streamedText.length,
                  answerCharacters: spoken.length,
                  toolCalls: toolCalls.length,
                  modelCalls,
                },
                "the answer's structure was refused after its text had been read; the text stands as the answer",
              );
              return {
                kind: "ANSWERED",
                messageId: message.id,
                modelPolicyVersion: error.routingPolicyCode ?? "unrouted",
                promptBundleVersion: rendered.bundle.bundleVersion,
              };
            }
          }
          logger?.warn(
            {
              qRunId: request.runId,
              taskClass,
              promptBundleVersion: rendered.bundle.bundleVersion,
              failureClass: error.failureClass,
              attempts: error.attempts,
              routingPolicy: error.routingPolicyCode,
              toolCalls: toolCalls.length,
              modelCalls,
            },
            "q answer not produced",
          );
          return {
            kind: "FAILED",
            diagnosticCode: diagnosticCodeFor(error.failureClass),
            // The service answered; its answer was malformed. Said as
            // such, never as an unreachable service (live b58ece1a) --
            // and only when no acting tool went through this run, since
            // the line says nothing was prepared or sent.
            ...(error.failureClass === "INVALID_MODEL_OUTPUT" &&
            !toolCalls.some(
              (call) =>
                call.status === "SUCCEEDED" &&
                actingByRun.get(request.runId)?.has(call.providerName) === true,
            )
              ? { cause: "MALFORMED_OUTPUT" as const }
              : {}),
          };
        }
        throw error;
      }
    },
  };
}
// Q Workspace W4 (DECISIONS 71): the page pane's MOVE / OFFER / STAY.
export {
  applyNavigationPolicy,
  gateByReading,
  readingPlacesContext,
  readingTabPlace,
  pitchOnElevator,
  subjectPlace,
  sameSubject as sameNavigationSubject,
  canOpenFor,
  pinnedOf,
  pinnedLine,
  pinnedBlocks,
  completeScreen,
  namesARecord,
  refinesPlace,
  createQNavigationDecider,
  createQPageMoves,
  sideOfRequest,
  decideNavigation,
  navigationVariables,
  findListedRecord,
  listedRecordResolver,
  resolveNavigationPlace,
  resolveNavigationPlaceWith,
  resolveAlternative,
  NAVIGATION_DECISION_REASONING,
  NAVIGATION_VOTES,
  NAVIGATION_DECISION_DEADLINE_MS,
  NAVIGATION_SETTLE_GRACE_MS,
  NAVIGATION_LATE_LIMIT_MS,
  voteNavigation,
  sampleForLog,
  type QNavigationSample,
  NAVIGATION_DECISION_TASK_CLASS,
  navigateTargetFromPath,
  navigationPaneFromWorkspace,
  ownPlace,
  navigationSiteMap,
  samePlace as sameNavigationPlace,
  sitePlaceToTarget,
  targetToSitePlace,
  type QResolvedIds,
  type QSitePlace,
  type QNavigationDecider,
  type QNavigationGuard,
  type QNavigationInput,
  type QNavigationOutcome,
  type QNavigationPane,
  type QNavigationPolicyConfig,
  type QNavigationRecordAsk,
  type QNavigationRecordFound,
  type QNavigationRecordResolver,
  type QNavigationRecords,
  type QNavigationResolution,
  type QNavigationSide,
  type QWorkspaceScreen,
  type QPageMovePort,
  type QPageMoveTurn,
  type QPageMoveReading,
  type QPageMoveSubject,
  type QPlacedSubject,
} from "./navigation-decision.js";
// W3-A: moved verbatim into sibling modules; the public surface is unchanged.
export {
  ANSWER_REASONING_V1,
  answerReasoning,
  answerReasoningKey,
  answerShapeNoteOf,
  answerTaskClass,
  ARRIVAL_SKIM_GRACE_MS,
  askPartsNote,
  budgetForTaskClass,
  CLIENT_ACTION_DONE_LINE,
  comparisonAsked,
  diagnosticCodeFor,
  discoveryAsked,
  discoveryBlocks,
  fixedCommunicationProfile,
  modelOfferAllowed,
  namedInFactsNote,
  noAuthorisedContext,
  operatingModeForCapability,
  OUTWARD_FOLLOW_ON_RESERVE,
  Q_TOOL_LOOP_MAX_CALLS,
  Q_TOOL_LOOP_MAX_ROUNDS,
  type QAnswerSensitivityPolicy,
  type QAuthorisedContextPort,
  type QCommunicationProfilePort,
  readAnswerKinds,
  readAsComparison,
  taskClassForCapability,
  withoutTrailingOffers,
} from "./answer-plan.js";
export {
  ACTS_HELD_BACK_NOTE,
  ANALYST_LENIENT_FIELDS,
  ANALYST_RESULT_SCHEMA,
  companyCardNamesOfLastQ,
  conversationStateNote,
  DISCUSS_VERSUS_DO,
  noMatchLast,
  OWN_MANDATE_NOTE,
  PREPARED_FOR_APPROVAL_LINE,
  PROSPECT_RESEARCH_BELOW,
  PROSPECT_RESEARCH_NOTE,
  referencesNote,
  RESEARCH_LEAD_AFTER_MS,
  SAY_DO_NOTE,
  screenActMissLine,
  screenActsNote,
  screenSubjectNote,
  shownCompanyCard,
  shownContextNote,
  WEB_BESIDE_RECORDS_NOTE,
  withoutLandedClaims,
  withoutStaleFailures,
} from "./turn-notes.js";
export {
  analystSpokenOf,
  boundedRefinement,
  CAPABILITIES_NOTE,
  CAPITAL_Q_COMPANY_NOTE,
  CLEAR_QUESTION,
  type ClearCheck,
  clearsOnPurpose,
  DISPLAY_NAME_NOTE,
  ENVIRONMENT_NOTES_MAX_CHARS,
  EXPRESSIVE_NOTE,
  LIKELY_INTENT_NOTE,
  LONG_ANSWER_NOTE,
  NAME_NOTE,
  NEXT_STEP_NOTE,
  nextStepTurn,
  NO_OFFER_NOTE,
  ONE_PAGE_NOTE,
  OWN_DAY_NOTE,
  PROFILE_UPDATE_NOTE,
  questionSequenceNote,
  REFINE_WAIT_MS,
  REMEMBER_FIRST_NOTE,
  requestedChangeValues,
  RESEARCH_NOTE,
  restatedListAsk,
  SAVE_NOT_VERIFY_NOTE,
  SPOKEN_TURN_NOTE,
  type SpokenFormGuardInputs,
  spokenHeldToAnswerGuards,
  subjectIdentifierNotes,
  TURN_UNREAD_NOTE,
  uncertaintyOfferTurn,
  UNPREPARED_CHANGE_LINE,
  unreadActionOf,
  VIEWING_NOT_DISCLOSED_NOTE,
  WRITING_DOCUMENT_NOTE,
} from "./held-and-offers.js";
export {
  boundedNotes,
  environmentNoteParts,
  environmentNotesFor,
  fittedTurnNotes,
  joinedNoteParts,
  NOTES_SHORTENED_NOTE,
  type QEnvironmentNoteParts,
  runSituation,
  SITUATION_WITH_ACCOUNT_MAX_CHARS,
  situationWithAccount,
} from "./environment-notes.js";
export {
  type ModelGatewayQAnswer,
  type ModelGatewayQAnswerDependencies,
  type QAnswerObservation,
  type QArtifactReviser,
  type QMemoryRecall,
  type QMemoryRecalled,
  type QProfileUpdateNotebook,
  type QProfileUpdateReading,
  type QSummaryCorrection,
  type QToolCallObservation,
  type QUserStatementRecorder,
  recalledText,
  summaryCorrections,
} from "./answer-dependencies.js";
export {
  fetchedForYouMessage,
  readForYouMessage,
  SCREEN_ACT_TELL_THEM,
  toolResultMessage,
} from "./tool-messages.js";
export {
  appActionLineOf,
  asksThePerson,
  atMostOneOffer,
  CHART_NOT_YET_LINE,
  claimsDone,
  couldNotDoLine,
  couldNotLineFor,
  documentReceiptOf,
  DRAFT_NOT_ON_CARD_LINE,
  explainsNothingDone,
  heardNames,
  isAsk,
  ownRecordOf,
  preparedLineOf,
  rememberConfirmation,
  shownFindingsLine,
  withoutRememberTalk,
  withoutTrailingAsks,
} from "./answer-lines.js";
