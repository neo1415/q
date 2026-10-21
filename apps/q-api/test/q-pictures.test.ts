import { describe, expect, it } from "vitest";

import type {
  StockPicture,
  StockPictureProvider,
} from "@capital-q/model-gateway/images/stock";

import {
  createPexelsQPictures,
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
