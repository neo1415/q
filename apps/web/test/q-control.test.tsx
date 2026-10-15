// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  QControlKindSchema,
  QManifestControlSchema,
  Q_CONTROL_KINDS,
  Q_MANIFEST_CONTROLS_MAX,
  QControlIdSchema,
  QUiActReceiptsRequestSchema,
  type QUiActIntent,
} from "@capital-q/contracts";

import {
  performClientAction,
  registerClientRouter,
} from "../src/features/q/client-actions";
import { QControl } from "../src/features/q/control/q-control";
import { noticeOf } from "../src/features/q/control/q-control-runtime";
import { startReceiptReporter } from "../src/features/q/control/receipt-reporter";
import {
  CONTROL_ID,
  CONTROLS_MAX,
  KIND_ACTS,
  manifestControls,
  registerControl,
  resetControls,
} from "../src/features/q/control/registry";
import { currentManifest } from "../src/features/q/manifest";
import {
  requestMove,
  noteRoute,
  navigationInFlight,
  onNavigationOutcome,
  routesMatch,
  performUiAct,
  type NavigationOutcome,
  recentUiActReports,
  registerUiControl,
  resetUiActController,
} from "../src/features/q/ui-act-controller";

let n = 0;
/** What a scroll brought into view (jsdom lays nothing out). */
const inView = new Set<Element>();
const scrollIntoView = vi.fn(function (this: Element) {
  inView.add(this);
});
function rectOf(this: Element): DOMRect {
  const top = inView.has(this) ? 10 : 5_000;
  return {
    top,
    bottom: top + 40,
    left: 0,
    right: 100,
    width: 100,
    height: 40,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}
const act_ = (
  act: QUiActIntent["act"],
  extra: Partial<QUiActIntent> = {},
): QUiActIntent => {
  n += 1;
  return { kind: "UI_ACT", actId: `uia_test${String(n)}xx`, act, ...extra };
};

/** The router's pushes (R3: the move's own executor pushes, once). */
let pushes: string[] = [];

beforeEach(() => {
  resetControls();
  resetUiActController();
  pushes = [];
  // A client router that records the push; each test settles the route.
  registerClientRouter((path) => pushes.push(path));
  inView.clear();
  Element.prototype.scrollIntoView = scrollIntoView;
  Element.prototype.getBoundingClientRect = rectOf;
});
afterEach(() => {
  cleanup();
  registerClientRouter(null);
  vi.useRealTimers();
});

function Tabs() {
  const [tab, setTab] = useState<"overview" | "readiness">("overview");
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div role="tablist">
      {(["overview", "readiness"] as const).map((key) => (
        <QControl key={key} id={`tab.${key}`} kind="TAB">
          <button
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {key}
          </button>
        </QControl>
      ))}
      <QControl id="section.risks" kind="SECTION">
        <section>Risks</section>
      </QControl>
      <QControl id="list.investors" kind="LIST">
        <ul>
          {["a", "b", "c"].map((name) => (
            <li key={name}>
              <button
                type="button"
                aria-expanded={open === name}
                onClick={() => {
                  opened.push(name);
                  setOpen(name);
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      </QControl>
      <QControl id="button.save" kind="BUTTON">
        <button type="button" disabled>
          Save
        </button>
      </QControl>
    </div>
  );
}
const opened: string[] = [];

describe("the control registry mirrors the lead contract (C1)", () => {
  it("uses the contract's id rule, bound and kinds", () => {
    expect(CONTROLS_MAX).toBe(Q_MANIFEST_CONTROLS_MAX);
    for (const id of ["tab.mandate", "section.risks", "list.investors"]) {
      expect(CONTROL_ID.test(id)).toBe(QControlIdSchema.safeParse(id).success);
    }
    for (const id of ["Tab.x", "tab", "tab.", "a.b.c.d.e", "tab.X"]) {
      expect(CONTROL_ID.test(id)).toBe(false);
      expect(QControlIdSchema.safeParse(id).success).toBe(false);
    }
    expect(Object.keys(KIND_ACTS).sort()).toEqual([...Q_CONTROL_KINDS].sort());
    for (const kind of Object.keys(KIND_ACTS)) {
      expect(QControlKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("refuses an id outside the rule, and a duplicate replaces only while mounted", () => {
    const element = document.createElement("div");
    document.body.append(element);
    registerControl({ id: "Bad id", kind: "SECTION", element: () => element });
    expect(manifestControls()).toEqual([]);
    const first = registerControl({
      id: "section.one",
      kind: "SECTION",
      element: () => element,
    });
    const second = registerControl({
      id: "section.one",
      kind: "SECTION",
      element: () => element,
    });
    first();
    expect(manifestControls().map((c) => c.id)).toEqual(["section.one"]);
    second();
    expect(manifestControls()).toEqual([]);
    // The id's first part names its kind; a mismatch never registers.
    registerControl({ id: "tab.one", kind: "SECTION", element: () => element });
    expect(manifestControls()).toEqual([]);
    element.remove();
  });
});

describe("registered controls travel in the manifest (C1)", () => {
  it("publishes ids, kinds, ARIA states and list counts, tabs first, contract-valid", () => {
    render(<Tabs />);
    const controls = manifestControls();
    expect(controls).toEqual([
      { id: "tab.overview", kind: "TAB", state: "SELECTED" },
      { id: "tab.readiness", kind: "TAB" },
      { id: "section.risks", kind: "SECTION" },
      { id: "list.investors", kind: "LIST", count: 3 },
      { id: "button.save", kind: "BUTTON", state: "DISABLED" },
    ]);
    for (const control of controls) {
      expect(QManifestControlSchema.safeParse(control).success).toBe(true);
    }
    expect(currentManifest()?.controls).toEqual(controls);
  });

  it("leaves out a control the person hid from Q, and one that is unmounted", () => {
    const { unmount } = render(
      <div data-q-hidden>
        <QControl id="section.private" kind="SECTION">
          <p>Private</p>
        </QControl>
      </div>,
    );
    expect(manifestControls()).toEqual([]);
    unmount();
    expect(manifestControls()).toEqual([]);
  });

  it("is bounded to the contract maximum", () => {
    const element = document.createElement("div");
    document.body.append(element);
    for (let i = 0; i < 60; i += 1) {
      registerControl({
        id: `section.s${String(i)}`,
        kind: "SECTION",
        element: () => element,
      });
    }
    expect(manifestControls()).toHaveLength(Q_MANIFEST_CONTROLS_MAX);
    element.remove();
  });
});

describe("UI acts run through the control's own handler, with a receipt (C2)", () => {
  it("SELECT_TAB clicks the real tab and is DONE only once it is selected", async () => {
    render(<Tabs />);
    const receipt = await act(() =>
      performUiAct(act_("SELECT_TAB", { target: "tab.readiness" })),
    );
    expect(receipt.status).toBe("DONE");
    expect(screen.getByRole("tab", { name: "readiness" })).toHaveProperty(
      "ariaSelected",
      "true",
    );
    expect(typeof receipt.seq).toBe("number");
  });

  it("a tab whose click changes nothing is FAILED, never done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <QControl id="tab.stuck" kind="TAB">
        <button type="button" role="tab" aria-selected={false}>
          Stuck
        </button>
      </QControl>,
    );
    const pending = performUiAct(act_("SELECT_TAB", { target: "tab.stuck" }));
    await vi.advanceTimersByTimeAsync(7_000);
    expect((await pending).status).toBe("FAILED");
  });

  it("SELECT_ITEM opens the nth item through its own control, DONE once it shows open", async () => {
    opened.length = 0;
    render(<Tabs />);
    const receipt = await act(() =>
      performUiAct(act_("SELECT_ITEM", { target: "list.investors", index: 2 })),
    );
    expect(receipt.status).toBe("DONE");
    expect(opened).toEqual(["b"]);
    expect(screen.getByRole("button", { name: "b" })).toHaveProperty(
      "ariaExpanded",
      "true",
    );
    expect(
      (
        await performUiAct(
          act_("SELECT_ITEM", { target: "list.investors", index: 9 }),
        )
      ).status,
    ).toBe("TARGET_MISSING");
  });

  it("an item whose click shows nothing is FAILED, never done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <QControl id="list.dead" kind="LIST">
        <ul>
          <li>
            <button type="button">Nothing happens</button>
          </li>
        </ul>
      </QControl>,
    );
    const pending = performUiAct(
      act_("SELECT_ITEM", { target: "list.dead", index: 1 }),
    );
    await vi.advanceTimersByTimeAsync(7_000);
    expect((await pending).status).toBe("FAILED");
  });

  it("a link tab is DONE only once the router has settled on its route", async () => {
    noteRoute("/capital");
    function LinkTabs() {
      const [on, setOn] = useState(false);
      return (
        <QControl id="tab.readiness" kind="TAB">
          <a
            href="/capital?tab=readiness"
            role="tab"
            aria-selected={on}
            onClick={(event) => {
              event.preventDefault();
              // The bar marks the pick at once; the router settles later.
              setOn(true);
              setTimeout(() => noteRoute("/capital?tab=readiness"), 300);
            }}
          >
            Readiness
          </a>
        </QControl>
      );
    }
    render(<LinkTabs />);
    let settledAt = 0;
    const pending = performUiAct(
      act_("SELECT_TAB", { target: "tab.readiness" }),
    ).then((receipt) => {
      settledAt = Date.now();
      return receipt;
    });
    const started = Date.now();
    const receipt = await act(() => pending);
    expect(receipt.status).toBe("DONE");
    // Not on the optimistic aria-selected: after the route settled.
    expect(settledAt - started).toBeGreaterThanOrEqual(250);
  });

  it("a link tab whose route never settles is FAILED", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    noteRoute("/capital");
    render(
      <QControl id="tab.plan" kind="TAB">
        <a
          href="/capital?tab=plan"
          role="tab"
          aria-selected
          onClick={(event) => event.preventDefault()}
        >
          Plan
        </a>
      </QControl>,
    );
    const pending = performUiAct(act_("SELECT_TAB", { target: "tab.plan" }));
    await vi.advanceTimersByTimeAsync(7_000);
    expect((await pending).status).toBe("FAILED");
  });

  it("a section that never comes into view is FAILED", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Element.prototype.scrollIntoView = vi.fn();
    render(<Tabs />);
    const pending = performUiAct(
      act_("SCROLL_TO", { target: "section.risks" }),
    );
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await pending).status).toBe("FAILED");
  });

  it("SCROLL_TO brings a section into view", async () => {
    render(<Tabs />);
    const receipt = await performUiAct(
      act_("SCROLL_TO", { target: "section.risks" }),
    );
    expect(receipt.status).toBe("DONE");
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("a disabled control, or an act its kind does not take, is NOT_APPLICABLE", async () => {
    render(<Tabs />);
    expect(
      (await performUiAct(act_("ACTIVATE", { target: "button.save" }))).status,
    ).toBe("NOT_APPLICABLE");
    expect(
      (
        await performUiAct(
          act_("SET", { target: "section.risks", value: true }),
        )
      ).status,
    ).toBe("NOT_APPLICABLE");
  });

  it("an id nobody registered is TARGET_MISSING, and a throwing handler is FAILED", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const missing = performUiAct(act_("SELECT_TAB", { target: "tab.mandate" }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await missing).status).toBe("TARGET_MISSING");
    vi.useRealTimers();
    registerUiControl("menu.card", () => {
      throw new Error("boom");
    });
    expect(
      (await performUiAct(act_("OPEN", { target: "menu.card" }))).status,
    ).toBe("FAILED");
  });

  it("runs a chain in order and waits for the page a move is going to", async () => {
    noteRoute("/discover");
    requestMove({ path: "/capital" });
    const first = performUiAct(act_("SELECT_TAB", { target: "tab.readiness" }));
    const second = performUiAct(act_("SCROLL_TO", { target: "section.risks" }));
    // The new page arrives after the acts were queued.
    await new Promise((resolve) => setTimeout(resolve, 100));
    noteRoute("/capital");
    render(<Tabs />);
    const [one, two] = await act(() => Promise.all([first, second]));
    expect([one.status, two.status]).toEqual(["DONE", "DONE"]);
    expect(recentUiActReports().map((r) => r.receipt.actId)).toEqual([
      one.actId,
      two.actId,
    ]);
  });

  it("BACK with no page of the app behind them is NOT_APPLICABLE, not a step out of Capital Q", async () => {
    noteRoute("/home");
    const back = vi.spyOn(window.history, "back");
    expect((await performUiAct(act_("BACK"))).status).toBe("NOT_APPLICABLE");
    expect(back).not.toHaveBeenCalled();
  });

  it("BACK steps the real history and is DONE when the route changes", async () => {
    noteRoute("/home");
    noteRoute("/capital");
    vi.spyOn(window.history, "back").mockImplementation(() => {
      setTimeout(() => noteRoute("/home"), 20);
    });
    expect((await performUiAct(act_("BACK"))).status).toBe("DONE");
  });

  it("scrolls the page without a target, DONE once it moved", async () => {
    const area = {
      scrollTop: 0,
      scrollHeight: 3_000,
      clientHeight: 800,
      scrollBy({ top }: { top: number }) {
        setTimeout(() => {
          area.scrollTop += top;
        }, 30);
      },
      scrollTo: vi.fn(),
    };
    Object.defineProperty(document, "scrollingElement", {
      configurable: true,
      value: area,
    });
    expect((await performUiAct(act_("SCROLL_DOWN"))).status).toBe("DONE");
    expect(area.scrollTop).toBe(680);
    // Already at the top: nothing to scroll up, and it is said so.
    area.scrollTop = 0;
    expect((await performUiAct(act_("SCROLL_UP"))).status).toBe(
      "NOT_APPLICABLE",
    );
    // A scroll that never lands is not done.
    area.scrollBy = () => undefined;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stuck = performUiAct(act_("SCROLL_DOWN"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await stuck).status).toBe("FAILED");
  });
});

describe("Q's moves are confirmed by the settled route (C3, R3 lifecycle)", () => {
  it("a move is DONE when the router settles, with the route it landed on", async () => {
    noteRoute("/home");
    const outcomes: NavigationOutcome[] = [];
    const stop = onNavigationOutcome((outcome) => outcomes.push(outcome));
    const move = requestMove({ path: "/capital?tab=readiness" });
    expect(outcomes).toEqual([]);
    await vi.waitFor(() => expect(pushes).toEqual(["/capital?tab=readiness"]));
    noteRoute("/capital?tab=readiness");
    await move.settled;
    stop();
    expect(outcomes).toEqual([
      {
        status: "DONE",
        intentId: move.intentId,
        expected: "/capital?tab=readiness",
        route: "/capital?tab=readiness",
      },
    ]);
  });

  it("a move that never lands is pushed once more, then FAILED with a reason, never assumed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    noteRoute("/home");
    window.history.replaceState(null, "", "/home");
    const outcomes: NavigationOutcome[] = [];
    const stop = onNavigationOutcome((outcome) => outcomes.push(outcome));
    const move = requestMove({ path: "/documents" });
    await vi.advanceTimersByTimeAsync(21_000);
    stop();
    expect(pushes).toEqual(["/documents", "/documents"]);
    expect(outcomes).toEqual([
      {
        status: "FAILED",
        intentId: move.intentId,
        expected: "/documents",
        reason: "NOT_LANDED",
      },
    ]);
  });

  it("one receipt per move: a page landing after FAILED is not a second receipt", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    noteRoute("/home");
    window.history.replaceState(null, "", "/home");
    const outcomes: NavigationOutcome[] = [];
    const stop = onNavigationOutcome((outcome) => outcomes.push(outcome));
    requestMove({ path: "/company/x?tab=dataroom" });
    await vi.advanceTimersByTimeAsync(21_000);
    noteRoute("/company/x?tab=dataroom");
    await vi.advanceTimersByTimeAsync(10);
    stop();
    expect(outcomes.map((o) => o.status)).toEqual(["FAILED"]);
  });

  it("G-D14: at the deadline, a tab that is already there is DONE, never FAILED", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    noteRoute("/home");
    window.history.replaceState(null, "", "/home");
    const outcomes: NavigationOutcome[] = [];
    const stop = onNavigationOutcome((outcome) => outcomes.push(outcome));
    requestMove({ path: "/relationships/company/x" });
    // The URL moved but the settled-route report was missed.
    window.history.replaceState(null, "", "/relationships/company/x");
    await vi.advanceTimersByTimeAsync(21_000);
    stop();
    expect(outcomes).toEqual([
      expect.objectContaining({
        status: "DONE",
        expected: "/relationships/company/x",
        route: "/relationships/company/x",
      }),
    ]);
  });

  it("G-D14: the page rewriting its own URL (/home?c=) is not the move landing", async () => {
    noteRoute("/home");
    window.history.replaceState(null, "", "/home");
    const outcomes: NavigationOutcome[] = [];
    const stop = onNavigationOutcome((outcome) => outcomes.push(outcome));
    const move = requestMove({ path: "/relationships/company/x" });
    expect(navigationInFlight()).toBe(true);
    noteRoute("/home?c=abc");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(outcomes).toEqual([]);
    noteRoute("/relationships/company/x");
    await move.settled;
    stop();
    expect(outcomes).toEqual([
      expect.objectContaining({
        status: "DONE",
        expected: "/relationships/company/x",
        route: "/relationships/company/x",
      }),
    ]);
    expect(navigationInFlight()).toBe(false);
  });

  it("the same move asked twice is one move, one receipt; already there is DONE at once", async () => {
    noteRoute("/home");
    window.history.replaceState(null, "", "/home");
    const outcomes: NavigationOutcome[] = [];
    const stop = onNavigationOutcome((outcome) => outcomes.push(outcome));
    const one = requestMove({ path: "/documents" });
    const two = requestMove({ path: "/documents" });
    expect(two.intentId).toBe(one.intentId);
    await vi.waitFor(() => expect(pushes).toEqual(["/documents"]));
    noteRoute("/documents");
    await one.settled;
    const there = requestMove({ path: "/documents" });
    await there.settled;
    stop();
    expect(outcomes.map((o) => o.status)).toEqual(["DONE", "DONE"]);
    // Already there: no second push.
    expect(pushes).toEqual(["/documents"]);
    expect(routesMatch("/documents", "/documents?c=1")).toBe(true);
    expect(routesMatch("/company/x?tab=dataroom", "/company/x")).toBe(false);
  });

  it("G-R1: receipts are also window events, for tests to record", async () => {
    const seen: unknown[] = [];
    const record = (event: Event) =>
      seen.push((event as CustomEvent<unknown>).detail);
    window.addEventListener("cq:ui-act-receipt", record);
    window.addEventListener("cq:navigation-receipt", record);
    noteRoute("/home");
    window.history.replaceState(null, "", "/home");
    const move = requestMove({ path: "/work" });
    noteRoute("/work");
    await move.settled;
    render(<Tabs />);
    await performUiAct(act_("SCROLL_TO", { target: "section.risks" }));
    window.removeEventListener("cq:ui-act-receipt", record);
    window.removeEventListener("cq:navigation-receipt", record);
    expect(seen).toEqual([
      {
        status: "DONE",
        intentId: move.intentId,
        expected: "/work",
        route: "/work",
      },
      expect.objectContaining({
        status: "DONE",
        act: "SCROLL_TO",
        target: "section.risks",
      }),
    ]);
  });

  it("G-R8: registered roots carry data-q-control, list items data-q-control-item", () => {
    render(<Tabs />);
    manifestControls();
    expect(
      document.querySelector('[data-q-control="list.investors"]'),
    ).not.toBeNull();
    expect(document.querySelectorAll("[data-q-control-item]")).toHaveLength(3);
  });
});

