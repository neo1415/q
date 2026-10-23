import { describe, expect, it } from "vitest";

import type {
  StockPicture,
  StockPictureProvider,
} from "@capital-q/model-gateway/images/stock";

import {
  createPexelsQPictures,
  createPublicQPictures,
  createQPictures,
} from "../src/composition/pictures.js";

/**
 * L-13: what leaves Capital Q for a picture passes q-research's outbound
 * Context Firewall. Only the person's own words (and connectives) survive
 * from the model's proposal; figures and anything private never leave.
 */

const PICTURE: StockPicture = {
  kind: "PICTURE",
  url: "https://images.pexels.com/photos/1/pexels-photo-1.jpeg",
  alt: "A baobab tree at dusk",
  credit: { name: "Ada Obi", url: null },
  source: "PEXELS",
  pageUrl: "https://www.pexels.com/photo/baobab-1/",
};

function fakeProvider(found: readonly StockPicture[] = [PICTURE]): {
  readonly provider: StockPictureProvider;
  readonly sent: string[];
} {
  const sent: string[] = [];
  return {
    sent,
    provider: {
      code: "fake",
      search: (query) => {
        sent.push(query);
        return Promise.resolve(found);
      },
    },
  };
}

describe("Q pictures", () => {
  it("sends only the person's words from the model's proposal", async () => {
    const { provider, sent } = fakeProvider();
    const pictures = createQPictures(provider);
    const found = await pictures?.find({
      // The model slipped in a private figure and a customer's name.
      requestedQuery: "baobab tree Acme Foods 2.4m revenue",
      userText: "What does a baobab tree look like?",
      earlierUserText: [],
    });
    expect(found).toEqual(PICTURE);
    expect(sent).toEqual(["baobab tree"]);
  });

  it("uses the person's earlier words, never Q's", async () => {
    const { provider, sent } = fakeProvider();
    await createQPictures(provider)?.find({
      requestedQuery: "shea butter",
      userText: "show me what it looks like",
      earlierUserText: ["We make shea butter in Tamale"],
    });
    expect(sent).toEqual(["shea butter"]);
  });

  it("searches nothing when none of the proposal is the person's", async () => {
    const { provider, sent } = fakeProvider();
    const found = await createQPictures(provider)?.find({
      requestedQuery: "Acme Foods factory",
      userText: "show me",
      earlierUserText: [],
    });
    expect(found).toBeNull();
    expect(sent).toEqual([]);
  });

  it("is no picture when the source has none", async () => {
    const { provider } = fakeProvider([]);
    expect(
      await createQPictures(provider)?.find({
        requestedQuery: "baobab",
        userText: "a baobab?",
        earlierUserText: [],
      }),
    ).toBeNull();
  });

  it("is absent without a usable key, so answers go without pictures", () => {
    expect(createQPictures(undefined)).toBeUndefined();
    expect(
      createPexelsQPictures("disabled-locally-000000000000"),
    ).toBeUndefined();
    expect(createPexelsQPictures(undefined)).toBeUndefined();
  });
});

describe("Q pictures withhold every name the run read", () => {
  it("drops a company name the person typed, and keeps the thing itself", async () => {
    const { provider, sent } = fakeProvider();
    await createQPictures(provider)?.find({
      // The model echoed the name the person typed.
      requestedQuery: "Kivu Freight cold-chain warehouse",
      userText:
        "What would a cold-chain warehouse like Kivu Freight's look like?",
      earlierUserText: [],
      withheld: ["Kivu Freight Ltd"],
    });
    expect(sent).toEqual(["cold-chain warehouse"]);
  });

  it("searches nothing when only the name, or only connectives, would be left", async () => {
    const { provider, sent } = fakeProvider();
    const pictures = createQPictures(provider);
    expect(
      await pictures?.find({
        requestedQuery: "Kivu Freight",
        userText: "show me Kivu Freight",
        earlierUserText: [],
        withheld: ["Kivu Freight"],
      }),
    ).toBeNull();
    expect(
      await pictures?.find({
        requestedQuery: "the Portside of",
        userText: "a picture of the Portside office",
        earlierUserText: [],
        withheld: ["Portside"],
      }),
    ).toBeNull();
    expect(sent).toEqual([]);
  });

  it("withholds investors and people the same way", async () => {
    const { provider, sent } = fakeProvider();
    await createQPictures(provider)?.find({
      requestedQuery: "Amara Nwosu Halyard office building",
      userText:
        "what does an office building like Halyard's, Amara Nwosu's firm, look like",
      earlierUserText: [],
      withheld: ["Halyard Capital", "Amara Nwosu"],
    });
    expect(sent).toEqual(["office building"]);
  });
});

describe("pictures of who a turn names (owner 2026-10-23)", () => {
  it("is off without a usable SERP key, so nothing is searched locally", () => {
    expect(createPublicQPictures(undefined)).toBeUndefined();
    expect(
      createPublicQPictures("disabled-locally-000000000000"),
    ).toBeUndefined();
  });

  it("searches the image results with the name and keeps a page that names them", async () => {
    const asked: string[] = [];
    const port = createPublicQPictures("k".repeat(32), undefined, (input) => {
      asked.push(input instanceof Request ? input.url : input.toString());
      return Promise.resolve(
        new Response(
          JSON.stringify({
            images: [
              {
                title: "Zino Aviation | Charter flights",
                imageUrl: "https://zinoaviation.com/hero.jpg",
                link: "https://zinoaviation.com/",
              },
            ],
          }),
        ),
      );
    });
    const found = await port?.find({
      name: "Zino Aviation",
      userText: "Tell me about Zino Aviation",
      earlierUserText: [],
    });
    expect(asked).toEqual(["https://google.serper.dev/images"]);
    expect(found?.map((picture) => picture.domain)).toEqual([
      "zinoaviation.com",
    ]);
  });
});
