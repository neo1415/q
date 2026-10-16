// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { overlaps, useOverPane } from "../src/features/briefing/over-pane";

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
