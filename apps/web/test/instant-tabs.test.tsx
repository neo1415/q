// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/relationships", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// A plain anchor in place of Next's Link: the click is the app's, the
// navigation (which needs a mounted App Router) is not under test here.
vi.mock("next/link", () => ({
  default: ({
    prefetch: _prefetch,
    onClick,
    ...props
  }: ComponentProps<"a"> & { readonly prefetch?: unknown }) => (
    <a
      {...props}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
    />
  ),
  useLinkStatus: () => ({ pending: false }),
}));

import { QSubjectProvider, type QSubject } from "@/features/q/q-subject";
import { HubNavigation } from "@/features/relationships/hub-navigation";
import { HubLoadingTabs } from "@/features/relationships/hub-loading-tabs";
import { WorkNavigation } from "@/features/work/work-navigation";
import { currentManifest } from "@/features/q/manifest";
import { resetControls } from "@/features/q/control/registry";

import GateqLoading from "../app/(app)/gateq/loading";
import InvestorsLoading from "../app/(app)/investors/loading";
import RehearsalsLoading from "../app/(app)/rehearsals/loading";
import DailyLoading from "../app/(app)/daily/loading";

afterEach(() => {
  cleanup();
  resetControls();
  nav.pathname = "/relationships";
  nav.search = "";
});

const INVESTOR: QSubject = {
  kind: "INVESTOR_ORGANISATION",
  investorOrganisationId: "a0000000-0000-4000-8000-000000000001",
  scope: "investor_private",
};
const FOUNDER: QSubject = {
  kind: "COMPANY",
  companyId: "c0000000-0000-4000-8000-000000000001",
  scope: "founder_private",
};

const current = (name: string) =>
  screen.getByRole("link", { name }).getAttribute("aria-current");

describe("optimistic tab selection", () => {
  it("draws the clicked CRM tab open at once, and follows the server's view after", () => {
    const page = render(<HubNavigation view="overview" side="INVESTOR" />);
    fireEvent.click(screen.getByRole("link", { name: "Pipeline" }));
    expect(current("Pipeline")).toBe("page");
    expect(current("Overview")).toBeNull();
    // Q's page state is still the server's view until the page arrives.
    expect(currentManifest()?.filters).toMatchObject({ view: "overview" });
    page.rerender(<HubNavigation view="pipeline" side="INVESTOR" />);
    expect(current("Pipeline")).toBe("page");
    // A later server view is drawn as it is: the choice belonged to the old one.
    page.rerender(<HubNavigation view="capital" side="INVESTOR" />);
    expect(current("Capital")).toBe("page");
    expect(current("Pipeline")).toBeNull();
  });
  it("leaves the open tab alone for a click that opens a new tab or window", () => {
    render(<HubNavigation view="overview" side="INVESTOR" />);
    fireEvent.click(screen.getByRole("link", { name: "Pipeline" }), {
      metaKey: true,
    });
    fireEvent.click(screen.getByRole("link", { name: "Capital" }), {
      ctrlKey: true,
    });
    expect(current("Overview")).toBe("page");
  });
  it("drops the choice on back or forward", () => {
    render(<HubNavigation view="overview" side="INVESTOR" />);
    fireEvent.click(screen.getByRole("link", { name: "GateQ" }));
    expect(current("GateQ")).toBe("page");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(current("Overview")).toBe("page");
  });
  it("draws the clicked Work tab open at once", () => {
    render(<WorkNavigation view="tasks" side="COMPANY" />);
    fireEvent.click(screen.getByRole("link", { name: "Documents" }));
    expect(current("Documents")).toBe("page");
    expect(current("Tasks")).toBeNull();
  });
});

const strip = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-loading-tab]")].map(
    (tab) =>
      `${tab.textContent ?? ""}${tab.hasAttribute("data-open") ? "*" : ""}`,
  );

describe("loading strips", () => {
  it("draws the person's own CRM tabs, the destination marked", () => {
    nav.search = "view=pipeline";
    const { container } = render(
      <QSubjectProvider own={INVESTOR}>
        <HubLoadingTabs />
      </QSubjectProvider>,
    );
    // An investor sees all five tabs, not the three every side has.
    expect(strip(container)).toEqual([
      "Overview",
      "Pipeline*",
      "Capital",
      "GateQ",
      "Company requests",
    ]);
  });
  it("marks a founder's GateQ tab on /gateq", () => {
    nav.pathname = "/gateq";
    const { container } = render(
      <QSubjectProvider own={FOUNDER}>
        <GateqLoading />
      </QSubjectProvider>,
    );
    expect(strip(container)).toEqual([
      "Overview",
      "Pipeline",
      "Capital",
      "GateQ*",
    ]);
  });
  it("is neutral when the person is not known: the common tabs and the destination", () => {
    nav.pathname = "/gateq";
    const { container } = render(<GateqLoading />);
    expect(strip(container)).toEqual([
      "Overview",
      "Pipeline",
      "Capital",
      "GateQ*",
    ]);
  });
  it("marks company requests for an investor, and keeps the app frame for a founder's directory", () => {
    nav.pathname = "/investors";
    const investor = render(
      <QSubjectProvider own={INVESTOR}>
        <InvestorsLoading />
      </QSubjectProvider>,
    );
    expect(strip(investor.container)).toContain("Company requests*");
    investor.unmount();
    const founder = render(
      <QSubjectProvider own={FOUNDER}>
        <InvestorsLoading />
      </QSubjectProvider>,
    );
    expect(founder.container.querySelector("[data-loading-tabs]")).toBeNull();
    expect(
      founder.container.querySelector("[data-page-skeleton]"),
    ).not.toBeNull();
  });
  it("draws Work's header strip on a Work tab, and only on its index page", () => {
    nav.pathname = "/rehearsals";
    const index = render(
      <QSubjectProvider own={FOUNDER}>
        <RehearsalsLoading />
      </QSubjectProvider>,
    );
    expect(strip(index.container)).toEqual([
      "Tasks",
      "Board",
      "Documents",
      "Pitch",
      "Rehearsals*",
      "The Q Daily",
    ]);
    expect(
      screen.getByRole("status", { name: "Loading your rehearsals" }),
    ).toBeDefined();
    index.unmount();
    // A page under /rehearsals is not the Rehearsals tab.
    nav.pathname = "/rehearsals/live";
    const nested = render(
      <QSubjectProvider own={FOUNDER}>
        <RehearsalsLoading />
      </QSubjectProvider>,
    );
    expect(nested.container.querySelector("[data-loading-tabs]")).toBeNull();
    expect(
      nested.container.querySelector("[data-page-skeleton]"),
    ).not.toBeNull();
  });
  it("keeps the newspaper's shape under Work's strip on The Q Daily", () => {
    nav.pathname = "/daily";
    const { container } = render(
      <QSubjectProvider own={INVESTOR}>
        <DailyLoading />
      </QSubjectProvider>,
    );
    expect(strip(container)).toEqual([
      "Tasks",
      "Board",
      "Documents",
      "Rehearsals",
      "The Q Daily*",
    ]);
    expect(container.querySelector("[data-daily-loading]")).not.toBeNull();
    // No heading or text that would change when the page arrives.
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
