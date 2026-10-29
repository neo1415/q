import { describe, expect, it } from "vitest";

import {
  createRecordingResearchProvider,
  createReplayResearchProvider,
  RecordedFixtureMiss,
  RecordedResearchFixtureSchema,
  recordedSearchKey,
} from "../src/providers/recorded.js";
import {
  ResearchProviderFailure,
  type PublicWebResearchProvider,
} from "../src/ports.js";

/**
 * The acceptance gate's record/replay providers (owner 2026-10-29): what
 * is recorded is only what the provider returned; replay fails loudly on
 * a query or page it does not hold.
 */

const live: PublicWebResearchProvider = {
  code: "brave",
  search: (request) =>
    request.query.includes("down")
      ? Promise.reject(
          new ResearchProviderFailure({
            providerCode: "brave",
            failureClass: "RATE_LIMIT",
          }),
        )
      : Promise.resolve({
          hits: [
            // A vendor that returns more than the contract: the extra
            // field must not reach the fixture.
            Object.assign(
              {
                url: "https://www.cbn.gov.ng/circulars/payments",
                title: "Circular",
                snippet: "Payment service providers must be licensed.",
                publishedAt: "2026-01-02",
                relevance: 0.9,
              },
              { raw: "vendor-internal-payload" },
            ),
          ],
          latencyMs: 12,
        }),
  extract: (request) =>
    Promise.resolve({
      pages: request.urls
        .filter((url) => url.includes("cbn"))
        .map((url) => ({
          url,
          title: "Circular",
          text: "14 operators were licensed as of 2026.",
        })),
      failedUrls: request.urls.filter((url) => !url.includes("cbn")),
      latencyMs: 30,
    }),
};

const search = (query: string) => ({
  query,
  maxResults: 5,
  freshness: "ANY" as const,
  includeDomains: [],
});

async function recorded() {
  const recording = createRecordingResearchProvider({
    provider: live,
    clock: () => new Date("2026-10-29T12:00:00.000Z"),
  });
  await recording.search(search("Nigeria  CBN payments circular"), {});
  await recording
    .search(search("down nigeria payments"), {})
    .catch(() => undefined);
  await recording.extract(
    {
      urls: [
        "https://www.cbn.gov.ng/circulars/payments",
        "https://blocked.example.com/a",
      ],
    },
    {},
  );
  return recording.fixture();
}

describe("research record/replay (acceptance gate)", () => {
  it("normalises a query's case and spacing, and keeps domains apart", () => {
    expect(recordedSearchKey({ query: " Nigeria  CBN " })).toBe("nigeria cbn");
    expect(
      recordedSearchKey({ query: "cbn", includeDomains: ["B.ng", "a.ng"] }),
    ).toBe("cbn @a.ng,b.ng");
  });

  it("records only what the provider returned, failures included", async () => {
    const fixture = await recorded();
    expect(RecordedResearchFixtureSchema.parse(fixture)).toEqual(fixture);
    expect(JSON.stringify(fixture)).not.toContain("vendor-internal-payload");
    expect(fixture.searches.map((one) => one.key)).toEqual([
      "nigeria cbn payments circular",
      "down nigeria payments",
    ]);
    expect(fixture.searches[1]?.failure).toEqual({
      failureClass: "RATE_LIMIT",
    });
    expect(fixture.pages).toHaveLength(1);
    expect(fixture.failedUrls).toEqual(["https://blocked.example.com/a"]);
  });

  it("replays by normalised query, without the network", async () => {
    const replay = createReplayResearchProvider({ fixture: await recorded() });
    const result = await replay.search(
      search("nigeria cbn PAYMENTS circular"),
      {},
    );
    expect(result.hits[0]?.url).toBe(
      "https://www.cbn.gov.ng/circulars/payments",
    );
    await expect(
      replay.search(search("down nigeria payments"), {}),
    ).rejects.toBeInstanceOf(ResearchProviderFailure);
    const pages = await replay.extract(
      {
        urls: [
          "https://www.cbn.gov.ng/circulars/payments",
          "https://blocked.example.com/a",
        ],
      },
      {},
    );
    expect(pages.pages[0]?.text).toContain("14 operators");
    expect(pages.failedUrls).toEqual(["https://blocked.example.com/a"]);
    expect(replay.misses).toEqual([]);
  });

  it("fails loudly on a query or page the recording does not hold", async () => {
    const replay = createReplayResearchProvider({ fixture: await recorded() });
    // A code change that lost the country: not silently answered.
    await expect(
      replay.search(search("payments circular"), {}),
    ).rejects.toBeInstanceOf(RecordedFixtureMiss);
    await expect(
      replay.extract({ urls: ["https://www.irs.gov/payments"] }, {}),
    ).rejects.toThrow(/not in the recorded fixture/u);
    expect(replay.misses).toEqual([
      { kind: "SEARCH", key: "payments circular" },
      { kind: "PAGE", url: "https://www.irs.gov/payments" },
    ]);
  });

  it("in EMPTY mode a miss returns nothing and is still counted", async () => {
    const replay = createReplayResearchProvider({
      fixture: await recorded(),
      onMiss: "EMPTY",
    });
    expect((await replay.search(search("something new"), {})).hits).toEqual([]);
    expect(replay.misses).toHaveLength(1);
  });
});
