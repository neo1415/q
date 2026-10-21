import type { ApplicationDimension } from "../contracts/index.js";

import { DIMENSION_LABELS } from "./coverage.js";

/**
 * Why a fact the interviewer read from the applicant's words was not kept
 * (onboarding speed 2026-10-20, G4). Q's reply is written before Capital Q
 * validates what it read, so without this the reply could acknowledge a
 * figure that was then refused, and the applicant never knew.
 */
export type NotRecordedReason =
  /** An amount they did not say themselves (worked out, not stated). */
  | "AMOUNT_NOT_STATED"
  /** Their confirmed contact details stay as confirmed. */
  | "CONTACT_CONFIRMED"
  /** A value that could not be kept in the shape this item takes. */
  | "UNREADABLE";

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
 * One plain line saying what was not recorded and why, asking again where
 * the applicant can put it right. Empty when everything read was kept.
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
  const unreadable = of("UNREADABLE");
  const contact = of("CONTACT_CONFIRMED");
  const lines: string[] = [];
  if (amounts.length > 0) {
    lines.push(
      `I haven't recorded a figure for ${joinLabels(amounts)}: I only keep amounts you say yourself, not ones I work out. What is the figure?`,
    );
  }
  if (unreadable.length > 0) {
    lines.push(
      `I couldn't record what you said about ${joinLabels(unreadable)}. Could you put it another way?`,
    );
  }
  if (contact.length > 0) {
    lines.push(
      `Your ${joinLabels(contact)} ${contact.length === 1 ? "stays" : "stay"} as you confirmed on the contact step.`,
    );
  }
  return lines.join(" ");
}
