// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  QDailyEdition,
  QDailyPreferences,
  QDailyStory,
} from "@capital-q/contracts";

const setPreferences = vi.fn();
const requestEdition = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../src/features/daily/daily-actions", () => ({
  setDailyPreferencesAction: (patch: unknown) =>
    setPreferences(patch) as Promise<unknown>,
  requestDailyEditionAction: () => requestEdition() as Promise<unknown>,
}));

import { DailySetting } from "../src/features/daily/daily-setting";
import { Newspaper } from "../src/features/daily/newspaper";
import { PrepareEditionButton } from "../src/features/daily/prepare-edition";

/**
 * The Q Daily in the app (DAILY spec §3): a newspaper whose every story
 * names and links its source, Q's take labelled as inference, pictures
 * credited, and preferences that save at once.
 */

function story(id: string, overrides: Partial<QDailyStory> = {}): QDailyStory {
  return {
    id,
    section: "YOUR_SECTOR",
    headline: `Headline ${id}`,
    standfirst: `Standfirst ${id}.`,
    paragraphs: [`TechCabal reports ${id}.`],
    quotes: [],
    sources: [
      {
        url: `https://techcabal.com/${id}`,
        publisher: "TechCabal",
        title: id,
        publishedAt: null,
      },
    ],
    image: null,
    deal: null,
    written: true,
    ...overrides,
  };
}

const EDITION: QDailyEdition = {
  id: "00000000-0000-4000-8000-0000000000e1",
  number: 4,
  editionDate: "2026-10-05",
  frequency: "WEEKLY",
  readerName: "Kola",
  topics: ["Fintech", "Nigeria"],
  lead: story("lead", {
    section: "LEAD",
    quotes: [
      {
        text: "We will hire across Lagos",
        speaker: "the founder",
        sourceIndex: 0,
      },
    ],
    image: {
      url: "https://images.pexels.com/photos/1/a.jpeg",
      alt: "Lagos skyline",
      credit: "Photo by Ada on Pexels",
      creditUrl: "https://www.pexels.com/photo/1",
      kind: "STOCK",
      linkUrl: null,
    },
  }),
  sections: [
    {
      code: "DEALS",
      title: "Deals and rounds",
      stories: [
        story("deal", {
          section: "DEALS",
          image: {
            url: "https://techcabal.com/thumb.jpg",
            alt: "Thumbnail",
            credit: "Image: TechCabal",
            creditUrl: "https://techcabal.com/deal",
            kind: "PUBLISHER_THUMBNAIL",
            linkUrl: "https://techcabal.com/deal",
          },
        }),
      ],
    },
  ],
  briefs: [story("brief", { written: false })],
  chart: {
    title: "Rounds reported this week, in US dollars",
    unit: "USD",
    bars: [
      {
        label: "Paystack",
        value: 12_000_000,
        formatted: "$12M",
        storyId: "deal",
      },
      { label: "Kuda", value: 3_000_000, formatted: "$3M", storyId: "brief" },
    ],
    source: "Amounts as reported by TechCabal",
  },
  qTake: {
    paragraphs: ["Worth watching who leads seed rounds."],
    storyIds: ["lead"],
    truthClass: "Q_INFERENCE",
  },
  generatedAt: "2026-10-05T06:00:00Z",
};

afterEach(() => {
  setPreferences.mockReset();
  requestEdition.mockReset();
  refresh.mockReset();
});

