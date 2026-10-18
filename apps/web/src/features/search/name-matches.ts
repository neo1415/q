import "server-only";

import { discoverInvestors } from "@capital-q/api-client";

import { apiSession, resolveOwnContext } from "@/features/q/context";
import { ownRelationships } from "@/features/relationships/relationship-data";
import { relationshipHref } from "@/features/relationships/relationship-words";

/**
 * Search by name (demo audit 2026-10-03), within what the person can
 * already see -- never a directory. The founder direction of 2026-09-29
 * still holds for everyone else: a stranger is found by their whole
 * @handle only. So the names searched are the person's own relationships
 * and, for a founder, the investors their Discover already lists. Nothing
 * is fetched that their own pages would not show them, and an investor's
 * feed is not read here (a search is not a view).
 */
export type NameMatch = {
  readonly name: string;
  readonly detail: string;
  readonly href: string;
  readonly kind: "company" | "investor";
  /** A company's id, for its gated photo route. */
  readonly companyId?: string | undefined;
  /**
   * An investor's photo only as the founder's own Discover read returned
   * it (ADR 0023); null otherwise. Never fetched for a search.
   */
  readonly photoUrl?: string | null | undefined;
};

const MAX = 12;

export function matchesName(name: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = name.toLowerCase();
  return words.length > 0 && words.every((word) => haystack.includes(word));
}

export async function nameMatches(
  query: string,
): Promise<readonly NameMatch[]> {
  const context = await resolveOwnContext();
  if (context.kind !== "FOUNDER" && context.kind !== "INVESTOR") return [];
  const session = await apiSession();
  const [relationships, investors] = await Promise.all([
    ownRelationships(context),
    context.kind === "FOUNDER" && session !== null
      ? discoverInvestors(session)
          .then((slate) => slate.items)
          .catch(() => [])
      : Promise.resolve([]),
  ]);
  const seen = new Set<string>();
  const out: NameMatch[] = [];
  const discovered = new Map(
    investors.map((investor) => [
      investor.investorOrganisationId,
      investor.photoUrl ?? null,
    ]),
  );
  for (const item of relationships ?? []) {
    if (!matchesName(item.counterpart.name, query)) continue;
    seen.add(item.counterpart.id);
    out.push({
      name: item.counterpart.name,
      detail: "Your relationship",
      href: relationshipHref(item),
      ...(item.counterpart.kind === "COMPANY"
        ? { kind: "company" as const, companyId: item.counterpart.id }
        : {
            kind: "investor" as const,
            photoUrl: discovered.get(item.counterpart.id) ?? null,
          }),
    });
  }
  for (const investor of investors) {
    if (seen.has(investor.investorOrganisationId)) continue;
    if (!matchesName(investor.displayName, query)) continue;
    out.push({
      name: investor.displayName,
      detail: "In your Discover",
      href: `/investors/${investor.investorOrganisationId}`,
      kind: "investor",
      photoUrl: investor.photoUrl ?? null,
    });
  }
  return out.slice(0, MAX);
}
