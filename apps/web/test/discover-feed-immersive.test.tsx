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
const authoriseDownloadAction =
  vi.fn<
    (companyId: string, mediaAssetId: string) => Promise<ActionResult<unknown>>
  >();
vi.mock("../src/features/discover/feed/playback-source", () => ({
  authorisePlaybackAction: (companyId: string, mediaAssetId: string) =>
    authorisePlaybackAction(companyId, mediaAssetId),
  authoriseDownloadAction: (companyId: string, mediaAssetId: string) =>
    authoriseDownloadAction(companyId, mediaAssetId),
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
const { resetPlaybackRateForTests } =
  await import("../src/features/discover/stage/playback-rate");

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
let pause: ReturnType<typeof vi.fn>;
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
  pause = vi.fn();
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: play,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    writable: true,
    value: pause,
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

describe("the four-player ring (ADR 0064)", () => {
  it("never holds more than four video elements, however far the reader goes", async () => {
    const { container } = await renderFeed();
    for (let step = 0; step < 4; step += 1) {
      expect(videos(container).length).toBeLessThanOrEqual(4);
      fireEvent.keyDown(feedRegion(), { key: "ArrowDown" });
      await screen.findByRole("heading", { name: `Company ${step + 2}` });
    }
    expect(videos(container).length).toBeLessThanOrEqual(4);
  });

  it("gives the active card ACTIVE, buffers the next two, and keeps the one behind", async () => {
    const { container } = await renderFeed();
    fireEvent.keyDown(feedRegion(), { key: "ArrowDown" });
    await screen.findByRole("heading", { name: "Company 2" });

    expect(policies(container)).toEqual({
      "Pitch from Company 1": "STARTUP_BUFFER",
      "Pitch from Company 2": "ACTIVE",
      "Pitch from Company 3": "STARTUP_BUFFER",
      "Pitch from Company 4": "STARTUP_BUFFER",
    });
  });

  it("buffers the next two from the moment the feed loads", async () => {
    const { container } = await renderFeed();
    expect(policies(container)).toEqual({
      "Pitch from Company 1": "ACTIVE",
      "Pitch from Company 2": "STARTUP_BUFFER",
      "Pitch from Company 3": "STARTUP_BUFFER",
    });
  });

  it("falls back to active plus a poster on a constrained link", async () => {
    setConnection({ effectiveType: "3g", saveData: false });
    const { container } = await renderFeed();

    expect(policies(container)).toEqual({
      "Pitch from Company 1": "ACTIVE",
      "Pitch from Company 2": "POSTER",
      "Pitch from Company 3": "NONE",
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

describe("the poster after the buffered two", () => {
  it("is warmed as an image, with no player, and its grant is reused when its slot arrives", async () => {
    const { container } = await renderFeed();

    const warm = await waitFor(() => {
      const image = container.querySelector<HTMLImageElement>(
        `img[data-poster-warm="${companyId(4)}"]`,
      );
      expect(image).not.toBeNull();
      return image;
    });
    expect(warm?.getAttribute("src")).toBe(
      `https://cdn.test/${assetId(4)}/poster.jpg`,
    );
    expect(warm?.hidden).toBe(true);
    expect(
      container.querySelector('video[aria-label="Pitch from Company 4"]'),
    ).toBeNull();

    fireEvent.keyDown(feedRegion(), { key: "ArrowDown" });
    await screen.findByRole("heading", { name: "Company 2" });
    await waitFor(() =>
      expect(
        container
          .querySelector('video[aria-label="Pitch from Company 4"]')
          ?.getAttribute("poster"),
      ).toBe(`https://cdn.test/${assetId(4)}/poster.jpg`),
    );

    const asksForFour = authorisePlaybackAction.mock.calls.filter(
      ([id]) => id === companyId(4),
    );
    expect(asksForFour).toHaveLength(1);
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

  it("passes on a swipe left and moves on, the card following the finger (founder direction 2026-09-29)", async () => {
    const { container } = await renderFeed();
    const region = feedRegion();
    const media = container.querySelector<HTMLElement>(".cq-feed-media");
    const at = (x: number) => [{ clientX: x, clientY: 400, identifier: 0 }];
    fireEvent.touchStart(region, { touches: at(300) });
    fireEvent.touchMove(region, { touches: at(220) });
    fireEvent.touchMove(region, { touches: at(120) });
    expect(media?.dataset["swipe"]).toBe("pass");
    // Sideways never scrolls the feed.
    expect(media?.style.getPropertyValue("--cq-feed-drag")).toBe("");
    fireEvent.touchEnd(region, { changedTouches: at(120) });
    await screen.findByRole("heading", { name: "Company 2" });
    expect(media?.dataset["swipe"]).toBeUndefined();
  });

  it("keeps it on a swipe right and moves on", async () => {
    const { container } = await renderFeed();
    const region = feedRegion();
    const media = container.querySelector<HTMLElement>(".cq-feed-media");
    const at = (x: number) => [{ clientX: x, clientY: 400, identifier: 0 }];
    fireEvent.touchStart(region, { touches: at(100) });
    fireEvent.touchMove(region, { touches: at(180) });
    fireEvent.touchMove(region, { touches: at(260) });
    expect(media?.dataset["swipe"]).toBe("interested");
    fireEvent.touchEnd(region, { changedTouches: at(260) });
    await screen.findByRole("heading", { name: "Company 2" });
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
  it("plays only the card in view, with sound and inline (ADR 0026)", async () => {
    const { container } = await renderFeed();
    await waitFor(() => expect(play).toHaveBeenCalled());
    const active = container.querySelector<HTMLVideoElement>(
      "[data-slot-active] video",
    );
    expect(active?.getAttribute("aria-label")).toBe("Pitch from Company 1");
    expect(active?.muted).toBe(false);
    expect(active?.hasAttribute("playsinline")).toBe(true);
    for (const call of play.mock.contexts) {
      expect(call).toBe(active);
    }
  });

  it("under reduced motion shows the poster and an explicit Play, and starts nothing", async () => {
    reducedMotion = true;
    const { container } = await renderFeed();

    // A real button with words on it (ADR-001), and the sound stays off
    // until the person turns it on.
    const playButton = await screen.findByRole("button", {
      name: "Play pitch",
    });
    expect(
      screen.getByText("Sound stays off until you turn it on"),
    ).toBeTruthy();
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
    const warm = [1, 2, 3, 4].map((n) => ({
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
        container.querySelector(`img[data-poster-warm="${companyId(4)}"]`),
      ).not.toBeNull(),
    );
    expect(authorisePlaybackAction).not.toHaveBeenCalled();
    expect(loadSlatePageAction).not.toHaveBeenCalled();
  });
});

describe("tap to pause (founder directive, 2026-09-27)", () => {
  function activeVideo(container: HTMLElement): HTMLVideoElement {
    const video = container.querySelector<HTMLVideoElement>(
      "[data-slot-active] video",
    );
    if (video === null) throw new Error("no active video");
    return video;
  }

  it("pauses the pitch in view on a tap, and a second tap plays it again", async () => {
    const { container } = await renderFeed();
    const video = activeVideo(container);
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => false,
    });
    pause.mockClear();
    fireEvent.click(video);
    expect(pause).toHaveBeenCalled();
    expect(container.querySelector("[data-feed-paused]")).not.toBeNull();

    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => true,
    });
    play.mockClear();
    fireEvent.click(video);
    expect(play).toHaveBeenCalled();
    expect(container.querySelector("[data-feed-paused]")).toBeNull();
  });

  it("leaves taps on the rail and the overlay to their own controls", async () => {
    const { container } = await renderFeed();
    const video = activeVideo(container);
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => false,
    });
    pause.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: /^More about / }));
    fireEvent.click(screen.getByRole("button", { name: "All details" }));
    expect(pause).not.toHaveBeenCalled();
  });
});

describe("the details sheet over the feed", () => {
  it("keeps its keys, taps and swipes out of the feed", async () => {
    const { container } = await renderFeed();
    const video = container.querySelector<HTMLVideoElement>(
      "[data-slot-active] video",
    );
    if (video === null) throw new Error("no active video");
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => false,
    });
    fireEvent.click(screen.getByRole("button", { name: /^More about / }));
    fireEvent.click(screen.getByRole("button", { name: "All details" }));
    const dialog = await screen.findByRole("dialog");
    pause.mockClear();

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.click(dialog);
    const details = dialog.querySelector("[data-feed-details]");
    if (details === null) throw new Error("no details");
    fireEvent.touchStart(details, { touches: [{ clientY: 400 }] });
    fireEvent.touchEnd(details, { changedTouches: [{ clientY: 100 }] });

    expect(pause).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Company 1" })).toBeTruthy();
  });
});

describe("Discover v2: options, long press, Clear display, keys", () => {
  function activeVideo(container: HTMLElement): HTMLVideoElement {
    const video = container.querySelector<HTMLVideoElement>(
      "[data-slot-active] video",
    );
    if (video === null) throw new Error("no active video");
    return video;
  }

  beforeEach(() => {
    authoriseDownloadAction.mockReset();
    window.localStorage.removeItem("cq.discover.rate");
    resetPlaybackRateForTests();
  });

  it("a long press on the pitch opens its options, and the release does not pause it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { container } = await renderFeed();
      const video = activeVideo(container);
      fireEvent.pointerDown(video, {
        pointerType: "touch",
        isPrimary: true,
        clientX: 100,
        clientY: 200,
      });
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(await screen.findByRole("dialog")).toBeTruthy();
      expect(document.querySelector("[data-pitch-options]")).not.toBeNull();
      pause.mockClear();
      fireEvent.pointerUp(video, { pointerType: "touch" });
      fireEvent.click(video);
      expect(pause).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a short press is still a tap, not a long press", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { container } = await renderFeed();
      const video = activeVideo(container);
      fireEvent.pointerDown(video, { pointerType: "touch", isPrimary: true });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      fireEvent.pointerUp(video, { pointerType: "touch" });
      expect(document.querySelector("[data-pitch-options]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("More and a right-click open the same options; speed is the viewer's own and stays on this device", async () => {
    const { container } = await renderFeed();
    fireEvent.contextMenu(activeVideo(container));
    await screen.findByRole("dialog");
    const speeds = screen.getByRole("radiogroup", { name: "Playback speed" });
    const labels = [...speeds.querySelectorAll("[role='radio']")].map(
      (radio) => radio.textContent,
    );
    expect(labels).toEqual(["0.5×", "0.75×", "1×", "1.25×", "1.5×", "2×"]);
    fireEvent.click(screen.getByRole("radio", { name: "1.5×" }));
    await waitFor(() => expect(activeVideo(container).playbackRate).toBe(1.5));
    expect(window.localStorage.getItem("cq.discover.rate")).toBe("1.5");
    // Never sent anywhere: no request is made for a speed change.
    expect(loadSlatePageAction).toHaveBeenCalledTimes(1);
  });

  it("offers Download only when the founder allows it, and never Report without a contract", async () => {
    await renderFeed();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /Download pitch/ })).toBeNull();
    expect(
      screen.getByText("Download not allowed by the company"),
    ).toBeTruthy();
    expect(screen.queryByText(/Report/)).toBeNull();
  });

  it("downloads through the server's short-lived link when allowed", async () => {
    loadSlatePageAction.mockResolvedValue({
      ok: true,
      value: {
        ...slate([1, 2]).value,
        items: [
          {
            ...company(1),
            pitch: { ...company(1).pitch, downloadAllowed: true },
          },
          company(2),
        ],
      },
    });
    authoriseDownloadAction.mockResolvedValue({
      ok: true,
      value: {
        status: "READY",
        mediaAssetId: assetId(1),
        downloadUrl: "https://cdn.test/token/downloads/default.mp4",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    const clicks: string[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push(this.href);
      });
    try {
      await renderFeed();
      fireEvent.click(screen.getByRole("button", { name: "More" }));
      fireEvent.click(
        await screen.findByRole("button", { name: /Download pitch/ }),
      );
      await screen.findAllByText("Download started.");
      expect(authoriseDownloadAction).toHaveBeenCalledWith(
        companyId(1),
        assetId(1),
      );
      expect(clicks).toEqual(["https://cdn.test/token/downloads/default.mp4"]);
    } finally {
      click.mockRestore();
    }
  });

  it("Not interested is Pass: it records the pass and moves on", async () => {
    await renderFeed();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Not interested/ }),
    );
    expect(
      await screen.findByRole("heading", { name: "Company 2" }),
    ).toBeTruthy();
  });

  it("Clear display hides everything over the pitch until a tap, and that tap does nothing else", async () => {
    const { container } = await renderFeed();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Clear display/ }),
    );
    const feed = container.querySelector("[data-feed-immersive]");
    expect(feed?.hasAttribute("data-clear-display")).toBe(true);
    const video = activeVideo(container);
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => false,
    });
    pause.mockClear();
    fireEvent.click(video);
    expect(feed?.hasAttribute("data-clear-display")).toBe(false);
    expect(pause).not.toHaveBeenCalled();
  });

  it("left and right move through the pitch; j and k still move through the feed; < and > change speed", async () => {
    const { container } = await renderFeed();
    const video = activeVideo(container);
    // The card in view hands its element to the feed once it is mounted.
    await waitFor(() =>
      expect(screen.getByRole("slider").getAttribute("aria-disabled")).toBe(
        "false",
      ),
    );
    video.currentTime = 20;
    fireEvent.keyDown(feedRegion(), { key: "ArrowRight" });
    expect(video.currentTime).toBe(25);
    fireEvent.keyDown(feedRegion(), { key: "ArrowLeft" });
    fireEvent.keyDown(feedRegion(), { key: "ArrowLeft" });
    expect(video.currentTime).toBe(15);
    fireEvent.keyDown(feedRegion(), { key: ">" });
    await waitFor(() => expect(video.playbackRate).toBe(1.25));
    expect(screen.getByText("Speed 1.25×")).toBeTruthy();
    fireEvent.keyDown(feedRegion(), { key: "j" });
    expect(
      await screen.findByRole("heading", { name: "Company 2" }),
    ).toBeTruthy();
  });

  it("carries a progress bar for the pitch in view: a slider with its time in words", async () => {
    await renderFeed();
    const slider = screen.getByRole("slider", {
      name: "Position in Company 1's pitch",
    });
    expect(slider.getAttribute("aria-valuemin")).toBe("0");
    expect(slider.getAttribute("aria-valuetext")).toMatch(/of 1:00$/);
  });
});

