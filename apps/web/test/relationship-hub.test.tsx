// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HubNavigation } from "@/features/relationships/hub-navigation";
import { hubViewOf } from "@/features/relationships/hub-view";
import {
  controlOf,
  manifestControls,
  resetControls,
} from "@/features/q/control/registry";
import { performOnControl } from "@/features/q/control/perform";
import { noteRoute, resetRouteState } from "@/features/q/control/route-state";
import { currentManifest } from "@/features/q/manifest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  results: vi.fn(),
  relationships: vi.fn(),
}));
vi.mock("@/features/q/context", () => ({
  resolveOwnContext: mocks.context,
  apiSession: mocks.session,
  qApiSession: mocks.session,
}));
vi.mock("@/features/relationships/relationship-data", () => ({
  ownRelationships: mocks.relationships,
  relationshipDigests: vi.fn(),
}));
vi.mock("@capital-q/api-client", async (load) => ({
  ...(await load<typeof import("@capital-q/api-client")>()),
  getResults: mocks.results,
}));
vi.mock("@/features/results/results-dashboard", () => ({
  ResultsDashboard: ({
    results,
  }: {
    readonly results: { readonly organisationName: string };
  }) => <div>{results.organisationName}</div>,
}));
const { default: RelationshipsPage } =
  await import("../app/(app)/relationships/page");

afterEach(() => {
  cleanup();
  resetControls();
  resetRouteState();
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    baseUrl: "https://test.invalid",
    accessToken: "fixture",
  });
  mocks.context.mockResolvedValue({
    kind: "INVESTOR",
    investorOrganisationId: "a0000000-0000-4000-8000-000000000001",
    label: "Fund",
  });
});

async function overview() {
  render(
    await RelationshipsPage({
      searchParams: Promise.resolve({ view: "overview" }),
    }),
  );
}

