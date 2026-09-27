// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
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
    const link = within(list).getByRole("link");
    expect(link.getAttribute("href")).toBe(
      "/relationships/company/c0000000-0000-4000-8000-000000000001",
    );
    expect(link.textContent).toContain("Kivu Freight");
    expect(link.textContent).toContain("Interest expressed");
    expect(link.textContent).toMatch(/20 Sept? 2026/);
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
