// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classifyRoute } from "@/auth/route-policy";
import { isActiveRoute } from "@/components/app-shell/navigation";
import { isAppRoute, redirectedTo } from "@/features/q/control/app-routes";
import { manifestControls, resetControls } from "@/features/q/control/registry";
import { HubNavigation } from "@/features/relationships/hub-navigation";
import {
  crmTarget,
  hubDestinations,
  hubTabs,
} from "@/features/relationships/hub-view";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  context: vi.fn(),
  session: vi.fn(),
  results: vi.fn(),
  usage: vi.fn(),
}));
vi.mock("next/navigation", async (load) => ({
  ...(await load<typeof import("next/navigation")>()),
  redirect: mocks.redirect,
}));
vi.mock("@/features/q/context", () => ({
  resolveOwnContext: mocks.context,
  apiSession: mocks.session,
  qApiSession: mocks.session,
}));
vi.mock("@capital-q/api-client", async (load) => ({
  ...(await load<typeof import("@capital-q/api-client")>()),
  getResults: mocks.results,
  getMyUsage: mocks.usage,
}));
vi.mock("@/features/results/results-dashboard", () => ({
  ResultsDashboard: ({
    heading,
    basePath,
  }: {
    readonly heading?: string;
    readonly basePath: string;
  }) => (
    <div data-testid="dashboard" data-base={basePath}>
      {heading}
    </div>
  ),
}));

const { default: CrmPage } = await import("../app/(app)/crm/page");
const { default: ResultsPage } = await import("../app/(app)/results/page");

afterEach(() => {
  cleanup();
  resetControls();
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    baseUrl: "https://test.invalid",
    accessToken: "fixture",
  });
  mocks.usage.mockResolvedValue(null);
  mocks.context.mockResolvedValue({
    kind: "INVESTOR",
    investorOrganisationId: "a0000000-0000-4000-8000-000000000001",
    label: "Fund",
  });
});

describe("CRM routes: one workspace, no broken links", () => {
  it("/crm forwards to the overview, and to each view's owning route", () => {
    expect(crmTarget({})).toBe("/relationships?view=overview");
    expect(crmTarget({ view: "pipeline", q: "acme", state: "CONNECTED" })).toBe(
      "/relationships?view=pipeline&q=acme&state=CONNECTED",
    );
    expect(crmTarget({ view: "relationships" })).toBe(
      "/relationships?view=relationships",
    );
    expect(crmTarget({ view: "reports", range: "90d", q: "x" })).toBe(
      "/results?range=90d",
    );
    expect(crmTarget({ view: "reports" })).toBe("/results");
  });

  it("/crm fails an unknown view to the overview and drops malformed input", () => {
    expect(crmTarget({ view: "admin" })).toBe("/relationships?view=overview");
    expect(crmTarget({ view: "pipeline", q: ["a", "b"] })).toBe(
      "/relationships?view=pipeline",
    );
    expect(crmTarget({ view: "pipeline", q: "x".repeat(201) })).toBe(
      "/relationships?view=pipeline",
    );
    expect(crmTarget({ view: "pipeline", other: "kept?" })).toBe(
      "/relationships?view=pipeline",
    );
  });

  it("the /crm page redirects server-side", async () => {
    await expect(
      CrmPage({ searchParams: Promise.resolve({ view: "pipeline" }) }),
    ).rejects.toThrow("NEXT_REDIRECT /relationships?view=pipeline");
    await expect(CrmPage()).rejects.toThrow(
      "NEXT_REDIRECT /relationships?view=overview",
    );
  });

  it("keeps every established deep link a page, and /crm protected", () => {
    for (const path of [
      "/crm",
      "/results",
      "/relationships",
      "/relationships?view=overview",
      "/relationships?view=pipeline&layout=board",
      "/relationships/company/c0000000-0000-4000-8000-000000000001",
      "/relationships/company/c0000000-0000-4000-8000-000000000001/calls",
      "/relationships/investor/a0000000-0000-4000-8000-000000000001/diligence",
      "/relationships/investor/a0000000-0000-4000-8000-000000000001/messages",
    ]) {
      expect(isAppRoute(path), path).toBe(true);
    }
    expect(classifyRoute("/crm")).toBe("protected");
    expect(classifyRoute("/results")).toBe("protected");
  });

  it("Q's moves to /crm are verified where the alias sent them", () => {
    expect(redirectedTo("/crm", "/relationships?view=overview")).toBe(true);
    expect(redirectedTo("/crm?view=reports", "/results")).toBe(true);
    expect(redirectedTo("/crm", "/discover")).toBe(false);
  });

  it("marks the CRM entry current on Reports and the alias, without prefix leaks", () => {
    expect(isActiveRoute("/relationships", "/relationships")).toBe(true);
    expect(isActiveRoute("/results", "/relationships")).toBe(true);
    expect(isActiveRoute("/crm", "/relationships")).toBe(true);
    expect(isActiveRoute("/resultsx", "/relationships")).toBe(false);
    expect(isActiveRoute("/results", "/profile")).toBe(false);
  });
});

