// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiscoveredCompanyDto, MediaAssetDto } from "@capital-q/contracts";

/**
 * Discover v2's parts (ADR 0047): the progress bar, the speed store, the
 * stall-aware preload budget, the ABR starting estimate, the card's
 * declared facts, and the founder's download switch. Feed-level behaviour
 * (long press, options, keys, buffering, offline) is in the immersive
 * suite.
 */

const setPitchDetailsAction = vi.fn();
vi.mock("../src/features/pitch/pitch-actions", () => ({
  setPitchDetailsAction: (...args: unknown[]) =>
    setPitchDetailsAction(...args) as unknown,
  deletePitchMediaAction: vi.fn(),
}));

const { PitchScrubber, formatTime, seekBy } =
  await import("../src/features/discover/stage/scrubber");
const { stepPlaybackRate, rateLabel } =
  await import("../src/features/discover/stage/playback-rate");
const { linkIsStalling, reportPlaybackStall, resetPlaybackStallsForTests } =
  await import("../src/features/discover/feed/use-feed-budget");
const { startingBandwidthEstimate } =
  await import("../src/features/discover/player/hls-source");
const { evidenceWords, FeedCard } =
  await import("../src/features/discover/feed-card");
const { PitchDetails } = await import("../src/features/pitch/pitch-details");

afterEach(() => {
  cleanup();
  resetPlaybackStallsForTests();
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: undefined,
  });
});

/** A video element with a known duration and a settable position. */
function videoAt(duration: number, at = 0): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "duration", {
    configurable: true,
    get: () => duration,
  });
  video.currentTime = at;
  return video;
}

describe("the progress bar", () => {
  it("says the time as minutes and seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(42.9)).toBe("0:42");
    expect(formatTime(90)).toBe("1:30");
    expect(formatTime(Number.NaN)).toBe("0:00");
  });

  it("seeks within the pitch, never past either end", () => {
    const video = videoAt(60, 58);
    seekBy(video, 5);
    expect(video.currentTime).toBeCloseTo(59.95);
    seekBy(video, -100);
    expect(video.currentTime).toBe(0);
  });

  it("is a keyboard slider whose keys stay its own", () => {
    const video = videoAt(60, 10);
    const onParent = vi.fn();
    render(
      <div onKeyDown={onParent}>
        <PitchScrubber video={video} companyName="Nixo" durationSeconds={60} />
      </div>,
    );
    const slider = screen.getByRole("slider", {
      name: "Position in Nixo's pitch",
    });
    expect(slider.getAttribute("aria-valuemax")).toBe("60");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(video.currentTime).toBe(15);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(video.currentTime).toBe(0);
    expect(onParent).not.toHaveBeenCalled();
  });

  it("thickens and shows the time while dragged, hides the rest, and lands where the finger lets go", () => {
    const video = videoAt(100, 0);
    const scrubbing = vi.fn();
    render(
      <PitchScrubber
        video={video}
        companyName="Nixo"
        durationSeconds={100}
        onScrubbingChange={scrubbing}
      />,
    );
    const slider = screen.getByRole("slider");
    slider.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 28 }) as DOMRect;
    slider.setPointerCapture = () => undefined;
    fireEvent.pointerDown(slider, {
      clientX: 50,
      isPrimary: true,
      pointerId: 1,
    });
    expect(slider.dataset["state"]).toBe("dragging");
    expect(scrubbing).toHaveBeenLastCalledWith(true);
    expect(document.querySelector(".cq-scrubber-readout")).not.toBeNull();
    fireEvent.pointerMove(slider, { clientX: 120, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 120, pointerId: 1 });
    expect(video.currentTime).toBe(60);
    expect(scrubbing).toHaveBeenLastCalledWith(false);
    expect(slider.dataset["state"]).toBe("paused");
  });

  it("is disabled until there is a pitch in view", () => {
    render(<PitchScrubber video={null} companyName="Nixo" />);
    expect(screen.getByRole("slider").getAttribute("aria-disabled")).toBe(
      "true",
    );
  });
});

describe("speed", () => {
  it("steps along 0.5x to 2x and stops at the ends", () => {
    expect(stepPlaybackRate(1, 1)).toBe(1.25);
    expect(stepPlaybackRate(2, 1)).toBe(2);
    expect(stepPlaybackRate(0.5, -1)).toBe(0.5);
    expect(rateLabel(0.75)).toBe("0.75×");
  });
});

describe("a link that keeps stalling (doc 20 §53)", () => {
  it("narrows the preload window after two stalls in half a minute, then lets it widen again", () => {
    const t = 1_000_000;
    reportPlaybackStall(t);
    expect(linkIsStalling(t)).toBe(false);
    reportPlaybackStall(t + 5_000);
    expect(linkIsStalling(t + 5_000)).toBe(true);
    expect(linkIsStalling(t + 40_000)).toBe(false);
  });
});

describe("the first rendition", () => {
  it("starts from the link's own estimate, discounted and bounded; no hint, no guess", () => {
    expect(startingBandwidthEstimate()).toBeNull();
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { downlink: 2.5 },
    });
    expect(startingBandwidthEstimate()).toBe(2_000_000);
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { downlink: 0.1 },
    });
    expect(startingBandwidthEstimate()).toBe(300_000);
  });
});

