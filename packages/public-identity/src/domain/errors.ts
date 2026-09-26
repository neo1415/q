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
