import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  problemFromUnknownError,
  type ProblemDetails,
} from "@capital-q/contracts";
import {
  ActiveCapitalObjectiveExistsError,
  CapitalObjectiveCreationConflictError,
  CapitalObjectiveLifecycleError,
  CapitalObjectiveNotFoundError,
  CapitalObjectiveVersionConflictError,
} from "@capital-q/capital";
import {
  CompanyCreationConflictError,
  CompanyMemberNotFoundError,
  CompanyNotFoundError,
  CompanyTeamFactsNotFoundError,
  CompanyVersionConflictError,
  FounderProfileNotAllowedError,
  FounderProfileNotFoundError,
  TeamVersionConflictError,
} from "@capital-q/companies";
import {
  InvestorCreationConflictError,
  InvestorMandateCreationConflictError,
  InvestorMandateLifecycleError,
  InvestorMandateNotFoundError,
  InvestorOrganisationExistsError,
  InvestorOrganisationNotFoundError,
  InvestorPortfolioReferenceNotFoundError,
  InvestorRepresentativeNotFoundError,
  InvestorVersionConflictError,
} from "@capital-q/investors";
import type { Logger } from "@capital-q/observability";
import {
  OrganisationCreationConflictError,
  OrganisationNotFoundError,
  OrganisationVersionConflictError,
} from "@capital-q/organisations";
import type { DocumentUploadFailureCode } from "@capital-q/contracts";
import {
  ClaimNotFoundError,
  ClaimRevisionConflictError,
  DocumentNotFoundError,
  DocumentStorageUnavailableError,
  DocumentUploadCreationConflictError,
  DocumentUploadRejectedError,
  DocumentUploadSessionNotFoundError,
  DocumentUploadStateError,
  DocumentVersionConflictError,
  DocumentVersionNotFoundError,
  EvidenceItemNotFoundError,
  EvidenceRuleError,
  EvidenceSourceNotFoundError,
  EvidenceSubjectNotFoundError,
} from "@capital-q/evidence";
import {
  ActorContextDeniedError,
  ActorContextRequiredError,
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  AuthorizationRequirementError,
} from "@capital-q/security";
import {
  OnboardingContextRequiredError,
  OnboardingDefinitionUnavailableError,
  OnboardingMutationConflictError,
  OnboardingRuntimeConfigurationError,
  OnboardingSessionNotFoundError,
  OnboardingSessionStateError,
  OnboardingSessionVersionConflictError,
  OnboardingSubjectNotFoundError,
  OnboardingSuggestionNotFoundError,
} from "@capital-q/onboarding";
import {
  TaxonomyClassificationCandidateDecidedError,
  TaxonomyClassificationCandidateNotFoundError,
  TaxonomyClassificationInputError,
  TaxonomyClassificationRunNotFoundError,
  TaxonomyClassifierNotAvailableError,
  TaxonomyNodeNotFoundError,
  TaxonomyNodeNotSelectableError,
  TaxonomySubjectNotFoundError,
  TaxonomyVocabularyNotFoundError,
} from "@capital-q/taxonomy";

/**
 * Fastify wiring for the Capital Q problem contract.
 *
 * Deliberately thin. Every decision about status, wording and what is safe to
 * disclose lives in @capital-q/contracts, so the two Capital Q HTTP services
 * cannot drift apart on a security-relevant control. What remains here is the
 * framework-specific part only: recognising Fastify's own error shapes and
 * writing the response.
 */

/** Fastify attaches these to its own errors; neither is trusted from arbitrary throws. */
type FastifyErrorShape = {
  readonly validation?: readonly {
    readonly instancePath?: string;
    readonly params?: Readonly<Record<string, unknown>>;
    readonly message?: string;
    readonly keyword?: string;
  }[];
  readonly code?: string;
  readonly statusCode?: number;
};

function asFastifyError(error: unknown): FastifyErrorShape {
  return typeof error === "object" && error !== null ? error : {};
}

/**
 * Fastify reports validation paths as JSON Pointer ("/targetAmount"). Capital Q
 * validation issues use dotted paths so a frontend can match them to form
 * fields, so they are normalised rather than passed through raw.
 */
