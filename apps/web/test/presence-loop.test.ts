import { describe, expect, it, vi } from "vitest";

import {
  PRESENCE_FPS,
  startPresenceLoop,
  type PresenceInputs,
  type PresenceLoopHost,
} from "../src/features/q-swarm/presence-loop";

/**
 * Q room W7: the presence's loop draws at most PRESENCE_FPS frames a
 * second, nothing while off screen or hidden, and a still presence only
 * when what it shows changes.
 */

const INPUTS: PresenceInputs = {
  state: "IDLE",
  showsFace: false,
  showing: false,
  motion: "full",
  bloom: false,
};

function fakeHost(overrides: Partial<PresenceLoopHost> = {}) {
  const queue = new Map<number, (now: number) => void>();
  let next = 1;
  const levels = vi.fn(() => ({ input: 0, output: 0 }));
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    globalAlpha: 1,
  };
  const host: PresenceLoopHost = {
    canvas: { width: 0, height: 0, getContext: () => context },
    pixels: 96,
    dpr: 1,
    cores: 8,
    allow3d: false,
    inputs: INPUTS,
    colour: [0.4, 0.6, 1],
    dark: true,
    levels,
    leanTarget: () => ({ x: 0, y: 0 }),
    hidden: () => false,
    note: () => undefined,
    load3d: () => Promise.reject(new Error("no 3d here")),
    requestFrame: (callback) => {
      queue.set(next, callback);
      return next++;
    },
    cancelFrame: (handle) => {
      queue.delete(handle);
    },
    now: () => 0,
    ...overrides,
  };
  /** Runs the queued frames at a 60 Hz display's pace for `ms`. */
  const run = (fromMs: number, ms: number) => {
    for (let t = fromMs; t < fromMs + ms; t += 1000 / 60) {
      const due = [...queue.values()];
      queue.clear();
      for (const callback of due) callback(t);
    }
  };
  return { host, levels, queue, run };
}

describe("the presence loop (W7)", () => {
  it("draws at most PRESENCE_FPS frames a second on a 60 Hz display", () => {
    const fake = fakeHost();
    const loop = startPresenceLoop(fake.host);
    fake.run(1000, 1000);
    // levels() is read once per drawn frame.
    expect(fake.levels.mock.calls.length).toBeLessThanOrEqual(PRESENCE_FPS + 1);
    expect(fake.levels.mock.calls.length).toBeGreaterThanOrEqual(
      PRESENCE_FPS - 2,
    );
    loop?.dispose();
    expect(fake.queue.size).toBe(0);
  });

  it("asks for no frames off screen or in a hidden tab", () => {
    let hidden = false;
    const fake = fakeHost({ hidden: () => hidden });
    const loop = startPresenceLoop(fake.host);
    fake.run(1000, 100);
    loop?.setOnScreen(false);
    fake.run(1100, 100);
    expect(fake.queue.size).toBe(0);
    loop?.setOnScreen(true);
    expect(fake.queue.size).toBe(1);
    hidden = true;
    fake.run(1200, 100);
    expect(fake.queue.size).toBe(0);
  });

  it("a still presence draws once per change, never on its own", () => {
    const fake = fakeHost({ inputs: { ...INPUTS, motion: "calm" } });
    const notes: string[] = [];
    const loop = startPresenceLoop({
      ...fake.host,
      note: (key, value) => {
        if (key === "qFigure") notes.push(value);
      },
    });
    fake.run(1000, 500);
    expect(fake.queue.size).toBe(0);
    expect(notes).toEqual(["CLOUD"]);
    loop?.set({ ...INPUTS, motion: "calm", state: "LISTENING" });
    fake.run(1500, 100);
    expect(fake.queue.size).toBe(0);
    expect(notes.length).toBe(2);
  });
});
