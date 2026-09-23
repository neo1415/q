import type { MediaStatus } from "../contracts/index.js";

/**
 * Domain errors. "Not found" is the answer for anything the caller is not
 * entitled to see: an asset owned by another tenant or organisation is
 * indistinguishable from one that never existed (enumeration safety).
 */

export class MediaAssetNotFoundError extends Error {
  constructor() {
    super("Media asset not found.");
    this.name = "MediaAssetNotFoundError";
  }
}

/** The owning resource does not exist in the caller's context. */
export class MediaOwnerNotFoundError extends Error {
  constructor() {
    super("Media owner not found.");
    this.name = "MediaOwnerNotFoundError";
  }
}

/**
 * The move is not in the lifecycle. Carries both ends so an operator can see
 * what was attempted; a late provider event hitting this is normal, not a
 * fault, and the caller decides whether to ignore it.
 */
export class MediaTransitionError extends Error {
  readonly from: MediaStatus;
  readonly to: MediaStatus;

  constructor(from: MediaStatus, to: MediaStatus) {
    super(`A ${from} media asset cannot become ${to}.`);
    this.name = "MediaTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** Someone else changed the asset first. The stale writer loses. */
export class MediaAssetConflictError extends Error {
  constructor(message = "The media asset changed since it was read.") {
    super(message);
    this.name = "MediaAssetConflictError";
  }
}

/**
 * The company already has a current pitch, or the pitch being replaced is no
 * longer the current one. Refused rather than resolved, because guessing
 * which of two pitches is "the" pitch is exactly the ambiguity the single
 * primary pitch rule exists to prevent.
 */
export class MediaReplacementConflictError extends Error {
  constructor(message = "The pitch being replaced is no longer current.") {
    super(message);
    this.name = "MediaReplacementConflictError";
  }
}

/** A rule about the asset itself, not about who asked. */
export class MediaRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaRuleError";
  }
}

/**
 * The deployment has no video provider for this operation (CQ-MEDIA-010).
 *
 * Raised instead of pretending: there is no fake upload target, no fake
 * playback token and no "ready" that did not happen. `missing` names the
 * environment variables an operator must set — names only, never values —
 * so the failure is specific enough to fix and safe enough to show.
 */
export class MediaProviderNotConfiguredError extends Error {
  readonly code = "MEDIA_PROVIDER_NOT_CONFIGURED" as const;
  readonly operation: string;
  readonly missing: readonly string[];

  constructor(operation: string, missing: readonly string[]) {
    super(
      missing.length === 0
        ? `No video provider is configured for ${operation}.`
        : `No video provider is configured for ${operation}: set ${missing.join(", ")}.`,
    );
    this.name = "MediaProviderNotConfiguredError";
    this.operation = operation;
    this.missing = missing;
  }
}

/**
 * How a provider call fails, in Capital Q's words. The vendor's own status
 * and reason code travel as private diagnostics; the message is a plain
 * sentence that names no host, no token and no request.
 */
export const MEDIA_PROVIDER_FAILURES = [
  /** The credential was refused. A configuration fault, not a user's. */
  "AUTHENTICATION",
  "RATE_LIMITED",
  /** The provider refused what Capital Q asked for. */
  "REJECTED",
  /** Network, timeout or a 5xx: the provider could not answer. */
  "UNAVAILABLE",
  /** An answer arrived that does not have the shape the vendor documents. */
  "MALFORMED_RESPONSE",
] as const;
export type MediaProviderFailure = (typeof MEDIA_PROVIDER_FAILURES)[number];

export class MediaProviderError extends Error {
  readonly provider: string;
  readonly failure: MediaProviderFailure;
  /** The provider's HTTP status, when there was one. */
  readonly status: number | null;
  /** The provider's own code, for private diagnostics only. */
  readonly providerCode: string | null;

  constructor(input: {
    readonly provider: string;
    readonly failure: MediaProviderFailure;
    readonly operation: string;
    readonly status?: number | null | undefined;
    readonly providerCode?: string | null | undefined;
    readonly cause?: unknown;
  }) {
    super(`The video provider could not complete ${input.operation}.`, {
      cause: input.cause,
    });
    this.name = "MediaProviderError";
    this.provider = input.provider;
    this.failure = input.failure;
    this.status = input.status ?? null;
    this.providerCode = input.providerCode ?? null;
  }
}
