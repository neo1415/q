import { describe, expect, it } from "vitest";

import {
  createPublicPictureSearch,
  type PublicImageHit,
  type PublicImageSearchProvider,
} from "../src/application/public-pictures.js";
import { ResearchProviderFailure } from "../src/ports.js";
import {
  createDetectingImageSearch,
  createSerpApiImageSearch,
  createSerperImageSearch,
} from "../src/providers/images.js";

/**
 * Pictures of a named company or person from public pages (owner
 * 2026-10-23): only the name the person said leaves, a picture is kept only
 * from a page that names them, over https, one a site.
 */

function index(hits: readonly PublicImageHit[]) {
  const queries: string[] = [];
  const provider: PublicImageSearchProvider = {
    code: "serper",
    searchImages: (query) => {
      queries.push(query);
      return Promise.resolve(hits);
    },
  };
  return { provider, queries };
}

const ZINO: PublicImageHit = {
  imageUrl: "https://cdn.nairametrics.com/2024/zino-mario.jpg",
  thumbnailUrl: "https://encrypted-tbn0.gstatic.com/images?q=1",
  pageUrl: "https://nairametrics.com/2024/05/interview-captain-zino-mario/",
  title: "Interview: Captain Zino Mario on Zino Aviation",
};

describe("public pictures of who a turn names", () => {
  it("searches the name they said and keeps pictures from pages that name them", async () => {
    const found = index([
      ZINO,
      {
        imageUrl: "https://zinoaviation.com/hero.jpg",
        thumbnailUrl: null,
        pageUrl: "https://zinoaviation.com/",
        title: "Zino Aviation | Charter flights",
      },
    ]);
    const search = createPublicPictureSearch({ provider: found.provider });
    const pictures = await search.find({
      name: "Zino Aviation",
      userText: "Tell me about Zino Aviation and its team",
    });
    expect(found.queries).toEqual(["zino aviation"]);
    // Their own site first, then the rest in the index's order.
    expect(pictures.map((p) => p.domain)).toEqual([
      "zinoaviation.com",
      "nairametrics.com",
    ]);
    expect(pictures[1]?.pageUrl).toBe(ZINO.pageUrl);
  });

  it("never searches a name that is not wholly the person's own words", async () => {
    const found = index([ZINO]);
    const search = createPublicPictureSearch({ provider: found.provider });
    expect(
      await search.find({ name: "Zino Aviation", userText: "who are they?" }),
    ).toEqual([]);
    expect(found.queries).toEqual([]);
  });

  it("leaves out a namesake's page, plain http, a private host and a second picture from one site", async () => {
    const found = index([
      { ...ZINO, title: "Mario Kart release dates" },
      { ...ZINO, imageUrl: "http://example.com/a.jpg", thumbnailUrl: null },
      { ...ZINO, pageUrl: "https://127.0.0.1/zino-aviation" },
      ZINO,
      { ...ZINO, imageUrl: "https://cdn.nairametrics.com/other.jpg" },
    ]);
    const search = createPublicPictureSearch({ provider: found.provider });
    const pictures = await search.find({
      name: "Zino Aviation",
      userText: "Zino Aviation",
    });
    expect(pictures).toHaveLength(1);
    expect(pictures[0]?.imageUrl).toBe(ZINO.imageUrl);
  });

  it("leaves out design galleries, stock libraries and search pages (production 2026-10-23)", async () => {
    const shot = (
      pageUrl: string,
      imageUrl = "https://cdn.example.com/a.png",
    ) => ({
      imageUrl,
      thumbnailUrl: null,
      pageUrl,
      title: "Flutterwave",
    });
    const found = index([
      shot("https://dribbble.com/shots/123-flutterwave"),
      shot("https://www.behance.net/gallery/1/flutterwave"),
      shot("https://www.pinterest.com/pin/1/"),
      shot("https://www.shutterstock.com/search/flutterwave"),
      shot("https://techcabal.com/search?q=flutterwave"),
      shot(
        "https://techcabal.com/2026/10/20/flutterwave/",
        "https://cdn.dribbble.com/userupload/1.png",
      ),
      shot("https://techcrunch.com/2026/06/17/flutterwave-ma/"),
    ]);
    const search = createPublicPictureSearch({ provider: found.provider });
    const pictures = await search.find({
      name: "Flutterwave",
      userText: "Find the latest news on Flutterwave",
    });
    expect(pictures.map((p) => p.domain)).toEqual(["techcrunch.com"]);
  });

  it("prefers their own site, then Wikipedia and LinkedIn, then the rest", async () => {
    const at = (pageUrl: string) => ({
      imageUrl: `${pageUrl}photo.jpg`,
      thumbnailUrl: null,
      pageUrl,
      title: "Zino Aviation",
    });
    const found = index([
      at("https://punchng.com/"),
      at("https://en.wikipedia.org/"),
      at("https://www.zinoaviation.com/"),
    ]);
    const search = createPublicPictureSearch({ provider: found.provider });
    const pictures = await search.find({
      name: "Zino Aviation",
      userText: "Zino Aviation",
      max: 3,
    });
    expect(pictures.map((p) => p.domain)).toEqual([
      "zinoaviation.com",
      "en.wikipedia.org",
      "punchng.com",
    ]);
  });

  it("matches a person's page without their title", async () => {
    const found = index([
      {
        imageUrl: "https://cdn.nairametrics.com/zino.jpg",
        thumbnailUrl: null,
        pageUrl: "https://nairametrics.com/2024/05/zino-mario/",
        title: "Zino Mario on building Zino Aviation",
      },
    ]);
    const search = createPublicPictureSearch({ provider: found.provider });
    const pictures = await search.find({
      name: "Captain Zino Mario",
      userText: "Who is Captain Zino Mario?",
    });
    expect(pictures).toHaveLength(1);
  });

  it("is no pictures, never an error, when the index fails", async () => {
    const search = createPublicPictureSearch({
      provider: {
        code: "serper",
        searchImages: () =>
          Promise.reject(
            new ResearchProviderFailure({
              providerCode: "serper",
              failureClass: "UNAVAILABLE",
            }),
          ),
      },
    });
    expect(
      await search.find({ name: "Zino Aviation", userText: "Zino Aviation" }),
    ).toEqual([]);
  });
});

