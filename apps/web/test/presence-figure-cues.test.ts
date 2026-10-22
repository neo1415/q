// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clockPaths,
  flattenPath,
  PICTOGRAM_KINDS,
  pictogramPaths,
  pictogramPolylines,
} from "../src/features/q-swarm/figure-library";
import {
  buildFigure,
  createFigureFrame,
} from "../src/features/q-swarm/presence-figures";
import {
  clampHold,
  CUE_HOLD_DEFAULT_MS,
  CUE_HOLD_MAX_MS,
  CUE_HOLD_MIN_MS,
  cueDetail,
  presence,
  PRESENCE_FIGURE_IDS,
  Q_FIGURE_EVENT,
} from "../src/features/q-swarm/presence-cue";
import { figureForSignals } from "../src/features/q-swarm/presence-signals";
import {
  startPresenceLoop,
  type PresenceInputs,
  type PresenceLoopHost,
} from "../src/features/q-swarm/presence-loop";
import { presenceUniforms } from "../src/features/q-swarm/presence-uniforms";

/**
 * Q Story S4: the figures Q's particles form while it talks about them,
 * the cue the story calls, and the everyday signal-to-figure mapping.
 */

/** Distance from a point to the nearest segment of some polylines. */
function distanceTo(
  x: number,
  y: number,
  lines: readonly (readonly (readonly [number, number])[])[],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i += 1) {
      const a = line[i];
      const b = line[i + 1];
      if (a === undefined || b === undefined) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      const f =
        len2 === 0
          ? 0
          : Math.max(
              0,
              Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2),
            );
      best = Math.min(
        best,
        Math.hypot(x - (a[0] + dx * f), y - (a[1] + dy * f)),
      );
    }
  }
  return best;
}

describe("the figure library", () => {
  it("parses every pictogram's paths into strokes inside the grid", () => {
    for (const kind of PICTOGRAM_KINDS) {
      const paths = pictogramPaths(kind);
      expect(paths.length).toBeGreaterThan(0);
      for (const d of paths) {
        const lines = flattenPath(d);
        expect(lines.length, `${kind}: ${d}`).toBeGreaterThan(0);
        for (const [x, y] of lines.flat()) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(24);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(24);
        }
      }
    }
  });

  it("flattens lines, curves and closes like SVG", () => {
    expect(flattenPath("M0 0 L4 0 V3 H0 Z")).toEqual([
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
        [0, 0],
      ],
    ]);
    const curve = flattenPath("M0 0 Q5 10 10 0", 4)[0] ?? [];
    expect(curve).toHaveLength(5);
    expect(curve[2]?.[0]).toBeCloseTo(5);
    expect(curve[2]?.[1]).toBeCloseTo(5);
    // Two subpaths are two strokes.
    expect(flattenPath("M0 0 L1 1 M2 2 L3 3")).toHaveLength(2);
  });

  it("refuses commands the library does not draw with", () => {
    expect(() => flattenPath("M0 0 A5 5 0 0 1 10 0")).toThrow(/unsupported/);
    expect(() => flattenPath("m0 0 l1 1")).toThrow(/unsupported/);
  });

  it("shows 11:47 on the story's clock", () => {
    const [, , , , , hour, minute] = clockPaths(11, 47).map(
      (d) => flattenPath(d)[0] ?? [],
    );
    const end = (line: readonly (readonly [number, number])[]) => {
      const tip = line.at(-1) ?? [12, 12];
      // Clockwise from twelve, in turns.
      const turns = Math.atan2(tip[0] - 12, 12 - tip[1]) / (Math.PI * 2);
      return (turns + 1) % 1;
    };
    expect(end(minute ?? [])).toBeCloseTo(47 / 60, 3);
    expect(end(hour ?? [])).toBeCloseTo((11 + 47 / 60) / 12, 3);
  });

  it("samples each pictogram into exactly `count` points on its strokes", () => {
    for (const count of [480, 1400]) {
      for (const kind of PICTOGRAM_KINDS) {
        const figure = buildFigure(kind, count);
        const frame = createFigureFrame(count);
        figure.evaluate({ t: 0, input: 0, output: 0, blink: 0 }, frame);
        expect(frame.x).toHaveLength(count);
        const lines = pictogramPolylines(kind);
        let near = 0;
        for (let i = 0; i < count; i += 1) {
          const x = frame.x[i] ?? 0;
          const y = frame.y[i] ?? 0;
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          // Inside the frame (about ±1.15).
          expect(Math.abs(x)).toBeLessThan(1.15);
          expect(Math.abs(y)).toBeLessThan(1.15);
          if (distanceTo(x, y, lines) < 0.06) near += 1;
        }
        // Every point sits on a stroke, give or take its soft thickness.
        expect(near / count, kind).toBeGreaterThan(0.97);
      }
    }
  });

  it("lays a pictogram out the same way every time", () => {
    const a = createFigureFrame(480);
    const b = createFigureFrame(480);
    buildFigure("HOUSE", 480).evaluate(
      { t: 0, input: 0, output: 0, blink: 0 },
      a,
    );
    buildFigure("HOUSE", 480).evaluate(
      { t: 0, input: 0, output: 0, blink: 0 },
      b,
    );
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
  });

  it("turns a pictogram as little as the Q mark, so it stays legible", () => {
    const base = {
      state: "SPEAKING" as const,
      input: 0,
      output: 0,
      leanX: 0,
      leanY: 0,
      t: 0,
      motion: "full" as const,
      dim: false,
      keep: 1,
    };
    const clock = presenceUniforms({ ...base, figure: "CLOCK" });
    const mark = presenceUniforms({ ...base, figure: "LETTER_Q" });
    expect(clock.yaw).toBeCloseTo(mark.yaw);
  });
});

