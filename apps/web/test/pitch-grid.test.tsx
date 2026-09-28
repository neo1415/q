// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaAssetDto } from "@capital-q/contracts";

import * as actions from "../src/features/pitch/pitch-actions";
import { PitchGrid } from "../src/features/pitch/pitch-grid";

/**
 * Pitch & media as a grid of live videos (ADR 0022): what the server says,
 * newest first, each opening its own page; replaced and deleted videos are
 * not live and are not shown.
 */

vi.mock("../src/features/pitch/pitch-actions", () => ({
  listPitchMediaAction: vi.fn(),
  authorisePitchPlaybackAction: vi.fn(),
}));

const COMPANY = "44444444-0000-4000-8000-000000000001";
const id = (n: number) => `f0000000-0000-4000-8000-00000000000${String(n)}`;

function video(overrides: Partial<MediaAssetDto>): MediaAssetDto {
  return {
    mediaAssetId: id(1),
    purpose: "FOUNDER_PITCH",
    status: "READY",
    durationSeconds: 45,
    aspectRatio: "9:16",
    playbackPolicy: "AUTHORISED",
    captionState: "AVAILABLE",
    transcriptState: "AVAILABLE",
    moderationStatus: "ALLOWED",
    title: null,
    audience: "INVESTORS",
    live: true,
    replacesMediaAssetId: null,
    createdAt: "2026-09-20T09:00:00.000Z",
    readyAt: "2026-09-20T09:05:00.000Z",
    version: 5,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(actions.authorisePitchPlaybackAction).mockResolvedValue({
    ok: true,
    value: {
      mediaAssetId: id(1),
      playbackUrl: "https://video.example/signed/manifest.m3u8",
      posterUrl: "https://video.example/signed/poster.jpg",
      expiresAt: "2026-09-26T10:00:00.000Z",
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PitchGrid", () => {
  it("shows every live video newest first, each linking to its own page, and nothing that is no longer live", async () => {
    vi.mocked(actions.listPitchMediaAction).mockResolvedValue({
      ok: true,
      value: [
        video({ mediaAssetId: id(1), title: "Our pitch" }),
        video({
          mediaAssetId: id(2),
          title: "Product demo",
          audience: "NETWORK",
          createdAt: "2026-09-25T09:00:00.000Z",
        }),
        video({
          mediaAssetId: id(3),
          status: "PROCESSING",
          readyAt: null,
          createdAt: "2026-09-26T09:00:00.000Z",
        }),
        video({ mediaAssetId: id(4), live: false, title: "Replaced take" }),
        video({
          mediaAssetId: id(5),
          live: false,
          status: "DELETED",
          title: "Gone",
        }),
      ],
    });
    render(<PitchGrid companyId={COMPANY} />);
    await waitFor(() =>
      expect(document.querySelectorAll("[data-pitch-tile]")).toHaveLength(3),
    );
    const tiles = [...document.querySelectorAll("[data-pitch-tile]")];
    expect(tiles.map((tile) => tile.getAttribute("href"))).toEqual([
      `/pitch/${id(3)}`,
      `/pitch/${id(2)}`,
      `/pitch/${id(1)}`,
    ]);
    expect(tiles[0]?.textContent).toContain("Processing");
    expect(tiles[1]?.textContent).toContain("Product demo");
    expect(tiles[1]?.textContent).toContain("Everyone");
    expect(tiles[2]?.textContent).toContain("Investors only");
    expect(screen.queryByText("Replaced take")).toBeNull();
    expect(screen.queryByText("Gone")).toBeNull();
    expect(
      screen.getByRole("link", { name: /new video/i }).getAttribute("href"),
    ).toBe("/pitch/new");
  });

  it("offers the first video when there is none, and says why the list could not load", async () => {
    vi.mocked(actions.listPitchMediaAction).mockResolvedValueOnce({
      ok: true,
      value: [],
    });
    const { unmount } = render(<PitchGrid companyId={COMPANY} />);
    await waitFor(() =>
      expect(screen.getByText(/no videos yet/i)).toBeTruthy(),
    );
    expect(screen.getByRole("link", { name: /new video/i })).toBeTruthy();
    unmount();

    vi.mocked(actions.listPitchMediaAction).mockResolvedValueOnce({
      ok: false,
      message: "That company isn't available here.",
    });
    render(<PitchGrid companyId={COMPANY} />);
    await waitFor(() =>
      expect(
        screen.getByText("That company isn't available here."),
      ).toBeTruthy(),
    );
  });
});