function normaliseInstancePath(instancePath: string | undefined): string {
  if (instancePath === undefined || instancePath === "") {
    return "";
  }

  return instancePath.replace(/^\//, "").replace(/\//g, ".");
}

/**
 * Transport-level failures Fastify raises before a handler runs. Only these
 * known codes are translated; anything else falls through to a generic 500 so
 * an unexpected framework or driver error cannot choose its own public status.
 */
const MALFORMED_REQUEST_CODES: ReadonlySet<string> = new Set([
  "FST_ERR_CTP_EMPTY_JSON_BODY",
  "FST_ERR_CTP_INVALID_JSON_BODY",
  "FST_ERR_CTP_INVALID_MEDIA_TYPE",
  "FST_ERR_CTP_INVALID_CONTENT_LENGTH",
  "FST_ERR_CTP_BODY_TOO_LARGE",
]);

/**
 * What a refused upload is told. One short, bounded sentence per category:
 * enough for an honest person to fix the file, and nothing that maps out
 * the detector for a hostile one (doc 22 §22).
 */
const UPLOAD_REFUSAL_DETAIL: Readonly<
  Record<DocumentUploadFailureCode, string>
> = {
  FILE_TOO_LARGE: "The file is larger than the upload limit.",
  FILE_EMPTY: "The file is empty.",
  FILENAME_NOT_ALLOWED: "That file name cannot be used.",
  EXTENSION_NOT_ALLOWED: "That file type is not supported.",
  MIME_NOT_ALLOWED: "That file type is not supported.",
  SIGNATURE_MISMATCH: "The file does not match its extension.",
  OOXML_TYPE_MISMATCH:
    "The file is a different Office document type than its name suggests.",
  ACTIVE_CONTENT_TYPE_NOT_ALLOWED: "Files that can run code are not accepted.",
  ARCHIVE_NOT_ALLOWED: "Archives are not accepted.",
  CONTENT_UNRECOGNISED: "The file could not be recognised.",
  SIZE_MISMATCH: "The upload did not complete correctly. Try again.",
  OBJECT_MISSING: "No file was received. Try uploading again.",
  UPLOAD_EXPIRED: "The upload window expired. Start again.",
  STORAGE_VALIDATION_FAILED: "The upload could not be verified. Try again.",
};

function toProblem(
  error: unknown,
  requestId: string,
  logger: Logger,
): ProblemDetails {
  // Security failures map to existing public codes rather than new ones. The
  // wording is deliberately identical whether an organisation does not exist,
  // was never joined, or has been left: distinguishing them would let a caller
  // enumerate organisations and past affiliations.
  if (error instanceof AuthenticationRequiredError) {
    return createProblemDetails({ code: "AUTHENTICATION_REQUIRED", requestId });
  }

  if (error instanceof ActorContextDeniedError) {
    return createProblemDetails({
      code: "PERMISSION_DENIED",
      requestId,
      detail: error.message,
    });
  }

  if (error instanceof ActorContextRequiredError) {
    return createProblemDetails({
      code: "INVALID_REQUEST",
      requestId,
      detail: error.message,
    });
  }

  // Not currently a founder of this company: the same refusal whether the
  // relationship is absent or non-founder.
  if (error instanceof FounderProfileNotAllowedError) {
    return createProblemDetails({
      code: "PERMISSION_DENIED",
      requestId,
      detail: error.message,
    });
  }

  // Capability denial. The internal reason code is deliberately not sent: it
  // can disclose that an organisation or resource exists. Whether a given
  // resource should instead answer an enumeration-safe 404 is the owning
  // route's policy, applied before the error reaches here.
  if (error instanceof AuthorizationDeniedError) {
    return createProblemDetails({
      code: "PERMISSION_DENIED",
      requestId,
      detail: error.message,
    });
  }

  // A held capability with an unmet condition. No dedicated public code yet;
  // the flows that own step-up, verification and approval define their own
  // HTTP contracts when they exist. Until then this is a safe, generic refusal.
  if (error instanceof AuthorizationRequirementError) {
    return createProblemDetails({
      code: "PERMISSION_DENIED",
      requestId,
      detail: error.message,
    });
  }

  // Organisation domain failures. Each is enumeration-safe by construction
  // (the domain raises the same error for absent, foreign and inaccessible
  // resources), so mapping them is purely a status decision.
  if (
    error instanceof OrganisationNotFoundError ||
    error instanceof CompanyNotFoundError ||
    error instanceof CompanyMemberNotFoundError ||
    error instanceof FounderProfileNotFoundError ||
    error instanceof CompanyTeamFactsNotFoundError ||
    error instanceof InvestorOrganisationNotFoundError ||
    error instanceof InvestorRepresentativeNotFoundError ||
    error instanceof InvestorMandateNotFoundError ||
    error instanceof InvestorPortfolioReferenceNotFoundError ||
    error instanceof CapitalObjectiveNotFoundError ||
    error instanceof TaxonomyVocabularyNotFoundError ||
    error instanceof TaxonomyNodeNotFoundError ||
    error instanceof TaxonomySubjectNotFoundError ||
    error instanceof TaxonomyClassificationRunNotFoundError ||
    error instanceof TaxonomyClassificationCandidateNotFoundError ||
    error instanceof OnboardingSessionNotFoundError ||
    error instanceof OnboardingSuggestionNotFoundError ||
    error instanceof OnboardingSubjectNotFoundError ||
    error instanceof OnboardingDefinitionUnavailableError ||
    error instanceof EvidenceSourceNotFoundError ||
    error instanceof EvidenceItemNotFoundError ||
    error instanceof EvidenceSubjectNotFoundError ||
    error instanceof ClaimNotFoundError ||
    error instanceof DocumentNotFoundError ||
    error instanceof DocumentVersionNotFoundError ||
    error instanceof DocumentUploadSessionNotFoundError
  ) {
    return createProblemDetails({ code: "RESOURCE_NOT_FOUND", requestId });
  }

  // A refused upload. The category is machine-readable so a client can say
  // something useful; nothing about the detector, the storage target or the
  // file's content is disclosed.
  if (error instanceof DocumentUploadRejectedError) {
    return createProblemDetails({
      code: "VALIDATION_FAILED",
      requestId,
      detail: UPLOAD_REFUSAL_DETAIL[error.failureCode],
      errors: [
        {
          path: "file",
          code: error.failureCode,
          message: UPLOAD_REFUSAL_DETAIL[error.failureCode],
        },
      ],
    });
  }

  // The upload exists but is not at a step where this can happen: already
  // completed, already refused, cancelled, or never authorised.
  if (error instanceof DocumentUploadStateError) {
    return createProblemDetails({
      code: "UPLOAD_NOT_READY",
      requestId,
      detail: error.message,
    });
  }

  if (error instanceof DocumentUploadCreationConflictError) {
    return createProblemDetails({ code: "IDEMPOTENCY_CONFLICT", requestId });
  }

  if (error instanceof DocumentVersionConflictError) {
    return createProblemDetails({ code: "VERSION_CONFLICT", requestId });
  }

  if (error instanceof ClaimRevisionConflictError) {
    return createProblemDetails({ code: "VERSION_CONFLICT", requestId });
  }

  // Private storage is unreachable or unconfigured. Uploads are closed
  // rather than open, and no provider detail is echoed.
  if (error instanceof DocumentStorageUnavailableError) {
    return createProblemDetails({ code: "PROVIDER_UNAVAILABLE", requestId });
  }

  if (error instanceof EvidenceRuleError) {
    return createProblemDetails({
      code: "INVALID_REQUEST",
      requestId,
      detail: error.message,
    });
  }

  // A named taxonomy node cannot be selected here (unknown, deprecated,
  // wrong vocabulary, duplicate). The node id is the caller's own input,
  // so naming it discloses nothing.
  if (error instanceof TaxonomyNodeNotSelectableError) {
    return createProblemDetails({
      code: "INVALID_REQUEST",
      requestId,
      detail: `${error.message} (${error.reason}: ${error.nodeId})`,
    });
  }

  if (error instanceof TaxonomyClassificationInputError) {
    return createProblemDetails({
      code: "INVALID_REQUEST",
      requestId,
      detail: `${error.message} (${error.reason})`,
    });
  }

  // A strategy with a declared port but no adapter yet (SEMANTIC, MODEL).
  // Lexical search is never silently substituted for it.
  if (error instanceof TaxonomyClassifierNotAvailableError) {
    return createProblemDetails({
      code: "PROVIDER_UNAVAILABLE",
      requestId,
      detail: `${error.code}: ${error.message}`,
    });
  }

  if (error instanceof TaxonomyClassificationCandidateDecidedError) {
    return createProblemDetails({
      code: "RESOURCE_CONFLICT",
      requestId,
      detail: error.message,
    });
  }

  // Onboarding runtime. State refusals name their reason code because the
  // caller already owns the session; nothing about other people leaks.
  if (error instanceof OnboardingSessionStateError) {
    return createProblemDetails({
      code: "RESOURCE_CONFLICT",
      requestId,
      detail: `${error.message} (${error.reason})`,
    });
  }
  if (error instanceof OnboardingSessionVersionConflictError) {
    return createProblemDetails({
      code: "VERSION_CONFLICT",
      requestId,
      detail: error.message,
    });
  }
  if (error instanceof OnboardingMutationConflictError) {
    return createProblemDetails({
      code: "IDEMPOTENCY_CONFLICT",
      requestId,
      detail: error.message,
    });
  }
  if (error instanceof OnboardingContextRequiredError) {
    return createProblemDetails({
      code: "INVALID_REQUEST",
      requestId,
      detail: error.message,
    });
  }
  // A published step names a target nobody registered (or similar wiring
  // fault): the safe code goes to the log, the client gets a redacted 500.
  if (error instanceof OnboardingRuntimeConfigurationError) {
    logger.error(
      { requestId, fault: error.fault, detail: error.detail },
      "onboarding runtime configuration fault",
    );
    return createProblemDetails({ code: "INTERNAL_SERVER_ERROR", requestId });
  }

  if (
    error instanceof OrganisationVersionConflictError ||
    error instanceof CompanyVersionConflictError ||
    error instanceof TeamVersionConflictError ||
    error instanceof InvestorVersionConflictError ||
    error instanceof CapitalObjectiveVersionConflictError
  ) {
    return createProblemDetails({
      code: "VERSION_CONFLICT",
      requestId,
      detail: error.message,
    });
  }

  if (
    error instanceof OrganisationCreationConflictError ||
    error instanceof CompanyCreationConflictError ||
    error instanceof InvestorCreationConflictError ||
    error instanceof InvestorMandateCreationConflictError ||
    error instanceof CapitalObjectiveCreationConflictError
  ) {
    return createProblemDetails({
      code: "IDEMPOTENCY_CONFLICT",
      requestId,
      detail: error.message,
    });
  }

  // One canonical investor organisation per organisation, and a mandate
  // lifecycle that refuses edits to history. Only a member of that
  // organisation can reach these branches, so confirming the state to them
  // discloses nothing they cannot already read.
  if (
    error instanceof InvestorOrganisationExistsError ||
    error instanceof InvestorMandateLifecycleError ||
    error instanceof ActiveCapitalObjectiveExistsError ||
    error instanceof CapitalObjectiveLifecycleError
  ) {
    return createProblemDetails({
      code: "RESOURCE_CONFLICT",
      requestId,
      detail: error.message,
    });
  }

  const candidate = asFastifyError(error);

  if (candidate.validation !== undefined) {
    return createProblemDetails({
      code: "VALIDATION_FAILED",
      requestId,
      errors: candidate.validation.map((issue) => ({
        path: normaliseInstancePath(issue.instancePath),
        code: issue.keyword ?? "invalid",
        message: issue.message ?? "This value is not valid.",
      })),
    });
  }

  if (
    candidate.code !== undefined &&
    MALFORMED_REQUEST_CODES.has(candidate.code)
  ) {
    return createProblemDetails({ code: "INVALID_REQUEST", requestId });
  }

  // Contract validation errors and everything else are decided by contracts,
  // which redacts by default.
  return problemFromUnknownError(error, { requestId });
}

function sendProblem(reply: FastifyReply, problem: ProblemDetails): void {
  void reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
}

export function registerProblemHandling(
  app: FastifyInstance,
  logger: Logger,
): void {
  // Every response carries the request id, so a user reporting a failure gives
  // support something that ties straight to the server logs.
  app.addHook("onSend", (request, reply, _payload, done) => {
    void reply.header("X-Request-Id", request.id);
    done();
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    // A generic 404 with no route detail. Later authorization work may map a
    // forbidden private resource here too, so that a 403 does not itself
    // confirm the resource exists.
    sendProblem(
      reply,
      createProblemDetails({
        code: "RESOURCE_NOT_FOUND",
        requestId: request.id,
      }),
    );
  });

  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    const problem = toProblem(error, request.id, logger);

    if (problem.status >= 500) {
      // Diagnostics stay server-side. The client gets the request id and
      // nothing else; the error object is serialised through the logger's
      // redacting serializer.
      logger.error(
        { err: error, requestId: request.id, method: request.method },
        "unhandled request error",
      );
    }

    sendProblem(reply, problem);
  });
}
