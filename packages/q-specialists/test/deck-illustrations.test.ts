import { describe, expect, it } from "vitest";

import {
  QArtifactContentSchema,
  QSlideImageSchema,
  type QArtifactContent,
} from "@capital-q/contracts";

import {
  illustrateWithGenerated,
  illustrationPrompt,
  type IllustrationPort,
} from "../src/index.js";

/** DOCS: generated pictures in a deck, through a fake port only. */

const IMAGE_ID = "11111111-0000-4000-8000-000000000001";

function deck(): QArtifactContent {
  return QArtifactContentSchema.parse({
    sections: [{ heading: "Summary", body: "Freight.", findings: [] }],
    gaps: [],
    deck: {
      accent: "#0b6e4f",
      slides: [
        {
          layout: "TITLE",
          title: "Northstar",
          subtitle: "Northstar moves freight between Lagos and Abuja.",
          section: 0,
        },
        {
          layout: "BULLETS",
          title: "Team",
          bullets: ["Ada Obi, CEO"],
          section: 0,
        },
        {
          layout: "BULLETS",
          title: "Product",
          bullets: ["Booking app for spare truck space."],
          section: 0,
        },
        {
          layout: "BULLETS",
          title: "Traction",
          bullets: ["320 deliveries in June."],
          section: 0,
        },
      ],
    },
  });
}

function port(answers: boolean[] = [true, true, true]) {
  const asked: { prompt: string; purpose: string }[] = [];
  const illustrations: IllustrationPort = {
    illustrate: (input) => {
      asked.push({ prompt: input.prompt, purpose: input.purpose });
      const ok = answers[asked.length - 1] ?? false;
      return Promise.resolve(
        ok
          ? QSlideImageSchema.parse({
              url: `cq-image:${IMAGE_ID}`,
              alt: input.alt,
              credit: "AI-generated image · Capital Q",
              provenance: "AI_GENERATED",
            })
          : null,
      );
    },
  };
  return { illustrations, asked };
}

describe("generated illustrations", () => {
  it("illustrates the cover first, then a content slide, never the team, at most two", async () => {
    const { illustrations, asked } = port();
    const content = await illustrateWithGenerated(deck(), illustrations);
    expect(asked.map((entry) => entry.purpose)).toEqual(["COVER", "SLIDE"]);
    const slides = content.deck?.slides ?? [];
    expect(slides[0]?.image?.provenance).toBe("AI_GENERATED");
    expect(slides[1]?.image).toBeUndefined();
    expect(slides[2]?.image?.url).toBe(`cq-image:${IMAGE_ID}`);
    expect(slides[3]?.image).toBeUndefined();
    // The stored content still satisfies the contract.
    expect(QArtifactContentSchema.parse(content)).toEqual(content);
  });

  it("builds prompts from the deck's own words, with no figures from the slides", async () => {
    const { illustrations, asked } = port();
    await illustrateWithGenerated(deck(), illustrations, { slides: [4] });
    expect(asked[0]?.prompt).toContain('"Traction"');
    expect(asked[0]?.prompt).toContain("Lagos and Abuja");
    expect(asked[0]?.prompt).not.toContain("320");
    expect(asked[0]?.prompt).toContain("#0b6e4f");
  });

  it("never draws the team slide even when asked for it", async () => {
    const { illustrations, asked } = port();
    const content = await illustrateWithGenerated(deck(), illustrations, {
      slides: [2],
    });
    expect(asked).toEqual([]);
    expect(content).toEqual(deck());
  });

  it("stops at the first refusal (budget spent, images off) and keeps the words", async () => {
    const { illustrations, asked } = port([false, true]);
    const content = await illustrateWithGenerated(deck(), illustrations);
    expect(asked).toHaveLength(1);
    expect(content).toEqual(deck());
  });

  it("a generated image must say it is one", () => {
    expect(
      QSlideImageSchema.safeParse({
        url: `cq-image:${IMAGE_ID}`,
        alt: "x",
        credit: "x",
      }).success,
    ).toBe(false);
    expect(
      QSlideImageSchema.safeParse({
        url: "https://images.pexels.com/photos/1/a.jpg",
        alt: "x",
        credit: "x",
        provenance: "AI_GENERATED",
      }).success,
    ).toBe(false);
    expect(
      illustrationPrompt({
        slideTitle: "Market",
        description: undefined,
        accent: undefined,
        cover: false,
      }),
    ).toContain("restrained palette");
  });
});
