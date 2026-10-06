import type {
  ExploreMode,
  ExploreReasonCode,
  ExploreRelatedReason,
  ExploreSource,
} from "@capital-q/contracts";

import { STAGE_LADDER } from "../domain/fit.js";

/**
 * Explore's slate (E1, ADR 0055): Instagram's structure, not its objective.
 *
 *   eligible pool  -> candidate sources -> one deterministic score
 *                  -> diversity pass   -> cursor pages -> "You're up to date"
 *
 * The pool is decided before anything here runs: only pitches whose
 * company disclosure lets this viewer see (network-visible or wider),
 * never the viewer's own organisation's. This module never widens it.
 *
 * No model, no engagement term, no popularity, no pay-to-rank. Weights
 * live in one versioned config. Saves and expressed interest are explicit
 * actions and may pull similar pitches forward; views never do.
 */

export const EXPLORE_RANKING_VERSION = "explore.v1" as const;

export type ExploreConfig = {
  readonly version: string;
  /** Base weight of each source. Light personalisation: mandate leads, never monopolises. */
  readonly sourceWeight: Readonly<Record<ExploreSource, number>>;
  /** A pitch is "new" for this many days. */
  readonly freshDays: number;
  /** Up to this much is added for freshness, decaying linearly over `freshDays * 2`. */
  readonly freshnessBonus: number;
  /** No company twice within this many consecutive tiles. */
  readonly companyWindow: number;
  /** In any run of `sectorWindow` tiles, at most `sectorMax` share a primary sector. */
  readonly sectorWindow: number;
  readonly sectorMax: number;
  /** Every Nth slot goes to exploration when one is left (fairness for new founders). */
  readonly explorationEvery: number;
  /** A company's pitches beyond this many go to the end of the slate. */
  readonly maxPerCompany: number;
  /**
   * For you is finite: exploration older than this waits under Everything,
   * so the slate ends ("You're up to date") instead of scrolling forever.
   */
  readonly explorationDays: number;
};

export const EXPLORE_CONFIG_V1: ExploreConfig = {
  version: EXPLORE_RANKING_VERSION,
  sourceWeight: {
    MANDATE: 0.6,
    SAVED: 0.45,
    ADJACENT: 0.35,
    NEWEST: 0.25,
    EXPLORATION: 0.15,
  },
  freshDays: 7,
  freshnessBonus: 0.1,
  companyWindow: 4,
  sectorWindow: 6,
  sectorMax: 2,
  explorationEvery: 6,
  maxPerCompany: 2,
  explorationDays: 30,
};

/** One eligible pitch, as disclosure already lets this viewer see it. */
export type ExplorePoolItem = {
  readonly mediaAssetId: string;
  readonly companyId: string;
  readonly stageCode: string | null;
  readonly country: string | null;
  /** Declared industry nodes; the first is the primary one. */
  readonly sectorNodeIds: readonly string[];
  readonly postedAt: string;
};

/** What the viewer explicitly declared or did. Never what they watched. */
export type ExploreSignals = {
  readonly mode: ExploreMode;
  /** Companies in the viewer's Discover slate (declared mandate fit). */
  readonly mandateCompanyIds: ReadonlySet<string>;
  /** Slate companies retrieved one stage rung away (STAGE_ADJACENT). */
  readonly adjacentCompanyIds: ReadonlySet<string>;
  /** Saved or expressed interest: explicit actions only. */
  readonly savedCompanyIds: ReadonlySet<string>;
  /** A founder's own company sectors, for peers. Empty for an investor. */
  readonly ownSectorNodeIds: ReadonlySet<string>;
};

export const NO_SIGNALS: ExploreSignals = {
  mode: "FOR_YOU",
  mandateCompanyIds: new Set(),
  adjacentCompanyIds: new Set(),
  savedCompanyIds: new Set(),
  ownSectorNodeIds: new Set(),
};

export type ExploreCandidate<T extends ExplorePoolItem = ExplorePoolItem> = {
  readonly item: T;
  readonly source: ExploreSource;
  readonly reason: ExploreReasonCode;
  readonly score: number;
};

const DAY_MS = 86_400_000;

function ageDays(postedAt: string, now: number): number {
  return Math.max(0, (now - Date.parse(postedAt)) / DAY_MS);
}

function intersects(
  values: readonly string[],
  set: ReadonlySet<string>,
): boolean {
  return values.some((value) => set.has(value));
}

/** Newest first, then id: the only tie-break, so equal inputs give equal slates. */
function byFreshness(a: ExplorePoolItem, b: ExplorePoolItem): number {
  const time = Date.parse(b.postedAt) - Date.parse(a.postedAt);
  if (time !== 0) return time;
  return a.mediaAssetId < b.mediaAssetId
    ? -1
    : a.mediaAssetId > b.mediaAssetId
      ? 1
      : 0;
}

