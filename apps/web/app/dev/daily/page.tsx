import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { QDailyEdition, QDailyStory } from "@capital-q/contracts";

import { PageContainer } from "@/components/app-shell/page-container";
import { Newspaper } from "@/features/daily/newspaper";

export const metadata: Metadata = {
  title: "The Q Daily preview",
  robots: { index: false },
};

/**
 * A development preview of The Q Daily's reader (DAILY), from a fictional
 * edition, for checking the layout in light and dark, phone and desktop
 * without a signed-in session. 404 in production; not in navigation.
 */

function story(id: string, overrides: Partial<QDailyStory>): QDailyStory {
  return {
    id,
    section: "YOUR_SECTOR",
    headline: "",
    standfirst: "",
    paragraphs: [],
    quotes: [],
    sources: [
      {
        url: `https://example.com/news/${id}`,
        publisher: "Example News",
        title: id,
        publishedAt: "2026-09-30T08:00:00Z",
      },
    ],
    image: null,
    deal: null,
    written: true,
    ...overrides,
  };
}

const EDITION: QDailyEdition = {
  id: "00000000-0000-4000-8000-00000000d0e1",
  number: 3,
  editionDate: "2026-10-05",
  frequency: "WEEKLY",
  readerName: "Ada",
  topics: ["Financial Services", "Seed", "Nigeria"],
  lead: story("lead", {
    section: "LEAD",
    headline:
      "Fictional Lagos payments start-up closes a seed round to reach market traders",
    standfirst:
      "Example News reports the round will fund hiring and two new offices.",
    paragraphs: [
      "Example News reports that the company, which lets market traders take card payments on a phone, raised the round from two local funds and a group of angels.",
      "According to the report, the company plans to open offices in Abuja and Accra before the end of the year.",
    ],
    quotes: [
      {
        text: "Traders told us they lose a sale every time a customer has no cash",
        speaker: "the company's founder",
        sourceIndex: 0,
      },
    ],
  }),
  sections: [
    {
      code: "YOUR_SECTOR",
      title: "Your sector",
      stories: [
        story("s1", {
          headline: "Fictional lender reports a rise in small-business loans",
          standfirst: "Example News reports demand rose among retailers.",
          paragraphs: ["Example News reports the lender's quarterly figures."],
        }),
        story("s2", {
          headline: "Regulator publishes draft rules for payment agents",
          standfirst: "The draft is open for comment, Example News reports.",
          paragraphs: ["According to Example News, comments close next month."],
        }),
      ],
    },
    {
      code: "DEALS",
      title: "Deals and rounds",
      stories: [
        story("d1", {
          section: "DEALS",
          headline: "Fictional payroll start-up raises $12 million",
          standfirst: "Example News reports a Series A.",
          deal: {
            company: "Payroll Co",
            amount: "$12 million",
            amountUsd: 12_000_000,
            round: "Series A",
            sourceIndex: 0,
          },
        }),
        story("d2", {
          section: "DEALS",
          headline: "Fictional savings app raises $3 million",
          standfirst: "Example News reports a seed round.",
          deal: {
            company: "Savings Co",
            amount: "$3 million",
            amountUsd: 3_000_000,
            round: "Seed",
            sourceIndex: 0,
          },
        }),
      ],
    },
  ],
  briefs: [
    story("b1", {
      headline: "Fictional accelerator opens applications for its next cohort",
      written: false,
    }),
  ],
  chart: {
    title: "Rounds reported this week, in US dollars",
    unit: "USD",
    bars: [
      {
        label: "Payroll Co",
        value: 12_000_000,
        formatted: "$12M",
        storyId: "d1",
      },
      {
        label: "Savings Co",
        value: 3_000_000,
        formatted: "$3M",
        storyId: "d2",
      },
    ],
    source: "Amounts as reported by Example News",
  },
  qTake: {
    paragraphs: [
      "Seed money for payments in Nigeria looks active this week; worth asking the funds named here what they look for at your stage.",
    ],
    storyIds: ["lead", "d2"],
    truthClass: "Q_INFERENCE",
  },
  generatedAt: "2026-10-05T06:00:00Z",
};

export default function DailyPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return (
    <PageContainer width="content" className="py-6">
      <Newspaper edition={EDITION} />
    </PageContainer>
  );
}