describe("the story cue", () => {
  afterEach(() => vi.restoreAllMocks());

  it("announces a validated cue every presence hears", () => {
    const heard: unknown[] = [];
    const listen = (event: Event) => heard.push(cueDetail(event));
    window.addEventListener(Q_FIGURE_EVENT, listen);
    presence.form("CLOCK", { holdMs: 3000 });
    presence.form("HOUSE");
    presence.release();
    // A figure that is not in the library is not announced.
    presence.form("BRAIN" as never);
    window.removeEventListener(Q_FIGURE_EVENT, listen);
    expect(heard).toEqual([
      { kind: "FORM", figure: "CLOCK", holdMs: 3000 },
      { kind: "FORM", figure: "HOUSE", holdMs: CUE_HOLD_DEFAULT_MS },
      { kind: "RELEASE" },
    ]);
  });

  it("clamps a hold and rejects anything that is not a cue", () => {
    expect(clampHold(10)).toBe(CUE_HOLD_MIN_MS);
    expect(clampHold(1e9)).toBe(CUE_HOLD_MAX_MS);
    expect(clampHold(Number.NaN)).toBe(CUE_HOLD_DEFAULT_MS);
    expect(cueDetail(new Event(Q_FIGURE_EVENT))).toBeNull();
    expect(
      cueDetail(
        new CustomEvent(Q_FIGURE_EVENT, {
          detail: { kind: "FORM", figure: "CLOUD" },
        }),
      ),
    ).toBeNull();
    expect(PRESENCE_FIGURE_IDS).toContain("LETTER_Q");
  });
});

const INPUTS: PresenceInputs = {
  state: "SPEAKING",
  stage: true,
  showing: false,
  motion: "full",
  bloom: false,
};

function fakeHost(pixels: number, clock: { now: number }) {
  const queue = new Map<number, (now: number) => void>();
  let next = 1;
  const notes: string[] = [];
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    globalAlpha: 1,
  };
  const host: PresenceLoopHost = {
    canvas: { width: 0, height: 0, getContext: () => context },
    pixels,
    dpr: 1,
    cores: 8,
    allow3d: false,
    inputs: INPUTS,
    colour: [0.4, 0.6, 1],
    dark: true,
    levels: () => ({ input: 0, output: 0.5 }),
    leanTarget: () => ({ x: 0, y: 0 }),
    hidden: () => false,
    note: (key, value) => {
      if (key === "qFigure") notes.push(value);
    },
    load3d: () => Promise.reject(new Error("no 3d here")),
    requestFrame: (callback) => {
      queue.set(next, callback);
      return next++;
    },
    cancelFrame: (handle) => {
      queue.delete(handle);
    },
    now: () => clock.now,
  };
  const run = (ms: number) => {
    const end = clock.now + ms;
    for (; clock.now < end; clock.now += 1000 / 60) {
      const due = [...queue.values()];
      queue.clear();
      for (const callback of due) callback(clock.now);
    }
  };
  return { host, notes, run };
}

