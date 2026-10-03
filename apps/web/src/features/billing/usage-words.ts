import type { QUsageDto } from "@capital-q/contracts";

/**
 * Words for Settings → Usage (lead 2026-10-03). Amounts are rounded for a
 * person and always "about": prices are snapshots and some calls have none.
 */

const TASK_NAMES: Readonly<
  Record<QUsageDto["byTask"][number]["purpose"], string>
> = {
  CONVERSATION: "Conversations with Q",
  INSTRUCTION: "Standing instructions",
  DELEGATED_WORK: "Work Q did for you",
  REHEARSAL: "Pitch rehearsals",
  RESEARCH: "Research",
  ONBOARDING: "Setting up",
  MEETING: "Meetings",
  DOCUMENT: "Documents",
  OTHER: "Other",
};

export function taskName(
  purpose: QUsageDto["byTask"][number]["purpose"],
): string {
  return TASK_NAMES[purpose];
}

/** "$0.17", "less than $0.01", "$0". Never a float in the record; display only. */
export function dollars(usd: string): string {
  const value = Number(usd);
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value < 0.01) return "less than $0.01";
  return `$${value.toFixed(2)}`;
}

export function headline(usage: QUsageDto): string {
  return Number(usage.totalUsd) <= 0
    ? "This month, Q hasn't used anything for you yet."
    : `This month: Q used about ${dollars(usage.totalUsd)} for you.`;
}

export function monthName(month: string): string {
  const [year = "1970", m = "01"] = month.split("-");
  return new Date(Date.UTC(Number(year), Number(m) - 1, 1)).toLocaleDateString(
    "en-GB",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
}

/**
 * The month's calls in a sentence. A failed call is never charged and is
 * said so; "without a price yet" is kept for a call that worked but has no
 * price (QA 2026-10-03: 130 failed calls read as unpriced).
 */
export function callsLine(
  usage: Pick<QUsageDto, "month" | "calls" | "unpricedCalls"> & {
    readonly failedCalls?: number | undefined;
  },
): string {
  const plural = (n: number, one: string, many: string) =>
    `${String(n)} ${n === 1 ? one : many}`;
  const failed = usage.failedCalls ?? 0;
  return `${monthName(usage.month)}, ${plural(usage.calls, "model call", "model calls")}${
    failed > 0
      ? `, ${plural(failed, "failed call", "failed calls")}, not charged`
      : ""
  }${
    usage.unpricedCalls > 0
      ? `, ${String(usage.unpricedCalls)} without a price yet (counted at no cost)`
      : ""
  }.`;
}
