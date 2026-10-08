// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { QApertureState } from "../src/features/q-aperture/aperture-state";
import type { QMotion } from "../src/features/q-aperture/aperture-frame";
import { buildFigure } from "../src/features/q-swarm/presence-figures";
import { createFigureFrame } from "../src/features/q-swarm/presence-kit";
import {
  createQMoment,
  Q_ANSWER_DELAY,
  Q_IDLE_PERIOD,
  Q_LANDING_DELAY,
  Q_MIN_GAP,
  Q_MOMENT_SECONDS,
  type QMoment,
} from "../src/features/q-swarm/presence-q-moment";
import {
  startPresenceLoop,
  type PresenceInputs,
  type PresenceLoopHost,
} from "../src/features/q-swarm/presence-loop";

/**
 * The Q moment (founder direction 2026-10-07): the presence forms the
 * letter Q on first landing, after an answer, and at most once every
 * Q_IDLE_PERIOD of rest -- on a fake clock, deterministically.
 */

type Env = {
  state: QApertureState;
  surface: boolean;
  showing: boolean;
  motion: QMotion;
};

const STEP = 1 / 30;

/** Runs the schedule at 30 fps from `from` for `seconds`; the times it was on. */
function drive(moment: QMoment, env: Env, from: number, seconds: number) {
  const on: number[] = [];
  const frames = Math.round(seconds / STEP);
  for (let i = 0; i < frames; i += 1) {
    const t = from + i * STEP;
    if (moment.at(t, env.state, env.surface, env.showing, env.motion)) {
      on.push(t);
    }
  }
  return on;
}

/** Start times of each continuous run of "on". */
function starts(on: number[]): number[] {
  return on.filter((t, i) => i === 0 || t - (on[i - 1] ?? 0) > STEP * 1.5);
}

const resting: Env = {
  state: "IDLE",
  surface: true,
  showing: false,
  motion: "full",
};

describe("the Q moment's schedule", () => {
  it("forms once on first landing, for its in-and-hold time, then rests", () => {
    const moment = createQMoment({ landing: () => true });
    const on = drive(moment, resting, 0, 20);
    expect(starts(on)).toHaveLength(1);
    expect(on[0]).toBeCloseTo(Q_LANDING_DELAY, 1);
    const span = (on[on.length - 1] ?? 0) - (on[0] ?? 0);
    expect(span).toBeGreaterThan(Q_MOMENT_SECONDS - 0.1);
    expect(span).toBeLessThan(Q_MOMENT_SECONDS + 0.05);
  });

  it("greets only when the host says this page has not been greeted", () => {
    const moment = createQMoment({ landing: () => false });
    expect(drive(moment, resting, 0, 30)).toEqual([]);
  });

  it("asks the landing question once, at the first eligible frame", () => {
    let asked = 0;
    const moment = createQMoment({
      landing: () => {
        asked += 1;
        return true;
      },
    });
    drive(moment, { ...resting, state: "SPEAKING" }, 0, 5);
    expect(asked).toBe(0);
    drive(moment, resting, 5, 30);
    expect(asked).toBe(1);
  });

  it("at most once every idle period while resting, never sooner", () => {
    const moment = createQMoment({ landing: () => false });
    const on = starts(drive(moment, resting, 0, Q_IDLE_PERIOD * 3 + 1));
    expect(on).toHaveLength(3);
    expect(on[0]).toBeCloseTo(Q_IDLE_PERIOD, 1);
    for (let i = 1; i < on.length; i += 1) {
      expect((on[i] ?? 0) - (on[i - 1] ?? 0)).toBeCloseTo(Q_IDLE_PERIOD, 1);
    }
  });

  it("forms a beat after Q finishes an answer", () => {
    const moment = createQMoment({ landing: () => false });
    drive(moment, resting, 0, 10);
    drive(moment, { ...resting, state: "SPEAKING" }, 10, 5);
    const on = starts(drive(moment, { ...resting, state: "COMPLETE" }, 15, 10));
    expect(on).toHaveLength(1);
    expect(on[0]).toBeCloseTo(15 + Q_ANSWER_DELAY, 1);
  });

  it("is the same every time: no dice", () => {
    const run = () => {
      const moment = createQMoment({ landing: () => true });
      return [
        ...drive(moment, resting, 0, 10),
        ...drive(moment, { ...resting, state: "THINKING" }, 10, 3),
        ...drive(moment, resting, 13, 120),
      ];
    };
    expect(run()).toEqual(run());
  });

  it("never while Q listens, thinks, works, speaks, asks or is paused", () => {
    const busy: QApertureState[] = [
      "LISTENING",
      "THINKING",
      "WORKING",
      "SPEAKING",
      "NEEDS_INPUT",
      "NEEDS_APPROVAL",
      "ERROR",
    ];
    for (const state of busy) {
      const moment = createQMoment({ landing: () => true });
      expect(
        drive(moment, { ...resting, state }, 0, Q_IDLE_PERIOD * 2),
      ).toEqual([]);
    }
  });

  it("never while cards are up, under reduced motion, or off the Q page", () => {
    for (const env of [
      { ...resting, showing: true },
      { ...resting, motion: "calm" as const },
      { ...resting, motion: "off" as const },
      { ...resting, surface: false },
    ]) {
      const moment = createQMoment({ landing: () => true });
      expect(drive(moment, env, 0, Q_IDLE_PERIOD * 2)).toEqual([]);
    }
  });

  it("an ask (the harness) forms it now, and is ignored mid-moment", () => {
    const moment = createQMoment({ landing: () => false });
    drive(moment, resting, 0, 5);
    moment.ask();
    const first = drive(moment, resting, 5, 1);
    expect(first[0]).toBeCloseTo(5, 5);
    moment.ask();
    const on = starts(drive(moment, resting, 6, 10));
    // Still the first moment's hold; no second one queued behind it.
    expect(on).toEqual([6]);
  });

  it("lets go at once when Q starts listening mid-moment", () => {
    const moment = createQMoment({ landing: () => true });
    const on = drive(moment, resting, 0, Q_LANDING_DELAY + 0.5);
    expect(on.length).toBeGreaterThan(0);
    expect(
      drive(
        moment,
        { ...resting, state: "LISTENING" },
        Q_LANDING_DELAY + 0.5,
        1,
      ),
    ).toEqual([]);
  });

  it("an answer just after the landing moment waits out the minimum gap", () => {
    const moment = createQMoment({ landing: () => true });
    drive(moment, resting, 0, Q_LANDING_DELAY + 0.1);
    drive(moment, { ...resting, state: "SPEAKING" }, Q_LANDING_DELAY + 0.1, 1);
    const from = Q_LANDING_DELAY + 1.1;
    const on = drive(moment, resting, from, Q_MIN_GAP);
    // The answer's beat lands inside the gap: no second letter.
    expect(on).toEqual([]);
  });

  it("unbroken rest restarts after Q does something else", () => {
    const moment = createQMoment({ landing: () => false });
    drive(moment, resting, 0, Q_IDLE_PERIOD - 5);
    drive(moment, { ...resting, state: "LISTENING" }, Q_IDLE_PERIOD - 5, 1);
    const on = starts(
      drive(moment, { ...resting }, Q_IDLE_PERIOD - 4, Q_IDLE_PERIOD + 1),
    );
    // Listening -> idle is not an answer; the idle clock starts over.
    expect(on).toHaveLength(1);
    expect(on[0]).toBeCloseTo(Q_IDLE_PERIOD - 4 + Q_IDLE_PERIOD, 1);
  });
});

