// @vitest-environment jsdom
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * W1.1/W1.7: with the flag off the shell is today's shell (its landmarks,
 * the dock handed to the one Q provider, no workspace markup); with it on,
 * nav | Q pane | page pane, the same one provider, and no dock.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/discover",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
const providerProps: Array<Record<string, unknown>> = [];
vi.mock("../src/components/app-shell/global-q", () => ({
  GlobalQProvider: (props: {
    children: ReactNode;
    dock?: ReactNode;
    workspace?: boolean;
  }) => {
    providerProps.push({
      dock: props.dock !== undefined,
      workspace: props.workspace,
    });
    return (
      <>
        {props.children}
        {props.workspace === true ? null : props.dock}
      </>
    );
  },
}));
const stub = (name: string) => {
  function Stub() {
    return <div data-stub={name} />;
  }
  return Stub;
};
vi.mock("../src/features/documents/document-ready-center-lazy", () => ({
  DocumentReadyCenterAfterPaint: stub("documents"),
}));
vi.mock("../src/features/q-dock/q-dock-lazy", () => ({
  QDockOffQPage: stub("dock"),
}));
vi.mock("../src/features/verification/verify-nudge", () => ({
  VerifyNudgeLink: stub("verify"),
}));
vi.mock("../src/features/wake/wake-indicator", () => ({
  WakeIndicator: stub("wake"),
}));
vi.mock("../src/components/app-shell/app-header", () => ({
  AppHeader: stub("header"),
}));
vi.mock("../src/components/app-shell/phone-lead", () => ({
  ShellPhoneLeadProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../src/components/app-shell/desktop-sidebar", () => ({
  DesktopSidebar: () => <nav data-stub="sidebar" />,
}));
vi.mock("../src/components/app-shell/fictional-names", () => ({
  FictionalNames: stub("fictional"),
}));
vi.mock("../src/components/app-shell/mobile-navigation", () => ({
  MobileNavigation: stub("mobile-nav"),
}));
vi.mock("../src/components/app-shell/network-status", () => ({
  NetworkStatus: stub("network"),
}));
vi.mock("../src/features/i18n/language", () => ({
  Words: ({ children }: { children: ReactNode }) => children,
  useT: () => (english: string) => english,
}));
vi.mock("../src/features/q-aperture", () => ({ QAperture: stub("aperture") }));
vi.mock("../src/features/q/q-session", () => ({
  useQSessionOptional: () => null,
}));

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia;

const { AppShell } = await import("../src/components/app-shell/app-shell");

describe("the shell and the workspace flag", () => {
  it("flag off: today's landmarks, the dock, no workspace markup", () => {
    providerProps.length = 0;
    const { container } = render(
      <AppShell qPane={<div data-q-pane-content />}>
        <h1>Page</h1>
      </AppShell>,
    );
    const shell = container.querySelector(":scope > .cq-shell");
    expect(shell).not.toBeNull();
    expect(shell?.hasAttribute("data-workspace")).toBe(false);
    expect(
      [...(shell?.children ?? [])].map((child) =>
        child.tagName === "A"
          ? "skip"
          : (child.getAttribute("data-stub") ?? child.className),
      ),
    ).toEqual(["skip", "sidebar", "cq-shell-body"]);
    expect(
      container.querySelector(".cq-shell-body > main#main h1"),
    ).not.toBeNull();
    expect(container.querySelector("[data-stub=dock]")).not.toBeNull();
    expect(container.querySelector("[class*=cq-ws-], script")).toBeNull();
    // A Q pane handed in with the flag off is never rendered.
    expect(container.querySelector("[data-q-pane-content]")).toBeNull();
    expect(providerProps).toEqual([{ dock: true, workspace: undefined }]);
  });

  it("flag on: nav | Q pane | page pane, one provider, no dock", () => {
    providerProps.length = 0;
    const { container } = render(
      <AppShell
        workspace={{ enabled: true, available: true }}
        qPane={<div data-q-pane-content />}
      >
        <h1>Page</h1>
      </AppShell>,
    );
    const shell = container.querySelector(".cq-shell[data-workspace]");
    expect(shell).not.toBeNull();
    const columns = [...(shell?.children ?? [])].filter(
      (child) => child.tagName !== "A",
    );
    expect(
      columns.map((c) => c.getAttribute("data-stub") ?? c.tagName),
    ).toEqual(["sidebar", "ASIDE", "DIV"]);
    expect(columns[1]?.querySelector("[data-q-pane-content]")).not.toBeNull();
    expect(columns[2]?.querySelector("main#main h1")).not.toBeNull();
    expect(container.querySelector("[data-stub=dock]")).toBeNull();
    expect(providerProps).toEqual([{ dock: false, workspace: true }]);
  });
});
