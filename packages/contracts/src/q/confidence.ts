import { z } from "zod";

/**
 * How sure Q is, in the five states the Q architecture permits a person to
 * see (doc 12 §21).
 *
 * No number. There is no calibrated methodology behind a percentage today,
 * and a "93%" that means nothing is worse than a word that means something.
 * If numeric calibration arrives later it is an additive internal field, and
 * this vocabulary remains what the person is shown.
 *
 * Confidence is one axis. It is not truth class (what kind of statement this
 * is), not evidence status (how it is supported), not verification, and not
 * a judgement about the subject: INSUFFICIENT_EVIDENCE about a company's
 * runway says Q could not find out -- it says nothing about the runway.
 * Unknown is unknown, never negative.
 */
export const Q_CONFIDENCE_LEVELS = [
  "HIGH",
  "MODERATE",
  "LOW",
  /** Q looked and could not find enough to say. Not a low mark. */
  "INSUFFICIENT_EVIDENCE",
  /** Sources disagree and Q has not silently picked one. */
  "CONFLICTING_EVIDENCE",
] as const;

export type QConfidenceLevel = (typeof Q_CONFIDENCE_LEVELS)[number];

export const QConfidenceLevelSchema = z.enum(Q_CONFIDENCE_LEVELS);

/** Plain-English labels. Rendered by a UI in place of the enum value. */
export const Q_CONFIDENCE_LABELS: Readonly<Record<QConfidenceLevel, string>> = {
  HIGH: "High confidence",
  MODERATE: "Moderate confidence",
  LOW: "Low confidence",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
  CONFLICTING_EVIDENCE: "Conflicting evidence",
};

export function qConfidenceLabel(level: QConfidenceLevel): string {
  return Q_CONFIDENCE_LABELS[level];
}

/**
 * The levels that express uncertainty rather than a degree of confidence.
 * An uncertainty block or finding uses one of these; HIGH would contradict
 * the block's own meaning.
 */
export const Q_UNCERTAIN_CONFIDENCE_LEVELS = [
  "LOW",
  "INSUFFICIENT_EVIDENCE",
  "CONFLICTING_EVIDENCE",
] as const;

export const QUncertainConfidenceLevelSchema = z.enum(
  Q_UNCERTAIN_CONFIDENCE_LEVELS,
);
