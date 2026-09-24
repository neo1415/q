import {
  DEFAULT_PITCH_DURATION_POLICY,
  type MediaAsset,
} from "../contracts/index.js";

/**
 * Automated moderation, V1 (CQ-MEDIA-013; doc 20 §99–§100).
 *
 * Capital Q holds integrity authority over what appears on the platform;
 * this rule is the smallest honest exercise of it. It is deterministic,
 * versioned as one object, and asks only what a machine can actually
 * know about a file: that the provider finished with it, that it is not
 * longer than a pitch may be, and that its picture has sane dimensions.
 *
 * What it cannot know it does not pretend to. Anything the rule cannot
 * clear goes to PENDING for a person; automation never BLOCKS, because a
 * refusal is a judgement about content and no rule here reads content.
 */

export type AutomatedModerationRule = {
  /** Named in every audit row and event the rule produces. */
  readonly version: string;
  /** Who decided, for the record: the rule, not a person. */
  readonly provenance: "AUTOMATED_RULE_V1";
  readonly minDurationSeconds: number;
  readonly maxDurationSeconds: number;
  readonly minDimensionPx: number;
  readonly maxDimensionPx: number;
};

export const AUTOMATED_MODERATION_RULE_V1: AutomatedModerationRule = {
  version: "automated-moderation.v1",
  provenance: "AUTOMATED_RULE_V1",
  minDurationSeconds: 1,
  // The product's hard maximum for a pitch, read from the one place it is
  // defined so the rule cannot drift from the guidance a founder was shown.
  maxDurationSeconds: DEFAULT_PITCH_DURATION_POLICY.hardMaxSeconds,
  minDimensionPx: 64,
  maxDimensionPx: 8_192,
};

export const MODERATION_HOLD_REASONS = [
  "NOT_READY",
  "DURATION_UNKNOWN",
  "DURATION_OUT_OF_RANGE",
  "DIMENSIONS_UNKNOWN",
  "DIMENSIONS_OUT_OF_RANGE",
] as const;
export type ModerationHoldReason = (typeof MODERATION_HOLD_REASONS)[number];

export type ModerationVerdict =
  | { readonly outcome: "ALLOWED" }
  | {
      readonly outcome: "PENDING";
      readonly reasons: readonly ModerationHoldReason[];
    };

/** Pure. The asset's technical facts in, a verdict out, nothing else read. */
export function evaluateAutomatedModeration(
  asset: Pick<MediaAsset, "status" | "durationSeconds" | "width" | "height">,
  rule: AutomatedModerationRule = AUTOMATED_MODERATION_RULE_V1,
): ModerationVerdict {
  const reasons: ModerationHoldReason[] = [];
  if (asset.status !== "READY") {
    reasons.push("NOT_READY");
  }
  if (asset.durationSeconds === null) {
    reasons.push("DURATION_UNKNOWN");
  } else if (
    asset.durationSeconds < rule.minDurationSeconds ||
    asset.durationSeconds > rule.maxDurationSeconds
  ) {
    reasons.push("DURATION_OUT_OF_RANGE");
  }
  if (asset.width === null || asset.height === null) {
    reasons.push("DIMENSIONS_UNKNOWN");
  } else if (
    asset.width < rule.minDimensionPx ||
    asset.height < rule.minDimensionPx ||
    asset.width > rule.maxDimensionPx ||
    asset.height > rule.maxDimensionPx
  ) {
    reasons.push("DIMENSIONS_OUT_OF_RANGE");
  }
  return reasons.length === 0
    ? { outcome: "ALLOWED" }
    : { outcome: "PENDING", reasons };
}
