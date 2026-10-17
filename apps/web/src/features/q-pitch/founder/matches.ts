import type { InvestorGateFitDto } from "@capital-q/contracts";

/**
 * The founder track's three "closest matches" on Discover (owner, 16 Oct:
 * "Q finds investors whose mandates you match"). Decided by code from what
 * each investor PUBLISHES (their gate's criteria, checked against the
 * founder's own company by the API), never from a private mandate and
 * never by a model: fewest required criteria not met, then the larger
 * share met, then more met, then the list's own order. An investor with
 * no published criteria, or none met, is not a match. Unknown is not a
 * miss: it counts as neither met nor not met.
 */
export const MATCH_ANCHORS = [
  "fdr.03.discover.match-1",
  "fdr.03.discover.match-2",
  "fdr.03.discover.match-3",
] as const;

type Standing = {
  readonly id: string;
  readonly order: number;
  readonly requiredMissed: number;
  readonly met: number;
  readonly total: number;
};

export function closestMatches(
  investorIds: readonly string[],
  gates: ReadonlyMap<string, InvestorGateFitDto>,
): ReadonlyMap<string, (typeof MATCH_ANCHORS)[number]> {
  const standings: Standing[] = [];
  investorIds.forEach((id, order) => {
    const criteria = gates.get(id)?.criteria ?? [];
    const met = criteria.filter((c) => c.standing === "MET").length;
    if (criteria.length === 0 || met === 0) return;
    standings.push({
      id,
      order,
      met,
      total: criteria.length,
      requiredMissed: criteria.filter(
        (c) => c.requiredness === "REQUIRED" && c.standing === "NOT_MET",
      ).length,
    });
  });
  standings.sort(
    (a, b) =>
      a.requiredMissed - b.requiredMissed ||
      b.met / b.total - a.met / a.total ||
      b.met - a.met ||
      a.order - b.order,
  );
  return new Map(
    standings.slice(0, MATCH_ANCHORS.length).flatMap((s, i) => {
      const anchor = MATCH_ANCHORS[i];
      return anchor === undefined ? [] : [[s.id, anchor] as const];
    }),
  );
}
