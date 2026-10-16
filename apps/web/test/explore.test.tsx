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
import {
  chooseActivePreview,
  linkIsConstrained,
  type PreviewInput,
} from "../src/features/explore/grid-preview";
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
  MOSAIC_COLUMNS,
  columnsForWidth,
  mosaicCellStyle,
  mosaicLayouts,
  placeMosaic,
} from "../src/features/explore/mosaic";

/**
 * Explore (E1-E5, ADR 0055) on the web: the mosaic math, the grid's
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

describe("mosaic layout math", () => {
  it("uses 3 columns on a phone (as Instagram) and 4-5 on a desktop", () => {
    expect(columnsForWidth(358)).toBe(3);
    expect(columnsForWidth(390)).toBe(3);
    expect(columnsForWidth(720)).toBe(4);
    expect(columnsForWidth(1136)).toBe(5);
  });

  it("places 3 columns in bands of four squares and one tall tile, the side alternating", () => {
    const placed = placeMosaic(10, 3);
    expect(placed.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // Band 1: tall on the right, read top-left first.
    expect(placed.slice(0, 5).map((p) => [p.column, p.row, p.rowSpan])).toEqual(
      [
        [1, 1, 1],
        [2, 1, 1],
        [3, 1, 2],
        [1, 2, 1],
        [2, 2, 1],
      ],
    );
    // Band 2: tall on the left.
    expect(placed[5]).toMatchObject({ column: 1, row: 3, rowSpan: 2 });
    expect(placed.filter((p) => p.rowSpan === 2)).toHaveLength(2);
  });

  it("fills every cell of a full band, gapless, at every column count", () => {
    // Whole bands: 5 tiles per band at 3 columns, 7 at 4, 6 then 9 at 5.
    const whole = { 3: 60, 4: 56, 5: 60 } as const;
    for (const columns of MOSAIC_COLUMNS) {
      const placed = placeMosaic(whole[columns], columns);
      const taken = new Set<string>();
      for (const p of placed) {
        for (let c = 0; c < p.columnSpan; c++) {
          for (let r = 0; r < p.rowSpan; r++) {
            const key = `${String(p.column + c)}:${String(p.row + r)}`;
            expect(taken.has(key)).toBe(false);
            expect(p.column + c).toBeLessThanOrEqual(columns);
            taken.add(key);
          }
        }
      }
      const rows = Math.max(...placed.map((p) => p.row + p.rowSpan - 1));
      // Every cell of every band is covered: no holes in the mosaic.
      expect(taken.size).toBe(rows * columns);
    }
    // Wide screens also get a large two-by-two tile.
    expect(
      placeMosaic(15, 5).some((p) => p.columnSpan === 2 && p.rowSpan === 2),
    ).toBe(true);
  });

  it("gives each cell its place for every column count, as CSS", () => {
    const style = mosaicCellStyle(mosaicLayouts(5), 2);
    expect(style).toMatchObject({
      "--x3": "3 / span 1",
      "--y3": "1 / span 2",
    });
    expect(Object.keys(style)).toEqual(
      expect.arrayContaining(["--x4", "--y4", "--x5", "--y5"]),
    );
  });
});

describe("the grid", () => {
  it("keeps DOM order equal to rank order, posters only, no captions under tiles", () => {
    const { container } = render(
      <ExploreGrid
        tiles={FIXTURE_TILES}
        posters={FIXTURE_POSTERS}
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
      expect((cell as HTMLElement).style.getPropertyValue("--y3")).not.toBe("");
    }
    expect(container.querySelector("video")).toBeNull();
    // Why each tile is shown is still on every tile (hover/focus), and in
    // its accessible name, with "video" said in words, not only an icon.
    expect(container.querySelectorAll("[data-reason]")).toHaveLength(
      FIXTURE_TILES.length,
    );
    const first = FIXTURE_TILES[0];
    if (first === undefined) throw new Error("no fixture tile");
    const button = within(cells[0] as HTMLElement).getByRole("button");
    const name = button.getAttribute("aria-label") ?? "";
    expect(name).toContain(first.canonicalName);
    expect(name).toContain("Pitch video");
    expect(name).toContain("Matches your mandate");
    // The tile shows the company's name on the image, and no stage label.
    expect(cells[0]?.textContent).not.toMatch(/Seed|Series/);
    expect(container.textContent ?? "").not.toMatch(COUNT_WORDS);
  });

  it("opens the tile that was tapped, by rank", () => {
    const onOpen = vi.fn();
    render(
      <ExploreGrid
        tiles={FIXTURE_TILES.slice(0, 6)}
        posters={{}}
        sectorLabels={labels}
        onOpen={onOpen}
      />,
    );
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[3] as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith(3);
  });

  it("never leaves a tile without a poster as an empty box", () => {
    const { container } = render(
      <ExploreGrid
        tiles={FIXTURE_TILES.slice(0, 2)}
        posters={{}}
        sectorLabels={labels}
        onOpen={() => undefined}
      />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      `/api/company-photo/${FIXTURE_TILES[0]?.companyId ?? ""}`,
    );
    expect(container.querySelector(".cq-explore-initial")?.textContent).toBe(
      FIXTURE_TILES[0]?.canonicalName.slice(0, 1).toUpperCase(),
    );
  });
});

describe("grid previews: one muted player, chosen by one controller", () => {
  const order = ["a", "b", "c", "d"];
  const base: PreviewInput = {
    order,
    visible: new Map([
      ["a", 1],
      ["b", 1],
      ["c", 0.5],
    ]),
    hovered: null,
    canHover: true,
    reducedMotion: false,
    constrained: false,
    suspended: false,
  };

  it("plays the first tile while it is in view, and nothing once it scrolls away", () => {
    expect(chooseActivePreview(base)).toBe("a");
    expect(
      chooseActivePreview({ ...base, visible: new Map([["b", 1]]) }),
    ).toBeNull();
  });

  it("switches to the hovered tile, which keeps playing after the pointer leaves", () => {
    expect(chooseActivePreview({ ...base, hovered: "c" })).toBe("c");
    // The pointer left c and hovered nothing else: c is still the one.
    expect(chooseActivePreview({ ...base, hovered: "c" })).toBe("c");
    expect(chooseActivePreview({ ...base, hovered: "b" })).toBe("b");
  });

  it("never plays with reduced motion, Save-Data or 2g, a hidden tab or an open pitch", () => {
    expect(chooseActivePreview({ ...base, reducedMotion: true })).toBeNull();
    expect(chooseActivePreview({ ...base, constrained: true })).toBeNull();
    expect(chooseActivePreview({ ...base, suspended: true })).toBeNull();
    expect(
      chooseActivePreview({ ...base, hovered: "b", reducedMotion: true }),
    ).toBeNull();
    expect(linkIsConstrained({ saveData: true })).toBe(true);
    expect(linkIsConstrained({ effectiveType: "2g" })).toBe(true);
    expect(linkIsConstrained({ effectiveType: "slow-2g" })).toBe(true);
    expect(linkIsConstrained({ effectiveType: "4g" })).toBe(false);
    expect(linkIsConstrained(undefined)).toBe(false);
  });

  it("on touch plays the most visible tile, the higher rank on a tie", () => {
    const touch = { ...base, canHover: false };
    expect(
      chooseActivePreview({
        ...touch,
        visible: new Map([
          ["a", 0.3],
          ["b", 0.6],
          ["c", 0.9],
        ]),
      }),
    ).toBe("c");
    expect(chooseActivePreview(touch)).toBe("a");
    expect(
      chooseActivePreview({ ...touch, visible: new Map([["d", 0.2]]) }),
    ).toBeNull();
  });

  function mockBrowser(reducedMotion: boolean) {
    let observerCallback: IntersectionObserverCallback = () => undefined;
    const observed: Element[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }
        observe(element: Element) {
          observed.push(element);
        }
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
      },
    );
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query.includes("reduced-motion")
            ? reducedMotion
            : query.includes("hover"),
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
      () => undefined,
    );
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(
      () => undefined,
    );
    const showAll = () =>
      act(() => {
        observerCallback(
          observed.map(
            (target) =>
              ({
                target,
                isIntersecting: true,
                intersectionRatio: 1,
              }) as unknown as IntersectionObserverEntry,
          ),
          {} as IntersectionObserver,
        );
      });
    return { showAll };
  }

  const renderGrid = () => {
    const authorize = vi.fn(() => new Promise<never>(() => undefined));
    const view = render(
      <ExploreGrid
        tiles={FIXTURE_TILES.slice(0, 6)}
        posters={FIXTURE_POSTERS}
        sectorLabels={labels}
        onOpen={() => undefined}
        preview={{ authorize, suspended: false }}
      />,
    );
    return { ...view, authorize };
  };

  it("renders exactly one muted, inline, looping player, and hover moves it", () => {
    const { showAll } = mockBrowser(false);
    const { container, authorize } = renderGrid();
    showAll();
    const videos = () => [...container.querySelectorAll("video")];
    expect(videos()).toHaveLength(1);
    const first = videos()[0];
    expect(
      first?.closest("[data-explore-tile]")?.getAttribute("data-rank"),
    ).toBe("0");
    expect(first?.muted).toBe(true);
    expect(first?.hasAttribute("playsinline")).toBe(true);
    expect(first?.loop).toBe(true);
    expect(first?.getAttribute("preload")).toBe("none");
    // The source is attached only from a signed grant, never up front.
    expect(first?.getAttribute("src")).toBeNull();
    expect(authorize).toHaveBeenCalledTimes(1);

    const third = container.querySelector('[data-rank="2"]');
    if (third === null) throw new Error("no third tile");
    fireEvent.pointerEnter(third, { pointerType: "mouse" });
    expect(videos()).toHaveLength(1);
    expect(
      videos()[0]?.closest("[data-explore-tile]")?.getAttribute("data-rank"),
    ).toBe("2");
    // Leaving keeps it playing until another tile is hovered.
    fireEvent.pointerLeave(third, { pointerType: "mouse" });
    expect(
      videos()[0]?.closest("[data-explore-tile]")?.getAttribute("data-rank"),
    ).toBe("2");
    vi.unstubAllGlobals();
  });

  it("shows posters only under reduced motion", () => {
    const { showAll } = mockBrowser(true);
    const { container, authorize } = renderGrid();
    showAll();
    expect(container.querySelector("video")).toBeNull();
    expect(authorize).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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
