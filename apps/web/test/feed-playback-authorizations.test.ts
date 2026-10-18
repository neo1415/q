import { describe, expect, it, vi } from "vitest";

import type { PlaybackAuthorizationDto } from "@capital-q/contracts";

import { feedPlaybackAuthorizations } from "../src/features/discover/feed/playback-authorizations";

/**
 * One feed's playback authorizations (UX-05; spec §9.5).
 *
 * The poster warmer, the buffering slot and the playing slot all want the
 * same company's authorization within a few swipes. These pin that they
 * share one answer while it is usable, and that nothing about the cache
 * lets a refusal, an expired URL or another company's grant through.
 */

const NOW = Date.parse("2026-09-26T08:00:00Z");

function grant(
  mediaAssetId: string,
  minutesLeft: number,
  tag = "a",
): PlaybackAuthorizationDto {
  return {
    mediaAssetId,
    playbackUrl: `https://cdn.test/${mediaAssetId}/${tag}.m3u8`,
    posterUrl: `https://cdn.test/${mediaAssetId}/${tag}.jpg`,
    expiresAt: new Date(NOW + minutesLeft * 60_000).toISOString(),
  };
}

describe("feed playback authorizations", () => {
  it("asks the server once for a company's pitch and shares the answer", async () => {
    const authorise = vi.fn((_: string, asset: string) =>
      Promise.resolve(grant(asset, 10)),
    );
    const cache = feedPlaybackAuthorizations(authorise, { now: () => NOW });

    const [first, second] = await Promise.all([
      cache.sourceFor("company-1")("asset-1"),
      cache.sourceFor("company-1")("asset-1"),
    ]);
    const third = await cache.sourceFor("company-1")("asset-1");

    expect(authorise).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("gives each company a stable source", () => {
    const cache = feedPlaybackAuthorizations(vi.fn(), { now: () => NOW });
    expect(cache.sourceFor("company-1")).toBe(cache.sourceFor("company-1"));
    expect(cache.sourceFor("company-1")).not.toBe(cache.sourceFor("company-2"));
  });

  it("never answers one company with another's grant for the same asset id", async () => {
    const authorise = vi.fn((company: string, asset: string) =>
      Promise.resolve(grant(asset, 10, company)),
    );
    const cache = feedPlaybackAuthorizations(authorise, { now: () => NOW });

    const one = await cache.sourceFor("company-1")("asset-x");
    const two = await cache.sourceFor("company-2")("asset-x");

    expect(authorise).toHaveBeenCalledTimes(2);
    expect(two.playbackUrl).not.toBe(one.playbackUrl);
  });

  it("asks again once the held grant is inside the expiry margin", async () => {
    let now = NOW;
    const authorise = vi
      .fn<
        (company: string, asset: string) => Promise<PlaybackAuthorizationDto>
      >()
      .mockResolvedValueOnce(grant("asset-1", 1, "old"))
      .mockResolvedValueOnce(grant("asset-1", 10, "new"));
    const cache = feedPlaybackAuthorizations(authorise, { now: () => now });

    await cache.sourceFor("company-1")("asset-1");
    now = NOW + 45_000; // 15 s left: inside the 30 s margin.
    const fresh = await cache.sourceFor("company-1")("asset-1");

    expect(authorise).toHaveBeenCalledTimes(2);
    expect(fresh.playbackUrl).toContain("new");
  });

  it("does not hold a refusal: the next ask asks the server again", async () => {
    const authorise = vi
      .fn<
        (company: string, asset: string) => Promise<PlaybackAuthorizationDto>
      >()
      .mockRejectedValueOnce(new Error("not allowed"))
      .mockResolvedValueOnce(grant("asset-1", 10));
    const cache = feedPlaybackAuthorizations(authorise, { now: () => NOW });

    await expect(cache.sourceFor("company-1")("asset-1")).rejects.toThrow(
      "not allowed",
    );
    await expect(cache.sourceFor("company-1")("asset-1")).resolves.toEqual(
      grant("asset-1", 10),
    );
    expect(authorise).toHaveBeenCalledTimes(2);
  });

  it("starts from the grant the server read for the first card", async () => {
    const authorise = vi.fn();
    const seeded = grant("asset-1", 10, "ssr");
    const cache = feedPlaybackAuthorizations(authorise, {
      seed: [{ companyId: "company-1", authorization: seeded }],
      now: () => NOW,
    });

    await expect(cache.sourceFor("company-1")("asset-1")).resolves.toBe(seeded);
    expect(authorise).not.toHaveBeenCalled();
  });
});
