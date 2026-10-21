import type { FigureKind } from "./presence-kit";

/**
 * Q Story S4 (owner 2026-10-21): the things Q's particles can form while it
 * talks about them -- a clock, an inbox, a plane, a house -- as clean
 * line pictograms in light, never a brain or a robot.
 *
 * Each pictogram is a few SVG path strings on a 24-unit grid, the way an
 * icon is drawn, so one source gives both the particles (sampled along the
 * strokes, presence-figures.ts) and the still figure reduced motion shows
 * instead of the morph (presence-figure-still.tsx). Only absolute M, L, H,
 * V, C, Q and Z are used; circles are four cubic quarters.
 */

export const PICTOGRAM_KINDS = [
  "CLOCK",
  "INBOX",
  "MAGNIFIER",
  "PLANE",
  "ENVELOPE",
  "PEN",
  "CHART_DIP",
  "CHART_BARS",
  "SCALE",
  "HOUSE",
  "CALENDAR",
  "MAP_PIN",
  "COMPARE",
  "DOCUMENT",
  "HANDSHAKE",
] as const satisfies readonly FigureKind[];

export type PictogramKind = (typeof PICTOGRAM_KINDS)[number];

const PICTOGRAMS: ReadonlySet<FigureKind> = new Set(PICTOGRAM_KINDS);

export function isPictogram(kind: FigureKind): kind is PictogramKind {
  return PICTOGRAMS.has(kind);
}

/** The grid every pictogram is drawn on. */
export const PICTOGRAM_GRID = 24;
/** Frame units per grid unit: the grid's ±12 spans about ±0.9 of the frame. */
const FRAME_PER_UNIT = 0.075;

const n = (v: number) => Number(v.toFixed(3));

/** A circle as four cubic quarters (κ = 0.5523). */
export function circlePath(cx: number, cy: number, r: number): string {
  const k = r * 0.5523;
  return [
    `M${n(cx + r)} ${n(cy)}`,
    `C${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)}`,
    `C${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)}`,
    `C${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)}`,
    `C${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)}`,
    "Z",
  ].join(" ");
}

/**
 * A clock face with its hands at h:m (12-hour; the story's "It's 11:47 at
 * night"). The hour hand moves with the minutes, as a real one does.
 */
export function clockPaths(hours: number, minutes: number): string[] {
  const hand = (turns: number, length: number) => {
    const a = turns * Math.PI * 2;
    return `M12 12 L${n(12 + Math.sin(a) * length)} ${n(12 - Math.cos(a) * length)}`;
  };
  const ticks = [0, 0.25, 0.5, 0.75].map((turns) => {
    const a = turns * Math.PI * 2;
    const s = Math.sin(a);
    const c = Math.cos(a);
    return `M${n(12 + s * 7.6)} ${n(12 - c * 7.6)} L${n(12 + s * 9)} ${n(12 - c * 9)}`;
  });
  return [
    circlePath(12, 12, 10),
    ...ticks,
    hand(((hours % 12) + minutes / 60) / 12, 4.8),
    hand(minutes / 60, 7.2),
  ];
}

/** The time the story's clock shows. */
export const STORY_CLOCK = { hours: 11, minutes: 47 } as const;

