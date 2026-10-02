import { describe, expect, it, vi } from "vitest";

vi.mock("../src/features/pitch/pitch-actions", () => ({
  deletePitchMediaAction: vi.fn(),
  setPitchDetailsAction: vi.fn(),
}));

const { detailsFor, sharingOf } =
  await import("../src/features/pitch/pitch-details");

/**
 * Who can watch a pitch is ONE choice (live 2026-10-02, Nixo: "Everyone
 * on Capital Q" with playback still private, so nobody could watch).
 */
describe("who can watch a pitch", () => {
  it("reads a private pitch as 'only my organisation', whatever audience it keeps", () => {
    expect(sharingOf({ playbackPolicy: "PRIVATE", audience: "NETWORK" })).toBe(
      "ORGANISATION",
    );
    expect(
      sharingOf({ playbackPolicy: "AUTHORISED", audience: "NETWORK" }),
    ).toBe("NETWORK");
    expect(
      sharingOf({ playbackPolicy: "AUTHORISED", audience: "INVESTORS" }),
    ).toBe("INVESTORS");
  });

  it("writes an investor-facing choice as playable, and 'only my organisation' as private", () => {
    expect(detailsFor("NETWORK", "INVESTORS")).toEqual({
      audience: "NETWORK",
      playbackPolicy: "AUTHORISED",
    });
    expect(detailsFor("INVESTORS", "NETWORK")).toEqual({
      audience: "INVESTORS",
      playbackPolicy: "AUTHORISED",
    });
    expect(detailsFor("ORGANISATION", "NETWORK")).toEqual({
      audience: "NETWORK",
      playbackPolicy: "PRIVATE",
    });
  });
});
