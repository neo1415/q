import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P9: posters for a grid in one action. Each tile is still authorised for
 * this viewer on its own (a refused tile is simply absent); only the round
 * trips are shared.
 */

const authorisePitchPlayback = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@capital-q/api-client", () => ({
  authorisePitchPlayback: (...args: unknown[]) =>
    authorisePitchPlayback(...args) as unknown,
  authorisePitchDownload: vi.fn(),
}));
const apiSession = vi.fn();
vi.mock("../src/features/q/context", () => ({
  apiSession: () => apiSession() as unknown,
}));

const { authorisePostersAction } =
  await import("../src/features/discover/feed/playback-source");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const COMPANY = "44444444-4444-4444-8444-444444444444";
const session = { baseUrl: "https://api.example", accessToken: "t" };

beforeEach(() => {
  authorisePitchPlayback.mockReset();
  apiSession.mockReset();
  apiSession.mockResolvedValue(session);
});

describe("authorisePostersAction", () => {
  it("authorises each tile for this viewer and keeps only granted posters", async () => {
    authorisePitchPlayback.mockImplementation(
      (_s: unknown, _company: string, asset: string) =>
        asset === A
          ? Promise.resolve({ posterUrl: "https://cdn.example/a.jpg" })
          : asset === B
            ? Promise.resolve({ posterUrl: null })
            : Promise.reject(new Error("refused")),
    );
    const posters = await authorisePostersAction([
      { companyId: COMPANY, mediaAssetId: A },
      { companyId: COMPANY, mediaAssetId: B },
      { companyId: COMPANY, mediaAssetId: C },
    ]);
    expect(posters).toEqual({ [A]: "https://cdn.example/a.jpg" });
    expect(authorisePitchPlayback).toHaveBeenCalledTimes(3);
    expect(authorisePitchPlayback).toHaveBeenCalledWith(session, COMPANY, A);
  });

  it("refuses malformed or oversized batches without asking anything", async () => {
    expect(
      await authorisePostersAction([{ companyId: "nope", mediaAssetId: A }]),
    ).toEqual({});
    const many = Array.from({ length: 25 }, () => ({
      companyId: COMPANY,
      mediaAssetId: A,
    }));
    expect(await authorisePostersAction(many)).toEqual({});
    expect(authorisePitchPlayback).not.toHaveBeenCalled();
  });

  it("asks nothing when signed out", async () => {
    apiSession.mockResolvedValue(null);
    expect(
      await authorisePostersAction([{ companyId: COMPANY, mediaAssetId: A }]),
    ).toEqual({});
    expect(authorisePitchPlayback).not.toHaveBeenCalled();
  });
});
