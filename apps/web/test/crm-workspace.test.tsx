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
    // Relationships became the Pipeline's List layout (S2).
    expect(crmTarget({ view: "relationships" })).toBe(
      "/relationships?view=pipeline&layout=list",
    );
    expect(crmTarget({ view: "reports", range: "90d", q: "x" })).toBe(
      "/relationships?view=overview&range=90d",
    );
    expect(crmTarget({ view: "reports" })).toBe("/relationships?view=overview");
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
    expect(
      redirectedTo("/crm?view=reports", "/relationships?view=overview"),
    ).toBe(true);
    expect(redirectedTo("/results", "/relationships?view=overview")).toBe(true);
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
  it("has Overview, Pipeline and Capital, no Reports or Relationships tab", () => {
    // Capital is a CRM tab (owner 2026-10-16).
    expect(hubTabs().map((tab) => tab.view)).toEqual([
      "overview",
      "pipeline",
      "capital",
    ]);
    for (const side of ["INVESTOR", "COMPANY"] as const) {
      expect(hubDestinations(side).map((entry) => entry.href)).not.toContain(
        "/results",
      );
    }
  });

  it("GateQ and company requests are CRM tabs, with Q's control ids on them", () => {
    // Owner 2026-10-17: out of the sidebar, into the CRM's tabs.
    expect(hubTabs("INVESTOR").map((tab) => [tab.view, tab.href])).toEqual([
      ["overview", "/relationships?view=overview"],
      ["pipeline", "/relationships?view=pipeline"],
      ["capital", "/relationships?view=capital"],
      ["gateq", "/gateq"],
      ["requests", "/investors"],
    ]);
    expect(hubTabs("COMPANY").map((tab) => [tab.view, tab.href])).toEqual([
      ["overview", "/relationships?view=overview"],
      ["pipeline", "/relationships?view=pipeline"],
      ["capital", "/relationships?view=capital"],
      ["applications", "/gateq?tab=applications"],
    ]);
    render(<HubNavigation view="overview" side="INVESTOR" />);
    const tabs = screen.getByRole("navigation", { name: "CRM" });
    expect(
      within(tabs).getByRole("link", { name: "GateQ" }).getAttribute("href"),
    ).toBe("/gateq");
    expect(
      within(tabs)
        .getByRole("link", { name: "Company requests" })
        .getAttribute("href"),
    ).toBe("/investors");
    expect(within(tabs).queryByRole("link", { name: "Reports" })).toBeNull();
    expect(
      manifestControls().some((entry) => entry.id === "button.hub-gateq"),
    ).toBe(true);
    // Retired with the links they named (Reports merged into Overview;
    // Discover, Capital and Q Work stay reachable from the sidebar and
    // through open_page). The catalog no longer lists them.
    for (const id of [
      "button.hub-results",
      "button.hub-discover",
      "button.hub-capital",
      "button.hub-work",
    ])
      expect(manifestControls().some((entry) => entry.id === id)).toBe(false);
  });
});

describe("Results is the Overview now", () => {
  it("redirects with its period and stage kept", async () => {
    await expect(
      ResultsPage({
        searchParams: Promise.resolve({
          range: "90d",
          stage: "CONNECTED",
          q: "dropped",
        }),
      }),
    ).rejects.toThrow(
      "NEXT_REDIRECT /relationships?view=overview&range=90d&stage=CONNECTED",
    );
    await expect(
      ResultsPage({
        searchParams: Promise.resolve({ from: "2026-09-01", to: "2026-09-30" }),
      }),
    ).rejects.toThrow(
      "NEXT_REDIRECT /relationships?view=overview&from=2026-09-01&to=2026-09-30",
    );
  });
});
