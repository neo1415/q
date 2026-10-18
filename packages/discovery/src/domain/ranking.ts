import {
  DISCOVERY_RANKING_VERSION,
  type DiscoveredCompany,
  type DiscoveredInvestor,
  type DiscoveryReason,
} from "../contracts.js";

/**
 * The ranking (doc 19 §§44-45, §100). Deterministic, explainable,
 * versioned, reproducible.
 *
 * Every number that decides an order is in this file, and every one of
 * them is a weight on a DECLARED field. There is no popularity signal, no
 * recency-of-activity signal, no click, no view, no dwell, no paid
 * placement, and nothing a model produced. Two runs over the same rows
 * give the same slate, and `DISCOVERY_RANKING_VERSION` changes whenever
 * anything here does.
 *
 * The score is never shown. It exists so a slate can be reproduced and
 * audited; what a person reads is the reasons, in their own vocabulary.
 */

/**
 * How much a declared preference counts, by how strongly it was declared.
 * An investor who said a sector is a MUST gets more from a match than one
 * who said it would be NICE — because they said so, not because anything
 * was inferred about them.
 */
export const PREFERENCE_WEIGHT: Readonly<Record<string, number>> = {
  MUST: 40,
  STRONG: 25,
  NICE: 10,
};

export const SIGNAL_WEIGHT = {
  /** The company's declared stage is inside the mandate's declared range. */
  stageInRange: 30,
  /** The investor says they are actively deploying. Declared, never observed. */
  declaredActivelyDeploying: 20,
  declaredSelectivelyDeploying: 10,
  /** Enough declared profile to be worth a founder's time. */
  profileComplete: 10,
} as const;

/** Vocabularies whose matches are worth naming separately to a person. */
const REASON_BY_VOCABULARY: Readonly<Record<string, DiscoveryReason["kind"]>> =
  {
    industry: "SECTOR_MATCH",
    geography: "GEOGRAPHY_MATCH",
    business_model: "BUSINESS_MODEL_MATCH",
    customer_type: "CUSTOMER_TYPE_MATCH",
  };

export function reasonKindForVocabulary(
  vocabulary: string,
): DiscoveryReason["kind"] {
  return REASON_BY_VOCABULARY[vocabulary] ?? "SECTOR_MATCH";
}

export function preferenceWeight(strength: string): number {
  return PREFERENCE_WEIGHT[strength] ?? PREFERENCE_WEIGHT["NICE"] ?? 10;
}

/**
 * Two counterparts with the same score keep a stable order, by id. A slate
 * that reshuffles on every read is not reproducible, and "roughly the same
 * order" is not an order anyone can audit.
 */
function byRankThenId<T extends { readonly rank: number; readonly id: string }>(
  a: T,
  b: T,
): number {
  return b.rank - a.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function rankCompanies(
  scored: readonly (Omit<DiscoveredCompany, "rank"> & {
    readonly rank: number;
  })[],
): readonly DiscoveredCompany[] {
  return [...scored]
    .map((item) => ({ ...item, id: item.companyId }))
    .sort(byRankThenId)
    .map(({ id: _id, ...item }) => item);
}

export function rankInvestors(
  scored: readonly (Omit<DiscoveredInvestor, "rank"> & {
    readonly rank: number;
  })[],
): readonly DiscoveredInvestor[] {
  return [...scored]
    .map((item) => ({ ...item, id: item.investorOrganisationId }))
    .sort(byRankThenId)
    .map(({ id: _id, ...item }) => item);
}

export { DISCOVERY_RANKING_VERSION };
