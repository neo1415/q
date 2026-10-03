import { describe, expect, it } from "vitest";

import {
  anchorPoint,
  applyMove,
  DEFAULT_PLACEMENT,
  normalise,
  placementAvoiding,
  placementForRelease,
  STASH_SIZE,
  type DockViewport,
} from "../src/features/q-dock/dock-placement";

/**
 * Where the Q Dock lands (spec §6.2): six anchors on a desktop clear of
 * the sidebar, four corners on a phone clear of the header and the bottom
 * navigation, a throw projected ahead, a stash past an edge, a menu move
 * for every drag (WCAG 2.5.7), and a registered control never covered.
 */

const desktop: DockViewport = {
  width: 1440,
  height: 900,
  insetTop: 0,
  insetBottom: 0,
  insetLeft: 240,
  insetRight: 0,
  gutter: 24,
};

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

describe("dock anchors", () => {
  it("defaults to the lower right, inside the gutter", () => {
    expect(anchorPoint(DEFAULT_PLACEMENT, desktop, size)).toEqual({
      x: 1440 - 24 - 44,
      y: 900 - 24 - 44,
    });
  });

  it("keeps clear of the sidebar on the left and the phone's chrome", () => {
    const left = anchorPoint(
      { side: "left", slot: "top", stashed: false },
      desktop,
      size,
    );
    expect(left).toEqual({ x: 240 + 24, y: 24 });
    const top = anchorPoint(
      { side: "right", slot: "top", stashed: false },
      phone,
      size,
    );
    expect(top.y).toBe(53 + 12);
    const bottom = anchorPoint(DEFAULT_PLACEMENT, phone, size);
    expect(bottom.y + size.height).toBeLessThanOrEqual(844 - 60 - 12);
  });

  it("has no middle on a phone", () => {
    expect(
      normalise({ side: "left", slot: "middle", stashed: false }, "mobile")
        .slot,
    ).toBe("bottom");
  });

  it("stashes flush against its side", () => {
    const point = anchorPoint(
      { side: "right", slot: "bottom", stashed: true },
      desktop,
      size,
    );
    expect(point.x).toBe(1440 - STASH_SIZE.width);
  });
});

describe("dock release", () => {
  it("lands on the nearest anchor to where it was heading", () => {
    // Released mid-screen, moving up and left.
    const placement = placementForRelease(
      { x: 700, y: 400 },
      { x: -2000, y: -1500 },
      desktop,
      size,
      "desktop",
    );
    expect(placement).toEqual({ side: "left", slot: "top", stashed: false });
  });

  it("stays put when released still near an anchor", () => {
    const placement = placementForRelease(
      { x: 1360, y: 420 },
      { x: 0, y: 0 },
      desktop,
      size,
      "desktop",
    );
    expect(placement).toEqual({
      side: "right",
      slot: "middle",
      stashed: false,
    });
  });

  it("stashes when thrown past an edge", () => {
    const placement = placementForRelease(
      { x: 1380, y: 800 },
      { x: 3000, y: 0 },
      desktop,
      size,
      "desktop",
    );
    expect(placement.stashed).toBe(true);
    expect(placement.side).toBe("right");
  });
});

describe("dock menu moves (no dragging needed)", () => {
  it("moves along the side, to the other side, and back to default", () => {
    const top = applyMove(
      DEFAULT_PLACEMENT,
      { kind: "slot", slot: "top" },
      "desktop",
    );
    expect(top).toEqual({ side: "right", slot: "top", stashed: false });
    const across = applyMove(top, { kind: "other-side" }, "desktop");
    expect(across.side).toBe("left");
    expect(applyMove(across, { kind: "reset" }, "desktop")).toEqual(
      DEFAULT_PLACEMENT,
    );
    expect(
      applyMove(
        { side: "left", slot: "top", stashed: true },
        { kind: "unstash" },
        "mobile",
      ).stashed,
    ).toBe(false);
  });
});

describe("dock avoid zones", () => {
  it("moves to the nearest free anchor while a control would be covered", () => {
    const point = anchorPoint(DEFAULT_PLACEMENT, desktop, size);
    const composer = {
      left: point.x - 400,
      top: point.y - 10,
      right: point.x + 50,
      bottom: point.y + 60,
    };
    const shown = placementAvoiding(
      DEFAULT_PLACEMENT,
      [composer],
      desktop,
      size,
      "desktop",
    );
    expect(shown).not.toEqual(DEFAULT_PLACEMENT);
    const moved = anchorPoint(shown, desktop, size);
    expect(
      moved.x < composer.right &&
        moved.x + size.width > composer.left &&
        moved.y < composer.bottom &&
        moved.y + size.height > composer.top,
    ).toBe(false);
    // The person's choice comes back when the control goes.
    expect(
      placementAvoiding(DEFAULT_PLACEMENT, [], desktop, size, "desktop"),
    ).toEqual(DEFAULT_PLACEMENT);
  });
  it("on a phone with every corner taken, waits mid-side rather than on Send", () => {
    // A chat at 390px: its header across the top, its composer across the
    // bottom (demo-44 phone pass).
    const header = { left: 0, top: 53, right: 390, bottom: 120 };
    const composer = { left: 0, top: 700, right: 390, bottom: 784 };
    const shown = placementAvoiding(
      DEFAULT_PLACEMENT,
      [header, composer],
      phone,
      size,
      "mobile",
    );
    expect(shown.slot).toBe("middle");
    expect(shown.side).toBe(DEFAULT_PLACEMENT.side);
    const at = anchorPoint(shown, phone, size);
    for (const zone of [header, composer]) {
      expect(
        at.x < zone.right &&
          at.x + size.width > zone.left &&
          at.y < zone.bottom &&
          at.y + size.height > zone.top,
      ).toBe(false);
    }
  });
});
