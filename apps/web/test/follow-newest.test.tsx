// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useFollowNewest } from "@/features/q/follow-newest";

// jsdom lays nothing out; give every element a tall content height so a
// follow on mount would visibly move the scroller.
const original = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollHeight",
);
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => 900,
  });
});
afterEach(() => {
  cleanup();
  if (original !== undefined) {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", original);
  }
});

function Thread({
  newest,
  anchor,
}: {
  readonly newest: string;
  readonly anchor?: "scroller" | "element";
}) {
  const end = useRef<HTMLDivElement>(null);
  useFollowNewest(end, newest, false, anchor);
  return (
    <div data-testid="scroller" style={{ overflowY: "auto" }}>
      <div ref={end} />
    </div>
  );
}

function scroller(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    "[data-testid=scroller]",
  );
  if (element === null) throw new Error("no scroller");
  return element;
}

describe("useFollowNewest", () => {
  it("leaves the scroller at the top while there is nothing to follow (the Q page's welcome)", () => {
    const { container } = render(<Thread newest="" />);
    expect(scroller(container).scrollTop).toBe(0);
  });

  it("follows the newest words once there are some", () => {
    const { container, rerender } = render(<Thread newest="" />);
    rerender(<Thread newest="turn-1" />);
    expect(scroller(container).scrollTop).toBe(900);
  });

  it("anchored to the element, brings the end element (not the scroller's end) into view", () => {
    // The Q panel: the exchange ends 300px below the visible bottom, with
    // the Board below it; the panel scrolls by 300, not to its end.
    const rect = (bottom: number) => ({ bottom }) as DOMRect;
    const { container, rerender } = render(
      <Thread newest="" anchor="element" />,
    );
    const box = scroller(container);
    const end = box.firstElementChild as HTMLElement;
    box.getBoundingClientRect = () => rect(600);
    end.getBoundingClientRect = () => rect(900);
    rerender(<Thread newest="answer-1" anchor="element" />);
    expect(box.scrollTop).toBe(300);
  });
});
