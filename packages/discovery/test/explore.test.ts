import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import {
  EXPLORE_CONFIG_V1,
  ExploreCursorRejectedError,
  createExploreService,
  decodeExploreCursor,
  diversifyExplore,
  exploreCandidates,
  exploreSlate,
  exploreSlatePage,
  relatedPitches,
  type ExploreCompanyFacts,
  type ExplorePoolItem,
  type ExploreSignals,
} from "../src/index.js";

/**
 * Explore (E1-E5, ADR 0055): candidate sources, the diversity pass, the
 * cursor, related pitches, and the permission boundary of the pool.
 */

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const HEALTH = id(9001);
const ENERGY = id(9002);
const PAY = id(9003);
const AGRI = id(9004);

function pitch(
  n: number,
  over: Partial<ExplorePoolItem> & { company?: number } = {},
): ExplorePoolItem {
  return {
    mediaAssetId: id(1000 + n),
    companyId: id(over.company ?? n),
    stageCode: "stageCode" in over ? (over.stageCode ?? null) : "seed",
    country: "country" in over ? (over.country ?? null) : "NG",
    sectorNodeIds: over.sectorNodeIds ?? [HEALTH],
    postedAt: over.postedAt ?? day(20),
  };
}

const signals = (over: Partial<ExploreSignals> = {}): ExploreSignals => ({
  mode: "FOR_YOU",
  mandateCompanyIds: new Set(),
  adjacentCompanyIds: new Set(),
  savedCompanyIds: new Set(),
  ownSectorNodeIds: new Set(),
  ...over,
});

describe("explore candidate sources", () => {
  const pool = [
    pitch(1, { sectorNodeIds: [HEALTH] }),
    pitch(2, { sectorNodeIds: [ENERGY], stageCode: "series_a" }),
    pitch(3, { sectorNodeIds: [PAY] }),
    pitch(4, { sectorNodeIds: [AGRI], postedAt: day(2) }),
    pitch(5, { sectorNodeIds: [AGRI] }),
    pitch(6, { sectorNodeIds: [HEALTH], stageCode: "series_b" }),
  ];

  it("gives each pitch its strongest source and one reason", () => {
    const out = exploreCandidates(
      pool,
      signals({
        mandateCompanyIds: new Set([id(1)]),
        adjacentCompanyIds: new Set([id(2)]),
        savedCompanyIds: new Set([id(3)]),
      }),
      NOW,
    );
    const reason = (n: number) =>
      out.find((c) => c.item.companyId === id(n))?.reason;
    expect(reason(1)).toBe("MATCHES_MANDATE");
    expect(reason(2)).toBe("CLOSE_TO_MANDATE");
    expect(reason(3)).toBe("LIKE_YOUR_SAVES");
    expect(reason(4)).toBe("NEW_THIS_WEEK");
    expect(reason(5)).toBe("OUTSIDE_USUAL_FOCUS");
    // A mandate sector at another stage is adjacent, not a match.
    expect(reason(6)).toBe("CLOSE_TO_MANDATE");
  });

  it("finds a founder's peers by their own company's sector", () => {
    const out = exploreCandidates(
      pool,
      signals({ ownSectorNodeIds: new Set([PAY]) }),
      NOW,
    );
    expect(out.find((c) => c.item.companyId === id(3))?.reason).toBe(
      "NEAR_YOUR_COMPANY",
    );
    expect(out.find((c) => c.item.companyId === id(5))?.reason).toBe(
      "ON_THE_NETWORK",
    );
  });

  it("Everything turns personalisation off: newest first, no mandate reasons", () => {
    const slate = exploreSlate(
      pool,
      signals({ mode: "EVERYTHING", mandateCompanyIds: new Set([id(1)]) }),
      NOW,
    );
    expect(slate[0]?.item.companyId).toBe(id(4));
    expect(
      slate.every((c) =>
        ["NEW_THIS_WEEK", "ON_THE_NETWORK"].includes(c.reason),
      ),
    ).toBe(true);
  });

  it("is deterministic: the same inputs give the same slate", () => {
    const s = signals({ mandateCompanyIds: new Set([id(1), id(6)]) });
    const a = exploreSlate(pool, s, NOW).map((c) => c.item.mediaAssetId);
    const b = exploreSlate([...pool].reverse(), s, NOW).map(
      (c) => c.item.mediaAssetId,
    );
    expect(a).toEqual(b);
  });

  it("puts the mandate first but never only the mandate", () => {
    const many = Array.from({ length: 24 }, (_, n) =>
      pitch(n + 1, {
        sectorNodeIds: [
          n < 12 ? ([HEALTH, ENERGY, PAY][n % 3] ?? HEALTH) : AGRI,
        ],
      }),
    );
    const mandate = new Set(many.slice(0, 12).map((p) => p.companyId));
    const slate = exploreSlate(
      many,
      signals({ mandateCompanyIds: mandate }),
      NOW,
    );
    expect(slate[0]?.source).toBe("MANDATE");
    // Every sixth slot is exploration while exploration is left.
    expect(slate[5]?.source).toBe("EXPLORATION");
    expect(slate).toHaveLength(24);
  });
});

