// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExploreTileDto } from "@capital-q/contracts";

import {
  DEFAULT_PREFETCH_BUDGET,
  policyForOffset,
} from "../src/features/discover/feed/feed-state";
import {
  resetSoundChoiceForTests,
  soundMuted,
} from "../src/features/discover/player/sound-policy";
import { ExploreFeed } from "../src/features/explore/explore-feed";
import {
  FIXTURE_POSTERS,
  FIXTURE_SECTORS,
  FIXTURE_TILES,
  fixtureRelated,
  fixtureSearch,
} from "../src/features/explore/explore-fixtures";
import { ExploreGrid } from "../src/features/explore/explore-grid";
import { ExploreSearchResults } from "../src/features/explore/explore-search-results";
import {
  parseSearch,
  profileFromCompany,
} from "../src/features/explore/explore-search-view";
import {
  ExploreScreen,
  type ExploreDataSource,
} from "../src/features/explore/explore-screen";
import {
  TILE_RATIO_MAX,
  TILE_RATIO_MIN,
  columnsForWidth,
  placeMasonry,
  tileRatio,
  tileRatioAt,
} from "../src/features/explore/masonry";

/**
 * Explore (E1-E5, ADR 0055) on the web: the masonry math, the grid's
 * order and posters, the related feed, search routing to profiles, the
 * end of the slate, and that nothing is ever counted.
 */

