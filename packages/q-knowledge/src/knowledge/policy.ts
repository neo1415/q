import {
  Q_SENSITIVITY_RANK,
  type MarketplaceVisibility,
  type MessageSensitivity,
  type QConfidenceLevel,
} from "@capital-q/contracts";
import type { EvidenceStatus, TruthClass } from "@capital-q/evidence/contracts";

import type { KnowledgeSourceEnvironment } from "./contracts.js";

/**
 * The deterministic half of the Knowledge Write Gate (CQ-KNW-002 §12-§15,
 * §19-§20, §29).
 *
 * Everything a proposer is not allowed to decide is decided here, from the
 * evidence and the sources and nothing else. There is no model in this file,
 * no database, no clock, and no configuration a document could reach.
 */

/**
 * The evidence status an understanding may claim, from what actually stands
 * behind it (§13).
 *
 * MULTI_SOURCE_SUPPORTED requires genuinely DISTINCT sources. Two passages
 * of one deck, or two evidence items from one source, are one source saying
 * a thing twice; counting that as corroboration is how a single unchecked
 * assertion acquires the appearance of independent support.
 *
 * The two verified statuses are unreachable here. Verification is a separate
 * workflow with its own evidence, and no amount of derivation produces it.
 */
export function evidenceStatusForSupport(input: {
  readonly supportingEvidenceCount: number;
  readonly distinctSourceCount: number;
  readonly strongestInputStatus: EvidenceStatus | null;
}): EvidenceStatus {
  if (input.supportingEvidenceCount === 0) {
    return "NO_EVIDENCE";
  }
  if (input.distinctSourceCount >= 2) {
    return "MULTI_SOURCE_SUPPORTED";
  }
  // One source. The best it can be is what that source's own evidence was,
  // never better — and never one of the verified classes.
  return input.strongestInputStatus === "DOCUMENT_SUPPORTED" ||
    input.strongestInputStatus === "MULTI_SOURCE_SUPPORTED"
    ? "DOCUMENT_SUPPORTED"
    : "SELF_REPORTED";
}

/**
 * The truth class an understanding may carry (§12).
 *
 * VERIFIED is unreachable: there is no branch that returns it. A candidate
 * cannot propose it — the proposal enum has no such member — and no rule
 * here upgrades one. Multiple models agreeing, a confident model, a document
 * asserting its own verification and a founder insisting are all, precisely,
 * nothing. Only a deterministic verification workflow with verifying
 * evidence may ever produce VERIFIED, and this is not one.
 */
export function truthClassForKnowledge(
  proposal: "USER_CLAIM" | "ESTIMATE" | "Q_INFERENCE" | "UNKNOWN",
  supportingEvidenceCount: number,
): TruthClass {
  // No evidence, no entity-specific assertion. General model knowledge is
  // not evidence about a company, whatever the model believes it knows.
  return supportingEvidenceCount === 0 ? "UNKNOWN" : proposal;
}

export type ConfidenceDecision = {
  readonly confidenceClass: QConfidenceLevel;
  /** The named rule that decided. Auditable; never a number. */
  readonly reason:
    | "CONFLICTING_SUPPORT"
    | "NO_SUPPORTING_EVIDENCE"
    | "SUPPORT_WITHDRAWN"
    | "VERIFIED_SUPPORT"
    | "MULTIPLE_INDEPENDENT_SOURCES"
    | "SINGLE_DOCUMENT_SOURCE"
    | "SELF_REPORTED_ONLY"
    | "INFERENCE_NOT_ASSERTED"
    | "ESTIMATE_NOT_ACTUAL"
    | "UNKNOWN_TRUTH_CLASS";
};

/**
 * Confidence, as an ordered list of named rules (§14-§15).
 *
 * Categorical, deterministic and auditable: the same inputs always give the
 * same class and the same reason, and both are storable. There is no 0.91,
 * no 83%, and no field anywhere for a model to put one in — this repository
 * has no calibrated methodology, and a number that looks measured but is not
 * is worse than a category everyone reads correctly.
 *
 * The order matters and is deliberate. Conflict and withdrawal come first
 * because they are facts about the evidence rather than gradations of it: an
 * understanding whose sources disagree is not "a bit less confident", it is
 * a different situation, and one whose evidence was withdrawn must stop
 * looking supported immediately.
 *
 * HIGH is reachable only from verified evidence. Nothing an extraction or an
 * inference does gets there, which is the intended ceiling: a pitch deck,
 * however many times it agrees with itself, is a company describing itself.
 */
