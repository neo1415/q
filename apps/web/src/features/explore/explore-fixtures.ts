import type {
  ExplorePageDto,
  ExploreReasonCode,
  ExploreRelatedDto,
  ExploreRelatedReason,
  ExploreTileDto,
} from "@capital-q/contracts";

import type { ExploreSearchView, SectorWord } from "./explore-search-view";

/**
 * Explore's design-review fixtures (dev route only). Every company is
 * fictional; posters are drawn here, not photographs of anyone. Nothing
 * here is read in production.
 */

const sector = (n: number) =>
  `5ec70000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const FIXTURE_SECTORS: readonly SectorWord[] = [
  { nodeId: sector(1), label: "Health" },
  { nodeId: sector(2), label: "Energy" },
  { nodeId: sector(3), label: "Logistics" },
  { nodeId: sector(4), label: "Payments" },
  { nodeId: sector(5), label: "Agri finance" },
  { nodeId: sector(6), label: "HR software" },
  { nodeId: sector(7), label: "Commerce" },
  { nodeId: sector(8), label: "Fintech" },
  { nodeId: sector(9), label: "B2B software" },
];
const S = Object.fromEntries(FIXTURE_SECTORS.map((s) => [s.label, s.nodeId]));

/** Muted pairs: earth, sea and stone; never a purple-blue "AI" gradient. */
const PALETTES = [
  ["#7a4b3a", "#2b1f1b"],
  ["#3f6b7a", "#16262d"],
  ["#8a7a4a", "#2c2717"],
  ["#4d6b4f", "#1a261b"],
  ["#6b5a7a", "#221d29"],
  ["#7a6250", "#2a221c"],
  ["#4f5f73", "#1a1f27"],
  ["#8a5e4a", "#2d1e18"],
] as const;

function poster(name: string, n: number, landscape: boolean): string {
  const [a, b] = PALETTES[n % PALETTES.length] ?? PALETTES[0];
  const w = landscape ? 320 : 180;
  const h = landscape ? 180 : 320;
  const initial = name.slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(w)} ${String(h)}"><defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${String(w)}" height="${String(h)}" fill="url(#g)"/><circle cx="${String(w * 0.72)}" cy="${String(h * 0.3)}" r="${String(Math.min(w, h) * 0.32)}" fill="#ffffff" fill-opacity="0.08"/><text x="${String(w * 0.12)}" y="${String(h * 0.42)}" font-family="system-ui, sans-serif" font-size="${String(Math.min(w, h) * 0.42)}" font-weight="600" fill="#ffffff" fill-opacity="0.22">${initial}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

type Seed = {
  readonly name: string;
  readonly hook: string;
  readonly stage: string;
  readonly sector: string;
  readonly country: string;
  readonly ar: string;
  readonly seconds: number;
  readonly reason: ExploreReasonCode;
  readonly days: number;
  readonly company?: number;
};

const SEEDS: readonly Seed[] = [
  {
    name: "Kora Health",
    hook: "Clinics paid in weeks, not months",
    stage: "seed",
    sector: "Health",
    country: "NG",
    ar: "9:16",
    seconds: 58,
    reason: "MATCHES_MANDATE",
    days: 3,
  },
  {
    name: "Sunline Energy",
    hook: "Solar for 12,000 small shops",
    stage: "seed",
    sector: "Energy",
    country: "KE",
    ar: "9:16",
    seconds: 62,
    reason: "MATCHES_MANDATE",
    days: 9,
  },
  {
    name: "Freightly",
    hook: "Trucks for exporters",
    stage: "series_a",
    sector: "Logistics",
    country: "EG",
    ar: "4:5",
    seconds: 90,
    reason: "OUTSIDE_USUAL_FOCUS",
    days: 20,
  },
  {
    name: "Harvest Ledger",
    hook: "Loans repaid at harvest",
    stage: "pre_seed",
    sector: "Agri finance",
    country: "GH",
    ar: "9:16",
    seconds: 47,
    reason: "CLOSE_TO_MANDATE",
    days: 12,
  },
  {
    name: "Tally Pay",
    hook: "Card payments for corner shops",
    stage: "seed",
    sector: "Payments",
    country: "AE",
    ar: "4:5",
    seconds: 72,
    reason: "MATCHES_MANDATE",
    days: 6,
  },
  {
    name: "Atlas Grid",
    hook: "Running city power from one screen",
    stage: "seed",
    sector: "Energy",
    country: "ZA",
    ar: "16:9",
    seconds: 160,
    reason: "NEW_THIS_WEEK",
    days: 2,
  },
  {
    name: "Mosaic",
    hook: "Payroll for remote African teams",
    stage: "pre_seed",
    sector: "HR software",
    country: "RW",
    ar: "9:16",
    seconds: 59,
    reason: "MATCHES_MANDATE",
    days: 14,
  },
  {
    name: "Kopa Credit",
    hook: "Why I left banking to fix credit",
    stage: "seed",
    sector: "Fintech",
    country: "KE",
    ar: "9:16",
    seconds: 75,
    reason: "NEW_THIS_WEEK",
    days: 1,
  },
  {
    name: "Bazaar Box",
    hook: "Wholesale delivered overnight",
    stage: "seed",
    sector: "Commerce",
    country: "NG",
    ar: "1:1",
    seconds: 68,
    reason: "MATCHES_MANDATE",
    days: 8,
  },
  {
    name: "Tally Pay",
    hook: "Demo: paid in 2 seconds",
    stage: "seed",
    sector: "Payments",
    country: "AE",
    ar: "1:1",
    seconds: 40,
    reason: "MATCHES_MANDATE",
    days: 4,
    company: 4,
  },
  {
    name: "Tro Logistics",
    hook: "Building in public, week 12",
    stage: "pre_seed",
    sector: "Logistics",
    country: "GH",
    ar: "9:16",
    seconds: 52,
    reason: "LIKE_YOUR_SAVES",
    days: 10,
  },
  {
    name: "Lumen Labs",
    hook: "Lab tests at the pharmacy",
    stage: "seed",
    sector: "Health",
    country: "KE",
    ar: "9:16",
    seconds: 80,
    reason: "MATCHES_MANDATE",
    days: 11,
  },
  {
    name: "Okra Finance",
    hook: "Savings that beat inflation",
    stage: "pre_seed",
    sector: "Fintech",
    country: "NG",
    ar: "9:16",
    seconds: 55,
    reason: "MATCHES_MANDATE",
    days: 13,
  },
  {
    name: "Crane",
    hook: "Our first 100 customers",
    stage: "seed",
    sector: "B2B software",
    country: "EG",
    ar: "16:9",
    seconds: 190,
    reason: "OUTSIDE_USUAL_FOCUS",
    days: 25,
  },
  {
    name: "Fleetwise",
    hook: "From mechanic to fleet software",
    stage: "pre_seed",
    sector: "Logistics",
    country: "NG",
    ar: "4:5",
    seconds: 61,
    reason: "NEW_THIS_WEEK",
    days: 2,
  },
  {
    name: "Sahel Grain",
    hook: "Storage that keeps a harvest",
    stage: "seed",
    sector: "Agri finance",
    country: "SN",
    ar: "9:16",
    seconds: 66,
    reason: "CLOSE_TO_MANDATE",
    days: 16,
  },
];

const id = (prefix: string, n: number) =>
  `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const NOW = Date.parse("2026-10-06T09:00:00.000Z");

