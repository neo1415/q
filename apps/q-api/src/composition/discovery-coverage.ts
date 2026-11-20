import {
  coverageFromOnboarding,
  type DiscoveryCoverage,
} from "@capital-q/q-core";

/**
 * HQ-5: the discovery gap model's coverage from the person's own
 * onboarding answers (own-summary `values`, keyed by step), so discovery
 * never asks what they already declared. Their most recent setup decides
 * the side when they have both. The mandate is added by the answer seam
 * from its own read (a mandate edited after onboarding counts too).
 */
export function discoveryCoverageOf(
  journeys: readonly {
    readonly journeyType: string;
    readonly lastActivityAt: string;
    readonly values?: Readonly<Record<string, unknown>> | undefined;
  }[],
): DiscoveryCoverage | null {
  const latest = [...journeys]
    .filter(
      (journey) =>
        journey.journeyType === "founder" || journey.journeyType === "investor",
    )
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0];
  if (latest === undefined) return null;
  const side = latest.journeyType === "founder" ? "FOUNDER" : "INVESTOR";
  return {
    side,
    known: coverageFromOnboarding(side, Object.keys(latest.values ?? {})),
  };
}
