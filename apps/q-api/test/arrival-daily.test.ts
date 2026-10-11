import { describe, expect, it } from "vitest";

import { type QDailyEdition, type QDailyStory } from "@capital-q/contracts";

import { dailyStoriesOf } from "../src/composition/arrival-daily.js";

const ID = "7b1c0e55-0000-4000-8000-0000000000e1";
const source = {
  url: "https://techcabal.com/a",
  publisher: "TechCabal",
  title: "t",
  publishedAt: null,
};
const story = (
  id: string,
  headline: string,
  standfirst = "gist",
): QDailyStory => ({
  id,
  section: "LEAD",
  headline,
  standfirst,
  paragraphs: ["First paragraph.", "Second paragraph."],
  quotes: [],
  sources: [source],
  image: null,
  deal: null,
  written: true,
});
const edition = (over: Partial<QDailyEdition> = {}): QDailyEdition => ({
  id: ID,
  number: 4,
  editionDate: "2026-10-09",
  frequency: "WEEKLY",
  readerName: null,
  topics: ["fintech"],
  lead: story("lead1", "Lead news"),
  sections: [
    {
      code: "YOUR_SECTOR",
      title: "Your sector",
      stories: [story("sec1", "Fintech regulation shifts")],
    },
    {
      code: "Q_TAKE",
      title: "Q's take",
      stories: [story("take1", "Opinion")],
    },
  ],
  briefs: [story("brief1", "A brief")],
  chart: null,
  qTake: null,
  generatedAt: "2026-10-09T06:00:00.000Z",
  ...over,
});
const NOW = new Date("2026-10-11T09:00:00Z");

describe("dailyStoriesOf (P4)", () => {
  it("no edition, no stories: nothing is invented", () => {
    expect(dailyStoriesOf(null, NOW)).toEqual([]);
  });

  it("ranks their sector and topic first, leaves Q's take out, gives exact paths", () => {
    const out = dailyStoriesOf(edition(), NOW);
    expect(out.map((one) => one.storyId)).toEqual(["sec1", "lead1", "brief1"]);
    expect(out[0]).toMatchObject({
      editionId: ID,
      editionDate: "2026-10-09",
      sectionCode: "YOUR_SECTOR",
      headline: "Fintech regulation shifts",
      summary: "gist",
      path: `/daily/${ID}#story-sec1`,
      sectionPath: `/daily/${ID}#section-YOUR_SECTOR`,
      publishedAt: "2026-10-09T06:00:00.000Z",
    });
    expect(out[0]?.sources[0]?.publisher).toBe("TechCabal");
    expect(out[1]?.sectionPath).toBeNull();
    expect(out.some((one) => one.storyId === "take1")).toBe(false);
  });

  it("falls back to the first paragraph when there is no standfirst", () => {
    const out = dailyStoriesOf(
      edition({ lead: story("l", "H", ""), sections: [], briefs: [] }),
      NOW,
    );
    expect(out[0]?.summary).toBe("First paragraph.");
  });

  it("an old edition is not news", () => {
    expect(
      dailyStoriesOf(edition({ generatedAt: "2026-09-01T06:00:00.000Z" }), NOW),
    ).toEqual([]);
  });
});
