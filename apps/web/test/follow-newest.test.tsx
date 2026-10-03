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

function Thread({ newest }: { readonly newest: string }) {
  const end = useRef<HTMLDivElement>(null);
  useFollowNewest(end, newest, false);
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
});
