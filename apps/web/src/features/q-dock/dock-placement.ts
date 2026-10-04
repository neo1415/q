/**
 * Where the Q Dock sits (spec §6.2), as numbers and a remembered choice.
 *
 * Pure geometry plus one small store, so the snapping rules are tested
 * without a browser:
 *
 * - desktop (≥ 1024 px): six anchors, top / middle / bottom on either
 *   side, inset by the page gutter and clear of the sidebar on the left;
 * - phone and tablet: four corners inside the safe areas, clear of the
 *   header and the bottom navigation;
 * - a throw is projected ~150 ms ahead, and the dock lands on the anchor
 *   nearest where it was going; thrown past an edge, it stashes there as
 *   a thin tab.
 *
 * The choice is remembered per breakpoint class in this browser, inside
 * try/catch; "Hide until next visit" lasts for this tab only.
 */

export type DockSide = "left" | "right";
export type DockSlot = "top" | "middle" | "bottom";
export type DockClass = "desktop" | "mobile";

export type DockPlacement = {
  readonly side: DockSide;
  readonly slot: DockSlot;
  /** Tucked against its side as a thin tab. */
  readonly stashed: boolean;
};

export type DockViewport = {
  readonly width: number;
  readonly height: number;
  /** Space the page's chrome takes, which the dock never sits on. */
  readonly insetTop: number;
  readonly insetBottom: number;
  readonly insetLeft: number;
  readonly insetRight: number;
  readonly gutter: number;
};

export type DockSize = { readonly width: number; readonly height: number };

export const DEFAULT_PLACEMENT: DockPlacement = {
  side: "right",
  slot: "bottom",
  stashed: false,
};

/** The stashed tab: a sliver of the light, still a 44 px tall target. */
export const STASH_SIZE: DockSize = { width: 12, height: 44 };

/** How far ahead a throw is projected (spec §6.2). */
export const THROW_PROJECTION_S = 0.15;

/** How far past an edge a throw has to land to stash. */
const STASH_OVERSHOOT = 24;

export function slotsFor(dockClass: DockClass): readonly DockSlot[] {
  return dockClass === "desktop"
    ? ["top", "middle", "bottom"]
    : ["top", "bottom"];
}

/** A placement that exists at this breakpoint (a phone has no middle). */
export function normalise(
  placement: DockPlacement,
  dockClass: DockClass,
): DockPlacement {
  return slotsFor(dockClass).includes(placement.slot)
    ? placement
    : { ...placement, slot: "bottom" };
}

/** The dock's top-left corner, in viewport pixels, for a placement. */
export function anchorPoint(
  placement: DockPlacement,
  viewport: DockViewport,
  size: DockSize,
): { readonly x: number; readonly y: number } {
  const box = placement.stashed ? STASH_SIZE : size;
  const left = viewport.insetLeft + (placement.stashed ? 0 : viewport.gutter);
  const right =
    viewport.width -
    viewport.insetRight -
    box.width -
    (placement.stashed ? 0 : viewport.gutter);
  const top = viewport.insetTop + viewport.gutter;
  const bottom =
    viewport.height - viewport.insetBottom - box.height - viewport.gutter;
  // The lower third by default (spec §6.2): "middle" is the centre line.
  const middle = (top + bottom) / 2;
  const y =
    placement.slot === "top"
      ? top
      : placement.slot === "middle"
        ? middle
        : bottom;
  return {
    x: Math.round(placement.side === "left" ? left : right),
    y: Math.round(Math.max(top, Math.min(bottom, y))),
  };
}

/**
 * Where a released dock goes: the anchor nearest the point it was heading
 * for, or a stash when it was thrown past a side.
 */
