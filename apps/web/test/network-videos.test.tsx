// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { NetworkPitchItemDto } from "@capital-q/contracts";

import * as actions from "../src/features/discover/feed/feed-actions";
import { NetworkVideos } from "../src/features/discover/network/network-videos";

/**
 * Founders' videos (ADR 0021): the server's list as a grid, newest first,
 * a watch view per video, and an honest empty state.
 */

vi.mock("../src/features/discover/feed/feed-actions", () => ({
  loadNetworkPitchesAction: vi.fn(),
}));
vi.mock("../src/features/discover/feed/action-feed-transport", () => ({
  authorisePlaybackViaAction: vi.fn(() =>
    Promise.resolve({
      mediaAssetId: "x",
      playbackUrl: "https://video.example/m.m3u8",
      posterUrl: "https://video.example/p.jpg",
      expiresAt: "2026-09-30T10:00:00.000Z",
    }),
  ),
}));

const item = (n: number): NetworkPitchItemDto => ({
  companyId: `c0000000-0000-4000-8000-00000000000${String(n)}`,
  canonicalName: `Company ${String(n)}`,
  shortDescription: null,
  headquartersCountry: "NG",
  currentStageCode: "seed",
  pitch: {
    mediaAssetId: `f0000000-0000-4000-8000-00000000000${String(n)}`,
    aspectRatio: "9:16",
    durationSeconds: 40,
    captionState: "NOT_REQUESTED",
    title: `Video ${String(n)}`,
  },
  postedAt: "2026-09-28T10:00:00.000Z",
});

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});

afterEach(() => vi.clearAllMocks());

describe("NetworkVideos", () => {
  it("shows the server's videos as tiles, each opening a watch view", async () => {
    vi.mocked(actions.loadNetworkPitchesAction).mockResolvedValue({
      ok: true,
      value: { items: [item(1), item(2)], nextCursor: null },
    });
    render(<NetworkVideos />);
    await waitFor(() =>
      expect(document.querySelectorAll("[data-network-tile]")).toHaveLength(2),
    );
    screen
      .getByRole("button", { name: "Watch Video 1 from Company 1" })
      .click();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Open company" })).toBeTruthy(),
    );
    expect(
      screen.getByRole("link", { name: "Open company" }).getAttribute("href"),
    ).toBe(`/company/${item(1).companyId}`);
  });

  it("says plainly when nobody has shared a video yet", async () => {
    vi.mocked(actions.loadNetworkPitchesAction).mockResolvedValue({
      ok: true,
      value: { items: [], nextCursor: null },
    });
    render(<NetworkVideos />);
    await waitFor(() =>
      expect(screen.getByText(/no founder has shared a video/i)).toBeTruthy(),
    );
  });
});
