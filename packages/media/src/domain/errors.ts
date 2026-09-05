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