export function placementForRelease(
  at: { readonly x: number; readonly y: number },
  velocity: { readonly x: number; readonly y: number },
  viewport: DockViewport,
  size: DockSize,
  dockClass: DockClass,
): DockPlacement {
  const projected = {
    x: at.x + velocity.x * THROW_PROJECTION_S,
    y: at.y + velocity.y * THROW_PROJECTION_S,
  };
  const centre = {
    x: projected.x + size.width / 2,
    y: projected.y + size.height / 2,
  };
  const pastLeft = projected.x < viewport.insetLeft - STASH_OVERSHOOT;
  const pastRight =
    projected.x + size.width >
    viewport.width - viewport.insetRight + STASH_OVERSHOOT;
  let best: DockPlacement = DEFAULT_PLACEMENT;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const side of ["left", "right"] as const) {
    for (const slot of slotsFor(dockClass)) {
      const candidate: DockPlacement = { side, slot, stashed: false };
      const point = anchorPoint(candidate, viewport, size);
      const distance = Math.hypot(
        point.x + size.width / 2 - centre.x,
        point.y + size.height / 2 - centre.y,
      );
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  if (pastLeft) return { ...best, side: "left", stashed: true };
  if (pastRight) return { ...best, side: "right", stashed: true };
  return best;
}

/** Every placement at this breakpoint, nearest the given one first. */
export function placementsByDistance(
  from: DockPlacement,
  viewport: DockViewport,
  size: DockSize,
  dockClass: DockClass,
): readonly DockPlacement[] {
  const origin = anchorPoint(from, viewport, size);
  const all: DockPlacement[] = [];
  for (const side of ["left", "right"] as const) {
    for (const slot of slotsFor(dockClass)) {
      all.push({ side, slot, stashed: false });
    }
  }
  return all
    .map((placement) => {
      const point = anchorPoint(placement, viewport, size);
      return {
        placement,
        distance: Math.hypot(point.x - origin.x, point.y - origin.y),
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .map((entry) => entry.placement);
}

export type Rect = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

/** The dock at its smallest: the bare 44 px button, still a full target. */
export const MINIMAL_SIZE: DockSize = { width: 44, height: 44 };

/** Clear space kept above the bottom navigation when nowhere is free. */
export const LAST_RESORT_GAP = 16;

/** Where the dock is shown, and in what form. */
export type DockSpot = {
  readonly placement: DockPlacement;
  /** The dock's top-left corner, in viewport pixels. */
  readonly x: number;
  readonly y: number;
  /** Shown as the minimal button whatever Q is doing (the pill did not fit). */
  readonly minimal: boolean;
  /** Nothing was free: the dock waits small, just above the bottom nav. */
  readonly lastResort: boolean;
};

function rectAt(
  point: { readonly x: number; readonly y: number },
  size: DockSize,
): Rect {
  return {
    left: point.x,
    top: point.y,
    right: point.x + size.width,
    bottom: point.y + size.height,
  };
}

function overlapArea(a: Rect, b: Rect): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Where to show the dock so that it covers no obstacle: an interactive
 * element or a heading on screen, or a registered control (spec §6.2 a;
 * WCAG 2.4.11). One rule for every page, in order:
 *
 * 1. the chosen anchor, then the others nearest it first, then (on a
 *    phone, which has no middle anchor) the middle of either side;
 * 2. the same anchors with the dock shrunk to its minimal 44 px button;
 * 3. last resort: the minimal button at the bottom of whichever side
 *    covers less, a safe gap above the bottom navigation. The insets keep
 *    it off the navigation itself.
 *
 * The person's choice is not rewritten: the dock goes back when the
 * obstacle goes away. A stash is an explicit choice and stays put.
 */
export function placeDock(
  chosen: DockPlacement,
  obstacles: readonly Rect[],
  viewport: DockViewport,
  size: DockSize,
  dockClass: DockClass,
): DockSpot {
  if (chosen.stashed) {
    return {
      placement: chosen,
      ...anchorPoint(chosen, viewport, size),
      minimal: false,
      lastResort: false,
    };
  }
  const other = chosen.side === "left" ? "right" : "left";
  const candidates: DockPlacement[] = [
    ...placementsByDistance(chosen, viewport, size, dockClass),
  ];
  if (dockClass !== "desktop") {
    // Every corner taken (a phone chat: header on top, composer below —
    // demo-44 pass): the middle of a side often covers only prose.
    for (const side of [chosen.side, other] as const) {
      candidates.push({ side, slot: "middle", stashed: false });
    }
  }
  const fitsMinimal =
    size.width <= MINIMAL_SIZE.width && size.height <= MINIMAL_SIZE.height;
  const sizes: readonly DockSize[] = fitsMinimal
    ? [size]
    : [size, MINIMAL_SIZE];
  for (const box of sizes) {
    for (const placement of candidates) {
      const point = anchorPoint(placement, viewport, box);
      const rect = rectAt(point, box);
      if (!obstacles.some((obstacle) => overlaps(rect, obstacle))) {
        return {
          placement,
          ...point,
          minimal: box !== size,
          lastResort: false,
        };
      }
    }
  }
  const lowest = viewport.insetTop + viewport.gutter;
  const y = Math.round(
    Math.max(
      lowest,
      viewport.height -
        viewport.insetBottom -
        MINIMAL_SIZE.height -
        LAST_RESORT_GAP,
    ),
  );
  let best: DockSpot | null = null;
  let bestCovered = Number.POSITIVE_INFINITY;
  for (const side of [chosen.side, other] as const) {
    const placement: DockPlacement = { side, slot: "bottom", stashed: false };
    const { x } = anchorPoint(placement, viewport, MINIMAL_SIZE);
    const rect = rectAt({ x, y }, MINIMAL_SIZE);
    const covered = obstacles.reduce(
      (sum, obstacle) => sum + overlapArea(rect, obstacle),
      0,
    );
    if (covered < bestCovered) {
      best = { placement, x, y, minimal: true, lastResort: true };
      bestCovered = covered;
    }
  }
  return (
    best ?? {
      placement: chosen,
      ...anchorPoint(chosen, viewport, MINIMAL_SIZE),
      minimal: true,
      lastResort: true,
    }
  );
}

/** The anchor {@link placeDock} picks, without its form. */
export function placementAvoiding(
  chosen: DockPlacement,
  avoid: readonly Rect[],
  viewport: DockViewport,
  size: DockSize,
  dockClass: DockClass,
): DockPlacement {
  return placeDock(chosen, avoid, viewport, size, dockClass).placement;
}

// ---- The remembered choice ------------------------------------------------

const PLACEMENT_KEY = "cq.q-dock.v1";
const HIDDEN_KEY = "cq.q-dock.hidden";
const CHANGED = "cq:q-dock-placement";

function isPlacement(value: unknown): value is DockPlacement {
  if (typeof value !== "object" || value === null) return false;
  const side: unknown = Reflect.get(value, "side");
  const slot: unknown = Reflect.get(value, "slot");
  const stashed: unknown = Reflect.get(value, "stashed");
  return (
    (side === "left" || side === "right") &&
    (slot === "top" || slot === "middle" || slot === "bottom") &&
    typeof stashed === "boolean"
  );
}

function readAll(): Partial<Record<DockClass, DockPlacement>> {
  try {
    const raw = window.localStorage.getItem(PLACEMENT_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Partial<Record<DockClass, DockPlacement>> = {};
    for (const key of ["desktop", "mobile"] as const) {
      const value: unknown = Reflect.get(parsed, key);
      if (isPlacement(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

// One object per stored value, so a subscriber sees a stable snapshot.
const snapshots = new Map<string, DockPlacement>();

export function readPlacement(dockClass: DockClass): DockPlacement {
  const stored = readAll()[dockClass] ?? DEFAULT_PLACEMENT;
  const value = normalise(stored, dockClass);
  const key = `${dockClass}:${value.side}:${value.slot}:${String(value.stashed)}`;
  const known = snapshots.get(key);
  if (known !== undefined) return known;
  snapshots.set(key, value);
  return value;
}

function announce(): void {
  try {
    window.dispatchEvent(new CustomEvent(CHANGED));
  } catch {
    // No window: nothing listens.
  }
}

export function storePlacement(
  dockClass: DockClass,
  placement: DockPlacement | null,
): void {
  try {
    const all = readAll();
    if (placement === null) {
      delete all[dockClass];
    } else {
      all[dockClass] = placement;
    }
    window.localStorage.setItem(PLACEMENT_KEY, JSON.stringify(all));
  } catch {
    // It applies now; it simply will not be remembered.
  }
  announce();
}

export function readHidden(): boolean {
  try {
    return window.sessionStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function storeHidden(hidden: boolean): void {
  try {
    if (hidden) window.sessionStorage.setItem(HIDDEN_KEY, "1");
    else window.sessionStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Hidden for this page only.
  }
  announce();
}

export function subscribePlacement(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  const fromAnotherTab = (event: StorageEvent) => {
    if (event.key === PLACEMENT_KEY) onChange();
  };
  window.addEventListener("storage", fromAnotherTab);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", fromAnotherTab);
  };
}

/** The menu's moves (WCAG 2.5.7: every drag has a non-drag equivalent). */
export type DockMove =
  | { readonly kind: "slot"; readonly slot: DockSlot }
  | { readonly kind: "other-side" }
  | { readonly kind: "unstash" }
  | { readonly kind: "reset" };

export function applyMove(
  placement: DockPlacement,
  move: DockMove,
  dockClass: DockClass,
): DockPlacement {
  switch (move.kind) {
    case "slot":
      return normalise(
        { ...placement, slot: move.slot, stashed: false },
        dockClass,
      );
    case "other-side":
      return {
        ...placement,
        side: placement.side === "left" ? "right" : "left",
        stashed: false,
      };
    case "unstash":
      return { ...placement, stashed: false };
    case "reset":
      return DEFAULT_PLACEMENT;
  }
}