describe("CRM tabs", () => {
  it("shows Reports only to a side that has reports, never as a duplicate link", () => {
    expect(hubTabs("NONE").map((tab) => tab.view)).toEqual([
      "overview",
      "pipeline",
      "relationships",
    ]);
    expect(hubTabs("INVESTOR").at(-1)).toEqual({
      view: "reports",
      label: "Reports",
      href: "/results",
    });
    for (const side of ["INVESTOR", "COMPANY"] as const) {
      expect(hubDestinations(side).map((entry) => entry.href)).not.toContain(
        "/results",
      );
    }
  });

  it("marks Reports current and keeps Q's existing Results control id", () => {
    render(<HubNavigation side="COMPANY" view="reports" />);
    const nav = screen.getByRole("navigation", { name: "CRM" });
    const reports = within(nav).getByRole("link", { name: "Reports" });
    expect(reports.getAttribute("href")).toBe("/results");
    expect(reports.getAttribute("aria-current")).toBe("page");
    expect(
      within(nav)
        .getByRole("link", { name: "Overview" })
        .hasAttribute("aria-current"),
    ).toBe(false);
    expect(within(nav).getAllByRole("link", { name: "Reports" })).toHaveLength(
      1,
    );
    expect(
      manifestControls().some((entry) => entry.id === "button.hub-results"),
    ).toBe(true);
  });
});

describe("Results inside the CRM", () => {
  it("renders the investor's Investment Hub with Reports open and downloads kept", async () => {
    mocks.results.mockResolvedValue({ side: "INVESTOR", pipelineFit: [] });
    render(await ResultsPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Investment Hub" }),
    ).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Reports" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByTestId("dashboard").getAttribute("data-base")).toBe(
      "/results",
    );
    expect(screen.getByTestId("dashboard").textContent).toBe("Reports");
  });

  it("renders the founder's Fundraising Hub and keeps an older custom period link", async () => {
    mocks.context.mockResolvedValue({
      kind: "FOUNDER",
      companyId: "c0000000-0000-4000-8000-000000000001",
      label: "Company",
    });
    mocks.results.mockResolvedValue({
      side: "FOUNDER",
      pipeline: { rows: [], byState: [] },
    });
    render(
      await ResultsPage({
        searchParams: Promise.resolve({ from: "2026-09-01", to: "2026-09-30" }),
      }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Fundraising Hub" }),
    ).toBeDefined();
    expect(mocks.results).toHaveBeenCalledWith(expect.anything(), {
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("says Reports couldn't load rather than inventing a zero report", async () => {
    mocks.results.mockRejectedValue(new Error("Unavailable"));
    render(await ResultsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Reports couldn't load")).toBeDefined();
    expect(screen.queryByTestId("dashboard")).toBeNull();
  });
});
