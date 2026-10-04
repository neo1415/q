// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { obstacleRects, watchLayout } from "@/features/q-dock/dock-avoid";
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

/**
 * Settings at 390 x 844 (QA, both accounts): the dock sat on the
 * "Notifications" heading. Every row is full width (term above its
 * control), so on a scrolled settings page each anchor touches a control,
 * and the old last resort chose whichever bottom covered the least area,
 * treating a heading like the edge of a button. Section titles that are
 * not h1-h6 and list terms were not obstacles at all.
 */
describe("the settings layout (QA 390 px)", () => {
  function settingsPage(): { notifications: Element; voice: Element } {
    const main = add(document.body, document.createElement("main"));
    // Appearance → Theme: a full-width segmented control under the header.
    const theme = add(main, document.createElement("div"));
    theme.setAttribute("role", "radiogroup");
    at(add(theme, document.createElement("button")), 16, 62, 358, 48);
    // Q's voice: titled by a styled paragraph, not an h2.
    const voiceSection = add(main, document.createElement("section"));
    voiceSection.setAttribute("aria-labelledby", "voice-heading");
    const voice = at(
      add(voiceSection, document.createElement("p")),
      16,
      300,
      96,
      28,
    );
    voice.id = "voice-heading";
    voice.textContent = "Q's voice";
    const list = add(voiceSection, document.createElement("dl"));
    at(add(list, document.createElement("dt")), 16, 340, 40, 18).textContent =
      "Voice";
    at(add(list, document.createElement("button")), 16, 372, 358, 48);
    // Notifications: its heading at the bottom left, the email switch row
    // spanning the width just above the bottom navigation.
    const section = add(main, document.createElement("section"));
    section.setAttribute("aria-labelledby", "notifications-heading");
    const notifications = at(
      add(section, document.createElement("h2")),
      16,
      700,
      118,
      28,
    );
    notifications.id = "notifications-heading";
    notifications.textContent = "Notifications";
    at(add(section, document.createElement("input")), 330, 724, 44, 44);
    at(
      add(section, document.createElement("a")),
      16,
      746,
      120,
      44,
    ).setAttribute("href", "/work");
    return { notifications, voice };
  }

  it("a section label, a list term and a legend are obstacles, as text", () => {
    const { voice } = settingsPage();
    const fieldset = add(document.body, document.createElement("fieldset"));
    at(add(fieldset, document.createElement("legend")), 16, 460, 80, 20);
    const obstacles = obstacleRects();
    expect(obstacles).toContainEqual({
      left: 16,
      top: 300,
      right: 112,
      bottom: 328,
      text: true,
    });
    expect(obstacles.filter((o) => o.text === true)).toHaveLength(4);
    expect(voice.id).toBe("voice-heading");
  });

  it("the dock never sits on Notifications, from either side", () => {
    const { notifications } = settingsPage();
    const obstacles = obstacleRects();
    const box = notifications.getBoundingClientRect();
    for (const side of ["left", "right"] as const) {
      const spot = placeDock(
        { side, slot: "bottom", stashed: false },
        obstacles,
        phone,
        size,
        "mobile",
      );
      const rect = {
        left: spot.x,
        top: spot.y,
        right: spot.x + 44,
        bottom: spot.y + 44,
      };
      expect(
        overlaps(rect, {
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
        }),
      ).toBe(false);
      for (const obstacle of obstacles.filter((o) => o.text === true)) {
        expect(overlaps(rect, obstacle)).toBe(false);
      }
    }
  });

  it("re-measures when a setting's text loads in without a new node", async () => {
    vi.useFakeTimers();
    try {
      const line = add(document.body, document.createElement("p"));
      line.textContent = "Checking this device.";
      let calls = 0;
      const stop = watchLayout(() => {
        calls += 1;
      });
      await vi.advanceTimersByTimeAsync(250);
      const before = calls;
      const text = line.firstChild;
      if (text === null) throw new Error("no text node");
      text.nodeValue =
        "To get pushes on iPhone, add Capital Q to your Home Screen.";
      await vi.advanceTimersByTimeAsync(250);
      expect(calls).toBeGreaterThan(before);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