describe("the card's declared facts", () => {
  const card = (summary: DiscoveredCompanyDto["summary"]) =>
    ({
      companyId: "00000001-0000-4000-8000-000000000000",
      canonicalName: "Nixo",
      websiteUrl: null,
      headquartersCountry: "NG",
      currentStageCode: "seed",
      shortDescription: "Supplier payouts.",
      reasons: [],
      reasonCodes: [],
      pitch: null,
      ...(summary === undefined ? {} : { summary }),
    }) satisfies DiscoveredCompanyDto;

  function renderOpen(company: DiscoveredCompanyDto) {
    render(
      <FeedCard
        company={company}
        policy="ACTIVE"
        reducedMotion={false}
        saved={false}
        deciding={false}
        showMedia={false}
        onSave={() => undefined}
        onPass={() => undefined}
        onAskQ={() => undefined}
        sectorLabels={
          new Map([["a0000000-0000-4000-8000-000000000051", "Fintech"]])
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More about Nixo" }));
  }

  it("names the raise with its evidence axes: the founder's statement, not a verified fact", () => {
    renderOpen(
      card({
        sectorNodeIds: ["a0000000-0000-4000-8000-000000000051"],
        raise: {
          money: { amount: "1500000", currency: "USD" },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
      }),
    );
    const facts = document.querySelector("[data-feed-facts]");
    expect(facts?.textContent).toContain("Fintech");
    expect(facts?.textContent).toContain("USD 1,500,000");
    expect(facts?.textContent).toContain("founder-stated");
  });

  it("says a raise not shared with this reader is unknown, never zero", () => {
    renderOpen(card({ sectorNodeIds: [], raise: null }));
    const facts = document.querySelector("[data-feed-facts]");
    expect(facts?.textContent).toContain("Not shared with you");
    expect(facts?.textContent).not.toMatch(/\b0\b/);
  });

  it("says nothing about facts the API did not send", () => {
    renderOpen(card(undefined));
    expect(document.querySelector("[data-feed-facts]")).toBeNull();
  });

  it("only VERIFIED reads as verified", () => {
    expect(evidenceWords("VERIFIED", "EXTERNALLY_VERIFIED")).toBe("verified");
    expect(evidenceWords("USER_CLAIM", "SELF_REPORTED")).toBe("founder-stated");
    expect(evidenceWords("Q_INFERENCE", "NO_EVIDENCE")).toBe("not verified");
  });
});

describe("the founder's download switch (ADR 0047)", () => {
  const pitch: MediaAssetDto = {
    mediaAssetId: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    purpose: "FOUNDER_PITCH",
    status: "READY",
    durationSeconds: 90,
    aspectRatio: "9:16",
    playbackPolicy: "AUTHORISED",
    captionState: "NOT_REQUESTED",
    transcriptState: "NOT_REQUESTED",
    moderationStatus: "ALLOWED",
    title: "Seed pitch",
    audience: "INVESTORS",
    downloadable: false,
    live: true,
    replacesMediaAssetId: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    readyAt: "2026-10-01T09:05:00.000Z",
    version: 3,
  };

  it("is off by default, says what off means, and saves the moment it is flipped", async () => {
    setPitchDetailsAction.mockResolvedValue({
      ok: true,
      value: { ...pitch, downloadable: true, version: 4 },
    });
    const onSaved = vi.fn();
    render(
      <PitchDetails
        companyId="00000001-0000-4000-8000-000000000000"
        pitch={pitch}
        onSaved={onSaved}
        onDeleted={() => undefined}
      />,
    );
    const toggle = screen.getByRole("switch", {
      name: "Let investors download my pitch",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/can't save a copy/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(setPitchDetailsAction).toHaveBeenCalledWith(
      "00000001-0000-4000-8000-000000000000",
      pitch.mediaAssetId,
      { title: "Seed pitch", audience: "INVESTORS", downloadable: true },
      3,
    );
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("true"),
    );
    expect(onSaved).toHaveBeenCalled();
    expect(screen.getByText(/can now download it/)).toBeTruthy();
  });
});

describe("the caption scrim's contrast guard (ADR 0047)", () => {
  it("never puts less than 62% stage canvas under text over the pitch", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const css = await readFile(
      join(import.meta.dirname, "../app/globals.css"),
      "utf8",
    );
    const floors = [
      ...css.matchAll(
        /--cq-feed-scrim-floor:\s*color-mix\(\s*in oklch,\s*var\(--cq-stage-canvas\)\s*(\d+)%/g,
      ),
    ].map((match) => Number(match[1]));
    // For you and Your companies each declare it.
    expect(floors.length).toBeGreaterThanOrEqual(2);
    for (const floor of floors) expect(floor).toBeGreaterThanOrEqual(62);
    // White over (floor × canvas + rest × white), on a pure white frame:
    // ≥ 4.5:1 needs the backing's sRGB value ≤ 0.454, i.e. a floor ≥ 58%.
    const canvas = 0.06;
    const value = Math.min(...floors) / 100;
    const backing = value * canvas + (1 - value);
    const luminance = ((backing + 0.055) / 1.055) ** 2.4;
    expect((0.96 + 0.05) / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
