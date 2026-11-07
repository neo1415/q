// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  resetWorkspaceLayoutForTests,
  setPane,
} from "../src/features/workspace/layout-store";
import {
  BUSY_WINDOW_MS,
  fitPath,
  notePageActivity,
  notePageMove,
  resetWorkspaceScreenForTests,
  useDirty,
  watchPageActivity,
  workspaceScreen,
} from "../src/features/workspace/workspace-screen";

/**
 * screen.workspace (W1 for W3/W4): what Q is told about the workspace each
 * turn. Absent unless the shell is on; the page before Q's own move; unsaved
 * work a page registered; the person's own recent input in the page pane.
 */
let shell: HTMLElement | null = null;
function mountShell() {
  shell = document.createElement("div");
  shell.className = "cq-shell";
  shell.setAttribute("data-workspace", "");
  document.body.append(shell);
}

beforeEach(() => {
  shell?.remove();
  shell = null;
  window.localStorage.clear();
  resetWorkspaceLayoutForTests();
  resetWorkspaceScreenForTests();
  window.history.replaceState(null, "", "/capital?round=r1");
});

function Form({ dirty }: { readonly dirty: boolean }) {
  useDirty(dirty);
  return null;
}

describe("screen.workspace", () => {
  it("is absent when the workspace shell is not on screen", () => {
    expect(workspaceScreen()).toBeUndefined();
  });

  it("carries the panes and the page side's place", () => {
    mountShell();
    setPane("pagePane", "collapsed");
    expect(workspaceScreen(0)).toEqual({
      qPane: "open",
      pagePane: "collapsed",
      at: "/capital?round=r1",
    });
  });

  it("names the page before Q's move, never before the person's own", () => {
    mountShell();
    notePageMove("/discover", true);
    expect(workspaceScreen(0)?.previous).toBeUndefined();
    notePageMove("/relationships", false);
    expect(workspaceScreen(0)?.previous).toBe("/relationships");
  });

  it("says dirty while a page holds unsaved work", () => {
    mountShell();
    const view = render(<Form dirty />);
    expect(workspaceScreen(0)?.dirty).toBe(true);
    view.rerender(<Form dirty={false} />);
    expect(workspaceScreen(0)?.dirty).toBeUndefined();
    view.rerender(<Form dirty />);
    view.unmount();
    expect(workspaceScreen(0)?.dirty).toBeUndefined();
  });

  it("says busy only within ~2 s of the person's own input in the page pane", () => {
    mountShell();
    const pane = document.createElement("div");
    document.body.append(pane);
    const stop = watchPageActivity(pane);
    const before = Date.now();
    pane.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    expect(workspaceScreen(before + 10)?.busy).toBe(true);
    expect(workspaceScreen(before + BUSY_WINDOW_MS + 50)?.busy).toBeUndefined();
    stop();
    notePageActivity(Number.NEGATIVE_INFINITY);
    pane.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    expect(workspaceScreen(Date.now())?.busy).toBeUndefined();
    pane.remove();
  });

  it("keeps paths within the contract's limit, never voiding the request", () => {
    expect(fitPath("/capital?round=r1")).toBe("/capital?round=r1");
    const longQuery = `/discover?${"q=x&".repeat(200)}`;
    expect(fitPath(longQuery)).toBe("/discover");
    expect(fitPath(`/${"a".repeat(600)}`)).toBeUndefined();
    expect(fitPath(undefined)).toBeUndefined();
  });

  it("rides on currentScreen only while the shell is on, valid to the contract", async () => {
    const { currentScreen } = await import("../src/features/q/screen");
    const { QScreenContextSchema } = await import("@capital-q/contracts");
    expect(currentScreen("/capital").workspace).toBeUndefined();
    mountShell();
    const screen = currentScreen("/capital");
    expect(screen.workspace).toMatchObject({
      qPane: "open",
      pagePane: "open",
      at: "/capital?round=r1",
    });
    expect(QScreenContextSchema.safeParse(screen).success).toBe(true);
  });
});
