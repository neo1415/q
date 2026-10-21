import type { ApplicationDimension } from "../contracts/index.js";

import { DIMENSION_LABELS } from "./coverage.js";

/**
 * Why a fact the interviewer read from the applicant's words was not kept
 * (onboarding speed 2026-10-20, G4). Q's reply is written before Capital Q
 * validates what it read, so without this the reply could acknowledge a
 * figure that was then refused, and the applicant never knew.
 */
export type NotRecordedReason =
  /**
   * An amount they did not say themselves (worked out, not stated). The
   * one refusal left (owner principle 2026-10-21): every other answer is
   * put into its shape and saved, a changed contact detail included.
   */
  "AMOUNT_NOT_STATED";

export type NotRecorded = {
  readonly dimension: ApplicationDimension;
  readonly reason: NotRecordedReason;
};

function joinLabels(labels: readonly string[]): string {
  const lower = labels.map((label) => label.toLowerCase());
  if (lower.length <= 1) return lower[0] ?? "";
  return `${lower.slice(0, -1).join(", ")} and ${lower.at(-1) ?? ""}`;
}

/**
 * One plain line saying a worked-out figure was not recorded and asking
 * for theirs. Empty when everything read was kept.
 */
export function notRecordedLine(items: readonly NotRecorded[]): string {
  const of = (reason: NotRecordedReason) => [
    ...new Set(
      items
        .filter((item) => item.reason === reason)
        .map((item) => DIMENSION_LABELS[item.dimension]),
    ),
  ];
  const amounts = of("AMOUNT_NOT_STATED");
  return amounts.length === 0
    ? ""
    : `I haven't recorded a figure for ${joinLabels(amounts)}: I only keep amounts you say yourself, not ones I work out. What is the figure?`;
}
