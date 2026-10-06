import type { ExploreMode } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { exploreSlatePage, type ExploreSlatePage } from "./page.js";
import {
  NO_SIGNALS,
  relatedPitches,
  type ExplorePoolItem,
  type ExploreSignals,
  type RelatedPitch,
} from "./policy.js";

/**
 * Explore's read service (E1-E5, ADR 0055): one place that decides which
 * pitches a viewer may see, shared by the HTTP API and Q's tools so the two
 * can never disagree.
 *
 * Authorization resolves before anything is ranked or matched: a pitch
 * enters the pool only when (a) its owner opened it to the network (the
 * network-pitch query), (b) it is not the viewer's own organisation's, and
 * (c) the company's disclosure lets THIS viewer see it now (network-visible
 * or wider, and active). Sectors are read through the same disclosure.
 * A failed check excludes; nothing fails open.
 */

export type ExploreNetworkRow = {
  readonly mediaAssetId: string;
  readonly companyId: string;
  readonly createdAt: string;
};

export type ExploreCompanyFacts = {
  readonly canonicalName: string;
  readonly shortDescription: string | null;
  readonly headquartersCountry: string | null;
  readonly currentStageCode: string | null;
  readonly companyStatus: string;
};

export type ExplorePorts<R extends ExploreNetworkRow> = {
  /** Network pitches newest first (keyset), excluding the viewer's own organisation's. */
  readonly findNetworkPitches: (input: {
    readonly excludeOwnerOrganisationId: string | null;
    readonly before: {
      readonly createdAt: string;
      readonly mediaAssetId: string;
    } | null;
    readonly limit: number;
  }) => Promise<readonly R[]>;
  /** The company as disclosure lets this viewer see it on the network; null when not. */
  readonly company: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<ExploreCompanyFacts | null>;
  /** Declared sectors, through disclosure. Absent or failing: no sectors (unknown, not none). */
  readonly sectors?:
    | ((
        actor: ActorContext,
        companyIds: readonly string[],
      ) => Promise<ReadonlyMap<string, readonly string[]>>)
    | undefined;
  /** The viewer's explicit signals. Absent or failing: unpersonalised. */
  readonly signals?:
    | ((actor: ActorContext) => Promise<Omit<ExploreSignals, "mode">>)
    | undefined;
  readonly clock?: (() => number) | undefined;
};

export type ExplorePitch<R extends ExploreNetworkRow> = ExplorePoolItem & {
  readonly row: R;
  readonly company: ExploreCompanyFacts;
};

/** How many network pitches one read considers at most. */
export const EXPLORE_POOL_MAX = 240;
const POOL_BATCH = 60;
const SEARCH_TEXT_MAX = 80;

export type ExploreService<R extends ExploreNetworkRow> = {
  readonly pool: (actor: ActorContext) => Promise<readonly ExplorePitch<R>[]>;
  readonly page: (
    actor: ActorContext,
    query: {
      readonly mode: ExploreMode;
      readonly cursor: string | null;
      readonly limit?: number | undefined;
    },
  ) => Promise<ExploreSlatePage<ExplorePitch<R>>>;
  /** The opened pitch and pitches like it; null when the viewer may not see it. */
  readonly related: (
    actor: ActorContext,
    query: {
      readonly mediaAssetId: string;
      readonly limit?: number | undefined;
    },
  ) => Promise<{
    readonly anchor: ExplorePitch<R>;
    readonly items: readonly RelatedPitch<ExplorePitch<R>>[];
  } | null>;
  /** Pitches whose company name or line matches, among what the viewer may see. */
  readonly search: (
    actor: ActorContext,
    query: {
      readonly text: string;
      /** Declared industry nodes the person picked; any one matches. */
      readonly sectorNodeIds?: readonly string[] | undefined;
    },
  ) => Promise<readonly ExplorePitch<R>[]>;
};

export function normaliseExploreText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, SEARCH_TEXT_MAX);
}

