import type { MessageSensitivity } from "@capital-q/contracts";

import type {
  DisclosureScope,
  EvidenceLocator,
  EvidenceSource,
  EvidenceStatus,
  ReliabilityClass,
  StructuredValue,
  TruthClass,
} from "../contracts/index.js";
import { strongestSensitivity } from "../domain/sensitivity.js";
import {
  PERMITTED_CLAIM_KEYS,
  type ClaimAssertionKind,
  type ClaimProposal,
  type ProposedValue,
} from "./contracts.js";

/**
 * The deterministic half of claim interpretation (CQ-KNW-001 §7, §12-§14,
 * §19-§20, §24, §31-§36).
 *
 * Everything a proposer is not allowed to decide is decided here, from the
 * source and the actor and nothing else. There is no model in this file, no
 * database, no clock and no configuration a document could reach.
 */

/**
 * Truth class, from the source's own type and the observed relationship.
 *
 * The canonical vocabulary is ADR-001's: VERIFIED, USER_CLAIM, ESTIMATE,
 * Q_INFERENCE, UNKNOWN. "Document supported" is deliberately NOT here — it
 * is an EVIDENCE STATUS, a different axis, and collapsing the two is how a
 * pitch deck ends up counting as verification. A deck asserting its own ARR
 * is the company making a claim (USER_CLAIM) that a document happens to
 * support (DOCUMENT_SUPPORTED).
 *
 * VERIFIED is unreachable from this function. It is not filtered out; there
 * is no branch that returns it. Verification is a separate workflow over
 * `verification_claims`, and no volume of documents agreeing amounts to it.
 */
export function truthClassFor(
  source: EvidenceSource,
  assertionKind: ClaimAssertionKind,
): TruthClass {
  if (assertionKind === "MODEL_INFERENCE") {
    return "Q_INFERENCE";
  }
  if (assertionKind === "SOURCE_ESTIMATE") {
    return "ESTIMATE";
  }
  switch (source.sourceType) {
    case "USER_STATEMENT":
    case "CONVERSATION":
    case "DOCUMENT":
    case "MEETING":
      // All four are the subject speaking about itself, in different
      // rooms. A document is not a more truthful speaker than a founder;
      // it is a better-evidenced one, which the evidence status records.
      return "USER_CLAIM";
    case "PLATFORM_EVENT":
    case "INTEGRATION":
    case "PUBLIC_WEB":
    case "REGULATORY_RECORD":
    case "ADMIN_VERIFICATION":
      // Registered but not yet interpreted by this packet. Recording them
      // as USER_CLAIM would misattribute the assertion to the subject; a
      // caller wanting these needs a policy written for them.
      return "UNKNOWN";
  }
}

/**
 * Evidence status for the EvidenceItem this passage produces.
 *
 * `NO_EVIDENCE` is absent because an evidence item IS evidence; the claims
 * table allows it for claims that have none. The two verified statuses are
 * unreachable: nothing an extraction does verifies anything.
 */
export function evidenceStatusFor(
  source: EvidenceSource,
  locator: EvidenceLocator,
): EvidenceStatus {
  return source.sourceType === "DOCUMENT" && locator.kind === "document"
    ? "DOCUMENT_SUPPORTED"
    : "SELF_REPORTED";
}

/**
 * Whether a set of supporting evidence items justifies MULTI_SOURCE_SUPPORTED.
 *
 * Only when they rest on genuinely distinct sources. Two slides of one deck,
 * or two passages of one document version, are one source saying a thing
 * twice; counting that as corroboration is how a single unchecked assertion
 * acquires the appearance of independent support.
 */
export function isMultiSourceSupported(
  sourceIds: readonly string[],
  documentVersionIds: readonly (string | null)[],
): boolean {
  const distinctSources = new Set(sourceIds);
  if (distinctSources.size < 2) {
    return false;
  }
  const versions = documentVersionIds.filter((id): id is string => id !== null);
  return versions.length === 0 || new Set(versions).size >= 2;
}

/**
 * The reliability of an extracted evidence item.
 *
 * `MODEL_DERIVED` where a model read the passage, `USER_STATEMENT` where a
 * person said it directly, `UNKNOWN` otherwise. These are classifications,
 * not scores: there is no weighting methodology in the repository, and
 * inventing one (audited = 0.95, deck = 0.4) would be a number nobody could
 * defend and everything downstream would treat as measured.
 */
export function reliabilityFor(
  source: EvidenceSource,
  proposerKind: "DETERMINISTIC" | "MODEL",
): ReliabilityClass {
  if (source.sourceType === "USER_STATEMENT") {
    return "USER_STATEMENT";
  }
  return proposerKind === "MODEL" ? "MODEL_DERIVED" : "UNKNOWN";
}

