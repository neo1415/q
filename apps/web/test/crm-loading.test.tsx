// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The loading shape reads the address it is loading (the tab just chosen).
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=pipeline"),
}));

import RecordCompanyLoading from "../app/(app)/relationships/company/[companyId]/loading";
import RecordInvestorLoading from "../app/(app)/relationships/investor/[investorOrganisationId]/loading";
import RelationshipsLoading from "../app/(app)/relationships/loading";

afterEach(cleanup);

describe("CRM loading shapes", () => {
  it("the hub loads as its header, tabs and queue rows, announced once", () => {
    const { container } = render(<RelationshipsLoading />);
    const status = screen.getByRole("status", { name: "Loading your CRM" });
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(
      container.querySelectorAll("[data-loading-rows=queue] li"),
    ).toHaveLength(3);
    // The tab just chosen is underlined at once (owner 2026-10-16).
    const chosen = within(status).getByText("Pipeline");
    expect(chosen.className).toContain("border-(--cq-accent)");
    expect(within(status).getByText("Overview").className).toContain(
      "border-transparent",
    );
    // No heading or text that would change when the page arrives.
    expect(screen.queryByRole("heading")).toBeNull();
  });
  it("a record loads as a record on both sides, not as the list", () => {
    for (const Loading of [RecordCompanyLoading, RecordInvestorLoading]) {
      const { container, unmount } = render(<Loading />);
      expect(
        screen.getByRole("status", { name: "Loading the relationship" }),
      ).toBeDefined();
      expect(container.querySelector("[data-loading-rows=record]")).not.toBe(
        null,
      );
      expect(container.querySelector("[data-loading-rows=queue]")).toBe(null);
      unmount();
    }
  });
});