describe("explore diversity pass", () => {
  it("never shows the same company twice within the window", () => {
    const pool = [
      ...[1, 2, 3].map((n) => pitch(n, { company: 1 })),
      ...[4, 5, 6, 7].map((n) => pitch(n, { sectorNodeIds: [ENERGY] })),
    ];
    const slate = diversifyExplore(exploreCandidates(pool, signals(), NOW));
    // The first six are the main pass (two of company 1 and four others);
    // only the capped extra may relax the window, at the very end.
    expect(slate.at(-1)?.item.companyId).toBe(id(1));
    for (let i = 0; i < slate.length - 1; i++) {
      const window = slate
        .slice(Math.max(0, i - EXPLORE_CONFIG_V1.companyWindow + 1), i + 1)
        .map((c) => c.item.companyId)
        .filter((c) => c === id(1));
      expect(window.length).toBeLessThanOrEqual(1);
    }
  });

  it("caps one company's share and keeps every pitch (the extras go last)", () => {
    const pool = [
      ...[1, 2, 3, 4].map((n) => pitch(n, { company: 1, postedAt: day(1) })),
      pitch(5, { sectorNodeIds: [ENERGY] }),
    ];
    const slate = diversifyExplore(exploreCandidates(pool, signals(), NOW));
    expect(slate).toHaveLength(5);
    const firstThree = slate.slice(0, 3).map((c) => c.item.companyId);
    expect(firstThree.filter((c) => c === id(1)).length).toBeLessThanOrEqual(
      EXPLORE_CONFIG_V1.maxPerCompany,
    );
  });

  it("rotates sectors: no more than the cap of one sector in a window", () => {
    const pool = [
      ...Array.from({ length: 6 }, (_, n) =>
        pitch(n + 1, { sectorNodeIds: [HEALTH], postedAt: day(1) }),
      ),
      ...Array.from({ length: 3 }, (_, n) =>
        pitch(n + 11, { sectorNodeIds: [ENERGY], postedAt: day(30) }),
      ),
      ...Array.from({ length: 3 }, (_, n) =>
        pitch(n + 21, { sectorNodeIds: [PAY], postedAt: day(30) }),
      ),
    ];
    const slate = exploreSlate(pool, signals(), NOW);
    const first = slate
      .slice(0, EXPLORE_CONFIG_V1.sectorWindow)
      .filter((c) => c.item.sectorNodeIds[0] === HEALTH);
    expect(first.length).toBeLessThanOrEqual(EXPLORE_CONFIG_V1.sectorMax);
    expect(
      slate.slice(0, 3).some((c) => c.item.sectorNodeIds[0] === ENERGY),
    ).toBe(true);
  });
});

describe("explore is finite", () => {
  it("For you leaves old exploration to Everything; Everything holds every pitch", () => {
    const pool = [
      pitch(1, { postedAt: day(2) }),
      pitch(2, { sectorNodeIds: [ENERGY], postedAt: day(90) }),
    ];
    const forYou = exploreSlate(pool, signals(), NOW);
    const everything = exploreSlate(pool, signals({ mode: "EVERYTHING" }), NOW);
    expect(forYou.map((c) => c.item.companyId)).toEqual([id(1)]);
    expect(everything).toHaveLength(2);
  });
});

