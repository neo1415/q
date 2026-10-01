import { describe, expect, it } from "vitest";

import {
  QDailyEditionSchema,
  type QDailyEdition,
  type QDailyStory,
} from "@capital-q/contracts";

import {
  layOutNewspaper,
  NEWSPAPER_PAGE,
  newspaperToPdf,
  overflowingBoxes,
} from "../src/index.js";

function story(
  index: number,
  overrides: Partial<QDailyStory> = {},
): QDailyStory {
  return {
    id: `story-${index}`,
    section: "YOUR_SECTOR",
    headline: `Lagos fintech number ${index} raises a seed round to expand across West Africa`,
    standfirst:
      "The company says it will hire engineers and open two new offices.",
    paragraphs: [
      "TechCabal reports that the round was led by a local fund with participation from two angels. ".repeat(
        3,
      ),
      "According to the report, the startup serves small merchants who sell through social media.",
    ],
    quotes: [
      {
        text: "We will hire across Lagos and Accra",
        speaker: "the founder",
        sourceIndex: 0,
      },
    ],
    sources: [
      {
        url: `https://techcabal.com/2026/09/30/story-${index}`,
        publisher: "TechCabal",
        title: "Original title",
        publishedAt: "2026-09-30T08:00:00Z",
      },
    ],
    image: null,
    deal: null,
    written: true,
    ...overrides,
  };
}

const EDITION: QDailyEdition = QDailyEditionSchema.parse({
  id: "00000000-0000-4000-8000-0000000000e1",
  number: 3,
  editionDate: "2026-10-05",
  frequency: "WEEKLY",
  readerName: "Kola",
  topics: ["Fintech", "Nigeria", "Seed"],
  lead: story(0, {
    section: "LEAD",
    image: {
      url: "https://images.pexels.com/photos/1/lagos.jpeg",
      alt: "Lagos skyline",
      credit: "Photo by Ada on Pexels",
      creditUrl: "https://www.pexels.com/photo/1",
      kind: "STOCK",
      linkUrl: null,
    },
  }),
  sections: [
    {
      code: "YOUR_SECTOR",
      title: "Your sector",
      stories: [1, 2, 3, 4].map((i) => story(i)),
    },
    {
      code: "DEALS",
      title: "Deals and rounds",
      stories: [5, 6].map((i) =>
        story(i, {
          section: "DEALS",
          image: {
            url: "https://techcabal.com/thumb.jpg",
            alt: "thumb",
            credit: "Image: TechCabal",
            creditUrl: "https://techcabal.com/x",
            kind: "PUBLISHER_THUMBNAIL",
            linkUrl: "https://techcabal.com/x",
          },
        }),
      ),
    },
    {
      code: "PEOPLE",
      title: "People you know in the news",
      stories: [story(7, { section: "PEOPLE" })],
    },
  ],
  briefs: [8, 9, 10].map((i) => story(i, { written: false })),
  chart: {
    title: "Rounds reported this week, in US dollars",
    unit: "USD",
    bars: [
      {
        label: "Paystack",
        value: 12_000_000,
        formatted: "$12M",
        storyId: "story-5",
      },
      {
        label: "Moniepoint",
        value: 3_000_000,
        formatted: "$3M",
        storyId: "story-6",
      },
    ],
    source: "Amounts as reported by TechCabal",
  },
  qTake: {
    paragraphs: [
      "Seed rounds in West African fintech look busy; worth watching who leads them.",
    ],
    storyIds: ["story-1"],
    truthClass: "Q_INFERENCE",
  },
  generatedAt: "2026-10-05T06:00:00Z",
});

describe("The Q Daily as a newspaper", () => {
  it("flows onto more than one A4 page without overflowing a column", () => {
    const laid = layOutNewspaper(EDITION);
    expect(laid.width).toBe(NEWSPAPER_PAGE.width);
    expect(laid.slides.length).toBeGreaterThanOrEqual(2);
    expect(overflowingBoxes(laid)).toEqual([]);
    const words = laid.slides
      .flatMap((slide) => slide.boxes)
      .flatMap((box) => (box.kind === "TEXT" ? box.lines : []))
      .join(" ");
    expect(words).toContain("The Q Daily");
    expect(words).toContain("No. 3");
    expect(words).toContain("Q's inference");
    for (let index = 0; index <= 10; index += 1) {
      expect(words).toContain(`number ${index}`);
    }
  });

  it("embeds only licensed stock photographs, never a publisher's thumbnail", () => {
    const images = layOutNewspaper(EDITION)
      .slides.flatMap((slide) => slide.boxes)
      .filter((box) => box.kind === "IMAGE");
    expect(images.map((box) => (box.kind === "IMAGE" ? box.url : ""))).toEqual([
      "https://images.pexels.com/photos/1/lagos.jpeg",
    ]);
  });

  it("draws the deals diagram from the edition's own figures", () => {
    const charts = layOutNewspaper(EDITION)
      .slides.flatMap((slide) => slide.boxes)
      .filter((box) => box.kind === "CHART");
    expect(charts).toHaveLength(1);
    const chart = charts[0];
    if (chart?.kind !== "CHART") throw new Error("no chart");
    expect(chart.bars.map((bar) => bar.formatted)).toEqual(["$12M", "$3M"]);
    expect(chart.bars[0]?.height).toBeGreaterThan(chart.bars[1]?.height ?? 0);
  });

  it("renders a PDF (photos unavailable: drawn without them)", async () => {
    const bytes = await newspaperToPdf(EDITION, { images: new Map() });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(5_000);
    if (process.env["CQ_DAILY_PDF_OUT"] !== undefined) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env["CQ_DAILY_PDF_OUT"], bytes);
    }
  });

  it("prints a quiet edition", () => {
    const laid = layOutNewspaper({
      ...EDITION,
      lead: null,
      sections: [],
      briefs: [],
      chart: null,
      qTake: null,
    });
    expect(laid.slides).toHaveLength(1);
  });
});
