import { describe, expect, it } from "vitest";

import { createPexelsPictureProvider } from "../src/images/stock.js";
import {
  namesReadByRun,
  pictureBlock,
  type QPictureBlock,
  type QPicturePort,
} from "../src/q/result-blocks.js";

/**
 * L-13 (owner ask 2026-10-20): a credited picture when the analyst asks for
 * one. The model chooses the kind and proposes words; the port decides what
 * may leave, and whatever comes back must satisfy the public contract.
 */

const PICTURE: QPictureBlock = {
  kind: "PICTURE",
  url: "https://images.pexels.com/photos/1/pexels-photo-1.jpeg",
  alt: "A baobab tree at dusk",
  credit: { name: "Ada Obi", url: "https://www.pexels.com/@ada-obi" },
  source: "PEXELS",
  pageUrl: "https://www.pexels.com/photo/baobab-1/",
};

type Asked = Parameters<QPicturePort["find"]>[0];

function fakePort(answer: (asked: Asked) => Promise<QPictureBlock | null>): {
  readonly port: QPicturePort;
  readonly asked: Asked[];
} {
  const asked: Asked[] = [];
  return {
    asked,
    port: {
      find: (input) => {
        asked.push(input);
        return answer(input);
      },
    },
  };
}

const PERSON = {
  userText: "What does a baobab tree look like?",
  earlierUserText: ["We sell shea butter from northern Ghana"],
};

