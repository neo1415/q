import { z } from "zod";

import type { OnboardingSourceRef } from "@capital-q/onboarding";
import type { FounderFactKey } from "@capital-q/q-core";

/**
 * Founder Onboarding Q (CQ-Q-021 §18-§29, §39-§43).
 *
 * The shapes that carry what Q understood from a founder's own material
 * into the onboarding journey — and, just as importantly, the shapes that
 * keep it a suggestion until a person says otherwise.
 *
 * Three separations hold this together, and none of them may collapse:
 *
 *   a document said it   ≠   the founder confirmed it   ≠   it is true
 *   a suggestion         ≠   a response                 ≠   canonical state
 *   missing              ≠   zero, false, or bad
 *
 * A pitch deck asserting five hundred customers produces a candidate, then
 * a suggestion, then — only if a founder confirms it — a validated response
 * that the existing write targets carry into the owning domain. There is no
 * path from a model's output to a company record that does not pass through
 * a person (§19, §20, §51).
 */

/** Where a candidate came from, resolved on the server from an opaque label. */
export type FounderSourceOrigin = {
  readonly documentId: string;
  readonly documentVersionId: string;
  /** Human-readable, e.g. "your pitch deck, slide 6". Never a storage path. */
  readonly label: string;
  /** Page, when the citation is page-specific. A locator, not content. */
  readonly page: number | null;
};

/**
 * A candidate fact after validation: what it claims, what it rests on, and
 * where that came from.
 *
 * `citations` are gone by this point — they were labels, and labels are a
 * rendering detail. What survives is the resolved origin, which is what
 * provenance actually means (§21).
 */
export type FounderCandidate = {
  readonly key: FounderFactKey;
  readonly value: string;
  /** Verbatim words the value rests on, when a source stated it. */
  readonly quote: string | null;
  readonly truthClass: "USER_CLAIM" | "ESTIMATE" | "Q_INFERENCE" | "UNKNOWN";
  readonly evidenceStatus: "NO_EVIDENCE" | "SELF_REPORTED";
  readonly confidence: string;
  /** True when a source stated it; false when Q inferred it. */
  readonly explicit: boolean;
  readonly origins: readonly FounderSourceOrigin[];
};

/** A taxonomy phrase the founder's material suggests. Mapped deterministically. */
export type FounderTaxonomySuggestion = {
  readonly label: string;
  readonly origins: readonly FounderSourceOrigin[];
};

/**
 * Two supplied readings of the same fact that disagree (§29, §64).
 *
 * Both sides travel or neither does. This is a question for the founder,
 * never a decision for Capital Q: whichever number is larger, newer or more
 * flattering has no bearing on which is recorded.
 */
export type FounderConflict = {
  readonly key: FounderFactKey;
  readonly readings: readonly {
    readonly value: string;
    readonly origins: readonly FounderSourceOrigin[];
  }[];
  readonly question: string;
};

/** A fact stated in a way that could mean two things. Neither missing nor wrong. */
export type FounderAmbiguity = {
  readonly key: FounderFactKey;
  readonly question: string;
};

export type FounderExtractionOutcome = {
  readonly candidates: readonly FounderCandidate[];
  readonly taxonomy: readonly FounderTaxonomySuggestion[];
  readonly conflicts: readonly FounderConflict[];
  readonly ambiguities: readonly FounderAmbiguity[];
  readonly missing: readonly FounderFactKey[];
  /** Model-proposed questions, before the planner decides which are asked. */
  readonly proposed: readonly {
    readonly key: FounderFactKey;
    readonly question: string;
    readonly why: string;
  }[];
  readonly summary: string;
  /**
   * Present when nothing could be extracted. Onboarding continues either
   * way: a founder is never trapped because a model was unavailable (§46).
   */
  readonly blocked:
    | "NO_MATERIAL"
    | "NO_ELIGIBLE_MODEL_ROUTE"
    | "MODEL_UNAVAILABLE"
    | "MODEL_OUTPUT_REJECTED"
    | null;
  readonly telemetry: FounderExtractionTelemetry;
};

/** Counts, codes and identifiers. Never a value, a quote or a document's text (§59). */
export type FounderExtractionTelemetry = {
  readonly promptBundleVersion: string | null;
  readonly providerCode: string | null;
  readonly modelCode: string | null;
  readonly passageCount: number;
  readonly documentCount: number;
  readonly candidateCount: number;
  readonly conflictCount: number;
  readonly ambiguityCount: number;
  readonly rejectedCandidateCount: number;
  readonly rejectedCitationCount: number;
  readonly latencyMs: number;
  readonly costUsd: number;
};

/**
 * A question the planner decided is worth asking (§24, §25, §41, §42).
 *
 * `stepKey` is always a real step of the pinned definition: the planner
 * chooses among questions the journey already knows how to ask and
 * validate, so a model cannot introduce a question with no schema behind
 * it, and an answer always lands in a field the domain understands.
 */
export type PlannedQuestion = {
  readonly key: FounderFactKey;
  readonly stepKey: string;
  readonly question: string;
  /** Why Q needs it — never why a better answer would look good (§31). */
  readonly why: string;
  readonly reason:
    "REQUIRED_AND_UNANSWERED" | "MATERIAL_GAP" | "CONTRADICTION" | "AMBIGUITY";
  /** Both sides of a disagreement, when this question is settling one. */
  readonly readings: readonly string[];
};

export const FOUNDER_QUESTION_REASONS = [
  "REQUIRED_AND_UNANSWERED",
  "MATERIAL_GAP",
  "CONTRADICTION",
  "AMBIGUITY",
] as const;

/**
 * How many follow-ups one iteration may ask (§42).
 *
 * Small on purpose. Twenty "just in case" questions is the questionnaire
 * this packet exists to replace, and a founder can always add more later.
 */
export const FOUNDER_FOLLOW_UP_BUDGET = 4;

export type FounderSuggestionDraft = {
  readonly stepKey: string;
  readonly targetField: string;
  readonly suggestedValue: Record<string, unknown>;
  readonly sourceRefs: readonly OnboardingSourceRef[];
  readonly confidence: string | null;
};

export const FounderSuggestionDraftSchema = z
  .object({
    stepKey: z.string().min(1).max(64),
    targetField: z.string().regex(/^[a-z][a-z0-9_.]{0,79}$/),
    suggestedValue: z.record(z.string(), z.unknown()),
    sourceRefs: z
      .array(
        z
          .object({
            sourceType: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
            sourceId: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(20),
    confidence: z.string().nullable(),
  })
  .strict();
