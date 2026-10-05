import { describe, expect, it } from "vitest";

import { Q_PRESENCE_GESTURES } from "@capital-q/contracts";

import { Q_APERTURE_STATES } from "../src/features/q-aperture/aperture-state";
import {
  createPresenceSim,
  DETOUR,
  flowAt,
  MAX_ACCEL,
  MAX_DT,
  MAX_SPEED,
  morphPoint,
  morphSeconds,
  morphWeight,
} from "../src/features/q-swarm/presence-dynamics";
import { FACE_PARTS, facePartsOf } from "../src/features/q-swarm/presence-face";
import {
  buildFigure,
  createFigureFrame,
  FACE_FIGURES,
  FIGURE_KINDS,
  HAND_FIGURES,
  type FigureKind,
} from "../src/features/q-swarm/presence-figures";
import {
  ARRIVE_MS,
  createPresenceMachine,
  FACE_MIN_PIXELS,
  faceAllowed,
  figureForState,
  gestureOffsets,
  GESTURE_FIGURE,
  GESTURE_MS,
  READY_MS,
  sentenceStarts,
  WAKE_MS,
} from "../src/features/q-swarm/presence-machine";
import {
  gesturesDetail,
  Q_GESTURES_EVENT,
} from "../src/features/q-swarm/q-gestures";

/**
 * PRESENCE (founder 2026-10-01): what the particles form follows what is
 * said and heard, and how they move is continuous -- never a drift and
 * then a bounce into a shape.
 */