describe("the letter Q figure", () => {
  it("lays out every point inside the frame, on the letter", () => {
    const count = 900;
    const figure = buildFigure("LETTER_Q", count);
    const frame = createFigureFrame(count);
    figure.evaluate({ t: 0, input: 0, output: 0, blink: 0 }, frame);
    let inRing = 0;
    for (let i = 0; i < count; i += 1) {
      const x = (frame.x[i] ?? 0) + 0.05;
      const y = (frame.y[i] ?? 0) + 0.05;
      expect(Math.abs(x)).toBeLessThan(1.15);
      expect(Math.abs(y)).toBeLessThan(1.15);
      const r = Math.hypot(x, y);
      if (r > 0.4 && r < 0.68) inRing += 1;
    }
    // Most of the letter is its ring; the hole stays dark save the tail.
    expect(inRing / count).toBeGreaterThan(0.75);
  });
});

describe("the loop with the Q moment", () => {
  const INPUTS: PresenceInputs = {
    state: "IDLE",
    stage: true,
    showing: false,
    motion: "full",
    bloom: false,
  };
  const host = (
    inputs: PresenceInputs,
    notes: string[],
  ): {
    host: PresenceLoopHost;
    run: (from: number, ms: number) => void;
  } => {
    const queue = new Map<number, (now: number) => void>();
    let next = 1;
    const context = {
      setTransform: () => undefined,
      clearRect: () => undefined,
      drawImage: () => undefined,
      globalAlpha: 1,
    };
    return {
      host: {
        canvas: { width: 0, height: 0, getContext: () => context },
        pixels: 200,
        dpr: 1,
        cores: 8,
        allow3d: false,
        inputs,
        colour: [0.8, 0.65, 0.3],
        dark: true,
        levels: () => ({ input: 0, output: 0 }),
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
        now: () => 0,
        landing: () => true,
      },
      run: (from, ms) => {
        for (let t = from; t < from + ms; t += 1000 / 60) {
          const due = [...queue.values()];
          queue.clear();
          for (const callback of due) callback(t);
        }
      },
    };
  };

  it("forms the letter on landing and returns to the state's figure", () => {
    const notes: string[] = [];
    const fake = host(INPUTS, notes);
    const loop = startPresenceLoop(fake.host);
    fake.run(1000, 6000);
    expect(notes).toEqual(["CLOUD", "LETTER_Q", "CLOUD"]);
    loop?.dispose();
  });

  it("a still presence never forms it", () => {
    const notes: string[] = [];
    const fake = host({ ...INPUTS, motion: "off" }, notes);
    const loop = startPresenceLoop(fake.host);
    fake.run(1000, 6000);
    loop?.formQ();
    loop?.redraw();
    fake.run(7000, 500);
    expect(notes).not.toContain("LETTER_Q");
    loop?.dispose();
  });
});