describe("Discover v2: loading, buffering and a bad network", () => {
  it("loads as the feed's own shape, never a sentence", () => {
    loadSlatePageAction.mockReturnValue(new Promise(() => undefined));
    const { container } = render(<InvestorFeedScreen />);
    expect(container.querySelector("[data-feed-loading]")).not.toBeNull();
    expect(container.textContent).not.toMatch(/Loading your recommendations…/);
    expect(screen.getByRole("status").textContent).toBe(
      "Loading your recommendations",
    );
  });

  it("shows a ring only after a stall has lasted 400 ms, and never for a quick one", async () => {
    const { container } = await renderFeed();
    const video = container.querySelector<HTMLVideoElement>(
      "[data-slot-active] video",
    );
    if (video === null) throw new Error("no video");
    await waitFor(() => expect(video.getAttribute("src")).not.toBeNull());
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => false,
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent(video, new Event("waiting"));
      act(() => {
        vi.advanceTimersByTime(300);
      });
      fireEvent(video, new Event("playing"));
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(container.querySelector("[data-buffering]")).toBeNull();
      fireEvent(video, new Event("waiting"));
      act(() => {
        vi.advanceTimersByTime(450);
      });
      expect(container.querySelector("[data-buffering]")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offline, says so over the poster with Try again, and keeps the profile on the rail", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      await renderFeed();
      act(() => {
        window.dispatchEvent(new Event("offline"));
      });
      expect(await screen.findByText("No connection")).toBeTruthy();
      expect(
        screen
          .getByRole("button", { name: "Try again" })
          .hasAttribute("disabled"),
      ).toBe(true);
      expect(
        screen.getByRole("link", { name: "Open Company 1 profile" }),
      ).toBeTruthy();
    } finally {
      online.mockRestore();
    }
  });
});
