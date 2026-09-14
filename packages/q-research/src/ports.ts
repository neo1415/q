import type {
  PublicWebExtractRequest,
  PublicWebExtractResult,
  PublicWebSearchRequest,
  PublicWebSearchResult,
  ResearchProviderCode,
  ResearchProviderFailureClass,
} from "./contracts.js";

/**
 * A provider adapter throws this, with a stable class and a SAFE message of
 * Capital Q's own wording. The vendor's exception, status text, endpoint
 * and request id travel only as `cause` for server-side diagnostics and
 * are never interpolated into anything that leaves the process (§33).
 */
export class ResearchProviderFailure extends Error {
  readonly failureClass: ResearchProviderFailureClass;
  readonly providerCode: ResearchProviderCode;
  /** HTTP status when the vendor reported one; bounded diagnostics only. */
  readonly status: number | null;

  constructor(input: {
    readonly providerCode: ResearchProviderCode;
    readonly failureClass: ResearchProviderFailureClass;
    readonly status?: number | null | undefined;
    readonly cause?: unknown;
  }) {
    super(SAFE_MESSAGES[input.failureClass], { cause: input.cause });
    this.name = "ResearchProviderFailure";
    this.failureClass = input.failureClass;
    this.providerCode = input.providerCode;
    this.status = input.status ?? null;
  }
}

const SAFE_MESSAGES: Readonly<Record<ResearchProviderFailureClass, string>> = {
  AUTHENTICATION:
    "The public research provider refused Capital Q's credentials.",
  RATE_LIMIT: "The public research provider is rate-limiting requests.",
  TIMEOUT: "The public research provider did not answer in time.",
  UNAVAILABLE: "The public research provider is unavailable.",
  VALIDATION: "The public research provider refused the request as invalid.",
};

export function isResearchProviderFailure(
  error: unknown,
): error is ResearchProviderFailure {
  return error instanceof ResearchProviderFailure;
}

/** Cooperative cancellation and the attempt deadline; nothing else. */
export type ResearchExecutionContext = {
  readonly signal?: AbortSignal | undefined;
};

/**
 * The one boundary to an external search service (§7). Search discovers
 * public sources; extract reads sources already discovered. There is no
 * crawl, no map, no research-report operation and no arbitrary fetch —
 * the port cannot express them, so nothing built on it can perform them.
 */
export type PublicWebResearchProvider = {
  readonly code: ResearchProviderCode;
  readonly search: (
    request: PublicWebSearchRequest,
    context: ResearchExecutionContext,
  ) => Promise<PublicWebSearchResult>;
  readonly extract: (
    request: PublicWebExtractRequest,
    context: ResearchExecutionContext,
  ) => Promise<PublicWebExtractResult>;
};
