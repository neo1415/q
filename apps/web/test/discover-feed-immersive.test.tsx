// @vitest-environment jsdom
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DiscoveredCompanyDto,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";

/**
 * Discover as an immersive feed (UX-05; spec §9, ADR 0017 C4/C5).
 *
 * The surface suite covers what a card says and what the decisions do.
 * This one covers the stage: the three-player ring and its preload tiers,
 * the poster warmed for the card after next, the inputs (swipe linked to
 * the finger, one wheel gesture per move), reduced motion, and playback
 * holding while the tab is hidden. jsdom has no media pipeline, so
 * `play()` is stubbed and nothing here claims a video played; what is
 * asserted is what the surface asked the element to do.
 */

type ActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const loadSlatePageAction =
  vi.fn<(cursor: string | null) => Promise<ActionResult<unknown>>>();
const authorisePlaybackAction =
  vi.fn<
    (
      companyId: string,
      mediaAssetId: string,
    ) => Promise<ActionResult<PlaybackAuthorizationDto>>
  >();

vi.mock("../src/features/discover/feed/feed-actions", () => ({
  loadSlatePageAction: (cursor: string | null) => loadSlatePageAction(cursor),
  recordDecisionAction: () =>
    Promise.resolve({
      ok: true,
      value: {
        recorded: true,
        deduplicated: false,
        state: { saved: true, passed: false },
      },
    }),
}));
vi.mock("../src/features/network/interest-actions", () => ({
  expressInterestAction: vi.fn(),
}));
vi.mock("../src/features/discover/feed/playback-source", () => ({
  authorisePlaybackAction: (companyId: string, mediaAssetId: string) =>
    authorisePlaybackAction(companyId, mediaAssetId),
}));
const globalQ: {
  open: boolean;
  source: (() => unknown) | null;
} = { open: false, source: null };
vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ open: globalQ.open, setOpen: vi.fn() }),
  useQMomentSource: (source: () => unknown) => {
    globalQ.source = source;
  },
}));
vi.mock("@/features/q/q-subject", () => ({
  QPageSubject: () => null,
}));

const { InvestorFeedScreen } =
  await import("../src/features/discover/investor-feed-screen");

// A shared machine can be slow to commit; the expectations are unchanged.
configure({ asyncUtilTimeout: 8000 });

const SLATE_ID = "22222222-2222-4222-8222-222222222222";

function companyId(n: number): string {
  return `0000000${n}-0000-4000-8000-000000000000`;
}
function assetId(n: number): string {
  return `aaaaaaa${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
}

function company(n: number): DiscoveredCompanyDto {
  return {
    companyId: companyId(n),
    canonicalName: `Company ${n}`,
    websiteUrl: null,
    headquartersCountry: "GB",
    currentStageCode: "SEED",
    shortDescription: `What company ${n} does.`,
    reasons: [],
    reasonCodes: [],
    pitch: {
      mediaAssetId: assetId(n),
      aspectRatio: "9:16",
      durationSeconds: 60,
      captionState: "NOT_REQUESTED",
    },
  };
}

function slate(companies: readonly number[]) {
  return {
    ok: true as const,
    value: {
      slateId: SLATE_ID,
      rankingVersion: "declared.v1",
      items: companies.map((n) => company(n)),
      notes: [],
      nextCursor: null,
    },
  };
}

function grantFor(mediaAssetId: string): PlaybackAuthorizationDto {
  return {
    mediaAssetId,
    // Samples, never real pitches.
    playbackUrl: `https://cdn.test/${mediaAssetId}/video.mp4`,
    posterUrl: `https://cdn.test/${mediaAssetId}/poster.jpg`,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}

let play: ReturnType<typeof vi.fn>;
let reducedMotion = false;

function setConnection(value: unknown) {
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  loadSlatePageAction.mockReset();
  authorisePlaybackAction.mockReset();
  loadSlatePageAction.mockResolvedValue(slate([1, 2, 3, 4, 5]));
  authorisePlaybackAction.mockImplementation((_, mediaAssetId) =>
    Promise.resolve({ ok: true, value: grantFor(mediaAssetId) }),
  );

  play = vi.fn(() => Promise.resolve());
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: play,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "load", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  reducedMotion = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });

  // A fast link with Save-Data off: the full window (doc 20 §50).
  setConnection({ effectiveType: "4g", saveData: false });
});

