// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearBottom,
  openedPlacement,
  overlaps,
  useOpenedPlacement,
  useOverPane,
} from "../src/features/briefing/over-pane";
import { useDockAvoid } from "../src/features/q-dock/dock-avoid";

/** Live check 2026-10-16: the arrival greeting covered the GateQ detail pane. */
afterEach(cleanup);

const box = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

describe("floating boxes and content panes", () => {
  it("overlap only when they share area", () => {
    expect(overlaps(box(0, 0, 10, 10), box(5, 5, 15, 15))).toBe(true);
    expect(overlaps(box(0, 0, 10, 10), box(10, 0, 20, 10))).toBe(false);
    expect(overlaps(box(0, 0, 10, 10), box(0, 20, 10, 30))).toBe(false);
  });

  function Probe({ at }: { readonly at: ReturnType<typeof box> }) {
    const over = useOverPane(() => at, null);
    return <p>{over ? "over" : "clear"}</p>;
  }

  function pane(rect: ReturnType<typeof box>) {
    const element = document.createElement("div");
    element.setAttribute("data-content-pane", "");
    element.getBoundingClientRect = () => ({
      ...rect,
      x: rect.left,
      y: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      toJSON: () => rect,
    });
    document.body.append(element);
    return element;
  }

  /**
   * Journey audit 2026-11-13 D4: the briefing covered the founder's Send
   * (desktop) and an interest's Accept/Decline (phone). A control the page
   * registers with the dock (`useDockAvoid`) counts like a pane.
   */
  function Registered({ rect }: { readonly rect: ReturnType<typeof box> }) {
    const ref = useRef<HTMLDivElement>(null);
    useDockAvoid(ref);
    return (
      <div
        ref={(element) => {
          ref.current = element;
          if (element !== null) {
            element.getBoundingClientRect = () => ({
              ...rect,
              x: rect.left,
              y: rect.top,
              width: rect.right - rect.left,
              height: rect.bottom - rect.top,
              toJSON: () => rect,
            });
          }
        }}
      />
    );
  }

  it("D4: a registered primary control (a composer's Send) counts as covered", () => {
    // jsdom's viewport is 1024x768: the control sits on screen.
    render(
      <>
        <Registered rect={box(600, 640, 1000, 760)} />
        <Probe at={box(620, 500, 1010, 700)} />
      </>,
    );
    expect(screen.getByText("over")).toBeTruthy();
    cleanup();
    render(
      <>
        <Registered rect={box(0, 640, 400, 760)} />
        <Probe at={box(620, 500, 1010, 700)} />
      </>,
    );
    expect(screen.getByText("clear")).toBeTruthy();
  });

  it("D4: the tucked button is lifted above the controls in its corner, and left where it is when clear", () => {
    const button = box(860, 700, 1010, 744);
    // Send sits under it: lifted to 8px above Send's top.
    expect(clearBottom(button, [box(900, 690, 1000, 740)], 768)).toBe(
      768 - (690 - 8),
    );
    // A stack: Send, then an attach row above it.
    expect(
      clearBottom(
        button,
        [box(900, 690, 1000, 740), box(850, 620, 1010, 680)],
        768,
      ),
    ).toBe(768 - (620 - 8));
    // Nothing under it: no lift.
    expect(clearBottom(button, [box(0, 690, 400, 740)], 768)).toBeNull();
  });

  /**
   * D4 remainder (live 14 Nov, /company/interest at 390x844): the OPENED
   * briefing (y 518-748) covered Accept/Decline (y 551-595) and no scroll
   * cleared it. Opened, it now rises above the registered controls.
   */
  it("D4: the opened briefing rises above an interest's Accept/Decline at 390px", () => {
    const opened = box(16, 518, 374, 748);
    const decision = box(16, 551, 374, 595);
    const placed = openedPlacement(opened, [decision], 844);
    expect(placed).not.toBeNull();
    if (placed === null) return;
    const top = 844 - placed.bottom - (placed.maxHeight ?? 230);
    const moved = box(16, top, 374, 844 - placed.bottom);
    expect(overlaps(moved, decision)).toBe(false);
    expect(top).toBeGreaterThanOrEqual(8);
    // Clear already: left where it is.
    expect(openedPlacement(opened, [box(16, 100, 374, 140)], 844)).toBeNull();
    // Little room above the control: it keeps the top edge and scrolls inside.
    const high = openedPlacement(opened, [box(16, 180, 374, 600)], 844);
    expect(high).toEqual({ bottom: 844 - (180 - 8), maxHeight: 180 - 8 - 8 });
    // Never shrunk below a readable height.
    expect(
      openedPlacement(opened, [box(16, 60, 374, 600)], 844)?.maxHeight,
    ).toBe(96);
  });

  function OpenedProbe({ at }: { readonly at: ReturnType<typeof box> }) {
    const ref = useRef<HTMLDivElement>(null);
    const placed = useOpenedPlacement(ref, true, null);
    return (
      <div
        data-testid="briefing"
        data-bottom={placed === null ? "" : String(placed.bottom)}
        ref={(element) => {
          ref.current = element;
          if (element !== null) {
            element.getBoundingClientRect = () => ({
              ...at,
              x: at.left,
              y: at.top,
              width: at.right - at.left,
              height: at.bottom - at.top,
              toJSON: () => at,
            });
          }
        }}
      />
    );
  }

  it("D4: rendered at 390x844, the opened briefing's placement leaves the registered controls uncovered", () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    Object.assign(window, { innerWidth: 390, innerHeight: 844 });
    try {
      const decision = box(16, 551, 374, 595);
      render(
        <>
          <Registered rect={decision} />
          <OpenedProbe at={box(16, 518, 374, 748)} />
        </>,
      );
      const bottom = Number(
        screen.getByTestId("briefing").getAttribute("data-bottom"),
      );
      expect(bottom).toBeGreaterThan(0);
      const placedBox = box(16, 844 - bottom - 230, 374, 844 - bottom);
      expect(overlaps(placedBox, decision)).toBe(false);
    } finally {
      Object.assign(window, { innerWidth: width, innerHeight: height });
    }
  });

  it("says a box is over a marked pane, and clear of everything else", () => {
    const marked = pane(box(800, 200, 1300, 900));
    render(<Probe at={box(1000, 700, 1400, 860)} />);
    expect(screen.getByText("over")).toBeTruthy();
    cleanup();
    render(<Probe at={box(1310, 700, 1420, 860)} />);
    expect(screen.getByText("clear")).toBeTruthy();
    marked.remove();
  });
});