/** Every word must appear in what the network already shows of the company. */
export function matchesExploreText(
  facts: Pick<ExploreCompanyFacts, "canonicalName" | "shortDescription">,
  text: string,
  extra: readonly string[] = [],
): boolean {
  const words = normaliseExploreText(text).split(" ").filter(Boolean);
  if (words.length === 0) return false;
  const haystack = [facts.canonicalName, facts.shortDescription ?? "", ...extra]
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

/**
 * The declared facts a search may match besides the name and line: the
 * stage ("pre seed", "series a") and the country (code and English name).
 * Only what the network view already shows; nothing hidden is searchable.
 */
export function declaredWords(
  facts: Pick<ExploreCompanyFacts, "currentStageCode" | "headquartersCountry">,
): string[] {
  const words: string[] = [];
  if (facts.currentStageCode !== null) {
    words.push(facts.currentStageCode.replace(/_/g, " "));
    words.push(facts.currentStageCode.replace(/_/g, "-"));
  }
  if (facts.headquartersCountry !== null) {
    const code = facts.headquartersCountry.toUpperCase();
    words.push(code);
    try {
      const name = regionNames?.of(code);
      if (name !== undefined) words.push(name);
    } catch {
      // An unknown code is just its code.
    }
  }
  return words;
}

export function createExploreService<R extends ExploreNetworkRow>(
  ports: ExplorePorts<R>,
): ExploreService<R> {
  const clock = ports.clock ?? (() => Date.now());

  const pool = async (actor: ActorContext) => {
    const rows: R[] = [];
    let before: { createdAt: string; mediaAssetId: string } | null = null;
    while (rows.length < EXPLORE_POOL_MAX) {
      const batch = await ports.findNetworkPitches({
        excludeOwnerOrganisationId: actor.organisationId ?? null,
        before,
        limit: POOL_BATCH,
      });
      rows.push(...batch);
      const last = batch.at(-1);
      if (batch.length < POOL_BATCH || last === undefined) break;
      before = { createdAt: last.createdAt, mediaAssetId: last.mediaAssetId };
    }
    const companies = new Map<string, ExploreCompanyFacts | null>();
    for (const companyId of new Set(rows.map((row) => row.companyId))) {
      companies.set(
        companyId,
        await ports.company(actor, companyId).catch(() => null),
      );
    }
    const visible = [...companies.entries()]
      .filter(([, facts]) => facts !== null && facts.companyStatus === "active")
      .map(([companyId]) => companyId);
    const sectors =
      ports.sectors === undefined || visible.length === 0
        ? new Map<string, readonly string[]>()
        : await ports
            .sectors(actor, visible)
            .catch(() => new Map<string, readonly string[]>());
    const out: ExplorePitch<R>[] = [];
    for (const row of rows.slice(0, EXPLORE_POOL_MAX)) {
      const company = companies.get(row.companyId) ?? null;
      if (company === null || company.companyStatus !== "active") continue;
      out.push({
        mediaAssetId: row.mediaAssetId,
        companyId: row.companyId,
        stageCode: company.currentStageCode,
        country: company.headquartersCountry,
        sectorNodeIds: sectors.get(row.companyId) ?? [],
        postedAt: row.createdAt,
        row,
        company,
      });
    }
    return out;
  };

  const signalsFor = async (actor: ActorContext, mode: ExploreMode) => {
    if (mode === "EVERYTHING" || ports.signals === undefined) {
      return { ...NO_SIGNALS, mode };
    }
    const known = await ports.signals(actor).catch(() => null);
    return known === null ? { ...NO_SIGNALS, mode } : { ...known, mode };
  };

  return {
    pool,
    page: async (actor, query) => {
      const [items, signals] = await Promise.all([
        pool(actor),
        signalsFor(actor, query.mode),
      ]);
      return exploreSlatePage({
        pool: items,
        signals,
        now: clock(),
        cursor: query.cursor,
        limit: query.limit,
      });
    },
    related: async (actor, query) => {
      const items = await pool(actor);
      const anchor = items.find(
        (item) => item.mediaAssetId === query.mediaAssetId,
      );
      if (anchor === undefined) return null;
      return { anchor, items: relatedPitches(anchor, items, query.limit) };
    },
    search: async (actor, query) => {
      const text = normaliseExploreText(query.text);
      const sectors = new Set(query.sectorNodeIds ?? []);
      if (text.length === 0 && sectors.size === 0) return [];
      const items = await pool(actor);
      return items.filter(
        (item) =>
          (sectors.size === 0 ||
            item.sectorNodeIds.some((id) => sectors.has(id))) &&
          (text.length === 0 ||
            matchesExploreText(
              item.company,
              text,
              declaredWords(item.company),
            )),
      );
    },
  };
}
