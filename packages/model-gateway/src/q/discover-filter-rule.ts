/**
 * QA F-114 (25 Oct 2026, savanna-seed, 07a748ac): "Only fintech ones in
 * Kenya or Nigeria that are raising now." after Q's own list opened
 * Discover and set its filters, adding Verified, Has pitch video and Raise
 * shared, and showed "No companies match these filters" -- while Silo
 * Credit, Ledgerfold and MedTrail are Nigerian fintechs that are raising.
 *
 * Two rules, decided by code at the tool port, whatever the model calls:
 *
 * - A narrowing of the list Q just gave is answered in the thread (the
 *   narrowed cards, from the catalog, where "raising now" is the network
 *   rank's own raise read). Their Discover page changes only when they
 *   asked for it (the reader's named action) or are on it.
 * - A filter Q does set carries only what they stated: sector, country and
 *   stage as the turn reader read them, and a raise range the model gives.
 *   Verified only, has a pitch video and raise shared only are the
 *   person's own choices on the filter sheet; Q never adds them. "Raising
 *   now" is not "raise shared": a raise stated in a pitch counts as raising
 *   for the rank, so the page is not narrowed to shared raises for it.
 */

export const SET_DISCOVER_FILTERS_TOOL = "set_discover_filters";

export type DiscoverRule = {
  /** The turn reader's structure for a company search, if it read one. */
  readonly discover: {
    readonly sectors: readonly string[];
    readonly countries: readonly string[];
    readonly stages: readonly string[];
    readonly raising?: boolean | undefined;
  } | null;
  /** A narrowing of a list Q just answered. */
  readonly narrowing: boolean;
  /** They asked for Discover itself (the reader's action) or are on it. */
  readonly asked: boolean;
};

export type DiscoverFilterDecision =
  | { readonly kind: "REFUSE"; readonly safeMessage: string }
  | { readonly kind: "SET"; readonly arguments: Record<string, unknown> };

const QUALIFIERS = ["verifiedOnly", "hasPitch", "raiseDisclosedOnly"] as const;

export function discoverFilterDecision(
  args: unknown,
  rule: DiscoverRule | undefined,
): DiscoverFilterDecision {
  if (rule?.narrowing === true && !rule.asked) {
    return {
      kind: "REFUSE",
      safeMessage:
        "They narrowed the list you just gave them and did not ask to change their Discover page. Answer in the conversation: list the companies that match (discover_companies with their sectors, countries and raising), and change nothing on their screen.",
    };
  }
  const given =
    typeof args === "object" && args !== null
      ? { ...(args as Record<string, unknown>) }
      : {};
  for (const qualifier of QUALIFIERS) delete given[qualifier];
  const read = rule?.discover ?? null;
  if (read !== null) {
    if (read.sectors.length > 0) given["sectors"] = [...read.sectors];
    if (read.countries.length > 0) {
      given["countries"] = read.countries.map((code) => code.toUpperCase());
    }
    if (read.stages.length > 0) given["stages"] = [...read.stages];
  }
  return { kind: "SET", arguments: given };
}
