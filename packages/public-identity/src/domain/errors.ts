/**
 * Refusals, each one answer to the caller. A subject that does not exist,
 * belongs to another tenant or another organisation is the same "not
 * found", so a probe learns nothing about anybody else's companies.
 */

export class QCardSubjectNotFoundError extends Error {
  constructor() {
    super("That profile isn't available.");
    this.name = "QCardSubjectNotFoundError";
  }
}

export const HANDLE_REFUSALS = ["SHAPE", "RESERVED", "TAKEN"] as const;
export type HandleRefusal = (typeof HANDLE_REFUSALS)[number];

const MESSAGES: Readonly<Record<HandleRefusal, string>> = {
  SHAPE:
    "A handle is 3 to 30 lowercase letters, digits or single hyphens, not starting or ending with a hyphen.",
  RESERVED: "That handle is reserved and can't be claimed.",
  // Held and retired handles read the same as taken: whose they were is
  // not the caller's business.
  TAKEN: "That handle isn't available.",
};

export class HandleUnavailableError extends Error {
  readonly reason: HandleRefusal;

  constructor(reason: HandleRefusal) {
    super(MESSAGES[reason]);
    this.name = "HandleUnavailableError";
    this.reason = reason;
  }
}

export class QCardVersionConflictError extends Error {
  constructor() {
    super("The card has changed since it was read.");
    this.name = "QCardVersionConflictError";
  }
}

export class QCardNotFoundError extends Error {
  constructor() {
    super("This profile has no Q Card yet. Claim a handle first.");
    this.name = "QCardNotFoundError";
  }
}

export class QCardFieldNotAllowedError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super("Those fields can't appear on this card.");
    this.name = "QCardFieldNotAllowedError";
    this.fields = fields;
  }
}

/** Profile images: the upload is not (or no longer) this caller's to finish. */
export class ProfileImageUploadNotFoundError extends Error {
  constructor() {
    super("That upload isn't available. Choose the image again.");
    this.name = "ProfileImageUploadNotFoundError";
  }
}

export const PROFILE_IMAGE_REFUSALS = [
  "NOT_UPLOADED",
  "TOO_LARGE",
  "NOT_AN_IMAGE",
  "TOO_SMALL",
  "EXPIRED",
  "TOO_MANY",
] as const;
export type ProfileImageRefusal = (typeof PROFILE_IMAGE_REFUSALS)[number];

const IMAGE_MESSAGES: Readonly<Record<ProfileImageRefusal, string>> = {
  NOT_UPLOADED: "The image didn't finish uploading. Try again.",
  TOO_LARGE: "That image is too large. Choose one under 8 MB.",
  NOT_AN_IMAGE: "That file isn't a JPEG, PNG or WebP image.",
  TOO_SMALL: "That image is too small. Choose one at least 200 pixels wide.",
  EXPIRED: "The upload took too long. Choose the image again.",
  TOO_MANY: "Too many uploads in a short time. Try again in a few minutes.",
};

/** A refused image, said in words the person can act on. */
export class ProfileImageRejectedError extends Error {
  readonly reason: ProfileImageRefusal;

  constructor(reason: ProfileImageRefusal) {
    super(IMAGE_MESSAGES[reason]);
    this.name = "ProfileImageRejectedError";
    this.reason = reason;
  }
}

/** Image storage or processing is not composed or not answering. */
export class ProfileImageStorageUnavailableError extends Error {
  constructor() {
    super("Image storage isn't available just now.");
    this.name = "ProfileImageStorageUnavailableError";
  }
}