describe("Hub foundation", () => {
  it("preserves old record-list links and fails unknown views to the existing list", () => {
    expect(hubViewOf(undefined)).toBe("relationships");
    expect(hubViewOf("invalid")).toBe("relationships");
    expect(hubViewOf("overview")).toBe("overview");
  });
  it("offers investor inbox without founder-only Capital or application links", () => {
    render(<HubNavigation side="INVESTOR" view="overview" />);
    expect(
      screen
        .getByRole("link", { name: "Investment inbox" })
        .getAttribute("href"),
    ).toBe("/gateq?tab=inbox");
    expect(screen.queryByRole("link", { name: "Capital" })).toBeNull();
    expect(screen.queryByRole("link", { name: "My applications" })).toBeNull();
    expect(
      manifestControls().find((entry) => entry.id === "tab.overview")?.state,
    ).toBe("SELECTED");
    expect(currentManifest()?.filters).toMatchObject({ view: "overview" });
  });
  it("offers founder applications and Capital without investor inbox", () => {
    render(<HubNavigation side="COMPANY" view="relationships" />);
    expect(
      screen
        .getByRole("link", { name: "My applications" })
        .getAttribute("href"),
    ).toBe("/gateq?tab=applications");
    expect(
      screen.getByRole("link", { name: "Capital" }).getAttribute("href"),
    ).toBe("/capital");
    expect(screen.queryByRole("link", { name: "Investment inbox" })).toBeNull();
    expect(
      manifestControls().find((entry) => entry.id === "tab.relationships")
        ?.state,
    ).toBe("SELECTED");
  });
  it("registers only rendered role destinations and confirms already selected tab", async () => {
    render(<HubNavigation side="COMPANY" view="overview" />);
    expect(
      manifestControls().some((entry) => entry.id === "button.hub-gateq"),
    ).toBe(true);
    noteRoute("/relationships?view=overview");
    const entry = controlOf("tab.overview");
    expect(entry).toBeDefined();
    if (entry === undefined) throw new Error("Missing overview control");
    expect(
      await performOnControl(entry, {
        kind: "UI_ACT",
        actId: "uia_huboverview01",
        act: "SELECT_TAB",
        target: "tab.overview",
      }),
    ).toBe("DONE");
  });
  it("confirms a tab switch only after the actual route and selected state settle", async () => {
    const page = render(<HubNavigation side="INVESTOR" view="overview" />);
    noteRoute("/relationships?view=overview");
    const link = screen.getByRole("link", { name: "Relationships" });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      page.rerender(<HubNavigation side="INVESTOR" view="relationships" />);
      noteRoute("/relationships?view=relationships");
    });
    const entry = controlOf("tab.relationships");
    if (entry === undefined) throw new Error("Missing relationships control");
    let receipt: string | undefined;
    await act(async () => {
      receipt = await performOnControl(entry, {
        kind: "UI_ACT",
        actId: "uia_hubrecords01",
        act: "SELECT_TAB",
        target: "tab.relationships",
      });
    });
    expect(receipt).toBe("DONE");
    expect(
      screen
        .getByRole("link", { name: "Relationships" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
  it("renders authorized investor overview and never loads hidden board data", async () => {
    mocks.results.mockResolvedValue({
      side: "INVESTOR",
      organisationName: "Authorized fund",
      pipelineFit: [],
    });
    await overview();
    expect(
      screen.getByRole("heading", { name: "Investment Hub" }),
    ).toBeDefined();
    expect(screen.getByText("Authorized fund")).toBeDefined();
    expect(mocks.relationships).not.toHaveBeenCalled();
    expect(mocks.results).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "fixture" }),
      { range: "30d" },
    );
  });
  it("exposes only authorized loaded counterpart IDs to Q", async () => {
    const companyId = "c0000000-0000-4000-8000-000000000001";
    mocks.results.mockResolvedValue({
      side: "INVESTOR",
      organisationName: "Fund",
      pipelineFit: [{ companyId, companyName: "Company", state: "CONNECTED" }],
    });
    await overview();
    expect(
      currentManifest()?.sections.find(
        (section) => section.id === "hub-overview",
      )?.refs,
    ).toEqual([{ kind: "COMPANY", id: companyId }]);
    expect(
      manifestControls().some((entry) => entry.id === "list.relationships"),
    ).toBe(false);
  });
  it("renders the founder perspective from its own authorized read", async () => {
    mocks.context.mockResolvedValue({
      kind: "FOUNDER",
      companyId: "c0000000-0000-4000-8000-000000000001",
      label: "Company",
    });
    mocks.results.mockResolvedValue({
      side: "FOUNDER",
      organisationName: "Founder company",
      pipeline: { rows: [], byState: [] },
    });
    await overview();
    expect(
      screen.getByRole("heading", { name: "Fundraising Hub" }),
    ).toBeDefined();
    expect(screen.getByText("Founder company")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Investment inbox" })).toBeNull();
  });
  it("does not expose a conflicting role projection", async () => {
    mocks.results.mockResolvedValue({
      side: "FOUNDER",
      organisationName: "Private company",
      pipeline: { rows: [], byState: [] },
    });
    await overview();
    expect(screen.getByText("Overview couldn't load")).toBeDefined();
    expect(screen.queryByText("Private company")).toBeNull();
  });
  it("shows recoverable failure rather than fabricated zero counts", async () => {
    mocks.results.mockRejectedValue(new Error("Unavailable"));
    await overview();
    expect(
      screen.getByRole("link", { name: "Try again" }).getAttribute("href"),
    ).toBe("/relationships?view=overview");
  });
  it("shows setup for confirmed absent context without querying scoped data", async () => {
    mocks.context.mockResolvedValue({ kind: "NONE" });
    await overview();
    expect(
      screen.getByRole("link", { name: "Set up" }).getAttribute("href"),
    ).toBe("/welcome");
    expect(mocks.results).not.toHaveBeenCalled();
  });
  it("keeps unavailable context distinct from absent organisation", async () => {
    mocks.context.mockResolvedValue({ kind: "NONE", unavailable: true });
    await overview();
    expect(screen.getByText("Overview couldn't load")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Set up" })).toBeNull();
  });
});