describe("INC-1: opening a named record is confirmed and reported with its route", () => {
  const SHIFTWELL = "5f1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f70";

  it("OPEN_RECORD_PAGE goes to the relationship's own route; the receipt says DONE only after the router settled there", async () => {
    noteRoute("/home");
    window.history.replaceState(null, "", "/home");
    const pushed: string[] = [];
    // The app's client router: the route settles a moment after the push.
    registerClientRouter((path) => {
      pushed.push(path);
      setTimeout(() => noteRoute(path), 80);
    });
    const sent: unknown[] = [];
    const stop = startReceiptReporter(currentManifest, (body) => {
      sent.push(JSON.parse(JSON.stringify(body)));
      return Promise.resolve();
    });
    expect(
      performClientAction({
        kind: "OPEN_RECORD_PAGE",
        page: "RELATIONSHIP_COMPANY",
        id: SHIFTWELL,
      }),
    ).toBe(true);
    await vi.waitFor(() => expect(pushed).toHaveLength(1));
    expect(pushed[0]).toBe(`/relationships/company/${SHIFTWELL}`);
    // Nothing is reported before the route settles.
    expect(sent).toEqual([]);
    await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 2_000 });
    stop();
    registerClientRouter(null);
    const report = QUiActReceiptsRequestSchema.parse(sent[0]);
    expect(report.navigations).toEqual([
      {
        status: "DONE",
        intentId: expect.any(String) as unknown,
        expected: `/relationships/company/${SHIFTWELL}`,
        route: `/relationships/company/${SHIFTWELL}`,
      },
    ]);
  });

  it("a data room that never opens is reported FAILED, never done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    noteRoute("/home");
    window.history.replaceState(null, "", "/home");
    registerClientRouter(() => undefined);
    const sent: unknown[] = [];
    const stop = startReceiptReporter(currentManifest, (body) => {
      sent.push(JSON.parse(JSON.stringify(body)));
      return Promise.resolve();
    });
    performClientAction({
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY_DATA_ROOM",
      id: SHIFTWELL,
    });
    await vi.advanceTimersByTimeAsync(21_000);
    stop();
    registerClientRouter(null);
    const report = QUiActReceiptsRequestSchema.parse(sent.at(-1));
    expect(report.navigations).toEqual([
      {
        status: "FAILED",
        intentId: expect.any(String) as unknown,
        expected: `/company/${SHIFTWELL}?tab=dataroom`,
        reason: "NOT_LANDED",
      },
    ]);
  });
});

