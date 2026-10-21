import type { ApplicationDimension } from "../contracts/index.js";

import { DIMENSION_LABELS } from "./coverage.js";
import { amountWords } from "./stated-amount.js";

/**
 * A figure Q worked out rather than heard ("two pay $180,000 each" read as
 * revenue 360,000). It is not recorded as the applicant's claim until they
 * agree to it, so Q says it back as a question, the way a person would
 * ("So that's USD 360,000 for revenue, right?"), and their yes records it
 * (owner 2026-10-21: confirm it, don't lecture). Every other answer is put
 * into its shape and saved without asking.
 */
export type NotRecordedReason = "AMOUNT_READ_BACK";

export type NotRecorded = {
  readonly dimension: ApplicationDimension;
  readonly reason: NotRecordedReason;
  /** The worked-out figure, as an exact decimal, and its ISO currency. */
  readonly amount: string;
  readonly currency: string;
};

/** The words that open Q's read-back; also how the next turn finds it. */
const READ_BACK_LEAD = "So that's";

/**
 * One short question saying the worked-out figures back for a yes. Empty
 * when everything read was kept.
 */
export function readBackLine(items: readonly NotRecorded[]): string {
  const seen = new Set<ApplicationDimension>();
  const parts: string[] = [];
  for (const item of items) {
    if (seen.has(item.dimension)) continue;
    seen.add(item.dimension);
    parts.push(
      `${amountWords(item.amount, item.currency)} for ${DIMENSION_LABELS[item.dimension].toLowerCase()}`,
    );
  }
  if (parts.length === 0) return "";
  const listed =
    parts.length === 1
      ? (parts[0] ?? "")
      : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
  return `${READ_BACK_LEAD} ${listed}, right?`;
}

const DIMENSION_BY_LABEL = new Map(
  (Object.entries(DIMENSION_LABELS) as [ApplicationDimension, string][]).map(
    ([dimension, label]) => [label.toLowerCase(), dimension],
  ),
);

/** The figures a read-back line of Q's put to the applicant, if any. */
export function readBacksIn(qText: string): readonly NotRecorded[] {
  const at = qText.lastIndexOf(READ_BACK_LEAD);
  if (at < 0) return [];
  const line = qText.slice(at + READ_BACK_LEAD.length);
  const found: NotRecorded[] = [];
  for (const match of line.matchAll(
    /([A-Z]{3}) (\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?) for ([a-z ]+?)(?=,| and |$)/gu,
  )) {
    const dimension = DIMENSION_BY_LABEL.get((match[3] ?? "").trim());
    if (dimension === undefined || match[1] === undefined) continue;
    found.push({
      dimension,
      reason: "AMOUNT_READ_BACK",
      amount: (match[2] ?? "").replace(/,/gu, ""),
      currency: match[1],
    });
  }
  return found;
}
