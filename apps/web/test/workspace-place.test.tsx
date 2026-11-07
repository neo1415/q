// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { QNavigationOfferBlock, QResultBlock } from "@capital-q/contracts";

/**
 * W1 batch 6 (live): after Q moved the page pane to a place, its reply still
 * offered "Open <that page>". In the workspace a link to the place the page
 * pane already shows is dropped; with the pane folded it becomes "Show the
 * page"; anywhere else, and with the workspace off, the card is unchanged.
 */
let pathname = "/relationships";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { QResultBlocks } = await import("../src/features/q/q-result-blocks");
const { resetSettledOffers } =
  await import("../src/features/q/navigation-offer-card");
const { WorkspaceProvider } =
  await import("../src/features/workspace/workspace-context");
const { samePlace } = await import("../src/features/workspace/workspace-place");
const { getWorkspaceLayout, resetWorkspaceLayoutForTests, setPane } =
  await import("../src/features/workspace/layout-store");
const { loadWire } = await import("../src/features/q/wire");

beforeAll(async () => {
  await loadWire();
}, 30_000);

const OFFER: QNavigationOfferBlock = {
  kind: "NAVIGATION_OFFER",
  intent: { kind: "NAVIGATE", destination: "CRM_PIPELINE" },
  place: "Relationships",
  openLabel: "Open pipeline",
};
const LINK: QResultBlock = {
  kind: "UI_INTENT",
  intent: { kind: "NAVIGATE", destination: "CRM_PIPELINE" },
};

function inWorkspace(enabled: boolean, children: ReactNode) {
  return (
    <WorkspaceProvider mode={{ enabled, available: true }}>
      {children}
    </WorkspaceProvider>
  );
}

beforeEach(() => {
  pathname = "/relationships";
  window.history.replaceState(null, "", "/relationships?view=pipeline");
  window.localStorage.clear();
  resetWorkspaceLayoutForTests();
});
afterEach(() => {
  cleanup();
  resetSettledOffers();
});

describe("samePlace", () => {
  it("is the same path with every query value the link names", () => {
    const on = new URLSearchParams("view=pipeline&x=1");
    expect(
      samePlace("/relationships?view=pipeline", "/relationships", on),
    ).toBe(true);
    expect(samePlace("/relationships", "/relationships/", on)).toBe(true);
    expect(samePlace("/relationships?view=capital", "/relationships", on)).toBe(
      false,
    );
    expect(samePlace("/capital", "/relationships", on)).toBe(false);
    expect(
      samePlace("https://example.com/relationships", "/relationships", on),
    ).toBe(false);
  });
});

describe("a link to where the page pane already is", () => {
  it("is dropped while the page pane shows that place", () => {
    render(
      inWorkspace(true, <QResultBlocks blocks={[OFFER, LINK]} turnId="m1" />),
    );
    expect(screen.queryByText("Where this lives")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open pipeline" })).toBeNull();
  });

  it("becomes Show the page while the page pane is folded", () => {
    setPane("pagePane", "collapsed");
    render(
      inWorkspace(true, <QResultBlocks blocks={[OFFER, LINK]} turnId="m2" />),
    );
    const shows = screen.getAllByRole("button", { name: "Show the page" });
    expect(shows).toHaveLength(2);
    fireEvent.click(shows[0] as HTMLElement);
    expect(getWorkspaceLayout().pagePane).toBe("open");
  });

  it("is today's card for another place", () => {
    window.history.replaceState(null, "", "/relationships?view=capital");
    render(
      inWorkspace(true, <QResultBlocks blocks={[OFFER, LINK]} turnId="m3" />),
    );
    expect(screen.getByRole("button", { name: "Open pipeline" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /pipeline/iu })).toBeTruthy();
  });

  it("is today's card with the workspace off, even on that place", () => {
    render(
      inWorkspace(false, <QResultBlocks blocks={[OFFER, LINK]} turnId="m4" />),
    );
    expect(screen.getByRole("button", { name: "Open pipeline" })).toBeTruthy();
    expect(screen.getAllByText("Where this lives").length).toBeGreaterThan(0);
  });
});
