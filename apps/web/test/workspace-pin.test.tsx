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

import type { QNavigationOfferBlock } from "@capital-q/contracts";

/**
 * Pinned workspace (owner addendum, 13 Nov 2026): a Pin/Unpin toggle on
 * the page pane; Q is told (screen.workspace.pinned); Q's own moves are
 * held in the browser; the person's own moves always work and never
 * unpin; "Unpin and open" unpins, then opens; the pin survives a remount
 * (sessionStorage) within the tab.
 */
let pathname = "/discover";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("../src/features/q-aperture", () => ({
  QAperture: () => <span data-testid="aperture" />,
}));

let phone = false;
function installMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes("max-width: 860px"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

const { WorkspacePagePane } =
  await import("../src/features/workspace/workspace-panes");
const { resetWorkspaceLayoutForTests } =
  await import("../src/features/workspace/layout-store");
const pin = await import("../src/features/workspace/workspace-pin");
const { workspaceScreen } =
  await import("../src/features/workspace/workspace-screen");
const actions = await import("../src/features/q/client-actions");
const { resetNavigationLifecycle } =
  await import("../src/features/q/control/navigation-lifecycle");
const { resetSettledOffers } =
  await import("../src/features/q/navigation-offer-card");
const { QResultBlocks } = await import("../src/features/q/q-result-blocks");
const { loadWire } = await import("../src/features/q/wire");
const { performTurnChain } =
  await import("../src/features/voice/use-follow-turn");

function Shell({ children }: { readonly children?: ReactNode }) {
  return (
    <div className="cq-shell" data-workspace>
      <WorkspacePagePane>
        <main id="main">page</main>
      </WorkspacePagePane>
      {children}
    </div>
  );
}

let pushes: string[] = [];
beforeAll(async () => {
  await loadWire();
}, 30_000);
beforeEach(() => {
  phone = false;
  pathname = "/discover";
  installMatchMedia();
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetWorkspaceLayoutForTests();
  pin.resetWorkspacePinForTests();
  pushes = [];
  actions.registerClientRouter((path) => pushes.push(path));
});
afterEach(() => {
  cleanup();
  actions.registerClientRouter(null);
  resetNavigationLifecycle();
  resetSettledOffers();
});

const toggle = () => screen.getByRole("button", { name: "Pin workspace" });

describe("the Pin control", () => {
  it("toggles with aria-pressed, shows a non-colour indicator and tells Q", () => {
    render(<Shell />);
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(workspaceScreen()?.pinned).toBeUndefined();
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(toggle().textContent).toContain("Pinned");
    expect(screen.getByRole("status").textContent).toBe("Workspace pinned");
    expect(workspaceScreen()?.pinned).toBe(true);
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(workspaceScreen()?.pinned).toBeUndefined();
  });

  it("is a native button, so it is keyboard reachable", () => {
    render(<Shell />);
    const button = toggle();
    expect(button.tagName).toBe("BUTTON");
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it("shows on the phone's page sheet too", () => {
    phone = true;
    render(<Shell />);
    expect(toggle().getAttribute("data-ws-pin")).toBe("sheet");
  });

  it("survives a remount and a reload of the tab (sessionStorage)", () => {
    const { unmount } = render(<Shell />);
    fireEvent.click(toggle());
    unmount();
    pin.resetWorkspacePinForTests(); // a reload: memory gone, storage kept
    render(<Shell />);
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(window.sessionStorage.getItem(pin.PIN_STORAGE_KEY)).toBe("1");
  });
});

describe("Q's moves while pinned", () => {
  it("Q's answer move is held; unpinned it moves", () => {
    render(<Shell />);
    fireEvent.click(toggle());
    expect(actions.answerMove("/relationships?view=pipeline")).toBe(false);
    expect(pushes).toEqual([]);
    fireEvent.click(toggle());
    expect(actions.answerMove("/relationships?view=pipeline")).toBe(true);
    expect(pushes).toEqual(["/relationships?view=pipeline"]);
  });

  it("a spoken move is held too", () => {
    render(<Shell />);
    fireEvent.click(toggle());
    const moved: string[] = [];
    performTurnChain(
      { navigate: "DISCOVER" } as never,
      () => true,
      (path) => moved.push(path),
      () => undefined,
    );
    expect(moved).toEqual([]);
  });

  it("the person's own moves still work and do not unpin", () => {
    render(<Shell />);
    fireEvent.click(toggle());
    actions.openOfferedPage("/relationships?view=pipeline");
    expect(pushes).toEqual(["/relationships?view=pipeline"]);
    expect(pin.workspacePinned()).toBe(true);
  });
});

describe("offers while pinned", () => {
  const OFFER: QNavigationOfferBlock = {
    kind: "NAVIGATION_OFFER",
    intent: { kind: "NAVIGATE", destination: "CRM_PIPELINE" },
    place: "Pipeline",
    openLabel: "Open Pipeline",
  };

  it("'Unpin and open' unpins, then opens the place", () => {
    render(
      <Shell>
        <QResultBlocks blocks={[{ ...OFFER, unpin: true }]} turnId="m-unpin" />
      </Shell>,
    );
    fireEvent.click(toggle());
    expect(
      screen.getByText("Workspace pinned", { selector: "span.cq-label" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Unpin and open Pipeline" }),
    );
    expect(pin.workspacePinned()).toBe(false);
    expect(pushes).toEqual(["/relationships?view=pipeline"]);
  });

  it("an ordinary offer's Open moves and keeps the pin", () => {
    render(
      <Shell>
        <QResultBlocks blocks={[OFFER]} turnId="m-plain" />
      </Shell>,
    );
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: "Open Pipeline" }));
    expect(pushes).toEqual(["/relationships?view=pipeline"]);
    expect(pin.workspacePinned()).toBe(true);
  });
});