describe("a cue on the presence loop", () => {
  it("forms the figure, holds it, then lets the state's figure back", () => {
    const clock = { now: 1000 };
    const fake = fakeHost(224, clock);
    const loop = startPresenceLoop(fake.host);
    fake.run(200);
    expect(fake.notes.at(-1)).toBe("WAVE");
    expect(loop?.cue({ kind: "FORM", figure: "CLOCK", holdMs: 1500 })).toBe(
      true,
    );
    fake.run(1000);
    expect(fake.notes.at(-1)).toBe("CLOCK");
    fake.run(700);
    expect(fake.notes.at(-1)).toBe("WAVE");
    loop?.dispose();
  });

  it("lets go at once on release", () => {
    const clock = { now: 0 };
    const fake = fakeHost(224, clock);
    const loop = startPresenceLoop(fake.host);
    loop?.cue({ kind: "FORM", figure: "HOUSE", holdMs: 10_000 });
    fake.run(200);
    expect(fake.notes.at(-1)).toBe("HOUSE");
    loop?.cue({ kind: "RELEASE" });
    fake.run(100);
    expect(fake.notes.at(-1)).toBe("WAVE");
    loop?.dispose();
  });

  it("is ignored by a presence too small to draw it legibly", () => {
    const clock = { now: 0 };
    const fake = fakeHost(40, clock);
    const loop = startPresenceLoop(fake.host);
    expect(loop?.cue({ kind: "FORM", figure: "CLOCK", holdMs: 2000 })).toBe(
      false,
    );
    fake.run(300);
    expect(fake.notes).not.toContain("CLOCK");
    loop?.dispose();
  });
});

describe("everyday signals to figures", () => {
  it("maps what the answer carries", () => {
    expect(figureForSignals({ blocks: [{ kind: "COMPARISON" }] })).toBe(
      "COMPARE",
    );
    expect(figureForSignals({ blocks: [{ kind: "TABLE" }] })).toBe("COMPARE");
    expect(figureForSignals({ blocks: [{ kind: "CHART" }] })).toBe(
      "CHART_BARS",
    );
    expect(figureForSignals({ blocks: [{ kind: "MAP" }] })).toBe("MAP_PIN");
    expect(figureForSignals({ blocks: [{ kind: "TIMELINE" }] })).toBe(
      "CALENDAR",
    );
    expect(figureForSignals({ blocks: [{ kind: "ARTIFACT_REFERENCE" }] })).toBe(
      "DOCUMENT",
    );
  });

  it("maps meetings, messages and calendar intents by their code", () => {
    expect(
      figureForSignals({
        blocks: [{ kind: "ACTION_PROPOSAL", actionType: "meeting.propose" }],
      }),
    ).toBe("CALENDAR");
    expect(
      figureForSignals({
        blocks: [{ kind: "ACTION_PROPOSAL", actionType: "message.send" }],
      }),
    ).toBe("ENVELOPE");
    expect(
      figureForSignals({
        blocks: [{ kind: "UI_INTENT", intentKind: "SHOW_CALENDAR_CONNECT" }],
      }),
    ).toBe("CALENDAR");
    expect(
      figureForSignals({
        blocks: [
          { kind: "ACTION_PROPOSAL", actionType: "relationship.archive" },
        ],
      }),
    ).toBeNull();
  });

  it("the answer's last object wins over the stage", () => {
    expect(
      figureForSignals({
        stage: "COMPARING_OPPORTUNITIES",
        blocks: [{ kind: "MAP" }, { kind: "CHART" }],
      }),
    ).toBe("CHART_BARS");
  });

  it("maps the stage, the durable task and the preview's layout", () => {
    expect(figureForSignals({ stage: "COMPARING_OPPORTUNITIES" })).toBe(
      "COMPARE",
    );
    expect(figureForSignals({ stage: "REVISING_DOCUMENT" })).toBe("PEN");
    expect(
      figureForSignals({ stage: "REVIEWING_COMPANY", task: "PITCH_DECK" }),
    ).toBe("DOCUMENT");
    expect(
      figureForSignals({ preview: { layout: "TABLE", subjects: 2 } }),
    ).toBe("COMPARE");
    expect(
      figureForSignals({ preview: { layout: "TABLE", subjects: 1 } }),
    ).toBeNull();
  });

  it("forms nothing it would have to guess: web research, plain answers", () => {
    expect(figureForSignals({ stage: "SEARCHING_PUBLIC_SOURCES" })).toBeNull();
    expect(figureForSignals({ stage: "UNDERSTANDING_REQUEST" })).toBeNull();
    expect(
      figureForSignals({ blocks: [{ kind: "COMPANY_REFERENCE" }] }),
    ).toBeNull();
    expect(figureForSignals({})).toBeNull();
  });
});