/**
 * Candidate generation: each pitch gets the strongest source that claims
 * it, and that source's reason. Sources, strongest first:
 *
 *   MANDATE      in the Discover slate (declared fit)
 *   SAVED        shares a sector with a saved or interested company
 *   ADJACENT     stage-adjacent slate company, or a mandate sector elsewhere
 *   NEWEST       posted within `freshDays`
 *   EXPLORATION  the rest of the network, labelled as outside their focus
 *
 * EVERYTHING turns personalisation off: newest first, reasons are only
 * "new this week" or "on the network".
 */
export function exploreCandidates<T extends ExplorePoolItem>(
  pool: readonly T[],
  signals: ExploreSignals,
  now: number,
  config: ExploreConfig = EXPLORE_CONFIG_V1,
): ExploreCandidate<T>[] {
  const bySector = new Map<string, readonly string[]>();
  for (const item of pool) bySector.set(item.companyId, item.sectorNodeIds);
  const savedSectors = new Set<string>();
  const mandateSectors = new Set<string>();
  for (const [companyId, sectors] of bySector) {
    if (signals.savedCompanyIds.has(companyId)) {
      for (const sector of sectors) savedSectors.add(sector);
    }
    if (signals.mandateCompanyIds.has(companyId)) {
      for (const sector of sectors) mandateSectors.add(sector);
    }
  }
  const personal =
    signals.mode === "FOR_YOU" &&
    (signals.mandateCompanyIds.size > 0 ||
      signals.savedCompanyIds.size > 0 ||
      signals.ownSectorNodeIds.size > 0);

  return pool.map((item) => {
    const age = ageDays(item.postedAt, now);
    const fresh = age <= config.freshDays;
    const freshness =
      config.freshnessBonus * Math.max(0, 1 - age / (config.freshDays * 2));
    let source: ExploreSource;
    let reason: ExploreReasonCode;
    if (!personal) {
      source = fresh ? "NEWEST" : "EXPLORATION";
      reason = fresh ? "NEW_THIS_WEEK" : "ON_THE_NETWORK";
    } else if (
      signals.mandateCompanyIds.has(item.companyId) ||
      signals.adjacentCompanyIds.has(item.companyId)
    ) {
      source = signals.adjacentCompanyIds.has(item.companyId)
        ? "ADJACENT"
        : "MANDATE";
      reason = source === "ADJACENT" ? "CLOSE_TO_MANDATE" : "MATCHES_MANDATE";
    } else if (
      signals.savedCompanyIds.has(item.companyId) ||
      intersects(item.sectorNodeIds, savedSectors)
    ) {
      source = "SAVED";
      reason = "LIKE_YOUR_SAVES";
    } else if (intersects(item.sectorNodeIds, signals.ownSectorNodeIds)) {
      source = "SAVED";
      reason = "NEAR_YOUR_COMPANY";
    } else if (intersects(item.sectorNodeIds, mandateSectors)) {
      source = "ADJACENT";
      reason = "CLOSE_TO_MANDATE";
    } else if (fresh) {
      source = "NEWEST";
      reason = "NEW_THIS_WEEK";
    } else {
      source = "EXPLORATION";
      reason =
        signals.mandateCompanyIds.size > 0
          ? "OUTSIDE_USUAL_FOCUS"
          : "ON_THE_NETWORK";
    }
    const score =
      signals.mode === "EVERYTHING"
        ? freshness
        : config.sourceWeight[source] + freshness;
    return { item, source, reason, score };
  });
}

function compareCandidates(a: ExploreCandidate, b: ExploreCandidate): number {
  if (a.score !== b.score) return b.score - a.score;
  return byFreshness(a.item, b.item);
}

/**
 * The diversity pass (TikTok's "no two in a row from the same creator",
 * adapted): greedy, in score order, taking the best candidate that keeps
 *   - no company twice within `companyWindow` tiles,
 *   - at most `sectorMax` of one primary sector in any `sectorWindow`,
 *   - an exploration tile every `explorationEvery` slots, when one is left.
 * When nothing satisfies a rule, the rule relaxes for that slot rather
 * than dropping a pitch: Explore holds every eligible pitch. A company's
 * pitches beyond `maxPerCompany` wait until everyone else has been shown.
 */
