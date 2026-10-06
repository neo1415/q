import "server-only";

import { discoverInvestors, exploreSearch } from "@capital-q/api-client";
import {
  exploreProfileHref,
  type ExploreSearchTab,
} from "@capital-q/contracts";

import { apiSession, resolveOwnContext } from "@/features/q/context";
import { ownRelationships } from "@/features/relationships/relationship-data";
import { matchesName } from "@/features/search/name-matches";

import {
  parseSearch,
  profileFromCompany,
  relatedSearches,
  type ExploreSearchView,
  type ProfileResult,
  type SectorWord,
} from "./explore-search-view";

/**
 * Explore's search, on the server, under the person's own session. The
 * index answers companies and pitches after disclosure (the API); names
 * are matched only among people the person already sees: their own
 * relationships and, for a founder, the investors Discover lists. Every
 * result opens a profile.
 */
export async function loadExploreSearch(input: {
  readonly query: string;
  readonly tab: ExploreSearchTab;
  readonly sectors: readonly SectorWord[];
}): Promise<ExploreSearchView | null> {
  const session = await apiSession();
  if (session === null) return null;
  const parsed = parseSearch(input.query, input.sectors);
  const context = await resolveOwnContext();
  const [found, relationships, investors] = await Promise.all([
    exploreSearch(session, {
      text: parsed.text,
      sectorNodeIds: parsed.sectorNodeIds,
    }),
    ownRelationships(context).catch(() => undefined),
    context.kind === "FOUNDER"
      ? discoverInvestors(session)
          .then((slate) => slate.items)
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const companies = new Map<string, ProfileResult>(
    found.companies.map((c) => [c.companyId, profileFromCompany(c)]),
  );
  const investorResults = new Map<string, ProfileResult>();
  const people: ProfileResult[] = [];
  const text = input.query.trim();
  for (const item of relationships ?? []) {
    if (!matchesName(item.counterpart.name, text)) continue;
    const kind =
      item.counterpart.kind === "COMPANY" ? "company" : ("investor" as const);
    const result: ProfileResult = {
      kind,
      id: item.counterpart.id,
      name: item.counterpart.name,
      line: null,
      meta: "Your relationship",
      href: exploreProfileHref(kind, item.counterpart.id),
      photoUrl: item.counterpart.photoUrl ?? null,
    };
    people.push(result);
    if (kind === "company" && !companies.has(result.id)) {
      companies.set(result.id, result);
    }
    if (kind === "investor") investorResults.set(result.id, result);
  }
  for (const investor of investors) {
    if (investorResults.has(investor.investorOrganisationId)) continue;
    if (!matchesName(investor.displayName, text)) continue;
    investorResults.set(investor.investorOrganisationId, {
      kind: "investor",
      id: investor.investorOrganisationId,
      name: investor.displayName,
      line: null,
      meta: "In your Discover",
      href: exploreProfileHref("investor", investor.investorOrganisationId),
      photoUrl: investor.photoUrl ?? null,
    });
  }
  const sectorLabels = new Map(input.sectors.map((s) => [s.nodeId, s.label]));
  return {
    query: text,
    tab: input.tab,
    chips: parsed.chips,
    companies: [...companies.values()],
    investors: [...investorResults.values()],
    people,
    pitches: found.pitches,
    related: relatedSearches(found.pitches, sectorLabels, text),
  };
}
