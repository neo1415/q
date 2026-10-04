// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { obstacleRects } from "@/features/q-dock/dock-avoid";
import {
  DEFAULT_PLACEMENT,
  overlaps,
  placeDock,
  type DockViewport,
} from "@/features/q-dock/dock-placement";

/**
 * The dock finds its obstacles in the page itself (QA phone pass): every
 * interactive element and heading on screen, on any page, without the
 * page registering anything; prose, hidden text and the dock are not.
 */

const phone: DockViewport = {
  width: 390,
  height: 844,
  insetTop: 53,
  insetBottom: 60,
  insetLeft: 0,
  insetRight: 0,
  gutter: 12,
};
const size = { width: 44, height: 44 };

function at<T extends Element>(
  element: T,
  left: number,
  top: number,
  width: number,
  height: number,
): T {
  element.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: left, y: top, width, height });
  return element;
}

function add<T extends Element>(parent: Element, element: T): T {
  parent.append(element);
  return element;
}

let saved: { width: number; height: number };

beforeEach(() => {
  saved = { width: window.innerWidth, height: window.innerHeight };
  Object.defineProperty(window, "innerWidth", {
    value: 390,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: 844,
    configurable: true,
  });
});

afterEach(() => {
  document.body.replaceChildren();
  Object.defineProperty(window, "innerWidth", {
    value: saved.width,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: saved.height,
    configurable: true,
  });
});

describe("dock obstacles from the page (jsdom)", () => {
  it("an investor relationship page: the dock leaves the pitch card and the decision free", () => {
    const main = add(document.body, document.createElement("main"));
    const title = at(add(main, document.createElement("h1")), 16, 64, 124, 32);
    title.textContent = "Ledgerfold";
    const pitch = at(add(main, document.createElement("a")), 16, 140, 358, 400);
    pitch.setAttribute("href", "/pitch/ledgerfold");
    const decision = at(
      add(main, document.createElement("button")),
      16,
      716,
      358,
      48,
    );
    decision.textContent = "Not proceeding for now";
    // Not obstacles: prose at the top right, visually hidden text, a
    // hidden control, something off screen, and the dock itself.
    at(add(main, document.createElement("p")), 150, 64, 224, 60);
    const srOnly = at(
      add(main, document.createElement("button")),
      360,
      70,
      1,
      1,
    );
    srOnly.textContent = "Skip";
    const hidden = add(main, document.createElement("div"));
    hidden.setAttribute("aria-hidden", "true");
    at(add(hidden, document.createElement("button")), 334, 65, 44, 44);
    at(add(main, document.createElement("button")), 16, 1200, 358, 48);
    const dock = add(document.body, document.createElement("aside"));
    dock.setAttribute("data-q-dock", "");
    at(add(dock, document.createElement("button")), 334, 728, 44, 44);

    const obstacles = obstacleRects();
    expect(obstacles).toHaveLength(3);
    expect(obstacles).toContainEqual({
      left: 16,
      top: 716,
      right: 374,
      bottom: 764,
    });

    const spot = placeDock(DEFAULT_PLACEMENT, obstacles, phone, size, "mobile");
    expect(spot.placement).toEqual({
      side: "right",
      slot: "top",
      stashed: false,
    });
    const rect = {
      left: spot.x,
      top: spot.y,
      right: spot.x + 44,
      bottom: spot.y + 44,
    };
    for (const element of [title, pitch, decision]) {
      const box = element.getBoundingClientRect();
      expect(
        overlaps(rect, {
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
        }),
      ).toBe(false);
    }
  });

  it("Settings → Usage: a heading is an obstacle", () => {
    const heading = at(
      add(document.body, document.createElement("h2")),
      16,
      712,
      358,
      28,
    );
    heading.textContent = "Plan allowances";
    const obstacles = obstacleRects();
    expect(obstacles).toHaveLength(1);
    const spot = placeDock(DEFAULT_PLACEMENT, obstacles, phone, size, "mobile");
    expect(spot.placement.slot).not.toBe("bottom");
    expect(
      overlaps(
        { left: spot.x, top: spot.y, right: spot.x + 44, bottom: spot.y + 44 },
        obstacles[0] ?? { left: 0, top: 0, right: 0, bottom: 0 },
      ),
    ).toBe(false);
  });
});
