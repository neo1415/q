import type {
  DiscoveryMode,
  MandateConstraintDimension,
  MandatePreferenceClass,
} from "@capital-q/contracts";
import type { MandateDimension, MandateStrength } from "@capital-q/q-core";

/**
 * Investor Mandate Q (CQ-Q-022 §28-§35).
 *
 * What Q proposes after reading an investor's own description of what they
 * invest in — and the shapes that keep every one of those proposals a
 * proposal.
 *
 * Three separations hold this together:
 *
 *   what the investor said  ≠  what Q read into it  ≠  what is declared
 *   preference  ≠  avoid  ≠  hard exclusion
 *   the mandate  ≠  observed behaviour  ≠  Q inference  ≠  GateQ
 *
 * A hard exclusion makes candidates ineligible. That is the one consequence
 * in this packet a model must never be able to cause, and the type system
 * carries it: `ProposedConstraint.preferenceClass` cannot be
 * HARD_EXCLUSION, and the only way to reach it is a confirmation carrying
 * the investor's decision.
 */

/** One thing Q read, ready for the investor to confirm, edit or reject. */
export type ProposedConstraint = {
  readonly dimension: MandateDimension;
  /** Where it lands among the canonical constraint dimensions, when it does. */
  readonly constraintDimension: MandateConstraintDimension | null;
  /** The investor's own words for the value. Mapped later, never here. */
  readonly value: string;
  /** The words it rests on, when they said it outright. */
  readonly quote: string | null;
  /**
   * Never HARD_EXCLUSION, and never MUST. A model's reading of firmness is
   * not an eligibility rule (§20).
   */
  readonly preferenceClass: Exclude<
    MandatePreferenceClass,
    "HARD_EXCLUSION" | "MUST"
  >;
  /**
   * True when the wording reads as a request to exclude outright. The
   * investor is asked; nothing acts on this alone.
   */
  readonly proposesExclusion: boolean;
  readonly confidence: string;
};

/** A sector phrase in the investor's words, before Capital Q maps it (§14, §41). */
export type ProposedTaxonomyPhrase = {
  readonly phrase: string;
  readonly preferenceClass: Exclude<
    MandatePreferenceClass,
    "HARD_EXCLUSION" | "MUST"
  >;
  readonly proposesExclusion: boolean;
  /** Canonical node ids the taxonomy service resolved, when it resolved any. */
  readonly nodeIds: readonly string[];
};

/**
 * A reading the wording genuinely leaves open (§33-§35).
 *
 * SCOPE_OR_EXCLUSION is the one that changes eligibility, so it is asked
 * before anything else. "I mostly invest in Africa" is not turned into an
 * exclusion of everywhere else, and being asked costs one question.
 */
export type MandateAmbiguity = {
  readonly dimension: MandateDimension;
  readonly kind: "SCOPE_OR_EXCLUSION" | "TYPICAL_OR_LIMIT" | "IMPRECISE_VALUE";
  readonly quote: string | null;
  readonly question: string;
};

/** Something Capital Q will not screen on, reported rather than dropped (§36). */
export type RefusedCriterion = {
  readonly quote: string;
  readonly message: string;
};

/**
 * What Q inferred, kept apart from what was declared (§22).
 *
 * Carries its basis so it can never be presented as a declaration, and
 * never reaches `core.investor_mandates` without the investor saying so.
 */
export type MandateInference = {
  readonly dimension: MandateDimension;
  readonly value: string;
  readonly basis: string;
  readonly confidence: string;
};

export type MandateSynthesis = {
  readonly constraints: readonly ProposedConstraint[];
  readonly taxonomy: readonly ProposedTaxonomyPhrase[];
  /** Cheque, currency, stage envelope and discovery mode: columns, not rows. */
  readonly columns: readonly {
    readonly dimension: MandateDimension;
    readonly value: string;
    readonly quote: string | null;
  }[];
  readonly ambiguities: readonly MandateAmbiguity[];
  readonly inferences: readonly MandateInference[];
  /** Where a declaration and an observation disagree. Stated, never resolved (§21). */
  readonly tensions: readonly string[];
  readonly refused: readonly RefusedCriterion[];
  readonly missing: readonly MandateDimension[];
  readonly summary: string;
  /**
   * Present when nothing could be synthesised. Onboarding continues:
   * every dimension is still answerable by selection, which is how the
   * journey worked before Q existed (§27).
   */
  readonly blocked:
    | "NO_NARRATIVE"
    | "NO_ELIGIBLE_MODEL_ROUTE"
    | "MODEL_UNAVAILABLE"
    | "MODEL_OUTPUT_REJECTED"
    | "PROTECTED_CRITERIA_ONLY"
    | null;
  /**
   * The session revision this synthesis was computed from (§48, §49, §91).
   * A result computed from an older revision is stale and is refused rather
   * than allowed to overwrite newer choices.
   */
  readonly computedFromRevision: number;
  readonly telemetry: MandateSynthesisTelemetry;
};

/** Counts, codes and versions. Never the thesis, a cheque figure or an exclusion (§74). */
export type MandateSynthesisTelemetry = {
  readonly promptBundleVersion: string | null;
  readonly providerCode: string | null;
  readonly modelCode: string | null;
  readonly constraintCount: number;
  readonly taxonomyPhraseCount: number;
  readonly mappedTaxonomyCount: number;
  readonly proposedExclusionCount: number;
  readonly ambiguityCount: number;
  readonly inferenceCount: number;
  readonly refusedCount: number;
  readonly latencyMs: number;
  readonly costUsd: number;
};

/**
 * The investor's decision on one proposed exclusion (§20, §30).
 *
 * `confirmed: true` is the only thing in this packet that can produce a
 * HARD_EXCLUSION, and it exists as its own type so the decision is visible
 * at every call site rather than hidden in a boolean argument.
 */
export type ExclusionDecision = {
  readonly dimension: MandateDimension;
  readonly value: string;
} & (
  | { readonly confirmed: true }
  | { readonly confirmed: false; readonly fallback: "AVOID" | "DROP" }
);

/** What a confirmed synthesis becomes, ready for the Investor service. */
export type ConfirmedMandateInput = {
  readonly constraints: readonly {
    readonly dimension: MandateConstraintDimension;
    readonly value: string;
    readonly importance: MandatePreferenceClass;
    readonly isHardExclusion: boolean;
  }[];
  readonly discoveryMode: DiscoveryMode | null;
  /** The investor's own narrative, preserved verbatim beside the structure (§18). */
  readonly rawMandateText: string | null;
};

export type { MandateStrength };
