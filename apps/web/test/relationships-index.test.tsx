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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
    expect(card.textContent).toContain("Interest expressed");
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

  it("filters with counts, searches by name, and offers the next step as a button", () => {
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
    expect(
      within(card).getByRole("link", { name: "Reply" }).getAttribute("href"),
    ).toBe(
      "/relationships/company/c0000000-0000-4000-8000-000000000002/messages",
    );
    expect(card.textContent).toContain("2 new messages");

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

  it("shows Needs you once per relationship and action", () => {
    render(
      <RelationshipsIndex
        side="INVESTOR"
        items={[ITEM]}
        notices={[1, 2].map((n) => ({
          id: `c0000000-0000-4000-8000-00000000000${String(n)}`,
          kind: "Q_WORK" as const,
          title: "Q is waiting to be let in",
          body: null,
          linkPath: null,
          read: false,
          createdAt: "2026-09-21T10:00:00.000Z",
          priority: "NEEDS_YOU" as const,
        }))}
      />,
    );
    const section = screen.getByRole("region", { name: "Needs you" });
    expect(within(section).getAllByRole("article")).toHaveLength(1);
    expect(section.textContent).toContain("2 updates");
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