describe("which figure, from real signals", () => {
  it("gives every state its free shape (K1), and no face anywhere by default", () => {
    for (const state of Q_APERTURE_STATES) {
      expect(FACE_FIGURES.has(figureForState(state, false))).toBe(false);
    }
    expect(figureForState("IDLE", false)).toBe("CLOUD");
    expect(figureForState("LISTENING", false)).toBe("ATTENTIVE");
    expect(figureForState("THINKING", false)).toBe("SPIRAL");
    expect(figureForState("WORKING", false)).toBe("RING");
    expect(figureForState("SPEAKING", false)).toBe("WAVE");
    expect(figureForState("NEEDS_INPUT", false)).toBe("QUESTION");
  });

  it("shows the human face only while Q speaks on the Q page at 160 px or more (ADR 0051)", () => {
    expect(faceAllowed({ face: true, pixels: FACE_MIN_PIXELS })).toBe(true);
    expect(faceAllowed({ face: true, pixels: 360 })).toBe(true);
    expect(faceAllowed({ face: true, pixels: FACE_MIN_PIXELS - 1 })).toBe(
      false,
    );
    // Any other surface, however large, has no face.
    expect(faceAllowed({ face: false, pixels: 520 })).toBe(false);
    expect(figureForState("SPEAKING", false, true)).toBe("FACE");
    for (const state of Q_APERTURE_STATES) {
      if (state === "SPEAKING") continue;
      expect(figureForState(state, false, true)).not.toBe("FACE");
    }
    const machine = createPresenceMachine();
    expect(
      machine.step({ state: "SPEAKING", small: false, now: 0, face: true })
        .figure,
    ).toBe("FACE");
    expect(
      machine.step({ state: "SPEAKING", small: false, now: 10, face: false })
        .figure,
    ).toBe("WAVE");
    expect(
      machine.step({ state: "SPEAKING", small: true, now: 20, face: true })
        .figure,
    ).toBe("CLOUD");
  });

  it("shows the Q mark in knots of light once when an answer is ready, then the cloud", () => {
    const machine = createPresenceMachine();
    machine.step({ state: "SPEAKING", small: false, now: 0 });
    expect(
      machine.step({ state: "COMPLETE", small: false, now: 100 }),
    ).toMatchObject({ figure: "CONSTELLATION", cause: "READY" });
    expect(
      machine.step({ state: "COMPLETE", small: false, now: 100 + READY_MS })
        .figure,
    ).toBe("CLOUD");
    // A surface that opens on a finished answer shows the cloud at once.
    expect(
      createPresenceMachine().step({ state: "COMPLETE", small: false, now: 0 })
        .figure,
    ).toBe("CLOUD");
  });

  it("arrives on a surface Q travels to as a ribbon, then takes its state's shape", () => {
    const machine = createPresenceMachine({ arrive: true });
    expect(
      machine.step({ state: "IDLE", small: false, now: 5_000 }),
    ).toMatchObject({ figure: "RIBBON", cause: "ARRIVE" });
    expect(
      machine.step({ state: "IDLE", small: false, now: 5_000 + ARRIVE_MS })
        .figure,
    ).toBe("CLOUD");
    expect(
      createPresenceMachine().step({ state: "IDLE", small: false, now: 0 })
        .figure,
    ).toBe("CLOUD");
  });

  it("never shows a face or a gesture on a surface too small to read one", () => {
    const machine = createPresenceMachine();
    machine.schedule(
      { gestures: [{ sentence: 0, gesture: "MONEY" }], spoken: false },
      0,
    );
    for (const state of [
      "IDLE",
      "LISTENING",
      "THINKING",
      "WORKING",
      "SPEAKING",
      "NEEDS_INPUT",
      "NEEDS_APPROVAL",
      "COMPLETE",
      "ERROR",
    ] as const) {
      const view = machine.step({ state, small: true, now: 10 });
      expect(FACE_FIGURES.has(view.figure)).toBe(false);
      expect(view.cause).toBe("STATE");
    }
  });

  it("answers 'Hey Q' from rest with a '!', then leans in to listen", () => {
    const machine = createPresenceMachine();
    machine.step({ state: "IDLE", small: false, now: 0 });
    expect(
      machine.step({ state: "LISTENING", small: false, now: 100 }),
    ).toMatchObject({
      figure: "EXCLAIM",
      cause: "WAKE",
    });
    expect(
      machine.step({ state: "LISTENING", small: false, now: 100 + WAKE_MS + 1 })
        .figure,
    ).toBe("ATTENTIVE");
  });

  it("does not wake between turns of a live conversation", () => {
    const machine = createPresenceMachine();
    machine.step({ state: "SPEAKING", small: false, now: 0 });
    expect(
      machine.step({ state: "LISTENING", small: false, now: 50 }).figure,
    ).toBe("ATTENTIVE");
  });

  it("dims on error", () => {
    const machine = createPresenceMachine();
    expect(machine.step({ state: "ERROR", small: false, now: 0 }).dim).toBe(
      true,
    );
  });
});