describe("pictureBlock", () => {
  it("asks the port with the model's words and the person's own words", async () => {
    const { port, asked } = fakePort(() => Promise.resolve(PICTURE));
    const block = await pictureBlock({
      result: { visual: "PICTURE", pictureQuery: "  baobab tree  " },
      pictures: port,
      ...PERSON,
    });
    expect(block).toEqual(PICTURE);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.requestedQuery).toBe("baobab tree");
    expect(asked[0]?.userText).toBe(PERSON.userText);
    expect(asked[0]?.earlierUserText).toEqual(PERSON.earlierUserText);
    // No names given: nothing withheld, but always a list for the port.
    expect(asked[0]?.withheld).toEqual([]);
    expect(asked[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does nothing unless PICTURE was asked for with words and a port exists", async () => {
    const { port, asked } = fakePort(() => Promise.resolve(PICTURE));
    for (const result of [
      { visual: "MAP", pictureQuery: "baobab tree" },
      { visual: null, pictureQuery: "baobab tree" },
      { visual: "PICTURE", pictureQuery: null },
      { visual: "PICTURE", pictureQuery: "   " },
      // A reply is no one to picture (production 2026-10-23: "Yes" drew a
      // stock '"yes" lettering' image).
      { visual: "PICTURE", pictureQuery: "Yes" },
      { visual: "PICTURE", pictureQuery: "sure, thanks!" },
    ]) {
      expect(await pictureBlock({ result, pictures: port, ...PERSON })).toBe(
        null,
      );
    }
    expect(asked).toHaveLength(0);
    expect(
      await pictureBlock({
        result: { visual: "PICTURE", pictureQuery: "baobab" },
        pictures: undefined,
        ...PERSON,
      }),
    ).toBeNull();
  });

  it("is no picture when the port refuses, fails or returns another host", async () => {
    const result = { visual: "PICTURE", pictureQuery: "baobab tree" };
    for (const answer of [
      () => Promise.resolve(null),
      () => Promise.reject(new Error("offline")),
      () =>
        Promise.resolve({
          ...PICTURE,
          url: "https://tracker.example.com/pixel.gif",
        }),
    ]) {
      const { port } = fakePort(answer);
      expect(await pictureBlock({ result, pictures: port, ...PERSON })).toBe(
        null,
      );
    }
  });

  it("never holds the answer longer than its wait", async () => {
    const { port, asked } = fakePort(
      () => new Promise<QPictureBlock | null>(() => undefined),
    );
    const started = Date.now();
    const block = await pictureBlock({
      result: { visual: "PICTURE", pictureQuery: "baobab tree" },
      pictures: port,
      ...PERSON,
      waitMs: 30,
    });
    expect(block).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(asked[0]?.signal?.aborted).toBe(true);
  });
});

describe("Pexels pictures", () => {
  it("is absent with a disabled key, so nothing is ever called", () => {
    expect(
      createPexelsPictureProvider("disabled-locally-000000000000"),
    ).toBeUndefined();
    expect(createPexelsPictureProvider(undefined)).toBeUndefined();
  });

  it("returns PICTURE blocks with the credit and the picture's page", async () => {
    const seen: string[] = [];
    const provider = createPexelsPictureProvider(
      "pexels-test-key-0000000000000",
      (url) => {
        seen.push(url instanceof Request ? url.url : url.toString());
        return Promise.resolve(
          new Response(
            JSON.stringify({
              photos: [
                {
                  alt: "A baobab tree at dusk",
                  photographer: "Ada Obi",
                  photographer_url: "https://www.pexels.com/@ada-obi",
                  url: "https://www.pexels.com/photo/baobab-1/",
                  src: {
                    large:
                      "https://images.pexels.com/photos/1/pexels-photo-1.jpeg",
                  },
                },
                // A credit link that is not https loses the link only.
                {
                  alt: "",
                  photographer: "Kofi",
                  photographer_url: "http://www.pexels.com/@kofi",
                  url: "https://www.pexels.com/photo/baobab-2/",
                  src: { large: "https://images.pexels.com/photos/2/b.jpeg" },
                },
                // Not the source's host, or no page: dropped.
                {
                  alt: "x",
                  photographer: "y",
                  url: "https://www.pexels.com/photo/3/",
                  src: { large: "https://example.com/a.jpeg" },
                },
                {
                  alt: "x",
                  photographer: "y",
                  src: { large: "https://images.pexels.com/photos/4/d.jpeg" },
                },
              ],
            }),
          ),
        );
      },
    );
    const pictures = (await provider?.search("baobab tree", {})) ?? [];
    expect(pictures).toEqual([
      PICTURE,
      {
        kind: "PICTURE",
        url: "https://images.pexels.com/photos/2/b.jpeg",
        alt: "baobab tree",
        credit: { name: "Kofi", url: null },
        source: "PEXELS",
        pageUrl: "https://www.pexels.com/photo/baobab-2/",
      },
    ]);
    const sent = new URL(seen[0] ?? "");
    expect(sent.searchParams.get("query")).toBe("baobab tree");
    expect(sent.searchParams.get("per_page")).toBe("3");
  });

  it("a failed search is no pictures, not an error", async () => {
    const provider = createPexelsPictureProvider(
      "pexels-test-key-0000000000000",
      () => Promise.reject(new Error("offline")),
    );
    expect(await provider?.search("x", {})).toEqual([]);
  });
});

describe("names a run read are withheld from picture searches", () => {
  it("hands every company, investor, person and counterpart name to the port", async () => {
    const { port, asked } = fakePort(() => Promise.resolve(PICTURE));
    const withheld = namesReadByRun({
      companyNames: new Map([["c1", "Kivu Freight"]]),
      profiles: new Map([
        ["c1", "Kivu Freight"],
        ["c2", "Portside"],
      ]),
      investors: new Map([["i1", { name: "Halyard Capital" }]]),
      externals: new Map([["amara", { name: "Amara Nwosu" }]]),
      relationships: new Map([["r1", { counterpart: { name: "Souqsheet" } }]]),
    });
    expect([...withheld].sort()).toEqual(
      [
        "Amara Nwosu",
        "Halyard Capital",
        "Kivu Freight",
        "Portside",
        "Souqsheet",
      ].sort(),
    );
    await pictureBlock({
      result: { visual: "PICTURE", pictureQuery: "warehouse" },
      pictures: port,
      ...PERSON,
      withheld,
    });
    expect(asked[0]?.withheld).toEqual(withheld);
  });
});
