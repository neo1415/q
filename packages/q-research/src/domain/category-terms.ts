import {
  countryName,
  isIsoCountryCode,
  REFERENCE_TAXONOMY,
} from "@capital-q/taxonomy";

/**
 * Web discovery (owner 2026-11-06): a search for companies of a kind --
 * a sector, a stage, a place -- from an investor's declared mandate. The
 * egress policy lets out only the person's own words, so "pre-seed" and
 * "United Kingdom" were stripped from every planned query when the person
 * had said neither (they had said "find me new companies online").
 *
 * CONTEXT FIREWALL: what may travel is decided here by REFERENCE DATA,
 * never by the caller. A sector, stage or region is admitted only when it
 * is a real node of the reference taxonomy (by vocabulary and canonical
 * code) and travels as that node's public display name; a country only as
 * an ISO code, travelling as its public name. Anything else -- a made-up
 * "sector" that spells a private note, a figure, a name -- is dropped, so
 * whoever sets these (code or a model) can only ever send public category
 * words. Cheque sizes are figures and have no place here.
 */

export type ResearchCategories = {
  readonly sectors?: readonly string[] | undefined;
  readonly countries?: readonly string[] | undefined;
  readonly stages?: readonly string[] | undefined;
  readonly regions?: readonly string[] | undefined;
};

export const RESEARCH_CATEGORIES_MAX = 6;

const SECTOR_VOCABULARIES = new Set(["industry", "product_category"]);

/**
 * Generic words a search for companies of a kind uses ("new fintech
 * startups raised seed"). They describe the kind of page wanted and say
 * nothing about anyone.
 */
export const DISCOVERY_VOCABULARY: readonly string[] = [
  "new",
  "startups",
  "startup",
  "companies",
  "launches",
  "launched",
  "founders",
  "founder",
  "founded",
  "raised",
  "raises",
  "seed",
  "round",
  "funding",
  // A founder search ("{company} founder CEO", 2026-11-06 round 3).
  "ceo",
  "co",
  "cofounder",
  // A search for more ("{sector} startups to watch", "emerging …",
  // "… startup accelerator"; round 4, 2026-11-06).
  "watch",
  "emerging",
  "accelerator",
];

function nodeName(
  vocabularies: ReadonlySet<string>,
  code: string,
): string | null {
  const wanted = code.trim().toLowerCase();
  const node = REFERENCE_TAXONOMY.nodes.find(
    (candidate) =>
      vocabularies.has(candidate.vocabularyCode) &&
      candidate.canonicalCode === wanted &&
      candidate.status === "ACTIVE",
  );
  return node?.displayName ?? null;
}

/**
 * The public words the categories may send: reference-taxonomy display
 * names and country names only, plus the discovery vocabulary when any
 * category was admitted. Empty when nothing is a real category.
 */
export function categoryTerms(categories: ResearchCategories): string[] {
  const terms: string[] = [];
  const take = (list: readonly string[] | undefined) =>
    (list ?? []).slice(0, RESEARCH_CATEGORIES_MAX);
  for (const code of take(categories.sectors)) {
    const name = nodeName(SECTOR_VOCABULARIES, code);
    if (name !== null) terms.push(name);
  }
  for (const code of take(categories.stages)) {
    const name = nodeName(new Set(["company_stage"]), code);
    if (name !== null) terms.push(name);
  }
  for (const code of take(categories.regions)) {
    const name = nodeName(new Set(["geography"]), code);
    if (name !== null) terms.push(name);
  }
  for (const code of take(categories.countries)) {
    const upper = code.trim().toUpperCase();
    if (!isIsoCountryCode(upper)) continue;
    const name = countryName(upper);
    if (name !== null) terms.push(name);
  }
  return terms.length === 0 ? [] : [...terms, ...DISCOVERY_VOCABULARY];
}
