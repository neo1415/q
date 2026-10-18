import { createHash } from "node:crypto";

/**
 * What one person's edition follows (DAILY spec §6, §8).
 *
 * Two halves, kept apart on purpose:
 *
 * - PUBLIC topics: sector, stage and market labels (taxonomy display
 *   names, country names). The same words could describe thousands of
 *   people, so a gathering for them is shared by everyone who follows the
 *   same set, keyed by a hash of the words alone.
 * - PERSONAL facts: their own company or firm, the names they have a
 *   relationship with, and their raise. These never enter a shared
 *   gathering or its key; they are used only for that person's own
 *   section and Q's take, stored only on their own edition.
 */
export type InterestProfile = {
  readonly userId: string;
  readonly tenantId: string;
  readonly readerName: string | null;
  readonly email: string | null;
  readonly role: "FOUNDER" | "INVESTOR";
  readonly sectors: readonly string[];
  readonly stages: readonly string[];
  readonly markets: readonly string[];
  /** Their own company's or firm's public name. Personal. */
  readonly ownName: string | null;
  /** Public names of companies or investors they have a relationship with. Personal. */
  readonly knownNames: readonly string[];
  /** Their raise as they recorded it ("Seed, 1500000 USD"). Personal. */
  readonly raise: string | null;
};

/** When a person has told Capital Q nothing to follow yet. */
export const GENERAL_TOPICS = ["Venture capital", "Startup funding"] as const;

const MAX_TOPICS = 8;

function clean(labels: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const label of labels) {
    const trimmed = label.trim().replace(/\s+/g, " ").slice(0, 80);
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.values()];
}

/**
 * The public half of a profile, cleaned and sorted: everything a shared
 * gathering may depend on. Its key and its searches are functions of this
 * value alone.
 */
export type PublicInterests = {
  readonly sectors: readonly string[];
  readonly stages: readonly string[];
  readonly markets: readonly string[];
};

function sorted(labels: readonly string[], limit: number): string[] {
  return clean(labels)
    .slice(0, limit)
    .sort((a, b) => a.localeCompare(b));
}

export function publicInterests(
  profile: Pick<InterestProfile, "sectors" | "stages" | "markets">,
): PublicInterests {
  return {
    sectors: sorted(profile.sectors, 4),
    stages: sorted(profile.stages, 2),
    markets: sorted(profile.markets, 2),
  };
}

/** The topic labels an edition follows, as printed in its masthead. */
export function topicsOf(interests: PublicInterests): readonly string[] {
  const topics = [
    ...interests.sectors,
    ...interests.stages,
    ...interests.markets,
  ];
  return (topics.length === 0 ? [...GENERAL_TOPICS] : topics).slice(
    0,
    MAX_TOPICS,
  );
}

/**
 * The key of a shared gathering: a hash of the public interests and the
 * news window, nothing else. A test asserts no personal fact changes it.
 */
export function clusterKeyOf(
  interests: PublicInterests,
  windowDays: number,
): string {
  const lower = (labels: readonly string[]): string[] =>
    labels.map((label) => label.toLowerCase());
  return createHash("sha256")
    .update(
      JSON.stringify([
        "q-daily/v1",
        windowDays,
        lower(interests.sectors),
        lower(interests.stages),
        lower(interests.markets),
      ]),
    )
    .digest("hex");
}

/**
 * The news searches for a shared gathering, from the public interests
 * only. Deterministic: the same interests ask the same questions.
 */
export function clusterQueries(
  interests: PublicInterests,
  limit: number,
): readonly string[] {
  const market = interests.markets[0] ?? "";
  const queries: string[] = [];
  for (const sector of interests.sectors.slice(0, 3)) {
    queries.push(`${sector} startup funding ${market}`.trim());
  }
  if (market.length > 0) {
    queries.push(`${market} venture capital deals`);
  }
  const stage = interests.stages[0];
  const sector = interests.sectors[0];
  if (stage !== undefined && sector !== undefined) {
    queries.push(`${sector} ${stage} round`);
  }
  if (queries.length === 0) {
    queries.push("startup funding rounds", "venture capital news");
  }
  return clean(queries).slice(0, limit);
}