vi.mock("../src/features/discover/feed/feed-actions", () => ({
  recordDecisionAction: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("../src/features/discover/feed/action-feed-transport", () => ({
  authorisePlaybackViaAction: vi.fn(),
}));
vi.mock("../src/features/explore/explore-actions", () => ({
  loadExplorePageAction: vi.fn(),
  loadExploreRelatedAction: vi.fn(),
}));

const labels = new Map(FIXTURE_SECTORS.map((s) => [s.nodeId, s.label]));
/** Engagement words that must never reach Explore's screen. */
const COUNT_WORDS =
  /\b(\d[\d,.]*\s*(views?|likes?|watch(es|ed)?|plays?|impressions?)|views|likes|trending|popular)\b/i;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("masonry layout math", () => {
  it("clamps tile heights between 4:3 and 2:3 and reads both spellings", () => {
    expect(tileRatio("9:16")).toBe(TILE_RATIO_MAX);
    expect(tileRatio("9/16")).toBe(TILE_RATIO_MAX);
    expect(tileRatio("4:5")).toBeCloseTo(5 / 4);
    expect(tileRatio("1:1")).toBe(1);
    expect(tileRatio("16:9")).toBe(TILE_RATIO_MIN);
    expect(tileRatio("9:21")).toBe(TILE_RATIO_MAX);
    // Unknown is the portrait default, never a zero-height box.
    expect(tileRatio(null)).toBe(TILE_RATIO_MAX);
    expect(tileRatio("nonsense")).toBe(TILE_RATIO_MAX);
  });

  it("varies equal portrait tiles by rank, never above 2:3 or below 4:3", () => {
    const ratios = Array.from({ length: 7 }, (_, index) =>
      tileRatioAt("9:16", index),
    );
    expect(new Set(ratios.map((r) => r.toFixed(3))).size).toBeGreaterThan(3);
    for (const ratio of ratios) {
      expect(ratio).toBeLessThanOrEqual(TILE_RATIO_MAX);
      expect(ratio).toBeGreaterThanOrEqual(TILE_RATIO_MIN);
    }
    expect(tileRatioAt("16:9", 1)).toBe(TILE_RATIO_MIN);
  });

  it("uses 2 columns on a phone and 4-5 on a desktop", () => {
    expect(columnsForWidth(390)).toBe(2);
    expect(columnsForWidth(800)).toBe(3);
    expect(columnsForWidth(1280)).toBe(4);
    expect(columnsForWidth(1440)).toBe(5);
  });

  it("places in rank order into the shortest column, leftmost on a tie", () => {
    const layout = placeMasonry([16 / 9, 1.25, 1.25, 1.25], 2);
    expect(layout.placements.map((p) => p.column)).toEqual([0, 1, 1, 0]);
    expect(layout.placements.map((p) => p.index)).toEqual([0, 1, 2, 3]);
    const third = layout.placements[2];
    expect(third?.tilesAbove).toBe(1);
    expect(third?.ratiosAbove).toBeCloseTo(1.25);
    // The reserved height is the tallest column's.
    expect(layout.height.tiles).toBe(2);
  });
});

describe("the grid", () => {
  it("keeps DOM order equal to rank order, posters only, a reason on every tile", () => {
    const { container } = render(
      <ExploreGrid
        tiles={FIXTURE_TILES}
        posters={FIXTURE_POSTERS}
        columns={2}
        sectorLabels={labels}
        onOpen={() => undefined}
      />,
    );
    const cells = [...container.querySelectorAll("[data-explore-tile]")];
    expect(cells.map((c) => c.getAttribute("data-rank"))).toEqual(
      FIXTURE_TILES.map((_, n) => String(n)),
    );
    // Reserved boxes: every cell is placed before any poster loads.
    for (const cell of cells) {
      expect((cell as HTMLElement).style.height).not.toBe("");
    }
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelectorAll("[data-reason]")).toHaveLength(
      FIXTURE_TILES.length,
    );
    expect(
      screen.getAllByText("Outside your usual focus").length,
    ).toBeGreaterThan(0);
    expect(container.textContent ?? "").not.toMatch(COUNT_WORDS);
  });
});

describe("the related feed", () => {
  it("opens with the pitch, says what it is related to, and goes back", () => {
    const related = fixtureRelated(FIXTURE_TILES[0]?.pitch.mediaAssetId ?? "");
    if (related === null) throw new Error("the fixture has no related feed");
    const onClose = vi.fn();
    const { container } = render(
      <ExploreFeed
        items={[related.anchor, ...related.items]}
        sectorLabels={labels}
        authorize={() => new Promise(() => undefined)}
        posters={FIXTURE_POSTERS}
        saved={new Set()}
        onSave={() => undefined}
        onHide={() => undefined}
        onClose={onClose}
        startOnRequest
      />,
    );
    // Discover's own stage: the opened pitch is the card in view.
    expect(container.querySelector("[data-feed-immersive]")).not.toBeNull();
    expect(
      container
        .querySelector("[data-slot-active] video")
        ?.getAttribute("aria-label"),
    ).toBe("Pitch from Kora Health");
    expect(
      screen.getAllByText("Related to Kora Health").length,
    ).toBeGreaterThan(0);
    // One controller: only the item on screen is ACTIVE.
    expect(
      container.querySelectorAll('[data-policy="ACTIVE"]').length,
    ).toBeLessThanOrEqual(1);
    // Related items share sector, stage, geography or founder with the anchor.
    for (const item of related.items) {
      expect(item.related.length).toBeGreaterThan(0);
    }
    const back = screen.getAllByRole("button", { name: "Back to Explore" })[0];
    if (back === undefined) throw new Error("no back button");
    fireEvent.click(back);
    expect(onClose).toHaveBeenCalled();
    // The profile, never a Q card.
    const profile = container.querySelector(
      `a[href="/company/${related.anchor.companyId}"]`,
    );
    expect(profile).not.toBeNull();
    expect(container.textContent ?? "").not.toMatch(COUNT_WORDS);
  });
});

describe("the opened pitch plays like Discover (ADR 0064)", () => {
  it("gets Discover's sound policy and preload window", () => {
    const related = fixtureRelated(FIXTURE_TILES[0]?.pitch.mediaAssetId ?? "");
    if (related === null) throw new Error("the fixture has no related feed");
    resetSoundChoiceForTests();
    const items = [related.anchor, ...related.items];
    const { container } = render(
      <ExploreFeed
        items={items}
        sectorLabels={labels}
        authorize={() => new Promise(() => undefined)}
        saved={new Set()}
        onSave={() => undefined}
        onHide={() => undefined}
        onClose={() => undefined}
      />,
    );
    const policyOf = (name: string) =>
      container
        .querySelector(`video[aria-label="Pitch from ${name}"]`)
        ?.getAttribute("data-policy") ?? "NONE";
    // The same window Discover's controller computes: the opened pitch
    // plays, the next two buffer (the one after is a poster, no player).
    items.slice(0, 3).forEach((item, offset) => {
      expect(policyOf(item.canonicalName)).toBe(
        policyForOffset(offset, DEFAULT_PREFETCH_BUDGET),
      );
    });
    expect(policyOf(items[1]?.canonicalName ?? "")).toBe("STARTUP_BUFFER");
    expect(policyOf(items[2]?.canonicalName ?? "")).toBe("STARTUP_BUFFER");
    // Sound on by default, as on Discover: the stage is not muted, and
    // nothing on it says the pitch is muted.
    expect(soundMuted(null, false)).toBe(false);
    const active = container.querySelector<HTMLVideoElement>(
      "[data-slot-active] video",
    );
    expect(active?.muted).toBe(false);
    expect(active?.hasAttribute("muted")).toBe(false);
  });
});

describe("search", () => {
  it("routes every company and investor result to its profile", () => {
    render(
      <ExploreSearchResults
        view={fixtureSearch("full", "top")}
        columns={2}
        posters={FIXTURE_POSTERS}
        sectorLabels={labels}
        limited={null}
        onOpen={() => undefined}
      />,
    );
    const rows = screen
      .getAllByRole("link")
      .filter((a) => a.hasAttribute("data-explore-result"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.getAttribute("href")).toMatch(
        /^\/(company|investors)\/[0-9a-f-]{36}$/,
      );
      expect(row.getAttribute("href")).not.toMatch(/^\/@|^\/u\/|^\/c\//);
    }
    const tabs = within(
      screen.getByRole("navigation", { name: "Result types" }),
    );
    expect(tabs.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Top",
      "Companies",
      "Investors",
      "People",
      "Pitches",
    ]);
    expect(document.body.textContent ?? "").not.toMatch(COUNT_WORDS);
  });

  it("reads a query into removable chips, deterministically", () => {
    const parsed = parseSearch("seed payments Nigeria", FIXTURE_SECTORS);
    expect(parsed.chips.map((c) => [c.kind, c.label])).toEqual([
      ["stage", "Seed"],
      ["sector", "Payments"],
      ["country", "Nigeria"],
    ]);
    expect(parsed.sectorNodeIds).toHaveLength(1);
    expect(parsed.chips[1]?.without).toBe("seed Nigeria");
    expect(
      profileFromCompany({
        companyId: "c0ffee00-0000-4000-8000-000000000001",
        canonicalName: "Tally Pay",
        shortDescription: null,
        headquartersCountry: "NG",
        currentStageCode: "seed",
      }).href,
    ).toBe("/company/c0ffee00-0000-4000-8000-000000000001");
  });
});

describe("the screen", () => {
  const source = (
    upToDate: boolean,
    items: readonly ExploreTileDto[],
  ): ExploreDataSource => ({
    loadPage: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          rankingVersion: "explore.v1",
          mode: "FOR_YOU" as const,
          items: [...items],
          nextCursor: upToDate ? null : "next",
          upToDate,
        },
      }),
    ),
    loadRelated: vi.fn(() => new Promise<never>(() => undefined)),
    authorize: vi.fn(() => new Promise<never>(() => undefined)),
    save: vi.fn(() => Promise.resolve({ ok: true })),
  });

  it('ends with "You\'re up to date" and no endless scroll', async () => {
    const live = source(true, FIXTURE_TILES.slice(0, 4));
    const { container } = render(
      <ExploreScreen source={live} sectors={FIXTURE_SECTORS} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("You're up to date")).toBeTruthy();
    expect(container.querySelector("[data-explore-sentinel]")).toBeNull();
    expect(container.textContent ?? "").not.toMatch(COUNT_WORDS);
  });

  it("offers Everything when For you is empty", async () => {
    const live = source(true, []);
    render(<ExploreScreen source={live} sectors={FIXTURE_SECTORS} />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Show everything" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(live.loadPage).toHaveBeenLastCalledWith("EVERYTHING", null);
  });
});