describe("image results behind the port", () => {
  const respond = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

  it("maps Serper's images and SerpApi's images_results to hits", async () => {
    const serper = createSerperImageSearch({
      apiKey: "k".repeat(32),
      fetch: () =>
        respond({
          images: [
            {
              title: ZINO.title,
              imageUrl: ZINO.imageUrl,
              thumbnailUrl: ZINO.thumbnailUrl,
              link: ZINO.pageUrl,
            },
            { title: "no link", imageUrl: "https://x.example/a.jpg" },
          ],
        }),
    });
    expect(await serper.searchImages("zino aviation", {})).toEqual([ZINO]);
    const serpapi = createSerpApiImageSearch({
      apiKey: "k".repeat(32),
      fetch: () =>
        respond({
          images_results: [
            {
              title: ZINO.title,
              original: ZINO.imageUrl,
              thumbnail: ZINO.thumbnailUrl,
              link: ZINO.pageUrl,
            },
          ],
        }),
    });
    expect(await serpapi.searchImages("zino aviation", {})).toEqual([ZINO]);
  });

  it("moves to SerpApi when Serper refuses the key, and keeps it", async () => {
    const asked: string[] = [];
    const detecting = createDetectingImageSearch({
      apiKey: "k".repeat(32),
      fetch: (input) => {
        const url = input instanceof Request ? input.url : input.toString();
        asked.push(new URL(url).host);
        return url.includes("serper")
          ? respond({}, 401)
          : respond({ images_results: [] });
      },
    });
    await detecting.searchImages("zino aviation", {});
    await detecting.searchImages("zino aviation", {});
    expect(asked).toEqual(["google.serper.dev", "serpapi.com", "serpapi.com"]);
    expect(detecting.code).toBe("serpapi");
  });
});