afterEach(() => {
  cleanup();
  globalQ.open = false;
  globalQ.source = null;
  setConnection(undefined);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

function feedRegion(): HTMLElement {
  return screen.getByRole("group", { name: "Companies to review" });
}

async function renderFeed() {
  const view = render(<InvestorFeedScreen />);
  await screen.findByRole("heading", { name: "Company 1" });
  return view;
}

function videos(container: HTMLElement): HTMLVideoElement[] {
  return [...container.querySelectorAll("video")];
}

function policies(container: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const video of videos(container)) {
    out[video.getAttribute("aria-label") ?? "?"] =
      video.dataset["policy"] ?? "?";
  }
  return out;
}

describe("the three-player ring", () => {
  it("never holds more than three video elements, however far the reader goes", async () => {
    const { container } = await renderFeed();
    for (let step = 0; step < 4; step += 1) {
      expect(videos(container).length).toBeLessThanOrEqual(3);
      fireEvent.keyDown(feedRegion(), { key: "ArrowDown" });
      await screen.findByRole("heading", { name: `Company ${step + 2}` });
    }
    expect(videos(container).length).toBeLessThanOrEqual(3);
  });

  it("gives the active card ACTIVE, the next a startup buffer, and the one behind a poster", async () => {
    const { container } = await renderFeed();
    fireEvent.keyDown(feedRegion(), { key: "ArrowDown" });
    await screen.findByRole("heading", { name: "Company 2" });

    expect(policies(container)).toEqual({
      "Pitch from Company 1": "POSTER",
      "Pitch from Company 2": "ACTIVE",
      "Pitch from Company 3": "STARTUP_BUFFER",
    });
  });

  it("falls back to active plus a poster on a constrained link", async () => {
    setConnection({ effectiveType: "3g", saveData: false });
    const { container } = await renderFeed();

    expect(policies(container)).toEqual({
      "Pitch from Company 1": "ACTIVE",
      "Pitch from Company 2": "POSTER",
    });
    expect(container.querySelector("[data-poster-warm]")).toBeNull();
  });

  it("recycles the next card's element in place when the reader moves on", async () => {
    const { container } = await renderFeed();
    await waitFor(() =>
      expect(
        container.querySelector('video[aria-label="Pitch from Company 2"]'),
      ).not.toBeNull(),
    );
    const warmed = container.querySelector(
      'video[aria-label="Pitch from Company 2"]',
    );

    fireEvent.keyDown(feedRegion(), { key: "ArrowDown" });
    await screen.findByRole("heading", { name: "Company 2" });

    // The same element, now the active one -- not a fresh player.
    expect(
      container.querySelector('video[aria-label="Pitch from Company 2"]'),
    ).toBe(warmed);
  });
});

describe("the poster after next", () => {
  it("is warmed as an image, with no player, and its grant is reused when its slot arrives", async () => {
    const { container } = await renderFeed();

    const warm = await waitFor(() => {
      const image = container.querySelector<HTMLImageElement>(
        `img[data-poster-warm="${companyId(3)}"]`,
      );
      expect(image).not.toBeNull();
      return image;
    });
    expect(warm?.getAttribute("src")).toBe(
      `https://cdn.test/${assetId(3)}/poster.jpg`,
    );
    expect(warm?.hidden).toBe(true);
    expect(
      container.querySelector('video[aria-label="Pitch from Company 3"]'),
    ).toBeNull();

    fireEvent.keyDown(feedRegion(), { key: "ArrowDown" });
    await screen.findByRole("heading", { name: "Company 2" });
    await waitFor(() =>
      expect(
        container
          .querySelector('video[aria-label="Pitch from Company 3"]')
          ?.getAttribute("poster"),
      ).toBe(`https://cdn.test/${assetId(3)}/poster.jpg`),
    );

    const asksForThree = authorisePlaybackAction.mock.calls.filter(
      ([id]) => id === companyId(3),
    );
    expect(asksForThree).toHaveLength(1);
  });

  it("reuses a grant when the reader comes back to a card whose slot was recycled", async () => {
    await renderFeed();
    for (const n of [2, 3]) {
      fireEvent.keyDown(feedRegion(), { key: "ArrowDown" });
      await screen.findByRole("heading", { name: `Company ${n}` });
    }
    for (const n of [2, 1]) {
      fireEvent.keyDown(feedRegion(), { key: "ArrowUp" });
      await screen.findByRole("heading", { name: `Company ${n}` });
    }
    const asksForOne = authorisePlaybackAction.mock.calls.filter(
      ([id]) => id === companyId(1),
    );
    expect(asksForOne).toHaveLength(1);
  });
});

describe("the wheel", () => {
  it("moves one card per gesture, however long the gesture's tail", async () => {
    await renderFeed();
    const region = feedRegion();

    // One trackpad flick: a first push past the threshold, then an
    // inertial tail of small deltas every 100 ms for longer than the
    // lockout -- the tail a fixed lockout read as a second gesture.
    fireEvent.wheel(region, { deltaY: 80 });
    for (let tick = 0; tick < 7; tick += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      fireEvent.wheel(region, { deltaY: 30 });
    }

    await screen.findByRole("heading", { name: "Company 2" });
    expect(screen.queryByRole("heading", { name: "Company 3" })).toBeNull();
  });

  it("moves again once the wheel has been quiet", async () => {
    await renderFeed();
    const region = feedRegion();

    fireEvent.wheel(region, { deltaY: 120 });
    await screen.findByRole("heading", { name: "Company 2" });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    fireEvent.wheel(region, { deltaY: 120 });
    await screen.findByRole("heading", { name: "Company 3" });
  });

  it("ignores small stray deltas that never add up to a gesture", async () => {
    await renderFeed();
    fireEvent.wheel(feedRegion(), { deltaY: 20 });
    fireEvent.wheel(feedRegion(), { deltaY: 20 });
    expect(screen.getByRole("heading", { name: "Company 1" })).toBeTruthy();
  });
});

describe("swipe", () => {
  function touch(y: number) {
    return [{ clientX: 100, clientY: y, identifier: 0 }];
  }

  it("follows the finger, then moves on when released past the threshold", async () => {
    const { container } = await renderFeed();
    const region = feedRegion();
    const media = container.querySelector<HTMLElement>(".cq-feed-media");

    fireEvent.touchStart(region, { touches: touch(600) });
    fireEvent.touchMove(region, { touches: touch(480) });
    expect(media?.style.getPropertyValue("--cq-feed-drag")).toBe("-120px");
    expect(media?.hasAttribute("data-dragging")).toBe(true);

    fireEvent.touchEnd(region, { changedTouches: touch(480) });
    await screen.findByRole("heading", { name: "Company 2" });
    expect(media?.style.getPropertyValue("--cq-feed-drag")).toBe("");
    expect(media?.hasAttribute("data-dragging")).toBe(false);
  });

  it("settles back on a short drag", async () => {
    await renderFeed();
    const region = feedRegion();
    fireEvent.touchStart(region, { touches: touch(600) });
    fireEvent.touchMove(region, { touches: touch(580) });
    fireEvent.touchEnd(region, { changedTouches: touch(580) });
    expect(screen.getByRole("heading", { name: "Company 1" })).toBeTruthy();
  });

  it("does not pull past the first card", async () => {
    const { container } = await renderFeed();
    const region = feedRegion();
    const media = container.querySelector<HTMLElement>(".cq-feed-media");
    fireEvent.touchStart(region, { touches: touch(300) });
    fireEvent.touchMove(region, { touches: touch(500) });
    expect(media?.style.getPropertyValue("--cq-feed-drag")).toBe("0px");
    fireEvent.touchEnd(region, { changedTouches: touch(500) });
    expect(screen.getByRole("heading", { name: "Company 1" })).toBeTruthy();
  });
});

describe("playback", () => {
  it("plays only the card in view, muted and inline", async () => {
    const { container } = await renderFeed();
    await waitFor(() => expect(play).toHaveBeenCalled());
    const active = container.querySelector<HTMLVideoElement>(
      "[data-slot-active] video",
    );
    expect(active?.getAttribute("aria-label")).toBe("Pitch from Company 1");
    expect(active?.muted).toBe(true);
    expect(active?.hasAttribute("playsinline")).toBe(true);
    for (const call of play.mock.contexts) {
      expect(call).toBe(active);
    }
  });

  it("under reduced motion shows the poster and an explicit Play, and starts nothing", async () => {
    reducedMotion = true;
    const { container } = await renderFeed();

    const playButton = await screen.findByRole("button", { name: "Play" });
    await waitFor(() =>
      expect(
        container
          .querySelector("[data-slot-active] video")
          ?.getAttribute("poster"),
      ).toBe(`https://cdn.test/${assetId(1)}/poster.jpg`),
    );
    expect(play).not.toHaveBeenCalled();

    fireEvent.click(playButton);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("holds while the tab is hidden", async () => {
    await renderFeed();
    await waitFor(() => expect(play).toHaveBeenCalled());
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    const active = document.querySelector<HTMLVideoElement>(
      "[data-slot-active] video",
    );
    // The element reports itself playing, as a browser would.
    Object.defineProperty(active, "paused", {
      configurable: true,
      get: () => false,
    });
    pause.mockClear();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(pause).toHaveBeenCalled());
  });
});

describe("the dock merges into the rail", () => {
  it("marks the page immersive and carries Ask Q in the rail", async () => {
    const { container } = await renderFeed();
    expect(container.querySelector("[data-feed-immersive]")).not.toBeNull();
    const rail = screen.getByRole("group", { name: "Decide" });
    expect(
      rail.querySelector("[data-feed-ask-q]")?.textContent?.includes("Ask Q"),
    ).toBe(true);
  });
});

describe("Q watches the pitch with the person", () => {
  it("tells Q which pitch and where in it, read from the playing element", async () => {
    const { container } = await renderFeed();
    const active = await waitFor(() => {
      const video = container.querySelector<HTMLVideoElement>(
        "[data-slot-active] video",
      );
      expect(video).not.toBeNull();
      return video;
    });
    Object.defineProperty(active, "currentTime", {
      configurable: true,
      get: () => 102.6,
    });

    expect(globalQ.source?.()).toEqual({
      kind: "PITCH_MOMENT",
      companyId: companyId(1),
      companyLabel: "Company 1",
      mediaAssetId: assetId(1),
      positionSeconds: 102,
    });
  });

  it("keeps the pitch playing, muted, while Q is open", async () => {
    globalQ.open = true;
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    const { container } = await renderFeed();
    await waitFor(() => expect(play).toHaveBeenCalled());
    const active = container.querySelector<HTMLVideoElement>(
      "[data-slot-active] video",
    );
    expect(active?.muted).toBe(true);
    expect(pause).not.toHaveBeenCalled();
  });
});

describe("the first cards' grants from the server", () => {
  it("asks nothing on the client for cards the server already authorised", async () => {
    const page = slate([1, 2, 3, 4, 5]).value;
    const warm = [1, 2, 3].map((n) => ({
      companyId: companyId(n),
      authorization: grantFor(assetId(n)),
    }));
    const { container } = render(
      <InvestorFeedScreen
        initial={{
          slate: page,
          authorization: grantFor(assetId(1)),
          warm,
        }}
      />,
    );
    await waitFor(() =>
      expect(
        container
          .querySelector('video[aria-label="Pitch from Company 2"]')
          ?.getAttribute("poster"),
      ).toBe(`https://cdn.test/${assetId(2)}/poster.jpg`),
    );
    await waitFor(() =>
      expect(
        container.querySelector(`img[data-poster-warm="${companyId(3)}"]`),
      ).not.toBeNull(),
    );
    expect(authorisePlaybackAction).not.toHaveBeenCalled();
    expect(loadSlatePageAction).not.toHaveBeenCalled();
  });
});
