// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * W1.2–W1.4, W1.6: the workspace panes. The Q pane is mounted once and is
 * never remounted by a page change; the separator resizes by keyboard; the
 * subtle pane controls collapse and expand through the one layout store;
 * on a phone, Q's move gives a peek bar and the person's own link opens
 * the sheet.
 */
let pathname = "/discover";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("../src/features/q-aperture", () => ({
  QAperture: () => <span data-testid="aperture" />,
}));
vi.mock("../src/features/q/q-session", () => ({
  useQSessionOptional: () => null,
}));
vi.mock("../src/features/i18n/language", () => ({
  useT: () => (english: string) => english,
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

const { WorkspacePagePane, WorkspaceQPane } =
  await import("../src/features/workspace/workspace-panes");
const { resetWorkspaceLayoutForTests } =
  await import("../src/features/workspace/layout-store");

let mounts = 0;
function QConversationStub() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <div data-testid="q-conversation">Q</div>;
}

function Shell({ page }: { readonly page: ReactNode }) {
  return (
    <div className="cq-shell" data-workspace>
      <WorkspaceQPane>
        <QConversationStub />
      </WorkspaceQPane>
      <WorkspacePagePane>
        <main id="main">{page}</main>
      </WorkspacePagePane>
    </div>
  );
}

const root = document.documentElement;
beforeEach(() => {
  mounts = 0;
  phone = false;
  pathname = "/discover";
  installMatchMedia();
  window.localStorage.clear();
  resetWorkspaceLayoutForTests();
  root.removeAttribute("data-cq-ws-q");
  root.removeAttribute("data-cq-ws-page");
});

describe("the Q pane", () => {
  it("is not remounted when the page changes", () => {
    const view = render(<Shell page={<h1>Discover</h1>} />);
    const node = screen.getByTestId("q-conversation");
    pathname = "/capital";
    view.rerender(<Shell page={<h1>Capital</h1>} />);
    pathname = "/relationships";
    view.rerender(<Shell page={<h1>Relationships</h1>} />);
    expect(mounts).toBe(1);
    expect(screen.getByTestId("q-conversation")).toBe(node);
    expect(screen.getByRole("heading").textContent).toBe("Relationships");
  });

  it("resizes by keyboard: arrows by 24 px, Home/End to the limits", () => {
    render(<Shell page={null} />);
    const separator = screen.getByRole("separator", { name: "Resize Q" });
    expect(separator.getAttribute("aria-valuenow")).toBe("380");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator.getAttribute("aria-valuenow")).toBe("404");
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator.getAttribute("aria-valuenow")).toBe("356");
    fireEvent.keyDown(separator, { key: "End" });
    expect(separator.getAttribute("aria-valuenow")).toBe("640");
    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator.getAttribute("aria-valuenow")).toBe("300");
    fireEvent.doubleClick(separator);
    expect(separator.getAttribute("aria-valuenow")).toBe("380");
    expect(root.style.getPropertyValue("--cq-ws-q-width")).toBe("380px");
  });

  it("collapses and expands each pane with its labelled control", () => {
    render(<Shell page={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide Q" }));
    expect(root.getAttribute("data-cq-ws-q")).toBe("collapsed");
    fireEvent.click(screen.getByRole("button", { name: "Show Q" }));
    expect(root.hasAttribute("data-cq-ws-q")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Hide pages" }));
    expect(root.getAttribute("data-cq-ws-page")).toBe("collapsed");
    fireEvent.click(screen.getByRole("button", { name: "Show pages" }));
    expect(root.hasAttribute("data-cq-ws-page")).toBe(false);
    // Collapsing Q keeps the conversation mounted.
    expect(mounts).toBe(1);
  });
});

describe("on a phone", () => {
  it("Q's move shows the peek bar; View opens the sheet; Back to Q closes it", async () => {
    phone = true;
    installMatchMedia();
    pathname = "/home";
    const view = render(<Shell page={null} />);
    const pane = document.querySelector("[data-ws-page]");
    expect(pane?.getAttribute("data-ws-sheet")).toBe("closed");
    document.title = "Messages · Capital Q";
    pathname = "/relationships/company/x/messages";
    view.rerender(<Shell page={<h1>Messages</h1>} />);
    const peek = await screen.findByRole("button", {
      name: /Opened Messages/u,
    });
    fireEvent.click(peek);
    expect(pane?.getAttribute("data-ws-sheet")).toBe("open");
    fireEvent.click(screen.getByRole("button", { name: "Back to Q" }));
    expect(pane?.getAttribute("data-ws-sheet")).toBe("closed");
    expect(mounts).toBe(1);
  });

  it("the person's own link press opens the sheet straight away", () => {
    phone = true;
    installMatchMedia();
    pathname = "/home";
    const view = render(<Shell page={<a href="/capital">Capital</a>} />);
    fireEvent.click(screen.getByText("Capital"));
    pathname = "/capital";
    view.rerender(<Shell page={<h1>Capital</h1>} />);
    expect(
      document.querySelector("[data-ws-page]")?.getAttribute("data-ws-sheet"),
    ).toBe("open");
    expect(screen.queryByRole("button", { name: /Opened/u })).toBeNull();
  });

  it("an open sheet follows Q's moves", () => {
    phone = true;
    installMatchMedia();
    pathname = "/discover";
    const view = render(<Shell page={<h1>Discover</h1>} />);
    const pane = document.querySelector("[data-ws-page]");
    expect(pane?.getAttribute("data-ws-sheet")).toBe("open");
    pathname = "/capital";
    view.rerender(<Shell page={<h1>Capital</h1>} />);
    expect(pane?.getAttribute("data-ws-sheet")).toBe("open");
    expect(screen.getByRole("heading").textContent).toBe("Capital");
  });
});
