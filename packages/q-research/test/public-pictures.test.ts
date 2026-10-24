import { describe, expect, it } from "vitest";

import {
  createPublicPictureSearch,
  subjectRank,
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
      // A stock or download CDN image embedded on another page.
      shot(
        "https://blog.example.com/flutterwave",
        "https://t3.ftcdn.net/jpg/01/flutterwave.jpg",
      ),
      shot(
        "https://news.example.com/flutterwave",
        "https://images.sftcdn.net/images/flutterwave.png",
      ),
      shot("https://flutterwave.en.softonic.com/android"),
      shot("https://techcrunch.com/2026/06/17/flutterwave-ma/"),
    ]);
    const search = createPublicPictureSearch({ provider: found.provider });
    const pictures = await search.find({
      name: "Flutterwave",
      userText: "Find the latest news on Flutterwave",
    });
    expect(pictures.map((p) => p.domain)).toEqual(["techcrunch.com"]);
  });

  it("shows one image once, even when two of their sites carry it", async () => {
    const photo = "https://static.wixstatic.com/media/zino.jpg";
    const found = index([
      {
        imageUrl: `${photo}?w=980`,
        thumbnailUrl: null,
        pageUrl: "https://academy.zinoaviation.com/post/pilots",
        title: "Zino Aviation",
      },
      {
        imageUrl: `${photo}?w=600`,
        thumbnailUrl: null,
        pageUrl: "https://www.zinoaviation.com/about",
        title: "Zino Aviation",
      },
    ]);
    const search = createPublicPictureSearch({ provider: found.provider });
    const pictures = await search.find({
      name: "Zino Aviation",
      userText: "Tell me about Zino Aviation",
    });
    expect(pictures).toHaveLength(1);
  });

  // Owner 2026-10-24 (QO-33): Zino Aviation's own site gave a cabin-crew
  // marketing shot. Their logo, then their people, then their product;
  // generic marketing imagery last.
  it("shows a site's best picture of them: logo, then people, then product, marketing last", async () => {
    const own = (path: string, title: string) => ({
      imageUrl: `https://jet.zinoaviation.com/assets/img/${path}`,
      thumbnailUrl: null,
      pageUrl: "https://jet.zinoaviation.com/",
      title,
    });
    const pick = async (hits: PublicImageHit[]) => {
      const found = index(hits);
      const search = createPublicPictureSearch({ provider: found.provider });
      return (
        await search.find({
          name: "Zino Aviation",
          userText: "Tell me about Zino Aviation",
        })
      ).map((p) => p.imageUrl.split("/").at(-1));
    };
    expect(
      await pick([
        own("crew-cabin-welcome.jpeg", "Zino Aviation cabin crew member"),
        own("zino-logo.png", "Zino Aviation"),
      ]),
    ).toEqual(["zino-logo.png"]);
    expect(
      await pick([
        own("hero-banner.jpg", "Zino Aviation"),
        own("ceo-portrait.jpg", "Zino Aviation CEO"),
      ]),
    ).toEqual(["ceo-portrait.jpg"]);
    // Nothing better: the one they have still shows.
    expect(
      await pick([own("crew-cabin-welcome.jpeg", "Zino Aviation cabin crew")]),
    ).toEqual(["crew-cabin-welcome.jpeg"]);
  });

  it("orders by what a picture shows, never whether it is shown", () => {
    const rank = (imageUrl: string, title: string) =>
      subjectRank({ imageUrl, title });
    expect(rank("https://a.example/x/logo.png", "Acme")).toBe(0);
    expect(rank("https://a.example/x/1.jpg", "Acme founders")).toBe(1);
    expect(rank("https://a.example/x/app-screenshot.png", "Acme")).toBe(2);
    expect(rank("https://a.example/x/1.jpg", "Acme")).toBe(3);
    expect(rank("https://a.example/x/hero-banner.jpg", "Acme app")).toBe(4);
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

  it("asks with their organisation, and keeps its pages about them (live 2026-10-23)", async () => {
    const found = index([
      {
        imageUrl: "https://mariowiki.com/captain.png",
        thumbnailUrl: null,
        pageUrl: "https://www.mariowiki.com/Captain_Toad",
        title: "Mario encountering Captain Toad",
      },
      {
        imageUrl: "https://cdn.nairametrics.com/zino-ceo.jpg",
        thumbnailUrl: null,
        pageUrl: "https://nairametrics.com/2026/07/19/zino-aviation-ceo/",
        title: "Zino Aviation CEO",
      },
    ]);
    const search = createPublicPictureSearch({ provider: found.provider });
    const pictures = await search.find({
      name: "Captain Zino Mario",
      organisation: "Zino Aviation",
      userText: "Who is Captain Zino Mario?",
    });
    expect(found.queries).toEqual(["captain zino mario zino aviation"]);
    expect(pictures.map((p) => p.domain)).toEqual(["nairametrics.com"]);
  });

  it("reads the page's address when the title is empty or a file name, and names a hyphenated surname (live 2026-10-23)", async () => {
    const found = index([
      {
        imageUrl: "https://global.ariseplay.com/amg/thisdaylive/zino.jpg",
        thumbnailUrl: null,
        pageUrl:
          "https://www.thisdaylive.com/index.php/2022/09/09/zino-aviation-takes-off-with-pilot-masterclass/",
        title: null,
      },
      {
        imageUrl: "https://static.wixstatic.com/media/ad758c_7d.jpg",
        thumbnailUrl: null,
        pageUrl: "https://zinoaviation.com/",
        title: "2298efc2-37a3-4e9b-a295-93837c2a8400.jpg",
      },
      {
        imageUrl: "https://cdn.zoominfo.com/zino.jpg",
        thumbnailUrl: null,
        pageUrl: "https://www.zoominfo.com/p/zino/10649437180",
        title: "Zino Mario-Ghae, Chief Executive Officer",
      },
    ]);
    const search = createPublicPictureSearch({ provider: found.provider });
    const pictures = await search.find({
      name: "Captain Zino Mario",
      organisation: "Zino Aviation",
      userText: "Who is Captain Zino Mario?",
      max: 3,
    });
    expect(pictures.map((p) => p.domain).sort()).toEqual([
      "thisdaylive.com",
      "zinoaviation.com",
      "zoominfo.com",
    ]);
    // A file name is no description: the alt says whose and from where.
    expect(pictures.find((p) => p.domain === "zinoaviation.com")?.title).toBe(
      "Zino Aviation, from zinoaviation.com",
    );
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
