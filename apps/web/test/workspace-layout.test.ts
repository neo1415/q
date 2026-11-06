// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyLayoutSet,
  clampWidth,
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  parseLayout,
  WORKSPACE_BOOT_SCRIPT,
} from "../src/features/workspace/layout-rules";
import {
  getWorkspaceLayout,
  resetWorkspaceLayoutForTests,
  setLayout,
  setPane,
  setQWidth,
} from "../src/features/workspace/layout-store";

/** W1.3–W1.5: the workspace pane layout. */
const root = document.documentElement;

/** Runs the inline boot script as the page would (a <script> in the body). */
function runBootScript(): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func -- the script under test is a string the page inlines; this is how it runs
  const boot = new Function(WORKSPACE_BOOT_SCRIPT) as () => void;
  boot();
}

beforeEach(() => {
  window.localStorage.clear();
  resetWorkspaceLayoutForTests();
  root.removeAttribute("data-cq-ws-q");
  root.removeAttribute("data-cq-ws-page");
  root.style.removeProperty("--cq-ws-q-width");
});

describe("layout rules", () => {
  it("clamps the Q pane to 300–640 px", () => {
    expect(clampWidth(100)).toBe(300);
    expect(clampWidth(900)).toBe(640);
    expect(clampWidth(Number.NaN)).toBe(380);
    expect(clampWidth(411.4)).toBe(411);
  });

  it("reads a stored layout defensively", () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("not json")).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{"qWidth":9999,"qPane":"collapsed"}')).toEqual({
      qWidth: 640,
      qPane: "collapsed",
      pagePane: "open",
    });
    // Both collapsed would show nothing: Q opens.
    expect(
      parseLayout('{"qPane":"collapsed","pagePane":"collapsed"}').qPane,
    ).toBe("open");
  });

  it("LAYOUT_SET changes only the panes it names, never both collapsed", () => {
    const pagesHidden = applyLayoutSet(DEFAULT_LAYOUT, {
      pagePane: "collapsed",
    });
    expect(pagesHidden).toMatchObject({ qPane: "open", pagePane: "collapsed" });
    // "Close the chat" while the pages are hidden brings the pages back.
    expect(applyLayoutSet(pagesHidden, { qPane: "collapsed" })).toMatchObject({
      qPane: "collapsed",
      pagePane: "open",
    });
    // Both named collapsed: Q (the conversation) stays.
    expect(
      applyLayoutSet(DEFAULT_LAYOUT, {
        qPane: "collapsed",
        pagePane: "collapsed",
      }),
    ).toMatchObject({ qPane: "open", pagePane: "collapsed" });
  });

  it("the boot script paints the stored layout onto <html> before React", () => {
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({ qWidth: 500, qPane: "collapsed" }),
    );
    runBootScript();
    expect(root.style.getPropertyValue("--cq-ws-q-width")).toBe("500px");
    expect(root.getAttribute("data-cq-ws-q")).toBe("collapsed");
    expect(root.hasAttribute("data-cq-ws-page")).toBe(false);
  });

  it("the boot script survives garbage in storage", () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, "{");
    expect(runBootScript).not.toThrow();
  });
});

describe("layout store", () => {
  it("writes through to <html> and storage", () => {
    setQWidth(452);
    setPane("pagePane", "collapsed");
    expect(root.style.getPropertyValue("--cq-ws-q-width")).toBe("452px");
    expect(root.getAttribute("data-cq-ws-page")).toBe("collapsed");
    expect(
      parseLayout(window.localStorage.getItem(LAYOUT_STORAGE_KEY)),
    ).toEqual({ qWidth: 452, qPane: "open", pagePane: "collapsed" });
    setLayout({ pagePane: "open" });
    expect(root.hasAttribute("data-cq-ws-page")).toBe(false);
    expect(getWorkspaceLayout().pagePane).toBe("open");
  });
});
