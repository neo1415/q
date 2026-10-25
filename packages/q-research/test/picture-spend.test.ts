import { describe, expect, it } from "vitest";

import {
  createPublicPictureSearch,
  PICTURE_CACHE,
  type PublicImageHit,
  type PublicImageSearchProvider,
} from "../src/application/public-pictures.js";
import { ResearchProviderFailure } from "../src/ports.js";
import type { PublicWebResearchProvider } from "../src/ports.js";
import {
  createCircuitBreaker,
  withCircuitBreaker,
} from "../src/providers/breaker.js";
import { withImageBreaker } from "../src/providers/images.js";

/**
 * Owner's spend rule (2026-10-25): a picture search is paid for once per
 * entity in a while, at most once a run, and a spent SERP key costs nothing
 * for pictures either -- it rests with the web search on the same key.
 */

const ZINO: PublicImageHit = {
  imageUrl: "https://cdn.nairametrics.com/2024/zino-mario.jpg",
  thumbnailUrl: null,
  pageUrl: "https://nairametrics.com/2024/05/zino-aviation-takes-off/",
  title: "Zino Aviation takes off",
};

function index(hits: readonly PublicImageHit[] = [ZINO]) {
  let calls = 0;
  const provider: PublicImageSearchProvider = {
    code: "serper",
    searchImages: () => {
      calls += 1;
      return Promise.resolve(hits);
    },
  };
  return { provider, calls: () => calls };
}

const ask = (runId: string) => ({
  name: "Zino Aviation",
  userText: "Tell me about Zino Aviation",
  runId,
});

describe("picture searches cost what an answer can show", () => {
  it("one entity's pictures are paid for once, then served from the cache", async () => {
    let clock = 0;
    const found = index();
    const search = createPublicPictureSearch({
      provider: found.provider,
      now: () => clock,
    });
    const first = await search.find(ask("run-1"));
    const again = await search.find(ask("run-2"));
    expect(found.calls()).toBe(1);
    expect(again).toEqual(first);
    expect(first).toHaveLength(1);
    clock += PICTURE_CACHE.ttlMs;
    await search.find(ask("run-3"));
    expect(found.calls()).toBe(2);
  });

  it("a run makes at most one image search", async () => {
    const found = index();
    const search = createPublicPictureSearch({ provider: found.provider });
    await search.find(ask("run-1"));
    const other = await search.find({
      name: "Duplo",
      userText: "and Duplo?",
      runId: "run-1",
    });
    expect(found.calls()).toBe(1);
    expect(other).toEqual([]);
  });

  it("a failed search is not kept: the next turn may ask again", async () => {
    let fail = true;
    let calls = 0;
    const search = createPublicPictureSearch({
      provider: {
        code: "serper",
        searchImages: () => {
          calls += 1;
          return fail
            ? Promise.reject(
                new ResearchProviderFailure({
                  providerCode: "serper",
                  failureClass: "UNAVAILABLE",
                }),
              )
            : Promise.resolve([ZINO]);
        },
      },
    });
    expect(await search.find(ask("run-1"))).toEqual([]);
    fail = false;
    expect(await search.find(ask("run-2"))).toHaveLength(1);
    expect(calls).toBe(2);
  });
});

describe("one breaker per key, for web and image search alike", () => {
  it("a SERP key spent on a web search costs nothing for pictures", async () => {
    const breaker = createCircuitBreaker();
    const web: PublicWebResearchProvider = {
      code: "serper",
      search: () =>
        Promise.reject(
          new ResearchProviderFailure({
            providerCode: "serper",
            failureClass: "RATE_LIMIT",
            status: 402,
          }),
        ),
      extract: () => Promise.reject(new Error("not used")),
    };
    const images = index();
    const guardedWeb = withCircuitBreaker(web, { breaker });
    const guardedImages = withImageBreaker(images.provider, breaker);
    await expect(
      guardedWeb.search(
        { query: "zino", maxResults: 6, freshness: "ANY", includeDomains: [] },
        {},
      ),
    ).rejects.toBeDefined();
    await expect(guardedImages.searchImages("zino", {})).rejects.toBeDefined();
    expect(images.calls()).toBe(0);
  });
});
