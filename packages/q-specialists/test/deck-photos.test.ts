import { describe, expect, it } from "vitest";

import type { QArtifactContent } from "@capital-q/contracts";

import { illustrateDeck, type StockPhotoPort } from "../src/index.js";

/** Photos for a deck (founder direction 2026-09-29): decoration, never a failure. */

const content = {
  sections: [
    { heading: "Company", body: "Yamfield Agro processes yams.", findings: [] },
  ],
  gaps: [],
  deck: {
    slides: [
      {
        layout: "TITLE",
        title: "Yamfield Agro",
        bullets: [],
        bulletsRight: [],
        section: 0,
      },
      {
        layout: "BULLETS",
        title: "Product",
        bullets: ["Yam flour."],
        bulletsRight: [],
        section: 0,
      },
      {
        layout: "CHART",
        title: "Traction",
        bullets: [],
        bulletsRight: [],
        section: 0,
      },
    ],
    direction: "MINIMAL_INSTITUTIONAL",
    markIsDraft: false,
  },
} as unknown as QArtifactContent;

const photo = (n: number) => ({
  url: `https://images.pexels.com/photos/${n}/a.jpeg`,
  alt: `photo ${n}`,
  credit: "Photo by A on Pexels",
});

describe("illustrateDeck", () => {
  it("puts distinct photos on the cover and bullet slides only, from the deck's own words", async () => {
    const queries: string[] = [];
    let n = 0;
    const photos: StockPhotoPort = {
      search: (query) => {
        queries.push(query);
        n += 1;
        return Promise.resolve([photo(1), photo(n + 1)]);
      },
    };
    const out = await illustrateDeck(content, photos);
    const slides = out.deck?.slides ?? [];
    expect(slides[0]?.image?.url).toBe(photo(1).url);
    expect(slides[1]?.image?.url).not.toBe(photo(1).url);
    expect(slides[2]?.image).toBeUndefined();
    expect(queries[0]).toContain("Yamfield");
    expect(queries[1]).toContain("Product");
  });

  it("returns the deck unchanged when search fails", async () => {
    const photos: StockPhotoPort = {
      search: () => Promise.reject(new Error("down")),
    };
    expect(await illustrateDeck(content, photos)).toBe(content);
  });
});