describe("gestures from the answer, timed to what is said", () => {
  it("maps every contract gesture to its own figure", () => {
    for (const gesture of Q_PRESENCE_GESTURES) {
      expect(FIGURE_KINDS).toContain(GESTURE_FIGURE[gesture]);
      expect(GESTURE_MS[gesture]).toBeGreaterThan(1000);
    }
    expect(GESTURE_FIGURE.MONEY).toBe("MONEY");
    expect(GESTURE_FIGURE.CLAP).toBe("CLAP");
    expect(HAND_FIGURES.has("CLAP")).toBe(true);
    expect(HAND_FIGURES.has(GESTURE_FIGURE.HANDS_EXPLAIN)).toBe(true);
    // The old face's gestures are shapes now: no gesture shows a face.
    for (const gesture of Q_PRESENCE_GESTURES) {
      expect(FACE_FIGURES.has(GESTURE_FIGURE[gesture])).toBe(false);
    }
  });

  it("times spoken gestures at their sentence's share of the reply", () => {
    const text =
      "Revenue doubled. They own offices in Lagos and Accra. Well done.";
    const starts = sentenceStarts(text);
    expect(starts).toHaveLength(3);
    const offsets = gestureOffsets({
      spoken: true,
      text,
      gestures: [
        { sentence: 0, gesture: "MONEY" },
        { sentence: 2, gesture: "CLAP" },
      ],
    });
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBeGreaterThan(2_000);
    // Typed: one after another.
    const typed = gestureOffsets({
      spoken: false,
      gestures: [
        { sentence: 0, gesture: "MONEY" },
        { sentence: 2, gesture: "CLAP" },
      ],
    });
    expect(typed[1]).toBeGreaterThanOrEqual(GESTURE_MS.MONEY);
  });

  it("plays a spoken answer's gestures against Q's voice, then returns to the wave", () => {
    const machine = createPresenceMachine();
    machine.step({ state: "THINKING", small: false, now: 0 });
    machine.schedule(
      {
        spoken: true,
        gestures: [
          { sentence: 0, gesture: "BUILDINGS" },
          { sentence: 1, gesture: "LAUGH" },
        ],
      },
      100,
    );
    // Waiting for the voice: still thinking.
    expect(
      machine.step({ state: "THINKING", small: false, now: 500 }).figure,
    ).toBe("SPIRAL");
    expect(
      machine.step({ state: "SPEAKING", small: false, now: 1_000 }).figure,
    ).toBe("BUILDINGS");
    const afterFirst = 1_000 + GESTURE_MS.BUILDINGS + 10;
    // The second is due at one sentence in (no text: SENTENCE_MS).
    const view = machine.step({
      state: "SPEAKING",
      small: false,
      now: afterFirst + 300,
    });
    expect(view.figure).toBe(GESTURE_FIGURE.LAUGH);
    expect(
      machine.step({
        state: "SPEAKING",
        small: false,
        now: afterFirst + 300 + GESTURE_MS.LAUGH + 10,
      }).figure,
    ).toBe("WAVE");
  });

  it("drops what was not said yet when the person interrupts", () => {
    const machine = createPresenceMachine();
    machine.step({ state: "SPEAKING", small: false, now: 0 });
    machine.schedule(
      {
        spoken: true,
        gestures: [
          { sentence: 0, gesture: "NOD" },
          { sentence: 3, gesture: "MONEY" },
        ],
      },
      10,
    );
    expect(
      machine.step({ state: "SPEAKING", small: false, now: 20 }),
    ).toMatchObject({ figure: GESTURE_FIGURE.NOD, cause: "GESTURE" });
    expect(
      machine.step({ state: "LISTENING", small: false, now: 400 }).figure,
    ).toBe("ATTENTIVE");
    expect(machine.waiting()).toBe(0);
  });

  it("plays a typed answer's gestures as it lands, and forgets stale ones", () => {
    const machine = createPresenceMachine();
    machine.schedule(
      { spoken: false, gestures: [{ sentence: 0, gesture: "CHART_UP" }] },
      0,
    );
    expect(
      machine.step({ state: "COMPLETE", small: false, now: 1 }).figure,
    ).toBe("CHART_UP");
    machine.schedule(
      { spoken: false, gestures: [{ sentence: 0, gesture: "EXCLAIM" }] },
      0,
    );
    // Long after it was due, it is no longer about anything.
    expect(
      machine.step({ state: "IDLE", small: false, now: 20_000 }).figure,
    ).toBe("CLOUD");
  });

  it("reads only well-formed gesture events", () => {
    const good = new CustomEvent(Q_GESTURES_EVENT, {
      detail: {
        answerId: "a1",
        spoken: true,
        gestures: [{ sentence: 0, gesture: "CLAP" }],
      },
    });
    expect(gesturesDetail(good)?.gestures).toEqual([
      { sentence: 0, gesture: "CLAP" },
    ]);
    const bad = new CustomEvent(Q_GESTURES_EVENT, {
      detail: {
        answerId: "a2",
        gestures: [{ sentence: 0, gesture: "FIREWORKS" }],
      },
    });
    expect(gesturesDetail(bad)).toBeNull();
    expect(gesturesDetail(new Event(Q_GESTURES_EVENT))).toBeNull();
  });
});

