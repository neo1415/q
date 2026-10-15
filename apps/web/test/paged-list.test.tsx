// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PagedList, pageThrough } from "../src/components/paged-list";

/**
 * Owner 2026-10-16: lists longer than a screen page. By cursor, never
 * offset: a page ends at a row's own key.
 */
const items = Array.from({ length: 19 }, (_, n) => ({
  key: `k${String(n)}`,
  node: <a href={`#${String(n)}`}>{`Row ${String(n)}`}</a>,
}));

afterEach(cleanup);

describe("pageThrough", () => {
  it("is the first page without a cursor, and runs through the cursor's row after", () => {
    expect(pageThrough(items, null, 8)).toBe(8);
    expect(pageThrough(items, "k15", 8)).toBe(16);
    // A cursor whose row has gone falls back to the first page, never an offset.
    expect(pageThrough(items, "gone", 8)).toBe(8);
    expect(pageThrough(items.slice(0, 3), null, 8)).toBe(3);
  });
});

describe("PagedList", () => {
  it("shows a page, opens the next on request, moves focus to the first new row, then folds back", () => {
    render(<PagedList items={items} pageSize={8} noun="companies" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByText("8 of 19 companies")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Show 8 more" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(16);
    expect(document.activeElement?.textContent).toBe("Row 8");
    fireEvent.click(screen.getByRole("button", { name: "Show 3 more" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(19);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
  });

  it("has no paging controls when everything fits on one page", () => {
    render(<PagedList items={items.slice(0, 5)} pageSize={8} noun="rows" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