const LIBRARY: Readonly<Record<PictogramKind, readonly string[]>> = {
  CLOCK: clockPaths(STORY_CLOCK.hours, STORY_CLOCK.minutes),
  // A tray with two letters waiting in it.
  INBOX: [
    "M2 13 L7 13 L9 16 L15 16 L17 13 L22 13 L22 21 L2 21 Z",
    "M2 13 L5 6 L19 6 L22 13",
    "M8 9 L16 9",
    "M7 2.5 L17 2.5",
  ],
  MAGNIFIER: [circlePath(10, 10, 6.8), "M15 15 L21.5 21.5"],
  // An airliner from above.
  PLANE: [
    "M12 1.5 C13.2 1.5 13.6 2.8 13.6 4 L13.6 9 L21.5 13.6 L21.5 15.6 L13.6 13.2 L13.6 18.2 L16.2 20 L16.2 21.8 L12 20.7 L7.8 21.8 L7.8 20 L10.4 18.2 L10.4 13.2 L2.5 15.6 L2.5 13.6 L10.4 9 L10.4 4 C10.4 2.8 10.8 1.5 12 1.5 Z",
  ],
  ENVELOPE: [
    "M2.5 5.5 L21.5 5.5 L21.5 18.5 L2.5 18.5 Z",
    "M2.5 5.5 L12 13 L21.5 5.5",
  ],
  PEN: [
    "M16.5 3 L21 7.5 L8.5 20 L3 21 L4 15.5 Z",
    "M14 5.5 L18.5 10",
    "M4 15.5 L8.5 20",
  ],
  // A line that falls, and keeps falling.
  CHART_DIP: [
    "M3 3 L3 21 L21 21",
    "M5.5 7 L9 9.5 L12 8.5 L16 15 L20 17.5",
    "M17 17.8 L20 17.5 L19.2 14.6",
  ],
  // A neutral chart: bars, no direction claimed.
  CHART_BARS: [
    "M3 3 L3 21 L21 21",
    "M6.5 21 L6.5 13 L9.5 13 L9.5 21",
    "M11.5 21 L11.5 7 L14.5 7 L14.5 21",
    "M16.5 21 L16.5 10.5 L19.5 10.5 L19.5 21",
  ],
  // A balance, level: weighing, not a verdict.
  SCALE: [
    "M12 3 L12 20",
    "M7.5 21 L16.5 21",
    "M4 6.5 L20 6.5",
    "M1.5 13 L4 6.5 L6.5 13",
    "M1.5 13 Q4 16.5 6.5 13",
    "M17.5 13 L20 6.5 L22.5 13",
    "M17.5 13 Q20 16.5 22.5 13",
  ],
  HOUSE: [
    "M2.5 11.5 L12 3 L21.5 11.5",
    "M5 9.5 L5 21 L19 21 L19 9.5",
    "M10 21 L10 15 L14 15 L14 21",
  ],
  CALENDAR: [
    "M3 5 L21 5 L21 21 L3 21 Z",
    "M3 9.5 L21 9.5",
    "M8 2.5 L8 7",
    "M16 2.5 L16 7",
    "M7 13.5 L9 13.5",
    "M11 13.5 L13 13.5",
    "M15 13.5 L17 13.5",
    "M7 17 L9 17",
    "M11 17 L13 17",
  ],
  MAP_PIN: [
    "M12 22 C12 22 4.5 15 4.5 9.8 C4.5 5.5 7.9 2.2 12 2.2 C16.1 2.2 19.5 5.5 19.5 9.8 C19.5 15 12 22 12 22 Z",
    circlePath(12, 9.8, 2.7),
  ],
  // Two columns side by side.
  COMPARE: [
    "M2.5 4 L10.5 4 L10.5 20 L2.5 20 Z",
    "M13.5 4 L21.5 4 L21.5 20 L13.5 20 Z",
    "M4.5 8 L8.5 8",
    "M4.5 11.5 L8.5 11.5",
    "M4.5 15 L8.5 15",
    "M15.5 8 L19.5 8",
    "M15.5 11.5 L19.5 11.5",
    "M15.5 15 L19.5 15",
  ],
  DOCUMENT: [
    "M5.5 2 L14 2 L19 7 L19 22 L5.5 22 Z",
    "M14 2 L14 7 L19 7",
    "M8.5 11.5 L16 11.5",
    "M8.5 15 L16 15",
    "M8.5 18.5 L13 18.5",
  ],
  // Two hands clasped, cuffs either side.
  HANDSHAKE: [
    "M1 8 L4.5 8 L4.5 17 L1 17",
    "M23 8 L19.5 8 L19.5 17 L23 17",
    "M4.5 9.5 L8.5 7.5 L12.5 8.5 L19.5 9.5",
    "M12.5 8.5 L9.5 11.5 Q10.5 13 12.5 11.8 L14 10.6",
    "M4.5 15.5 L7 15.5 L10.5 18.8 Q11.6 19.7 12.6 18.8 L19.5 14.5",
    "M10.5 14 L13 16.5",
    "M12.6 12.8 L15.2 15.3",
    "M14.8 11.6 L17.2 14",
  ],
};