describe("figures", () => {
  const input = { t: 1.3, output: 0.5, input: 0.4, blink: 0 };

  it("gives every particle a finite place in every figure, inside the frame", () => {
    for (const kind of FIGURE_KINDS) {
      for (const count of [160, 420, 2400]) {
        const figure = buildFigure(kind, count);
        const frame = createFigureFrame(count);
        figure.evaluate(input, frame);
        for (let i = 0; i < count; i += 1) {
          const x = frame.x[i] ?? NaN;
          const y = frame.y[i] ?? NaN;
          const z = frame.z[i] ?? NaN;
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(Math.abs(x)).toBeLessThan(1.25);
          expect(Math.abs(y)).toBeLessThan(1.25);
          expect(Math.abs(z)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("moves the face's lower lip with Q's voice, and blinks only the lids and eyes", () => {
    const count = 1600;
    const face = buildFigure("FACE", count);
    const parts = facePartsOf(count);
    const quiet = createFigureFrame(count);
    const loud = createFigureFrame(count);
    const blink = createFigureFrame(count);
    face.evaluate({ ...input, output: 0, t: 0 }, quiet);
    face.evaluate({ ...input, output: 1, t: 0 }, loud);
    face.evaluate({ ...input, output: 0, t: 0, blink: 1 }, blink);
    let lip = 0;
    for (let i = 0; i < count; i += 1) {
      const dy = (loud.y[i] ?? 0) - (quiet.y[i] ?? 0);
      if (parts[i] === FACE_PARTS.LOWER_LIP && dy > 0.01) lip += 1;
      // Only the mouth, lower lip and chin move with the voice.
      if (
        parts[i] !== FACE_PARTS.LOWER_LIP &&
        parts[i] !== FACE_PARTS.MOUTH &&
        parts[i] !== FACE_PARTS.CHIN
      ) {
        expect(dy).toBe(0);
      }
      const shut = Math.abs((blink.y[i] ?? 0) - (quiet.y[i] ?? 0)) > 1e-6;
      if (shut) expect(parts[i]).toBe(FACE_PARTS.LID);
    }
    expect(lip).toBeGreaterThan(5);
  });

  it("lights the face evenly: no dark holes where the eyes and mouth are", () => {
    const count = 2400;
    const frame = createFigureFrame(count);
    buildFigure("FACE", count).evaluate({ ...input, output: 0 }, frame);
    const parts = facePartsOf(count);
    // Around each eye, the skin stays lit (the old face had black sockets).
    for (const side of [-1, 1]) {
      const cx = side * 0.23 * 0.92;
      const cy = -0.1 * 0.92;
      const near: number[] = [];
      for (let i = 0; i < count; i += 1) {
        if (parts[i] !== FACE_PARTS.SKIN) continue;
        const d = Math.hypot((frame.x[i] ?? 0) - cx, (frame.y[i] ?? 0) - cy);
        if (d < 0.09) near.push(frame.b[i] ?? 0);
      }
      expect(near.length).toBeGreaterThan(8);
      const mean = near.reduce((a, b) => a + b, 0) / near.length;
      expect(mean).toBeGreaterThan(0.12);
    }
  });

  it("brings the hands into the frame when Q explains", () => {
    const count = 800;
    const frame = createFigureFrame(count);
    buildFigure(GESTURE_FIGURE.HANDS_EXPLAIN, count).evaluate(input, frame);
    const sides = Array.from(frame.x).filter((x) => Math.abs(x) > 0.3);
    expect(sides.length).toBeGreaterThan(count * 0.5);
  });

  it("draws each free shape as its own form (K1)", () => {
    const count = 900;
    const at = (kind: FigureKind) => {
      const frame = createFigureFrame(count);
      buildFigure(kind, count).evaluate({ ...input, output: 0 }, frame);
      return frame;
    };
    // The ring is hollow: nothing near its centre.
    const ring = at("RING");
    const radii = Array.from(ring.x, (x, i) =>
      Math.hypot(x, (ring.y[i] ?? 0) / Math.cos(1.12)),
    );
    expect(Math.min(...radii)).toBeGreaterThan(0.5);
    // The wave is wide and flat.
    const wave = at("WAVE");
    const wide = Math.max(...wave.x) - Math.min(...wave.x);
    const tall = Math.max(...wave.y) - Math.min(...wave.y);
    expect(wide).toBeGreaterThan(tall * 1.8);
    // The Q mark has its tail out to the lower right.
    const mark = at("CONSTELLATION");
    const tail = Array.from(mark.x).filter(
      (x, i) => x > 0.7 && (mark.y[i] ?? 0) > 0.7,
    );
    expect(tail.length).toBeGreaterThan(count * 0.02);
    // The ribbon reaches further sideways than the cloud.
    const ribbon = at("RIBBON");
    const cloud = at("CLOUD");
    expect(Math.max(...ribbon.x)).toBeGreaterThan(Math.max(...cloud.x));
  });

  it("has a divergence-free current", () => {
    const a = { fx: 0, fy: 0 };
    const b = { fx: 0, fy: 0 };
    const c = { fx: 0, fy: 0 };
    const h = 1e-3;
    for (const [x, y] of [
      [0.1, 0.2],
      [-0.6, 0.4],
      [0.9, -0.7],
    ] as const) {
      flowAt(x + h, y, 2, a);
      flowAt(x - h, y, 2, b);
      const dfx = (a.fx - b.fx) / (2 * h);
      flowAt(x, y + h, 2, a);
      flowAt(x, y - h, 2, c);
      const dfy = (a.fy - c.fy) / (2 * h);
      expect(Math.abs(dfx + dfy)).toBeLessThan(1e-3);
    }
  });
});

describe("motion: continuous, never a snap", () => {
  const all: FigureKind[] = [...FIGURE_KINDS];

  function run(fps: number, sequence: FigureKind[], holdSeconds: number) {
    const sim = createPresenceSim({
      count: 300,
      initial: "CLOUD",
    });
    const dt = 1 / fps;
    const px = new Float32Array(sim.count);
    const py = new Float32Array(sim.count);
    const pvx = new Float32Array(sim.count);
    const pvy = new Float32Array(sim.count);
    let maxStep = 0;
    let maxDv = 0;
    let t = 0;
    for (const kind of sequence) {
      sim.setFigure(kind);
      for (let f = 0; f < holdSeconds * fps; f += 1) {
        px.set(sim.x);
        py.set(sim.y);
        pvx.set(sim.vx);
        pvy.set(sim.vy);
        t += dt;
        const level = Math.max(0, Math.sin(t * 9)) ** 2;
        sim.step(t, dt, { input: level, output: level });
        for (let i = 0; i < sim.count; i += 1) {
          maxStep = Math.max(
            maxStep,
            Math.hypot(
              (sim.x[i] ?? 0) - (px[i] ?? 0),
              (sim.y[i] ?? 0) - (py[i] ?? 0),
            ),
          );
          maxDv = Math.max(
            maxDv,
            Math.hypot(
              (sim.vx[i] ?? 0) - (pvx[i] ?? 0),
              (sim.vy[i] ?? 0) - (pvy[i] ?? 0),
            ),
          );
        }
      }
    }
    return { maxStep, maxDv };
  }

  it("bounds every particle's movement per frame through every change of figure (60 fps)", () => {
    const sequence = all.flatMap((kind, i) => [
      kind,
      all[(i * 7 + 3) % all.length] ?? "CLOUD",
    ]);
    const { maxStep, maxDv } = run(60, sequence, 0.9);
    expect(maxStep).toBeLessThanOrEqual(MAX_SPEED / 60 + 1e-6);
    expect(maxDv).toBeLessThanOrEqual(MAX_ACCEL / 60 + 1e-6);
  });

  it("keeps the bound on a slow phone (30 fps) and through a dropped frame", () => {
    const { maxStep, maxDv } = run(
      30,
      ["CLOUD", "FACE", "SPIRAL", "MONEY", "RIBBON", "ATTENTIVE", "CLAP"],
      1.2,
    );
    expect(maxStep).toBeLessThanOrEqual(MAX_SPEED * MAX_DT + 1e-6);
    expect(maxDv).toBeLessThanOrEqual(MAX_ACCEL * MAX_DT + 1e-6);
    const sim = createPresenceSim({ count: 100 });
    sim.setFigure("BUILDINGS");
    const x0 = Float32Array.from(sim.x);
    sim.step(1, 2.5, { input: 0, output: 0 });
    for (let i = 0; i < sim.count; i += 1) {
      expect(Math.abs((sim.x[i] ?? 0) - (x0[i] ?? 0))).toBeLessThanOrEqual(
        MAX_SPEED * MAX_DT + 1e-6,
      );
    }
  });

  it("changes figure at a variable but bounded pace, quicker into a gesture", () => {
    for (const roll of [0, 0.5, 0.999]) {
      expect(morphSeconds("MONEY", roll)).toBeLessThan(
        morphSeconds("CLOUD", roll),
      );
      for (const kind of all) {
        expect(morphSeconds(kind, roll)).toBeGreaterThanOrEqual(0.55);
        expect(morphSeconds(kind, roll)).toBeLessThanOrEqual(1.6);
      }
    }
  });

  it("flows between shapes along a swirl that starts and lands exactly", () => {
    const out = { x: 0, y: 0 };
    morphPoint(0.2, -0.4, -0.6, 0.5, 0, 1.3, 0.7, out);
    expect(out).toEqual({ x: 0.2, y: -0.4 });
    morphPoint(0.2, -0.4, -0.6, 0.5, 1, 1.3, 0.7, out);
    expect(out.x).toBeCloseTo(-0.6, 9);
    expect(out.y).toBeCloseTo(0.5, 9);
    // Midway it leaves the straight line (a flow, not a slide), but never far.
    let off = 0;
    for (let k = 0; k < 20; k += 1) {
      morphPoint(0.2, -0.4, -0.6, 0.5, 0.5, k * 0.31, k, out);
      const straightX = -0.2;
      const straightY = 0.05;
      const d = Math.hypot(out.x - straightX, out.y - straightY);
      off = Math.max(off, d);
      expect(d).toBeLessThanOrEqual(DETOUR * Math.SQRT2 + 1e-9);
    }
    expect(off).toBeGreaterThan(0.05);
    // Each particle waits for its staggered start, then eases in, monotonically.
    expect(morphWeight(0.1, 0.2)).toBe(0);
    let last = 0;
    for (let p = 0; p <= 1.3; p += 0.05) {
      const w = morphWeight(p, 0.2);
      expect(w).toBeGreaterThanOrEqual(last);
      last = w;
    }
    expect(morphWeight(1.3, 0.3)).toBe(1);
  });

  it("arrives: after a change the swarm settles onto the new figure", () => {
    const sim = createPresenceSim({
      count: 200,
      initial: "CLOUD",
    });
    sim.setFigure("EXCLAIM");
    let t = 0;
    for (let f = 0; f < 150; f += 1) {
      t += 1 / 60;
      sim.step(t, 1 / 60, { input: 0, output: 0 });
    }
    const frame = createFigureFrame(200);
    buildFigure("EXCLAIM", 200).evaluate(
      { t, input: 0, output: 0, blink: 0 },
      frame,
    );
    let far = 0;
    for (let i = 0; i < 200; i += 1) {
      if (
        Math.hypot(
          (sim.x[i] ?? 0) - (frame.x[i] ?? 0),
          (sim.y[i] ?? 0) - (frame.y[i] ?? 0),
        ) > 0.1
      ) {
        far += 1;
      }
    }
    expect(far).toBeLessThan(10);
  });

  it("reduced motion settles a figure in place, with no velocity", () => {
    const sim = createPresenceSim({ count: 100 });
    sim.settle("QUESTION", 0, { input: 0, output: 0 });
    expect(Math.max(...Array.from(sim.vx).map(Math.abs))).toBe(0);
    expect(sim.figure()).toBe("QUESTION");
  });
});
