import { describe, expect, it } from "vitest";

import {
  anchorPoint,
  applyMove,
  DEFAULT_PLACEMENT,
  LAST_RESORT_GAP,
  MINIMAL_SIZE,
  normalise,
  overlaps,
  placeDock,
  placementAvoiding,
  placementForRelease,
  STASH_SIZE,
  type DockViewport,
  type Rect,
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

/**
 * QA phone pass (390x844, investor): the dock sat on a relationship
 * page's pitch card and its "Not proceeding for now" control, and on
 * Settings → Usage over the "Plan allowances" heading. Fictional rects
 * reproducing those layouts; every interactive element and heading on
 * screen is an obstacle.
 */
describe("dock obstacles (QA phone pass)", () => {
  const navTop = phone.height - phone.insetBottom;
  const coversNone = (
    spot: { x: number; y: number },
    box: typeof size,
    obstacles: readonly Rect[],
  ) =>
    !obstacles.some((obstacle) =>
      overlaps(
        {
          left: spot.x,
          top: spot.y,
          right: spot.x + box.width,
          bottom: spot.y + box.height,
        },
        obstacle,
      ),
    );

  // A relationship page, scrolled to the pitch: the company heading at
  // the top left, the pitch card across the middle, the decision control
  // across the bottom (it sat under the default bottom-right anchor).
  const heading = { left: 16, top: 64, right: 140, bottom: 96 };
  const pitchCard = { left: 16, top: 140, right: 374, bottom: 540 };
  const notProceeding = { left: 16, top: 716, right: 374, bottom: 764 };
  const relationship = [heading, pitchCard, notProceeding];

  it("relationship page: finds the free corner, off the pitch card and the decision", () => {
    const spot = placeDock(
      DEFAULT_PLACEMENT,
      relationship,
      phone,
      size,
      "mobile",
    );
    expect(spot.placement).toEqual({
      side: "right",
      slot: "top",
      stashed: false,
    });
    expect(spot.minimal).toBe(false);
    expect(spot.lastResort).toBe(false);
    expect(coversNone(spot, size, relationship)).toBe(true);
    expect(spot.y + size.height).toBeLessThanOrEqual(navTop);
  });

  it("relationship page: a pill that fits nowhere shrinks to the 44 px button", () => {
    const pill = { width: 200, height: 44 };
    const status = { left: 230, top: 66, right: 300, bottom: 96 };
    const obstacles = [...relationship, status];
    const spot = placeDock(DEFAULT_PLACEMENT, obstacles, phone, pill, "mobile");
    expect(spot.minimal).toBe(true);
    expect(spot.lastResort).toBe(false);
    expect(spot.placement.slot).toBe("top");
    expect(coversNone(spot, MINIMAL_SIZE, obstacles)).toBe(true);
    expect(MINIMAL_SIZE.width).toBeGreaterThanOrEqual(44);
    expect(MINIMAL_SIZE.height).toBeGreaterThanOrEqual(44);
  });

  it("with nothing free, waits small above the bottom nav with a safe gap", () => {
    const share = { left: 330, top: 64, right: 374, bottom: 104 };
    const spot = placeDock(
      DEFAULT_PLACEMENT,
      [...relationship, share],
      phone,
      { width: 200, height: 44 },
      "mobile",
    );
    expect(spot.lastResort).toBe(true);
    expect(spot.minimal).toBe(true);
    expect(spot.placement.side).toBe("right");
    expect(spot.y + MINIMAL_SIZE.height).toBe(navTop - LAST_RESORT_GAP);
    expect(spot.x + MINIMAL_SIZE.width).toBeLessThanOrEqual(
      phone.width - phone.gutter,
    );
  });

  it("last resort takes the side that covers less", () => {
    const rightOnly = { left: 300, top: 60, right: 390, bottom: navTop };
    const everywhere = [
      rightOnly,
      { left: 0, top: 60, right: 300, bottom: 700 },
      { left: 0, top: 700, right: 60, bottom: 730 },
    ];
    const spot = placeDock(
      DEFAULT_PLACEMENT,
      everywhere,
      phone,
      size,
      "mobile",
    );
    expect(spot.lastResort).toBe(true);
    expect(spot.placement.side).toBe("left");
  });

  it("Settings → Usage: keeps off the Plan allowances heading", () => {
    const usage = [
      { left: 16, top: 64, right: 100, bottom: 96 }, // h1 Usage
      { left: 290, top: 64, right: 374, bottom: 100 }, // Upgrade link
      { left: 16, top: 712, right: 374, bottom: 740 }, // h2 Plan allowances
    ];
    const spot = placeDock(DEFAULT_PLACEMENT, usage, phone, size, "mobile");
    expect(spot.placement).toEqual({
      side: "right",
      slot: "middle",
      stashed: false,
    });
    expect(coversNone(spot, size, usage)).toBe(true);
    expect(spot.y + size.height).toBeLessThanOrEqual(navTop);
  });

  it("is the same rule on a desktop, and a stash stays where it was put", () => {
    const spot = placeDock(
      DEFAULT_PLACEMENT,
      [{ left: 1100, top: 780, right: 1440, bottom: 900 }],
      desktop,
      size,
      "desktop",
    );
    expect(spot.placement).toEqual({
      side: "right",
      slot: "middle",
      stashed: false,
    });
    const stash = { side: "left", slot: "top", stashed: true } as const;
    expect(
      placeDock(
        stash,
        [{ left: 0, top: 0, right: 1440, bottom: 900 }],
        desktop,
        size,
        "desktop",
      ).placement,
    ).toEqual(stash);
  });
});