/** A pictogram's SVG paths, on the 24-unit grid. */
export function pictogramPaths(kind: PictogramKind): readonly string[] {
  return LIBRARY[kind];
}

type Pt = readonly [number, number];

/**
 * One SVG path as polylines (one per subpath), curves flattened into
 * `steps` segments each. Absolute M L H V C Q Z only; anything else is a
 * mistake in the library and throws, so a test catches it.
 */
export function flattenPath(d: string, steps = 12): Pt[][] {
  const tokens = d.match(/[a-z]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const lines: Pt[][] = [];
  let line: Pt[] = [];
  let start: Pt = [0, 0];
  let at: Pt = [0, 0];
  let i = 0;
  let command = "";
  const num = (): number => {
    const token = tokens[i];
    i += 1;
    const value = Number(token);
    if (token === undefined || !Number.isFinite(value)) {
      throw new Error(`pictogram path: expected a number in "${d}"`);
    }
    return value;
  };
  const isNumber = (token: string | undefined) =>
    token !== undefined && !/^[a-z]$/i.test(token);
  while (i < tokens.length) {
    const token = tokens[i];
    if (token !== undefined && /^[a-z]$/i.test(token)) {
      command = token;
      i += 1;
      if (!/^[MLHVCQZ]$/.test(command)) {
        throw new Error(`pictogram path: unsupported command ${command}`);
      }
    } else if (command === "M") {
      // Coordinates after a move are line-tos, as in SVG.
      command = "L";
    }
    switch (command) {
      case "M": {
        if (line.length > 1) lines.push(line);
        at = [num(), num()];
        start = at;
        line = [at];
        break;
      }
      case "L":
        at = [num(), num()];
        line.push(at);
        break;
      case "H":
        at = [num(), at[1]];
        line.push(at);
        break;
      case "V":
        at = [at[0], num()];
        line.push(at);
        break;
      case "C": {
        const p0 = at;
        const p1: Pt = [num(), num()];
        const p2: Pt = [num(), num()];
        const p3: Pt = [num(), num()];
        for (let s = 1; s <= steps; s += 1) {
          const t = s / steps;
          const u = 1 - t;
          line.push([
            u * u * u * p0[0] +
              3 * u * u * t * p1[0] +
              3 * u * t * t * p2[0] +
              t * t * t * p3[0],
            u * u * u * p0[1] +
              3 * u * u * t * p1[1] +
              3 * u * t * t * p2[1] +
              t * t * t * p3[1],
          ]);
        }
        at = p3;
        break;
      }
      case "Q": {
        const p0 = at;
        const p1: Pt = [num(), num()];
        const p2: Pt = [num(), num()];
        for (let s = 1; s <= steps; s += 1) {
          const t = s / steps;
          const u = 1 - t;
          line.push([
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
          ]);
        }
        at = p2;
        break;
      }
      case "Z":
        line.push(start);
        at = start;
        if (line.length > 1) lines.push(line);
        line = [start];
        // Z takes no numbers; a number after it is a malformed path.
        if (isNumber(tokens[i])) {
          throw new Error(`pictogram path: number after Z in "${d}"`);
        }
        break;
      default:
        throw new Error(`pictogram path: no command before "${token}"`);
    }
  }
  if (line.length > 1) lines.push(line);
  return lines;
}

/** A pictogram's strokes in frame units, centred on the frame. */
export function pictogramPolylines(kind: PictogramKind): Pt[][] {
  const half = PICTOGRAM_GRID / 2;
  return pictogramPaths(kind).flatMap((d) =>
    flattenPath(d).map((line) =>
      line.map(([x, y]): Pt => [
        (x - half) * FRAME_PER_UNIT,
        (y - half) * FRAME_PER_UNIT,
      ]),
    ),
  );
}
