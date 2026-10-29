import { describe, expect, it } from "vitest";

import {
  createRecordingResearchProvider,
  createRecordingTime,
  createReplayResearchProvider,
  createReplayTime,
  createVirtualTime,
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

  // Re-recorded case A: a read the caller had already given up on was kept
  // as read, so the replay read pages live never did and every later
  // request missed.
  it("records a read the caller gave up on as a timeout, not its late pages", async () => {
    const late: PublicWebResearchProvider = {
      ...live,
      extract: (request) =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                pages: request.urls.map((url) => ({
                  url,
                  title: "Late",
                  text: "arrived after the caller stopped waiting",
                })),
                failedUrls: [],
                latencyMs: 30,
              }),
            30,
          );
        }),
    };
    const recording = createRecordingResearchProvider({
      provider: late,
      clock: () => new Date("2026-10-29T12:00:00.000Z"),
    });
    const urls = ["https://www.cbn.gov.ng/slow"];
    await recording.extract({ urls }, { signal: AbortSignal.timeout(5) });
    const fixture = recording.fixture();
    expect(fixture.pages).toEqual([]);
    expect(fixture.extractFailures).toEqual([
      { urls, failureClass: "TIMEOUT" },
    ]);
    const replay = createReplayResearchProvider({ fixture });
    await expect(replay.extract({ urls }, {})).rejects.toMatchObject({
      failureClass: "TIMEOUT",
    });
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
      { kind: "EXTRACT", urls: ["https://www.irs.gov/payments"] },
    ]);
  });

  // Re-recorded case A: replay served pages by URL from anywhere in the
  // recording, so a read live never made was answered. A read is served
  // only as the same request was recorded.
  it("serves a page read per request, never a page recorded under another", async () => {
    const replay = createReplayResearchProvider({ fixture: await recorded() });
    await expect(
      replay.extract(
        { urls: ["https://www.cbn.gov.ng/circulars/payments"] },
        {},
      ),
    ).rejects.toBeInstanceOf(RecordedFixtureMiss);
    expect(replay.misses).toEqual([
      {
        kind: "EXTRACT",
        urls: ["https://www.cbn.gov.ng/circulars/payments"],
      },
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

describe("research record/replay: the schedule", () => {
  /** A deadline raced against a slow call, then a clock reading. */
  async function raced(
    time:
      | ReturnType<typeof createRecordingTime>
      | ReturnType<typeof createReplayTime>,
    call: () => Promise<string>,
  ): Promise<string> {
    const deadline = time.timeout(8_000);
    const winner = await Promise.race([
      time.track("WEB SEARCH slow", call),
      new Promise<string>((resolve) => {
        deadline.signal.addEventListener("abort", () => resolve("timed out"));
      }),
    ]);
    deadline.cancel();
    return `${winner} at ${String(time.now())}`;
  }

  it("replays a deadline that beat a slow call, with the same clock, and no time passing", async () => {
    const clock = createVirtualTime(1_000);
    const recording = createRecordingTime(clock);
    const live = await clock.drive(() =>
      raced(recording, async () => {
        await clock.sleep(30_000);
        return "answered";
      }),
    );
    expect(live).toBe("timed out at 9000");
    const schedule = recording.schedule();
    expect(schedule.begun).toEqual(["TIMER 8000", "WEB SEARCH slow"]);

    const replay = createReplayTime(schedule);
    const again = await replay.drive(() =>
      raced(replay, () => Promise.resolve("answered")),
    );
    expect(again).toBe(live);
    expect(replay.misses).toEqual([]);
  });

  it("names where a replay leaves the recorded schedule", async () => {
    const clock = createVirtualTime(0);
    const recording = createRecordingTime(clock);
    await clock.drive(() =>
      recording.track("WEB SEARCH a", () => Promise.resolve("a")),
    );
    const replay = createReplayTime(recording.schedule());
    await replay.drive(() =>
      replay.track("WEB SEARCH b", () => Promise.resolve("b")),
    );
    expect(replay.misses).toEqual([
      'began "WEB SEARCH b" where the recording began "WEB SEARCH a"',
    ]);
  });
});