describe("explore cursor", () => {
  const pool = Array.from({ length: 7 }, (_, n) =>
    pitch(n + 1, { sectorNodeIds: [[HEALTH, ENERGY, PAY][n % 3] ?? HEALTH] }),
  );

  it("pages through the whole slate once, then says up to date", () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    let upToDate = false;
    do {
      const page = exploreSlatePage({
        pool,
        signals: signals(),
        now: NOW,
        cursor,
        limit: 3,
      });
      seen.push(...page.items.map((c) => c.item.mediaAssetId));
      cursor = page.nextCursor;
      upToDate = page.upToDate;
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(upToDate).toBe(true);
    expect(new Set(seen).size).toBe(7);
  });

  it("a pitch posted after the first page does not shift later pages", () => {
    const first = exploreSlatePage({
      pool,
      signals: signals(),
      now: NOW,
      cursor: null,
      limit: 3,
    });
    const later = [
      pitch(99, { postedAt: new Date(NOW + 60_000).toISOString() }),
      ...pool,
    ];
    const second = exploreSlatePage({
      pool: later,
      signals: signals(),
      now: NOW + 120_000,
      cursor: first.nextCursor,
      limit: 3,
    });
    const reference = exploreSlatePage({
      pool,
      signals: signals(),
      now: NOW,
      cursor: first.nextCursor,
      limit: 3,
    });
    expect(second.items.map((c) => c.item.mediaAssetId)).toEqual(
      reference.items.map((c) => c.item.mediaAssetId),
    );
    expect(second.items.some((c) => c.item.mediaAssetId === id(1099))).toBe(
      false,
    );
  });

  it("refuses a forged or foreign-mode cursor", () => {
    expect(() => decodeExploreCursor("not-json")).toThrow(
      ExploreCursorRejectedError,
    );
    const page = exploreSlatePage({
      pool,
      signals: signals(),
      now: NOW,
      cursor: null,
      limit: 3,
    });
    expect(() =>
      exploreSlatePage({
        pool,
        signals: signals({ mode: "EVERYTHING" }),
        now: NOW,
        cursor: page.nextCursor,
      }),
    ).toThrow(ExploreCursorRejectedError);
  });
});

describe("related pitches", () => {
  const anchor = pitch(1, {
    sectorNodeIds: [HEALTH],
    stageCode: "seed",
    country: "NG",
  });
  const pool = [
    anchor,
    pitch(2, { company: 1, sectorNodeIds: [HEALTH] }),
    pitch(3, { sectorNodeIds: [HEALTH], stageCode: "seed", country: "NG" }),
    pitch(4, { sectorNodeIds: [ENERGY], stageCode: "seed", country: "KE" }),
    pitch(5, {
      sectorNodeIds: [AGRI],
      stageCode: "series_c_plus",
      country: "EG",
    }),
    pitch(6, { sectorNodeIds: [], stageCode: null, country: null }),
  ];

  it("relates by founder, sector, stage and geography, and says which", () => {
    const out = relatedPitches(anchor, pool);
    const ids = out.map((r) => r.item.mediaAssetId);
    expect(ids).not.toContain(anchor.mediaAssetId);
    // Sharing nothing (or only unknowns) is not related.
    expect(ids).not.toContain(id(1005));
    expect(ids).not.toContain(id(1006));
    // The same founder's other pitch ranks high, but not straight after the anchor.
    expect(out[0]?.item.companyId).not.toBe(anchor.companyId);
    expect(out[1]?.related).toContain("SAME_COMPANY");
    expect(out.find((r) => r.item.mediaAssetId === id(1003))?.related).toEqual([
      "SAME_SECTOR",
      "SAME_STAGE",
      "SAME_GEOGRAPHY",
    ]);
    expect(out.find((r) => r.item.mediaAssetId === id(1004))?.related).toEqual([
      "SAME_STAGE",
    ]);
  });

  it("never shows the same company twice in a row when another is left", () => {
    const more = [
      ...pool,
      pitch(7, { company: 1, sectorNodeIds: [HEALTH] }),
      pitch(8, { company: 1, sectorNodeIds: [HEALTH] }),
    ];
    const out = relatedPitches(anchor, more);
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1]?.item.companyId;
      const b = out[i]?.item.companyId;
      if (a === b) {
        // Only allowed once nothing else remains.
        expect(out.slice(i).every((r) => r.item.companyId === a)).toBe(true);
      }
    }
  });
});