export function diversify<T extends ExplorePoolItem>(
  candidates: readonly ExploreCandidate<T>[],
  config: ExploreConfig = EXPLORE_CONFIG_V1,
): ExploreCandidate<T>[] {
  const sorted = [...candidates].sort(compareCandidates);
  const perCompany = new Map<string, number>();
  const main: ExploreCandidate<T>[] = [];
  const overflow: ExploreCandidate<T>[] = [];
  for (const candidate of sorted) {
    const seen = perCompany.get(candidate.item.companyId) ?? 0;
    perCompany.set(candidate.item.companyId, seen + 1);
    (seen < config.maxPerCompany ? main : overflow).push(candidate);
  }

  const out: ExploreCandidate<T>[] = [];
  const place = (remaining: ExploreCandidate<T>[]) => {
    while (remaining.length > 0) {
      const slot = out.length;
      const recentCompanies = new Set(
        out.slice(-config.companyWindow + 1).map((c) => c.item.companyId),
      );
      const sectorCounts = new Map<string, number>();
      for (const c of out.slice(-(config.sectorWindow - 1))) {
        const sector = c.item.sectorNodeIds[0];
        if (sector !== undefined) {
          sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1);
        }
      }
      const companyOk = (c: ExploreCandidate<T>) =>
        config.companyWindow <= 1 || !recentCompanies.has(c.item.companyId);
      const sectorOk = (c: ExploreCandidate<T>) => {
        const sector = c.item.sectorNodeIds[0];
        return (
          sector === undefined ||
          (sectorCounts.get(sector) ?? 0) < config.sectorMax
        );
      };
      const explorationSlot =
        config.explorationEvery > 0 &&
        (slot + 1) % config.explorationEvery === 0;
      const tiers: ((c: ExploreCandidate<T>) => boolean)[] = [
        ...(explorationSlot
          ? [
              (c: ExploreCandidate<T>) =>
                c.source === "EXPLORATION" && companyOk(c) && sectorOk(c),
            ]
          : []),
        (c) => companyOk(c) && sectorOk(c),
        companyOk,
        () => true,
      ];
      let index = -1;
      for (const accept of tiers) {
        index = remaining.findIndex(accept);
        if (index >= 0) break;
      }
      const [picked] = remaining.splice(index, 1);
      if (picked !== undefined) out.push(picked);
    }
  };
  place(main);
  place(overflow);
  return out;
}

/** The whole slate for a viewer, deterministic for a given pool, signals and clock. */
export function exploreSlate<T extends ExplorePoolItem>(
  pool: readonly T[],
  signals: ExploreSignals,
  now: number,
  config: ExploreConfig = EXPLORE_CONFIG_V1,
): ExploreCandidate<T>[] {
  const candidates = exploreCandidates(pool, signals, now, config).filter(
    (c) =>
      signals.mode === "EVERYTHING" ||
      c.source !== "EXPLORATION" ||
      ageDays(c.item.postedAt, now) <= config.explorationDays,
  );
  return diversify(candidates, config);
}

// ---------------------------------------------------------------------------
// Related ("Related to X", E3)
// ---------------------------------------------------------------------------

export type RelatedPitch<T extends ExplorePoolItem = ExplorePoolItem> = {
  readonly item: T;
  readonly related: readonly ExploreRelatedReason[];
};

export const RELATED_MAX = 12;

function stageDistance(a: string | null, b: string | null): number | null {
  if (a === null || b === null) return null;
  const ladder = STAGE_LADDER as readonly string[];
  const i = ladder.indexOf(a);
  const j = ladder.indexOf(b);
  if (i < 0 || j < 0) return a === b ? 0 : null;
  return Math.abs(i - j);
}

/**
 * Pitches like the anchor: the same founder's other pitches, then shared
 * sector, stage and geography. Each says which of those it shares; a pitch
 * sharing nothing is not related and is left out. No company twice in a
 * row. Unknown stage or country never counts as a match.
 */
export function relatedPitches<T extends ExplorePoolItem>(
  anchor: ExplorePoolItem,
  pool: readonly T[],
  limit = RELATED_MAX,
): RelatedPitch<T>[] {
  const scored: { item: T; related: ExploreRelatedReason[]; score: number }[] =
    [];
  for (const item of pool) {
    if (item.mediaAssetId === anchor.mediaAssetId) continue;
    const related: ExploreRelatedReason[] = [];
    let score = 0;
    if (item.companyId === anchor.companyId) {
      related.push("SAME_COMPANY");
      score += 4;
    }
    const shared = item.sectorNodeIds.filter((id) =>
      anchor.sectorNodeIds.includes(id),
    ).length;
    if (shared > 0) {
      related.push("SAME_SECTOR");
      score += 2 + Math.min(shared, 3) * 0.5;
    }
    const distance = stageDistance(anchor.stageCode, item.stageCode);
    if (distance === 0) {
      related.push("SAME_STAGE");
      score += 2;
    } else if (distance === 1) {
      score += 0.5;
    }
    if (
      anchor.country !== null &&
      item.country !== null &&
      anchor.country === item.country
    ) {
      related.push("SAME_GEOGRAPHY");
      score += 1;
    }
    if (related.length > 0) scored.push({ item, related, score });
  }
  scored.sort((a, b) =>
    a.score !== b.score ? b.score - a.score : byFreshness(a.item, b.item),
  );
  const out: RelatedPitch<T>[] = [];
  let previous = anchor.companyId;
  const rest = [...scored];
  while (rest.length > 0 && out.length < limit) {
    let index = rest.findIndex((c) => c.item.companyId !== previous);
    if (index < 0) index = 0;
    const [picked] = rest.splice(index, 1);
    if (picked === undefined) break;
    out.push({ item: picked.item, related: picked.related });
    previous = picked.item.companyId;
  }
  return out;
}
