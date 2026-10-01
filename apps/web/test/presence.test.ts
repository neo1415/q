import { describe, expect, it } from "vitest";

import { Q_PRESENCE_GESTURES } from "@capital-q/contracts";

import type { QApertureState } from "../src/features/q-aperture/aperture-state";
import {
  createPresenceSim,
  flowAt,
  MAX_ACCEL,
  MAX_DT,
  MAX_SPEED,
  morphSeconds,
} from "../src/features/q-swarm/presence-dynamics";
import {
  buildFigure,
  createFigureFrame,
  FACE_FIGURES,
  FIGURE_KINDS,
  HAND_FIGURES,
  type FigureKind,
} from "../src/features/q-swarm/presence-figures";
import {
  createPresenceMachine,
  figureForState,
  gestureOffsets,
  GESTURE_FIGURE,
  GESTURE_MS,
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
  it("shows no face unless Q is speaking or thinking", () => {
    const faceless: QApertureState[] = [
      "IDLE",
      "LISTENING",
      "WORKING",
      "ERROR",
    ];
    for (const state of faceless) {
      expect(FACE_FIGURES.has(figureForState(state, false))).toBe(false);
    }
    expect(figureForState("SPEAKING", false)).toBe("FACE");
    expect(figureForState("THINKING", false)).toBe("HEAD");
    expect(figureForState("LISTENING", false)).toBe("ATTENTIVE");
    expect(figureForState("NEEDS_INPUT", false)).toBe("QUESTION");
    expect(figureForState("IDLE", false)).toBe("CLOUD");
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
    expect(HAND_FIGURES.has("HANDS_EXPLAIN")).toBe(true);
    expect(FACE_FIGURES.has("LAUGH")).toBe(true);
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

  it("plays a spoken answer's gestures against Q's voice, then returns to the face", () => {
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
    ).toBe("HEAD");
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
    expect(view.figure).toBe("LAUGH");
    expect(
      machine.step({
        state: "SPEAKING",
        small: false,
        now: afterFirst + 300 + GESTURE_MS.LAUGH + 10,
      }).figure,
    ).toBe("FACE");
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
      machine.step({ state: "SPEAKING", small: false, now: 20 }).figure,
    ).toBe("NOD");
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
      for (const voice of ["FEMALE", "MALE"] as const) {
        const count = 420;
        const figure = buildFigure(kind, voice, count);
        const frame = createFigureFrame(count);
        figure.evaluate(input, frame);
        for (let i = 0; i < count; i += 1) {
          const x = frame.x[i] ?? NaN;
          const y = frame.y[i] ?? NaN;
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(Math.abs(x)).toBeLessThan(1.25);
          expect(Math.abs(y)).toBeLessThan(1.25);
        }
      }
    }
  });

  it("makes the face bigger than before and opens the mouth with the voice", () => {
    const count = 800;
    const face = buildFigure("FACE", "FEMALE", count);
    const quiet = createFigureFrame(count);
    const loud = createFigureFrame(count);
    face.evaluate({ ...input, output: 0, t: 0 }, quiet);
    face.evaluate({ ...input, output: 1, t: 0 }, loud);
    const height = Math.max(...quiet.y) - Math.min(...quiet.y);
    // The old face spanned about 0.73 of the frame (2.3 units wide).
    expect(height / 2.3).toBeGreaterThan(0.78);
    let moved = 0;
    for (let i = 0; i < count; i += 1) {
      if (Math.abs((loud.y[i] ?? 0) - (quiet.y[i] ?? 0)) > 0.02) moved += 1;
    }
    expect(moved).toBeGreaterThan(20);
  });

  it("brings the hands into the frame when Q explains", () => {
    const count = 800;
    const frame = createFigureFrame(count);
    buildFigure("HANDS_EXPLAIN", "MALE", count).evaluate(input, frame);
    const lowSides = Array.from(frame.x).filter(
      (x, i) => Math.abs(x) > 0.45 && (frame.y[i] ?? 0) > 0.25,
    );
    expect(lowSides.length).toBeGreaterThan(count * 0.15);
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
      voice: "FEMALE",
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
      ["CLOUD", "FACE", "MONEY", "ATTENTIVE", "CLAP"],
      1.2,
    );
    expect(maxStep).toBeLessThanOrEqual(MAX_SPEED * MAX_DT + 1e-6);
    expect(maxDv).toBeLessThanOrEqual(MAX_ACCEL * MAX_DT + 1e-6);
    const sim = createPresenceSim({ count: 100, voice: "MALE" });
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

  it("arrives: after a change the swarm settles onto the new figure", () => {
    const sim = createPresenceSim({
      count: 200,
      voice: "FEMALE",
      initial: "CLOUD",
    });
    sim.setFigure("EXCLAIM");
    let t = 0;
    for (let f = 0; f < 150; f += 1) {
      t += 1 / 60;
      sim.step(t, 1 / 60, { input: 0, output: 0 });
    }
    const frame = createFigureFrame(200);
    buildFigure("EXCLAIM", "FEMALE", 200).evaluate(
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
    const sim = createPresenceSim({ count: 100, voice: "FEMALE" });
    sim.settle("QUESTION", 0, { input: 0, output: 0 });
    expect(Math.max(...Array.from(sim.vx).map(Math.abs))).toBe(0);
    expect(sim.figure()).toBe("QUESTION");
  });
});