describe("receipts reach the Q API and the person (C2)", () => {
  it("batches receipts into one contract-valid report", async () => {
    render(<Tabs />);
    const sent: unknown[] = [];
    const stop = startReceiptReporter(currentManifest, (body) => {
      sent.push(JSON.parse(JSON.stringify(body)));
      return Promise.resolve();
    });
    await performUiAct(act_("SCROLL_TO", { target: "section.risks" }));
    await act(() =>
      performUiAct(act_("SELECT_TAB", { target: "tab.readiness" })),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    stop();
    expect(sent).toHaveLength(1);
    const parsed = QUiActReceiptsRequestSchema.safeParse(sent[0]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.reports.map((r) => r.receipt.status)).toEqual([
      "DONE",
      "DONE",
    ]);
    expect(parsed.data?.manifest?.controls?.length).toBeGreaterThan(0);
  });

  it("tells the person when an act did not happen, and says nothing when it did", () => {
    const intent = act_("SELECT_TAB", { target: "tab.mandate" });
    expect(
      noticeOf({ intent, receipt: { actId: intent.actId, status: "DONE" } }),
    ).toBeNull();
    expect(
      noticeOf({
        intent,
        receipt: { actId: intent.actId, status: "TARGET_MISSING" },
      }),
    ).toMatch(/couldn't find/);
  });
});