export const FIXTURE_TILES: readonly ExploreTileDto[] = SEEDS.map(
  (seed, n) => ({
    companyId: id("c0ffee00", seed.company ?? n),
    canonicalName: seed.name,
    shortDescription: seed.hook,
    headquartersCountry: seed.country,
    currentStageCode: seed.stage,
    sectorNodeIds: [S[seed.sector] ?? sector(1)],
    pitch: {
      mediaAssetId: id("f1a70000", n),
      aspectRatio: seed.ar,
      durationSeconds: seed.seconds,
      captionState: "NOT_REQUESTED",
      title: seed.hook,
    },
    postedAt: new Date(NOW - seed.days * 86_400_000).toISOString(),
    source:
      seed.reason === "MATCHES_MANDATE"
        ? "MANDATE"
        : seed.reason === "OUTSIDE_USUAL_FOCUS"
          ? "EXPLORATION"
          : seed.reason === "NEW_THIS_WEEK"
            ? "NEWEST"
            : seed.reason === "LIKE_YOUR_SAVES"
              ? "SAVED"
              : "ADJACENT",
    reason: seed.reason,
  }),
);

export const FIXTURE_POSTERS: Readonly<Record<string, string>> =
  Object.fromEntries(
    FIXTURE_TILES.map((tile, n) => [
      tile.pitch.mediaAssetId,
      poster(tile.canonicalName, n, tile.pitch.aspectRatio === "16:9"),
    ]),
  );

