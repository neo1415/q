// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearBottom,
  overlaps,
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
