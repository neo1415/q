// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RelationshipSummaryDto } from "@capital-q/contracts";

// Server actions and the router are the app's; the list is tested alone.
vi.mock("@/features/relationships/relationships-actions", () => ({
  moreRelationshipDigestsAction: vi.fn(),
}));
vi.mock("@/features/schedule/schedule-actions", () => ({
  markNoticesReadAction: vi.fn(() => Promise.resolve({ ok: true })),
  dismissReminderAction: vi.fn(() => Promise.resolve({ ok: true })),
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { RelationshipsIndex } =
  await import("../src/features/relationships/relationships-index");

/**
 * R27; founder critique 2026-10-04: search first, tabs with counts, one row
 * per relationship with its stage, time since and ONE next step; Needs you
 * folded; with nothing to list it points somewhere useful.
 */

afterEach(cleanup);

const ITEM: RelationshipSummaryDto = {
  relationshipId: "a0000000-0000-4000-8000-000000000001",
  counterpart: {
    kind: "COMPANY",
    id: "c0000000-0000-4000-8000-000000000001",
    name: "Kivu Freight",
  },
  state: "INTEREST_EXPRESSED",
  stateSince: "2026-09-20T10:00:00.000Z",
  nextStep: "AWAIT_ANSWER",
};

describe("RelationshipsIndex", () => {
  it("lists each relationship with its stage, time since and one next step", () => {
    render(
      <RelationshipsIndex
        side="INVESTOR"
        items={[ITEM]}
        now={Date.parse("2026-09-22T10:00:00.000Z")}
      />,
    );
    const list = screen.getByRole("list", { name: "Relationships" });
    const card = within(list).getByRole("article", { name: "Kivu Freight" });
    expect(
      within(card)
        .getByRole("link", { name: "Kivu Freight" })
        .getAttribute("href"),
    ).toBe("/relationships/company/c0000000-0000-4000-8000-000000000001");
    // The design's word for interest sent and not yet answered.
    expect(card.textContent).toContain("Awaiting reply");
    expect(card.textContent).toContain("2d");
    expect(card.textContent).toContain("Waiting on them");
    // Search comes before the tabs and the list.
    const search = screen.getByRole("searchbox", {
      name: "Search relationships",
    });
    expect(
      search.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("filters with counts, searches by name, and opens the next step from the peek", () => {
    const connected: RelationshipSummaryDto = {
      ...ITEM,
      relationshipId: "a0000000-0000-4000-8000-000000000002",
      counterpart: {
        ...ITEM.counterpart,
        id: "c0000000-0000-4000-8000-000000000002",
        name: "Ledgerfold",
      },
      state: "CONNECTED",
      nextStep: "SCHEDULE_MEETING",
    };
    render(
      <RelationshipsIndex
        side="INVESTOR"
        items={[ITEM, connected]}
        unread={new Map([[connected.relationshipId, 2]])}
      />,
    );
    // The list layout carries the same stage strip as Table and Board.
    expect(document.querySelector("[data-stage-strip]")?.textContent).toBe(
      "1 awaiting reply · 1 connected · 1 waiting on you",
    );
    expect(
      screen
        .getByRole("button", { name: "Needs you 1" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Needs you 1" }));
    const list = screen.getByRole("list", { name: "Relationships" });
    expect(
      within(list).queryByRole("article", { name: "Kivu Freight" }),
    ).toBeNull();
    const card = within(list).getByRole("article", { name: "Ledgerfold" });
    // The row says the step in the accent, flagged as waiting on you.
    expect(
      card.querySelector('[data-next-step-text="yours"]')?.textContent,
    ).toBe("Reply");
    // A row opens the record peek, whose next step is the action.
    fireEvent.click(within(card).getByRole("link", { name: "Ledgerfold" }));
    const peek = screen.getByRole("dialog", { name: "Ledgerfold" });
    expect(
      within(peek).getByRole("link", { name: "Reply" }).getAttribute("href"),
    ).toBe(
      "/relationships/company/c0000000-0000-4000-8000-000000000002/messages",
    );
    expect(peek.textContent).toContain("This is waiting on you.");
    fireEvent.click(within(peek).getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "All 2" }));
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search relationships" }),
      { target: { value: "kivu" } },
    );
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search relationships" }),
      { target: { value: "zzz" } },
    );
    expect(screen.getByRole("status").textContent).toContain("Nothing matches");
  });

  it("ranks an investor's list by Suitability by default, unknown last, with the score in the peek", () => {
    const named = (n: number, name: string, stateSince: string) => ({
      ...ITEM,
      relationshipId: `a0000000-0000-4000-8000-00000000001${String(n)}`,
      counterpart: {
        ...ITEM.counterpart,
        id: `c0000000-0000-4000-8000-00000000001${String(n)}`,
        name,
      },
      stateSince,
    });
    // Newest first by time: Unscored, Middling, Best.
    const best = named(1, "Best Fit Co", "2026-09-10T10:00:00.000Z");
    const middling = named(2, "Middling Co", "2026-09-15T10:00:00.000Z");
    const unscored = named(3, "Unscored Co", "2026-09-20T10:00:00.000Z");
    const scores = {
      [best.counterpart.id]: { suitability: 88, investability: 61 },
      [middling.counterpart.id]: { suitability: 40, investability: null },
    };
    const page = render(
      <RelationshipsIndex
        side="INVESTOR"
        items={[unscored, middling, best]}
        scores={scores}
        sort="suitability"
      />,
    );
    const names = () =>
      screen
        .getAllByRole("article")
        .map((card) => card.getAttribute("aria-labelledby"))
        .map((id) => document.getElementById(id ?? "")?.textContent);
    expect(names()).toEqual(["Best Fit Co", "Middling Co", "Unscored Co"]);

    // The peek says the fit (design 2026-10-20: the list row does not).
    fireEvent.click(screen.getByRole("link", { name: "Best Fit Co" }));
    expect(
      screen
        .getByRole("dialog", { name: "Best Fit Co" })
        .querySelector('[data-pipeline-score="suitability"]')?.textContent,
    ).toBe("88/100");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    // Unknown is said in words, never 0.
    fireEvent.click(screen.getByRole("link", { name: "Unscored Co" }));
    const unknown = screen.getByRole("dialog", { name: "Unscored Co" });
    expect(unknown.textContent).toContain("Not enough evidence");
    expect(unknown.textContent).not.toMatch(/\b0\/100/);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // The order is the person's to change; the choice goes in the URL.
    const select = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Sort relationships",
    });
    expect(select.value).toBe("suitability");
    fireEvent.change(select, { target: { value: "recent" } });
    expect(router.push).toHaveBeenLastCalledWith("/?sort=recent");

    page.rerender(
      <RelationshipsIndex
        key="recent"
        side="INVESTOR"
        items={[unscored, middling, best]}
        scores={scores}
        sort="recent"
      />,
    );
    expect(names()).toEqual(["Unscored Co", "Middling Co", "Best Fit Co"]);
  });

  it("shows a founder's list without score columns or a suitability sort", () => {
    render(
      <RelationshipsIndex
        side="COMPANY"
        items={[
          {
            ...ITEM,
            counterpart: {
              kind: "INVESTOR_ORGANISATION",
              id: "f0000000-0000-4000-8000-000000000001",
              name: "Savanna Seed",
            },
          },
        ]}
      />,
    );
    expect(document.querySelector("[data-pipeline-scores]")).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Sort relationships" }),
    ).toBeNull();
  });

  it("points an investor with none to Discover", () => {
    render(<RelationshipsIndex side="INVESTOR" items={[]} />);
    expect(
      screen.getByRole("link", { name: "Open Discover" }).getAttribute("href"),
    ).toBe("/discover");
  });

  it("points a founder with none to their visibility", () => {
    render(<RelationshipsIndex side="COMPANY" items={[]} />);
    expect(
      screen
        .getByRole("link", { name: "Check visibility" })
        .getAttribute("href"),
    ).toBe("/company/visibility");
  });

  it("says so when the list couldn't be read, without claiming there are none", () => {
    render(<RelationshipsIndex side="COMPANY" items={undefined} />);
    expect(screen.getByText(/couldn.t be read/)).toBeTruthy();
    expect(screen.queryByText(/No investor relationships/)).toBeNull();
  });
});
