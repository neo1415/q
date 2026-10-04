/**
 * @capital-q/api-client
 *
 * Owns: the typed client the web application uses to call the Capital Q API,
 * so that product surfaces consume one client rather than ad hoc fetch calls
 * scattered through features (doc 22, 164; AEC-057).
 * Does not own: API implementation. It depends on public contracts only.
 *
 * Failure handling is here now. Application code branches on a stable error
 * code, never on message prose, and never reads a raw response body.
 *
 * Endpoint methods arrive with the packets that define those endpoints.
 */

export {
  ApiProblemError,
  parseProblemDetails,
  readProblemResponse,
  UNEXPECTED_API_RESPONSE,
} from "./problem.js";

export const PACKAGE_NAME = "@capital-q/api-client" as const;

export {
  fetchMe,
  getMyProfile,
  updateMe,
  updateMyProfile,
  type FetchMeInput,
} from "./me.js";

export {
  activateOrganisation,
  createOrganisation,
  getOrganisation,
  listMyOrganisations,
  updateOrganisation,
  type ApiSession,
} from "./organisations.js";

export {
  assessMarketplaceReadiness,
  createCompany,
  getCompany,
  downloadCompanyDeck,
  getCompanyNetworkPreview,
  getCompanyProfile,
  getCompanyProfilePhoto,
  getMarketplaceReadiness,
  setCompanyVisibility,
  updateCompany,
} from "./companies.js";

export {
  getCompanyTeamFacts,
  getMyCompanyMembership,
  getMyFounderProfile,
  updateCompanyTeamFacts,
  updateMyFounderProfile,
  upsertMyCompanyMembership,
} from "./company-team.js";

export {
  createInvestorOrganisation,
  getCurrentInvestorOrganisation,
  getInvestorNetworkPreview,
  setInvestorVisibility,
  getInvestorOrganisation,
  getMyInvestorRepresentative,
  updateInvestorOrganisation,
  upsertMyInvestorRepresentative,
} from "./investors.js";

export {
  activateInvestorMandate,
  closeInvestorMandate,
  createInvestorMandate,
  getInvestorMandate,
  listInvestorMandates,
  updateInvestorMandate,
} from "./investor-mandates.js";

export {
  closeCapitalObjective,
  createCapitalObjective,
  getCapitalObjective,
  getCurrentCapitalObjective,
  listCapitalObjectives,
  replaceCapitalObjective,
  updateCapitalObjective,
} from "./capital-objectives.js";

export {
  findTaxonomyCandidates,
  getTaxonomyNode,
  listTaxonomyNodes,
  listTaxonomyVocabularies,
} from "./taxonomy.js";

export {
  answerOnboardingQuestion,
  appendOnboardingInterviewTurns,
  chooseOnboardingNudge,
  claimBriefingOnboardingNudge,
  peekBriefingOnboardingNudge,
  listOnboardingInterviewTurns,
  sayToOnboarding,
  completeOnboardingSession,
  dismissOnboardingQuestion,
  getCurrentOnboardingSession,
  getOnboardingSession,
  goBackInOnboarding,
  resolveOnboardingSuggestion,
  skipOnboardingStep,
  withdrawOnboardingResponse,
  startOnboardingSession,
  reviseOnboardingResponse,
  submitOnboardingResponse,
} from "./onboarding.js";

export {
  cancelDocumentUploadSession,
  completeDocumentUploadSession,
  createDocumentUploadSession,
  getDocument,
  getDocumentUploadSession,
  listDocuments,
  setDocumentDownloadAudience,
} from "./documents.js";

export {
  authorisePitchDownload,
  authorisePitchPlayback,
  cancelPitchUpload,
  createPitchMediaAsset,
  createPitchUploadSession,
  deletePitchMediaAsset,
  getCompanyPitch,
  listCompanyMedia,
  setPitchDetails,
  setPitchPlaybackPolicy,
  syncPitch,
} from "./media.js";

export {
  appendQRunMessage,
  approveQApproval,
  archiveQConversation,
  hideQConversationMessage,
  cancelQRun,
  createQRun,
  getQConversation,
  getQArtifact,
  getQArtifactVersion,
  getProfileFindings,
  listQArtifacts,
  // DOCS block.
  confirmQBrandKit,
  createQAnswerExport,
  getQBrandKit,
  setQBrandKit,
  suggestQBrandKit,
  listQConversations,
  createQVoiceSession,
  getQVoiceTurnState,
  setQVoiceScreen,
  relayQVoiceDuplexTool,
  reportQVoiceDuplexUsage,
  endQVoiceDuplex,
  getQApproval,
  listPendingQApprovals,
  getQRun,
  rejectQApproval,
} from "./q.js";

export {
  streamQRunEvents,
  describeQStreamTransport,
  type QRunStreamOptions,
  type QRunStreamResult,
  type QStreamCloseReason,
  type QStreamEventMeta,
  type QStreamTransportStatus,
} from "./q-stream.js";
export {
  createQStreamState,
  describeQStage,
  reduceQStream,
  type QStreamApprovalState,
  type QStreamPartialMessage,
  type QStreamState,
} from "./q-stream-reducer.js";
export { createSseParser, type SseMessage, type SseParser } from "./sse.js";