describe("explore pool permission boundary", () => {
  const VIEWER_TENANT = id(7001);
  const OTHER_TENANT = id(7002);
  const VIEWER_ORG = id(7101);
  const actor = {
    tenantId: VIEWER_TENANT,
    organisationId: VIEWER_ORG,
  } as unknown as ActorContext;

  // Company 1 is network-visible; 2 is founder-private (disclosure says no);
  // 3 belongs to another tenant's private scope; 4 is closed.
  const facts = (name: string, status = "active"): ExploreCompanyFacts => ({
    canonicalName: name,
    shortDescription: `${name} line`,
    headquartersCountry: "NG",
    currentStageCode: "seed",
    companyStatus: status,
  });
  const visible = new Map<string, ExploreCompanyFacts | null>([
    [id(1), facts("Kora Health")],
    [id(2), null],
    [id(3), null],
    [id(4), facts("Closed Co", "closed")],
  ]);
  const rows = [1, 2, 3, 4].map((n) => ({
    mediaAssetId: id(1000 + n),
    companyId: id(n),
    createdAt: day(n),
    tenantId: n === 3 ? OTHER_TENANT : VIEWER_TENANT,
  }));

  const asked: (string | null)[] = [];
  const service = createExploreService({
    findNetworkPitches: (input) => {
      asked.push(input.excludeOwnerOrganisationId);
      return Promise.resolve(input.before === null ? rows : []);
    },
    company: (_actor, companyId) =>
      Promise.resolve(visible.get(companyId) ?? null),
    sectors: (_actor, companyIds) => {
      // Sectors are asked only for companies already allowed.
      expect(companyIds).toEqual([id(1)]);
      return Promise.resolve(new Map([[id(1), [HEALTH]]]));
    },
    signals: () =>
      Promise.resolve({
        mandateCompanyIds: new Set([id(2)]),
        adjacentCompanyIds: new Set<string>(),
        savedCompanyIds: new Set<string>(),
        ownSectorNodeIds: new Set<string>(),
      }),
    clock: () => NOW,
  });

  it("serves only what disclosure allows, never the viewer's own organisation", async () => {
    const page = await service.page(actor, { mode: "FOR_YOU", cursor: null });
    expect(page.items.map((c) => c.item.companyId)).toEqual([id(1)]);
    expect(asked.every((org) => org === VIEWER_ORG)).toBe(true);
  });

  it("cross-tenant negative: a hidden company is neither related nor searchable", async () => {
    expect(await service.related(actor, { mediaAssetId: id(1003) })).toBeNull();
    expect(await service.search(actor, { text: "line" })).toHaveLength(1);
    expect(
      (await service.search(actor, { text: "line" })).map((p) => p.companyId),
    ).toEqual([id(1)]);
    // Declared stage and country are searchable, in words.
    expect(await service.search(actor, { text: "seed nigeria" })).toHaveLength(
      1,
    );
    expect(
      await service.search(actor, { text: "", sectorNodeIds: [HEALTH] }),
    ).toHaveLength(1);
  });

  it("a failing disclosure read excludes rather than fails open", async () => {
    const failing = createExploreService({
      findNetworkPitches: () => Promise.resolve(rows),
      company: () => Promise.reject(new Error("down")),
      clock: () => NOW,
    });
    const page = await failing.page(actor, { mode: "FOR_YOU", cursor: null });
    expect(page.items).toHaveLength(0);
    expect(page.upToDate).toBe(true);
  });
});
