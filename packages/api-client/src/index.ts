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

export { fetchMe, type FetchMeInput } from "./me.js";

export {
  activateOrganisation,
  createOrganisation,
  getOrganisation,
  listMyOrganisations,
  updateOrganisation,
  type ApiSession,
} from "./organisations.js";

export { createCompany, getCompany, updateCompany } from "./companies.js";

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
  completeOnboardingSession,
  getCurrentOnboardingSession,
  getOnboardingSession,
  goBackInOnboarding,
  resolveOnboardingSuggestion,
  skipOnboardingStep,
  startOnboardingSession,
  submitOnboardingResponse,
} from "./onboarding.js";

export {
  cancelDocumentUploadSession,
  completeDocumentUploadSession,
  createDocumentUploadSession,
  getDocument,
  getDocumentUploadSession,
  listDocuments,
} from "./documents.js";

export {
  createPitchMediaAsset,
  deletePitchMediaAsset,
  getCompanyPitch,
  listCompanyMedia,
} from "./media.js";

export {
  appendQRunMessage,
  approveQApproval,
  cancelQRun,
  createQRun,
  getQApproval,
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