export {
  discoverCompanies,
  discoverInvestors,
  getDiscoveredInvestor,
  getDiscoveredInvestorPhoto,
  listNetworkPitches,
  getRecommendationExplanation,
  listSavedCompanies,
  listYourCompanies,
  listPassedCompanies,
  unpassCompany,
  passCompany,
  saveCompany,
  unsaveCompany,
} from "./discovery.js";

export {
  answerConnectionRequest,
  answerInterest,
  getConnectionStatus,
  listConnectionRequests,
  requestConnection,
  expressInterest,
  getOwnInterest,
  getRelationshipWithCompany,
  getRelationshipWithInvestor,
  listCompanyRelationships,
  listIncomingInterest,
  listInvestorRelationships,
} from "./network.js";

export {
  getCompanyVerification,
  requestCompanyVerification,
} from "./verification.js";
export {
  getAudiencePreview,
  getVisibilityState,
  revokeVisibilityShare,
  shareWithRelationship,
} from "./visibility.js";

export {
  completeProfileImageUpload,
  createProfileImageUpload,
  getProfileImages,
  removeProfileImage,
} from "./profile-images.js";
export {
  claimHandle,
  getPublicHandle,
  getQCard,
  resolveCardCode,
  updateQCard,
} from "./q-cards.js";
export {
  disconnectGoogle,
  getEmailDraft,
  getGoogleConnection,
  getInboundEmailAddress,
  rotateInboundEmailAddress,
  listRelationshipMail,
  reviseEmailDraft,
  startGoogleConnect,
} from "./integrations.js";
export {
  blockChat,
  reportChat,
  unblockChat,
  getChatAttachment,
  getChatThread,
  getChatUnread,
  markChatRead,
  sendChatMessage,
  unsendChatMessage,
} from "./chat.js";
export {
  cancelMeeting,
  createReminder,
  dismissReminder,
  findMeetingSlots,
  getMeetingBrief,
  listNotifications,
  listRelationshipMeetings,
  listReminders,
  markNotificationsRead,
  scheduleMeeting,
  joinMeetingCall,
} from "./schedule.js";

export { forgetQMemory, listQMemory } from "./memory.js";
export {
  bringMeetingAssistant,
  dismissMeetingAssistant,
  getMeetingAssistant,
} from "./meeting-assistant.js";
export { listRelationshipErrands, stopErrand } from "./errands.js";
export {
  adoptCommitment,
  disputeCommitment,
  confirmCommitment,
  getCompanyFundraising,
  getRelationshipCommitments,
  stateCommitment,
  withdrawCommitment,
} from "./commitments.js";
export {
  getRelationshipPass,
  listPassReasons,
  passRelationship,
  pauseRelationship,
  recordMeetingOutcome,
  resumeRelationship,
} from "./outcomes.js";
export {
  applicationTurn,
  createGateway,
  draftGatewayVersion,
  getPublicGateway,
  listGatewayApplications,
  listGateways,
  publishGatewayVersion,
  startApplication,
  submitApplication,
} from "./gateq.js";
export {
  getAdminAttribution,
  getAdminDisputes,
  getAdminOverview,
  getAdminPaused,
  reinstatePausedAccount,
} from "./admin.js";
// REHEARSE block
export {
  finishRehearsal,
  getRehearsal,
  getRehearsalMeeting,
  getRehearsalPartners,
  getRehearsalPersona,
  listInvestorRehearsals,
  listRehearsals,
  sayInRehearsal,
  sendRehearsalScreen,
  startRehearsal,
} from "./rehearsals.js";
// end REHEARSE block
export { getQStanding, setQPersonality } from "./standing.js";
// AUTO block: Q's delegated work, Web Push, notification settings.
export {
  answerQWork,
  getNotificationSettings,
  getPushKey,
  getQWork,
  getQWorkReport,
  getQWorkReportPdf,
  getMyUsage,
  listQWork,
  saveNotificationSettings,
  setQPresence,
  stopQWork,
  listQWorkSuggestions,
  listQWorkDone,
  dismissQWorkSuggestion,
  setQWorkPaused,
  subscribePush,
  unsubscribePush,
} from "./work.js";
// end AUTO block

// ADMIN block
export * from "./admin-console.js";
export * from "./results.js";
// end ADMIN block

// DAILY block
export {
  getQDaily,
  getQDailyEdition,
  getQDailyPreferences,
  requestQDailyEdition,
  setQDailyPreferences,
} from "./daily.js";
// BILLING block (ADR 0034)
export {
  accrueAdminFees,
  assignAdminBillingPlan,
  entitlementOf,
  exportAdminFeeLedger,
  getAdminBillingAccount,
  getAdminUsage,
  getAdminFeeLedger,
  getMyPlan,
  getPlanCatalogue,
  openBillingPortal,
  setAdminBillingOverride,
  setAdminFeeRate,
  startPlanCheckout,
} from "./billing.js";
// end BILLING block

// ADMIN-3 block
export * from "./reviews-kyb.js";
// end ADMIN-3 block
export {
  diligenceDownload,
  fulfilDiligenceRequest,
  getDiligence,
  requestDiligenceDocument,
  revokeDiligenceShare,
  shareDiligenceDocument,
} from "./diligence.js";