export function fixturePage(state: string): ExplorePageDto {
  const items =
    state === "empty"
      ? []
      : state === "limited"
        ? FIXTURE_TILES.filter((_, n) => n % 3 !== 1)
        : FIXTURE_TILES;
  return {
    rankingVersion: "explore.v1",
    mode: "FOR_YOU",
    items: [...items],
    nextCursor: null,
    upToDate: true,
  };
}

/** Related by sector, stage, country or the same company; fixture-only. */
export function fixtureRelated(mediaAssetId: string): ExploreRelatedDto | null {
  const anchor = FIXTURE_TILES.find(
    (t) => t.pitch.mediaAssetId === mediaAssetId,
  );
  if (anchor === undefined) return null;
  const items = FIXTURE_TILES.filter((t) => t !== anchor)
    .map((t) => {
      const related: ExploreRelatedReason[] = [];
      if (t.companyId === anchor.companyId) related.push("SAME_COMPANY");
      if (t.sectorNodeIds[0] === anchor.sectorNodeIds[0])
        related.push("SAME_SECTOR");
      if (t.currentStageCode === anchor.currentStageCode)
        related.push("SAME_STAGE");
      if (t.headquartersCountry === anchor.headquartersCountry)
        related.push("SAME_GEOGRAPHY");
      return { ...t, related };
    })
    .filter((t) => t.related.length > 0)
    .sort((a, b) => b.related.length - a.related.length)
    .slice(0, 12);
  return { anchor, items };
}

export function fixtureSearch(
  state: string,
  tab: ExploreSearchView["tab"],
): ExploreSearchView {
  const query =
    state === "empty" ? "seed drone delivery mali" : "seed payments nigeria";
  if (state === "empty") {
    return {
      query,
      tab,
      chips: [{ label: "Seed", kind: "stage", without: "drone delivery mali" }],
      companies: [],
      investors: [],
      people: [],
      pitches: [],
      related: [],
    };
  }
  const pick = (name: string) =>
    FIXTURE_TILES.find((t) => t.canonicalName === name);
  const company = (name: string, meta: string) => {
    const tile = pick(name);
    return {
      kind: "company" as const,
      id: tile?.companyId ?? id("c0ffee00", 99),
      name,
      line: tile?.shortDescription ?? null,
      meta,
      href: `/company/${tile?.companyId ?? ""}`,
    };
  };
  const investor = (n: number, name: string, meta: string) => ({
    kind: "investor" as const,
    id: id("1a7e5700", n),
    name,
    line: null,
    meta,
    href: `/investors/${id("1a7e5700", n)}`,
  });
  return {
    query,
    tab,
    chips: [
      { label: "Seed", kind: "stage", without: "payments nigeria" },
      { label: "Payments", kind: "sector", without: "seed nigeria" },
      { label: "Nigeria", kind: "country", without: "seed payments" },
    ],
    companies: [
      company("Tally Pay", "Seed · United Arab Emirates"),
      company("Okra Finance", "Pre-seed · Nigeria"),
      company("Bazaar Box", "Seed · Nigeria"),
    ],
    investors: [
      investor(1, "Sahel Ventures", "In your Discover"),
      investor(2, "Lagoon Angels", "Your relationship"),
    ],
    people: [investor(2, "Lagoon Angels", "Your relationship")],
    pitches: [
      "Tally Pay",
      "Okra Finance",
      "Bazaar Box",
      "Kora Health",
      "Kopa Credit",
      "Fleetwise",
    ]
      .map(pick)
      .filter((t): t is ExploreTileDto => t !== undefined),
    related: ["Credit for small shops", "Payments in Ghana", "Remittances"],
  };
}
