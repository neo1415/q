/**
 * Domain errors. "Not found" is the answer for anything the caller is not
 * entitled to see: a row that exists in another tenant or organisation is
 * indistinguishable from one that never existed (enumeration safety).
 */

export class EvidenceSourceNotFoundError extends Error {
  constructor() {
    super("Evidence source not found.");
    this.name = "EvidenceSourceNotFoundError";
  }
}

export class DocumentNotFoundError extends Error {
  constructor() {
    super("Document not found.");
    this.name = "DocumentNotFoundError";
  }
}

export class DocumentVersionNotFoundError extends Error {
  constructor() {
    super("Document version not found.");
    this.name = "DocumentVersionNotFoundError";
  }
}

export class ClaimNotFoundError extends Error {
  constructor() {
    super("Claim not found.");
    this.name = "ClaimNotFoundError";
  }
}

export class EvidenceItemNotFoundError extends Error {
  constructor() {
    super("Evidence item not found.");
    this.name = "EvidenceItemNotFoundError";
  }
}

/** The subject does not exist in the caller's context. Same answer as elsewhere. */
export class EvidenceSubjectNotFoundError extends Error {
  constructor() {
    super("Evidence subject not found.");
    this.name = "EvidenceSubjectNotFoundError";
  }
}

export class DocumentVersionConflictError extends Error {
  constructor() {
    super("The document changed since it was last read.");
    this.name = "DocumentVersionConflictError";
  }
}

export class ClaimRevisionConflictError extends Error {
  constructor() {
    super("The claim was revised since it was last read.");
    this.name = "ClaimRevisionConflictError";
  }
}

/** A rule of the evidence model was violated by the request. */
export class EvidenceRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceRuleError";
  }
}
