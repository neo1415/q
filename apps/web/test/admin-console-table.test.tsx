// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The console's list table and overview pieces (admin design 2026-11-19
 * §4 T1/T2): the view lives in the address, sorts and pages by cursor,
 * says the server's total, and shows a real empty or error state; the
 * spend chart draws priced spend only and counts calls with no price.
 */

vi.mock("@/features/i18n/server-now", () => ({
  serverTNow: () => (text: string) => text,
}));

const { AdminDataTable, viewFrom, viewHref } =
  await import("../src/features/admin/data-table");
const { SpendChart } = await import("../src/features/admin/spend-chart");
const { niceMax, usd } = await import("../src/features/admin/spend-words");
const { ageWords } = await import("../src/features/admin/console-overview");

afterEach(cleanup);

type Row = { readonly id: string; readonly name: string };

const table = (props: {
  rows: readonly Row[] | null;
  view?: {
    q: string;
    sort: "newest" | "oldest" | "name_asc" | "name_desc";
    cursor?: string;
  };
  nextCursor?: string | null;
  total?: number | null;
}) => (
  <AdminDataTable<Row>
    title="Accounts"
    noun="accounts"
    basePath="/admin/accounts"
    csvPath="/admin/accounts.csv"
    columns={[
      {
        id: "name",
        label: "Name",
        sort: { asc: "name_asc", desc: "name_desc" },
        cell: (row) => row.name,
      },
      {
        id: "joined",
        label: "Joined",
        sort: { asc: "oldest", desc: "newest" },
        cell: () => "1 Nov",
      },
    ]}
    rows={props.rows}
    rowKey={(row) => row.id}
    rowHref={(row) => `/admin/accounts/${row.id}`}
    primary={(row) => row.name}
    secondary={() => "joined 1 Nov"}
    view={props.view ?? { q: "", sort: "newest" }}
    total={props.total === undefined ? 2 : props.total}
    nextCursor={props.nextCursor ?? null}
    searchLabel="Search accounts"
    placeholder="Name, email or handle"
  />
);

describe("the view in the address", () => {
  it("keeps only a valid sort, a bounded search and a cursor", () => {
    expect(viewFrom({})).toEqual({ q: "", sort: "newest" });
    expect(viewFrom({ q: "  ada ", sort: "name_desc", cursor: "abc" })).toEqual(
      {
        q: "ada",
        sort: "name_desc",
        cursor: "abc",
      },
    );
    expect(viewFrom({ sort: "drop table", offset: "40" })).toEqual({
      q: "",
      sort: "newest",
    });
    expect(viewFrom({ q: "x".repeat(300) }).q).toHaveLength(100);
  });

  it("writes only what differs from the defaults", () => {
    expect(viewHref("/admin/accounts", { sort: "newest" })).toBe(
      "/admin/accounts",
    );
    expect(
      viewHref("/admin/accounts", { q: "ada", sort: "oldest", cursor: "c1" }),
    ).toBe("/admin/accounts?q=ada&sort=oldest&cursor=c1");
  });
});

describe("the console table", () => {
  it("opens with rows, the total, sort links and the next page", () => {
    render(
      table({
        rows: [
          { id: "a", name: "Ada" },
          { id: "b", name: "Bea" },
        ],
        total: 57,
        nextCursor: "next-1",
      }),
    );
    expect(screen.getByText("57 accounts")).toBeTruthy();
    const grid = document.querySelector("[data-admin-table-grid]");
    if (!(grid instanceof HTMLElement)) throw new Error("no table");
    expect(
      within(grid).getByRole("link", { name: "Ada" }).getAttribute("href"),
    ).toBe("/admin/accounts/a");
    // Newest first is the Joined column, descending; Name is unsorted.
    const joined = within(grid).getByRole("columnheader", { name: /Joined/ });
    expect(joined.getAttribute("aria-sort")).toBe("descending");
    expect(within(joined).getByRole("link").getAttribute("href")).toBe(
      "/admin/accounts?sort=oldest",
    );
    const name = within(grid).getByRole("columnheader", { name: /Name/ });
    expect(name.getAttribute("aria-sort")).toBe("none");
    expect(within(name).getByRole("link").getAttribute("href")).toBe(
      "/admin/accounts?sort=name_asc",
    );
    expect(
      screen.getByRole("link", { name: "Next page" }).getAttribute("href"),
    ).toBe("/admin/accounts?cursor=next-1");
    expect(screen.queryByRole("link", { name: "First page" })).toBeNull();
    expect(
      screen.getByRole("link", { name: /Download CSV/ }).getAttribute("href"),
    ).toBe("/admin/accounts.csv");
  });

  it("keeps the search and order on every link, and offers the first page later on", () => {
    render(
      table({
        rows: [{ id: "a", name: "Ada" }],
        view: { q: "ada", sort: "name_asc", cursor: "c1" },
        total: 3,
      }),
    );
    expect(screen.getByText(/3 accounts match "ada"/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "First page" }).getAttribute("href"),
    ).toBe("/admin/accounts?q=ada&sort=name_asc");
    expect(
      screen.getByRole("link", { name: /Download CSV/ }).getAttribute("href"),
    ).toBe("/admin/accounts.csv?q=ada&sort=name_asc");
  });

  it("says plainly when nothing matches, and when the read failed", () => {
    render(table({ rows: [], view: { q: "zzz", sort: "newest" }, total: 0 }));
    expect(screen.getByText("No accounts match")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Download CSV/ })).toBeNull();
    cleanup();
    render(table({ rows: null, total: null }));
    expect(screen.getByText("Accounts couldn't load")).toBeTruthy();
  });
});

describe("the spend chart", () => {
  const days = Array.from({ length: 14 }, (_, index) => ({
    day: `2026-11-${String(6 + index).padStart(2, "0")}`,
    pricedUsd: index === 13 ? "12.50" : index === 12 ? "0" : "2.00",
    calls: index === 12 ? 4 : 10,
    unpricedCalls: index === 12 ? 4 : 0,
  }));

  it("draws priced spend only and counts the calls with no price", () => {
    render(<SpendChart days={days} />);
    expect(
      screen.getByText(/\$36\.50 priced · 4 calls had no price/),
    ).toBeTruthy();
    // A day with only unpriced calls has no bar, not a $0 bar.
    expect(document.querySelectorAll("[data-spend-chart] path")).toHaveLength(
      13,
    );
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(15);
  });

  it("names a day's figures on hover or focus", () => {
    render(<SpendChart days={days} />);
    const last = screen.getByRole("button", {
      name: /19 Nov: \$12\.50, 10 calls/,
    });
    fireEvent.focus(last);
    expect(screen.getByRole("status").textContent).toContain(
      "$12.50 · 10 calls",
    );
  });

  it("rounds the axis up to a readable figure", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(12.5)).toBe(20);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(1000)).toBe(1000);
    expect(usd("1234.5")).toBe("$1,234.50");
  });
});

describe("the outbox's age", () => {
  it("is said in the largest whole unit", () => {
    expect(ageWords(45)).toBe("45 s");
    expect(ageWords(600)).toBe("10 min");
    expect(ageWords(10_800)).toBe("3 h");
    expect(ageWords(345_600)).toBe("4 days");
  });
});