/** The four scopes CQ-EVD-001 permits a claim to be recorded at. */
const PRIVATE_SCOPES = new Set<DisclosureScope>([
  "personal_private",
  "organisation_private",
  "founder_private",
  "investor_private",
]);

/**
 * Derived visibility: the source's own scope, never wider (§19).
 *
 * There is no argument by which this function can broaden anything. A
 * private source keeps its exact scope. A source that is already broader
 * than private — network-visible or public — is NARROWED to
 * organisation_private, because a claim is the organisation's own record of
 * what a source said, and CQ-EVD-001 refuses to record one at a shared
 * scope: sharing is a disclosure decision with its own workflow, its own
 * audit and its own actor, and an extraction worker is none of those.
 */
export function derivedVisibility(source: EvidenceSource): DisclosureScope {
  return PRIVATE_SCOPES.has(source.visibilityScope)
    ? source.visibilityScope
    : "organisation_private";
}

/**
 * Derived sensitivity: the strongest of the source's class and any floor
 * the caller applies (§20).
 *
 * Monotonic upward only. A RESTRICTED source cannot produce an INTERNAL
 * claim through this path, whatever a proposal asks for, because the
 * proposal has no field to ask with and this function only ever climbs.
 */
export function derivedSensitivity(
  source: EvidenceSource,
  floor: MessageSensitivity = "CONFIDENTIAL",
): MessageSensitivity {
  return strongestSensitivity(floor, source.sensitivityClass);
}

/**
 * Whether the proposal's claim key is one this extraction may produce, and
 * whether its value has the shape that key requires.
 *
 * `financial.arr` must be money; `traction.customer_count` must be a count.
 * A "customer count" carrying a currency is not a badly formatted claim, it
 * is a different claim, and storing it would corrupt every later comparison
 * on that key.
 */
export function claimKeyAccepts(
  claimKey: string,
  value: ProposedValue | null,
  permitted: ReadonlySet<string>,
): boolean {
  if (!permitted.has(claimKey)) {
    return false;
  }
  const spec = PERMITTED_CLAIM_KEYS[claimKey];
  if (spec === undefined) {
    return false;
  }
  if (spec.value === "ANY" || value === null) {
    return true;
  }
  return value.kind === spec.value;
}

export function claimTypeFor(claimKey: string): string {
  return PERMITTED_CLAIM_KEYS[claimKey]?.claimType ?? "other";
}

/**
 * The structured value as it is stored: the proposal's typed value with its
 * units intact, plus nothing.
 *
 * Money keeps its currency and is never converted, because a claim whose
 * currency was guessed is worse than a claim with no number at all.
 */
export function structuredValueFor(
  value: ProposedValue | null,
): StructuredValue | null {
  if (value === null) {
    return null;
  }
  switch (value.kind) {
    case "MONEY":
      return { kind: "MONEY", amount: value.amount, currency: value.currency };
    case "COUNT":
      return { kind: "COUNT", value: value.value };
    case "PERCENTAGE":
      return { kind: "PERCENTAGE", value: value.value };
    case "DATE":
      return { kind: "DATE", value: value.value };
    case "TEXT":
      return { kind: "TEXT", value: value.value };
  }
}

/** Two stored values agree when they are the same kind, unit and magnitude. */
export function valuesAgree(
  a: StructuredValue | null,
  b: StructuredValue | null,
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a["kind"] !== b["kind"]) {
    return false;
  }
  if (a["kind"] === "MONEY") {
    // Different currencies never agree, and are never converted to find out.
    return a["amount"] === b["amount"] && a["currency"] === b["currency"];
  }
  return a["value"] === b["value"];
}

/**
 * Whether the proposal actually quoted the passage (§28).
 *
 * A proposal whose excerpt is not in the text it was given did not read it,
 * and the claim it carries has no provenance whatever it says. Whitespace is
 * normalised because renderers reflow; nothing else is forgiven.
 */
export function excerptIsPresent(excerpt: string, passage: string): boolean {
  const normalise = (text: string): string =>
    text.replace(/\s+/g, " ").trim().toLowerCase();
  return normalise(passage).includes(normalise(excerpt));
}

/**
 * The locator stored on the evidence item: the passage's own, narrowed only
 * where the proposal's hint is consistent with it.
 *
 * The document version always comes from the passage. A proposal cannot
 * move a claim to another document by naming one, because the only field it
 * can influence is a page or a cell inside the document it was handed.
 */
export function locatorFor(
  passageLocator: EvidenceLocator,
  hint: ClaimProposal["locatorHint"],
): EvidenceLocator {
  if (passageLocator.kind !== "document" || hint === undefined) {
    return passageLocator;
  }
  return {
    ...passageLocator,
    ...(hint.page === undefined ? {} : { page: hint.page }),
    ...(hint.sheet === undefined ? {} : { sheet: hint.sheet }),
    ...(hint.cell === undefined ? {} : { cell: hint.cell }),
  };
}
