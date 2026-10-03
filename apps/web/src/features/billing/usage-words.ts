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

/** The month's total as a figure: "$0.81", "$0.00", "less than $0.01". */
export function total(usd: string): string {
  return Number(usd) > 0 ? dollars(usd) : "$0.00";
}

export function monthName(month: string): string {
  const [year = "1970", m = "01"] = month.split("-");
  return new Date(Date.UTC(Number(year), Number(m) - 1, 1)).toLocaleDateString(
    "en-GB",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
}