export function classifyConfidence(input: {
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
  readonly distinctSourceCount: number;
  readonly hasContradictingEvidence: boolean;
  readonly supportWithdrawn: boolean;
}): ConfidenceDecision {
  if (input.hasContradictingEvidence) {
    // Sources disagree and nothing here picks one.
    return {
      confidenceClass: "CONFLICTING_EVIDENCE",
      reason: "CONFLICTING_SUPPORT",
    };
  }
  if (input.supportWithdrawn) {
    return {
      confidenceClass: "INSUFFICIENT_EVIDENCE",
      reason: "SUPPORT_WITHDRAWN",
    };
  }
  if (
    input.evidenceStatus === "NO_EVIDENCE" ||
    input.truthClass === "UNKNOWN"
  ) {
    // Q looked and could not establish it. Not a low mark about the subject.
    return {
      confidenceClass: "INSUFFICIENT_EVIDENCE",
      reason:
        input.evidenceStatus === "NO_EVIDENCE"
          ? "NO_SUPPORTING_EVIDENCE"
          : "UNKNOWN_TRUTH_CLASS",
    };
  }
  if (
    input.evidenceStatus === "EXTERNALLY_VERIFIED" ||
    input.evidenceStatus === "PLATFORM_VERIFIED"
  ) {
    return { confidenceClass: "HIGH", reason: "VERIFIED_SUPPORT" };
  }
  if (input.truthClass === "Q_INFERENCE") {
    // Q's own conclusion, however well evidenced its inputs. It never
    // outranks something a source actually asserted.
    return { confidenceClass: "LOW", reason: "INFERENCE_NOT_ASSERTED" };
  }
  if (input.truthClass === "ESTIMATE") {
    return { confidenceClass: "LOW", reason: "ESTIMATE_NOT_ACTUAL" };
  }
  if (input.distinctSourceCount >= 2) {
    return {
      confidenceClass: "MODERATE",
      reason: "MULTIPLE_INDEPENDENT_SOURCES",
    };
  }
  if (input.evidenceStatus === "DOCUMENT_SUPPORTED") {
    return { confidenceClass: "MODERATE", reason: "SINGLE_DOCUMENT_SOURCE" };
  }
  return { confidenceClass: "LOW", reason: "SELF_REPORTED_ONLY" };
}

/** The four scopes a derived understanding may be recorded at. */
const PRIVATE_SCOPES = new Set<MarketplaceVisibility>([
  "personal_private",
  "organisation_private",
  "founder_private",
  "investor_private",
]);

/**
 * Derived visibility (§19): the NARROWEST scope among the inputs.
 *
 * Not the widest, and never wider than any input. An understanding drawn
 * from a founder-private source and a network-visible one is founder-private
 * material: it could not have been reached without the private half, so it
 * carries the private half's scope. A source already broader than private is
 * narrowed to organisation_private, because derived knowledge is the
 * organisation's own and sharing is a separate decision with its own
 * workflow, audit and actor.
 *
 * There is no argument by which this function widens anything.
 */
export function derivedKnowledgeVisibility(
  inputScopes: readonly MarketplaceVisibility[],
): MarketplaceVisibility {
  const narrowness: Readonly<Record<MarketplaceVisibility, number>> = {
    personal_private: 0,
    founder_private: 1,
    investor_private: 1,
    organisation_private: 2,
    relationship_shared: 3,
    specifically_shared: 3,
    network_visible: 4,
    public_external: 5,
  };
  let chosen: MarketplaceVisibility = "organisation_private";
  let best = narrowness.organisation_private;
  for (const scope of inputScopes) {
    const rank = narrowness[scope];
    const candidate = PRIVATE_SCOPES.has(scope)
      ? scope
      : "organisation_private";
    const candidateRank = PRIVATE_SCOPES.has(scope)
      ? rank
      : narrowness.organisation_private;
    if (candidateRank < best) {
      best = candidateRank;
      chosen = candidate;
    }
  }
  return chosen;
}

/**
 * Derived sensitivity (§20): the strongest class among the inputs, and never
 * below the floor.
 *
 * Monotonic upward only. RESTRICTED evidence cannot produce INTERNAL
 * knowledge through this path, because there is no branch that descends.
 *
 * The floor exists because of combination risk: cash, burn and payroll may
 * each be classified one way while the runway they jointly imply is more
 * sensitive than any of them. A derived understanding is at least as
 * sensitive as its inputs and may be more.
 */
export function derivedKnowledgeSensitivity(
  inputClasses: readonly MessageSensitivity[],
  floor: MessageSensitivity = "CONFIDENTIAL",
): MessageSensitivity {
  let strongest: MessageSensitivity = floor;
  for (const value of inputClasses) {
    if (Q_SENSITIVITY_RANK[value] > Q_SENSITIVITY_RANK[strongest]) {
      strongest = value;
    }
  }
  return strongest;
}

/** Where the understanding came from, for the record. Never authority. */
export function sourceEnvironmentFor(
  sourceTypes: readonly string[],
): KnowledgeSourceEnvironment {
  if (sourceTypes.includes("DOCUMENT")) {
    return "DOCUMENT";
  }
  if (sourceTypes.includes("MEETING")) {
    return "MEETING";
  }
  if (
    sourceTypes.includes("USER_STATEMENT") ||
    sourceTypes.includes("CONVERSATION")
  ) {
    return "CONVERSATION";
  }
  if (sourceTypes.includes("INTEGRATION")) {
    return "INTEGRATION";
  }
  if (sourceTypes.includes("PUBLIC_WEB")) {
    return "PUBLIC";
  }
  return "PLATFORM";
}

/**
 * Whether two structured values are the same understanding.
 *
 * Different currencies never agree and are never converted to find out; a
 * present value never agrees with a missing one.
 */
export function knowledgeValuesAgree(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}