describe("the newspaper", () => {
  it("prints the masthead, lead, sections, briefs and the PDF edition", () => {
    render(<Newspaper edition={EDITION} />);
    expect(screen.getByText("The Q Daily")).toBeTruthy();
    expect(
      screen.getByText(/5 October 2026 · Weekly edition · No\. 4 · For Kola/),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Headline lead" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Deals and rounds" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "In brief" })).toBeTruthy();
    const pdf = screen.getByRole("link", { name: "Download PDF" });
    expect(pdf.getAttribute("href")).toBe(`/api/q-daily/${EDITION.id}/pdf`);
  });

  it("folds a story's body below the lead, keeping its sources out of the fold (design-48)", () => {
    render(<Newspaper edition={EDITION} />);
    const folds = document.querySelectorAll("details[data-story-fold]");
    expect(folds.length).toBeGreaterThan(0);
    for (const fold of folds) {
      expect(fold.hasAttribute("open")).toBe(false);
      expect(fold.querySelector("a[href^='https://']")).toBeNull();
    }
    // The lead is never folded.
    expect(
      document.querySelector("[data-daily-lead] details[data-story-fold]"),
    ).toBeNull();
  });

  it("names and links every story's source, opening outside the app", () => {
    render(<Newspaper edition={EDITION} />);
    const sources = screen.getAllByRole("link", { name: /TechCabal/ });
    expect(sources.length).toBeGreaterThanOrEqual(3);
    for (const link of sources) {
      expect(link.getAttribute("href")).toMatch(/^https:\/\/techcabal\.com\//);
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  });

  it("credits pictures and links a publisher's thumbnail to its article", () => {
    render(<Newspaper edition={EDITION} />);
    expect(screen.getByText("Photo by Ada on Pexels")).toBeTruthy();
    const thumb = screen.getByRole("img", { name: "Thumbnail" });
    expect(thumb.closest("a")?.getAttribute("href")).toBe(
      "https://techcabal.com/deal",
    );
    expect(
      screen.getByRole("link", { name: "Photos provided by Pexels" }),
    ).toBeTruthy();
  });

  it("labels Q's take as Q's inference, not reported fact", () => {
    render(<Newspaper edition={EDITION} />);
    const take = screen.getByRole("complementary", { name: "Q's take" });
    expect(
      within(take).getByText(/Q's inference .* not reported fact/),
    ).toBeTruthy();
  });

  it("draws the deals diagram with each figure in words, not colour alone", () => {
    render(<Newspaper edition={EDITION} />);
    expect(screen.getByText("$12M")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Paystack" }).getAttribute("href"),
    ).toBe("#story-deal");
    expect(screen.getByText("Amounts as reported by TechCabal")).toBeTruthy();
  });

  it("prints a quiet edition", () => {
    render(
      <Newspaper
        edition={{
          ...EDITION,
          lead: null,
          sections: [],
          briefs: [],
          chart: null,
          qTake: null,
        }}
      />,
    );
    expect(screen.getByText(/A quiet week in your markets/)).toBeTruthy();
  });
});

const PREFERENCES: QDailyPreferences = {
  frequency: "WEEKLY",
  email: true,
  sections: ["YOUR_SECTOR", "YOUR_MARKET", "DEALS", "PEOPLE", "Q_TAKE"],
  nextDueAt: "2026-10-05T06:00:00.000Z",
};

describe("Settings → The Q Daily", () => {
  it("saves a new frequency at once and says what it means", async () => {
    setPreferences.mockResolvedValue({
      ok: true,
      preferences: {
        ...PREFERENCES,
        frequency: "DAILY",
        nextDueAt: "2026-10-02T06:00:00.000Z",
      },
    });
    render(<DailySetting initial={PREFERENCES} />);
    expect(
      screen
        .getByRole("button", { name: "Weekly" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Daily" }));
      await Promise.resolve();
    });
    expect(setPreferences).toHaveBeenCalledWith({ frequency: "DAILY" });
    expect(
      screen
        .getByRole("button", { name: "Daily" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByText(/Every morning, by email and in The Q Daily/),
    ).toBeTruthy();
  });

  it("drops a section and puts the choice back if the save fails", async () => {
    setPreferences.mockResolvedValue({
      ok: false,
      message: "Your change wasn't saved. Try again in a moment.",
    });
    render(<DailySetting initial={PREFERENCES} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Q's take" }));
      await Promise.resolve();
    });
    expect(setPreferences).toHaveBeenCalledWith({
      sections: ["YOUR_SECTOR", "YOUR_MARKET", "DEALS", "PEOPLE"],
    });
    expect(
      screen
        .getByRole("button", { name: "Q's take" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("wasn't saved");
  });

  it("hides email and sections while it is off", () => {
    render(
      <DailySetting
        initial={{ ...PREFERENCES, frequency: "OFF", nextDueAt: null }}
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      screen.getByText("No editions are prepared or emailed."),
    ).toBeTruthy();
  });
});

describe("Prepare my edition", () => {
  it("queues one and refreshes the page", async () => {
    requestEdition.mockResolvedValue({
      ok: true,
      result: { status: "QUEUED", retryAfter: null },
    });
    render(<PrepareEditionButton />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Prepare my edition" }),
      );
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("says when another can be asked for", async () => {
    requestEdition.mockResolvedValue({
      ok: true,
      result: { status: "TOO_SOON", retryAfter: "2026-10-06T06:00:00.000Z" },
    });
    render(<PrepareEditionButton />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Prepare my edition" }),
      );
      await Promise.resolve();
    });
    expect(screen.getByRole("alert").textContent).toMatch(
      /You have a recent edition/,
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
