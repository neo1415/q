// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { RelationshipSummaryDto } from "@capital-q/contracts";

import { RelationshipsIndex } from "../src/features/relationships/relationships-index";

/**
 * R27: the Relationships page lists every relationship the API returned
 * for the person's side, in the projection's own words, each opening the
 * existing relationship page; with nothing to list it points somewhere
 * useful.
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
  it("lists each relationship with its state, date and a link to its page", () => {
    render(<RelationshipsIndex side="INVESTOR" items={[ITEM]} />);
    const list = screen.getByRole("list", { name: "Relationships" });
    const card = within(list).getByRole("article", { name: "Kivu Freight" });
    expect(
      within(card)
        .getByRole("link", { name: "Kivu Freight" })
        .getAttribute("href"),
    ).toBe("/relationships/company/c0000000-0000-4000-8000-000000000001");
    expect(card.textContent).toContain("Awaiting reply");
    expect(card.textContent).toContain("Interest expressed since");
    expect(card.textContent).toMatch(/20 Sept? 2026/);
    // Not connected: messages and calls say so and link nowhere.
    expect(card.textContent).toContain("Open once connected");
    expect(card.textContent).toContain("After you connect");
    expect(
      within(card)
        .getByRole("link", { name: /reminder/i })
        .getAttribute("href"),
    ).toBe(
      "/relationships/company/c0000000-0000-4000-8000-000000000001#reminders",
    );
  });

  it("filters by status with counts, searches by name, and shows the last message", () => {
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
        digests={{
          [connected.relationshipId]: {
            photoUrl: null,
            about: "Ledgers for SMEs.",
            chips: ["Seed", "Nigeria"],
            websiteUrl: null,
            messages: {
              count: 3,
              more: false,
              last: {
                text: "Thursday works.",
                mine: false,
                senderName: "Ada",
                sentAt: "2026-09-27T10:00:00.000Z",
              },
            },
            nextCall: null,
            nextReminder: null,
            followUpDue: true,
          },
        }}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Connected 1" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: "Follow-up due 1" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connected 1" }));
    const list = screen.getByRole("list", { name: "Relationships" });
    expect(
      within(list).queryByRole("article", { name: "Kivu Freight" }),
    ).toBeNull();
    const card = within(list).getByRole("article", { name: "Ledgerfold" });
    expect(card.textContent).toContain("Ada: Thursday works.");
    expect(card.textContent).toContain("Follow-up due");
    expect(
      within(card)
        .getByRole("link", { name: /Messages/ })
        .getAttribute("href"),
    ).toBe(
      "/relationships/company/c0000000-0000-4000-8000-000000000002/messages",
    );

    fireEvent.click(screen.getByRole("button", { name: "All 2" }));
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search relationships" }),
      {
        target: { value: "kivu" },
      },
    );
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search relationships" }),
      {
        target: { value: "zzz" },
      },
    );
    expect(screen.getByRole("status").textContent).toContain("Nothing matches");
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
