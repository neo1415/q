// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Q_MOTION_STORAGE_KEY } from "../src/features/q-aperture/q-motion";
import {
  budgetSettings,
  createBudget,
  scaledParticleCount,
  stepBudget,
  surfaceDpr,
} from "../src/features/q-swarm/presence-budget";
import { createPresenceSim } from "../src/features/q-swarm/presence-dynamics";
import { presenceStats } from "../src/features/q-swarm/presence-gl";
import {
  LEAN_YAW,
  presenceUniforms,
  STILL_PITCH,
  STILL_YAW,
  stepLean,
  type UniformInput,
} from "../src/features/q-swarm/presence-uniforms";
import { heroState } from "../src/features/q-swarm/q-presence-3d";
import { QSwarm } from "../src/features/q-swarm/q-swarm";

/**
 * Q's 3D presence (ADR 0049): how the existing state machine and signals
 * become the renderer's uniforms, the reduced-motion still, the 2D
 * fallback where WebGL2 is missing, and the offscreen pause.
 */

const base: UniformInput = {
  state: "IDLE",
  figure: "CLOUD",
  input: 0,
  output: 0,
  leanX: 0,
  leanY: 0,
  t: 3,
  motion: "full",
  dim: false,
  keep: 1,
};

describe("state to uniforms", () => {
  it("swells and brightens with Q's voice, and a little with the person's", () => {
    const quiet = presenceUniforms({ ...base, state: "SPEAKING" });
    const loud = presenceUniforms({ ...base, state: "SPEAKING", output: 1 });
    const mic = presenceUniforms({ ...base, state: "LISTENING", input: 1 });
    expect(loud.pointScale).toBeGreaterThan(quiet.pointScale);
    expect(loud.glow).toBeGreaterThan(quiet.glow);
    expect(mic.glow).toBeGreaterThan(quiet.glow);
    expect(mic.pointScale).toBeLessThan(loud.pointScale);
  });

  it("tips towards the person while listening, glows more while working, dims on error", () => {
    const idle = presenceUniforms(base);
    expect(
      presenceUniforms({ ...base, state: "LISTENING" }).pitch,
    ).toBeGreaterThan(idle.pitch);
    expect(
      presenceUniforms({ ...base, state: "WORKING", figure: "RING" }).glow,
    ).toBeGreaterThan(idle.glow);
    const error = presenceUniforms({ ...base, state: "ERROR", dim: true });
    expect(error.fade).toBeLessThan(1);
    expect(error.glow).toBeLessThan(idle.glow);
  });

  it("leans towards the cursor, capped, and turns a face less than the cloud", () => {
    const right = presenceUniforms({ ...base, leanX: 5 });
    expect(right.yaw - presenceUniforms(base).yaw).toBeCloseTo(LEAN_YAW, 5);
    expect(right.shiftX).toBeGreaterThan(0);
    const face = presenceUniforms({
      ...base,
      figure: "FACE",
      state: "SPEAKING",
    });
    expect(Math.abs(face.yaw)).toBeLessThan(
      Math.abs(presenceUniforms(base).yaw),
    );
  });

  it("draws the face fine: smaller points, a dark floor, no white core", () => {
    const face = presenceUniforms({
      ...base,
      figure: "FACE",
      state: "SPEAKING",
    });
    const wave = presenceUniforms({
      ...base,
      figure: "WAVE",
      state: "SPEAKING",
    });
    expect(face.floor).toBeLessThan(0.1);
    expect(wave.floor).toBeGreaterThan(0.3);
    expect(face.pointScale).toBeLessThan(wave.pointScale);
    expect(face.core).toBe(0);
  });

  it("whitens only the cloud's dense core, never a ring or a glyph", () => {
    expect(presenceUniforms(base).core).toBe(1);
    expect(presenceUniforms({ ...base, figure: "RING" }).core).toBeLessThan(
      0.5,
    );
    expect(presenceUniforms({ ...base, figure: "QUESTION" }).core).toBeLessThan(
      0.5,
    );
  });

  it("ignores levels that are not numbers", () => {
    const u = presenceUniforms({
      ...base,
      output: Number.NaN,
      input: Infinity,
    });
    expect(Number.isFinite(u.glow) && Number.isFinite(u.pointScale)).toBe(true);
  });
});

describe("reduced motion: one still 3D frame", () => {
  it("holds one turned pose whatever the clock or the cursor", () => {
    for (const motion of ["calm", "off"] as const) {
      const a = presenceUniforms({ ...base, motion, t: 1, leanX: 1 });
      const b = presenceUniforms({ ...base, motion, t: 97, leanY: -1 });
      expect(a).toEqual(b);
      // Turned, so the frame still reads as 3D.
      expect(a.yaw).toBe(STILL_YAW);
      expect(a.pitch).toBe(STILL_PITCH);
    }
  });

  it("settles every particle with depth and no velocity", () => {
    const sim = createPresenceSim({
      count: 400,
      initial: "CLOUD",
    });
    sim.settle("CLOUD", 0, { input: 0, output: 0 });
    expect(Array.from(sim.vx).every((v) => v === 0)).toBe(true);
    const depths = new Set(Array.from(sim.z).map((z) => z.toFixed(2)));
    expect(depths.size).toBeGreaterThan(50);
  });
});

describe("the lean spring and the frame budget", () => {
  it("never overshoots, even through long frames", () => {
    const lean = { x: 0, y: 0, vx: 0, vy: 0 };
    let max = 0;
    for (let i = 0; i < 240; i += 1) {
      stepLean(lean, 1, -1, i % 7 === 0 ? 0.2 : 1 / 60);
      max = Math.max(max, lean.x);
      expect(lean.y).toBeGreaterThanOrEqual(-1 - 1e-9);
    }
    expect(max).toBeLessThanOrEqual(1 + 1e-9);
    expect(lean.x).toBeGreaterThan(0.99);
  });

  it("steps down (fewer points, then lower DPR) only on sustained slow frames", () => {
    let budget = createBudget();
    for (let i = 0; i < 200; i += 1) budget = stepBudget(budget, 16.7, 6);
    expect(budget.level).toBe(0);
    // A slow page with little swarm work is not the swarm's to fix.
    for (let i = 0; i < 200; i += 1) budget = stepBudget(budget, 40, 1);
    expect(budget.level).toBe(0);
    for (let i = 0; i < 60; i += 1) budget = stepBudget(budget, 40, 9);
    expect(budgetSettings(budget).keep).toBeLessThan(1);
    for (let i = 0; i < 400; i += 1) budget = stepBudget(budget, 40, 9);
    expect(budgetSettings(budget).dprScale).toBeLessThan(1);
    // A paused tab's gap is not a slow frame.
    expect(stepBudget(createBudget(), 5_000, 50).level).toBe(0);
  });

  it("scales points with the device and caps DPR at 2", () => {
    expect(scaledParticleCount(360, 8)).toBeGreaterThan(
      scaledParticleCount(360, 2),
    );
    expect(scaledParticleCount(40, 16)).toBeLessThanOrEqual(160);
    expect(surfaceDpr(3)).toBe(2);
    expect(surfaceDpr(undefined)).toBe(1);
  });

  it("gathers the hero into its ring once the page scrolls away", () => {
    expect(heroState("IDLE", 0, 800, true)).toBe("IDLE");
    expect(heroState("IDLE", 400, 800, true)).toBe("WORKING");
    expect(heroState("IDLE", 400, 800, false)).toBe("IDLE");
  });
});

describe("the component: fallback and pause", () => {
  let frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  let observers: IntersectionObserverCallback[] = [];

  const fake2d = () =>
    ({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      createRadialGradient: () => ({ addColorStop: vi.fn() }),
      getImageData: () => ({
        data: new Uint8ClampedArray([106, 168, 255, 255]),
      }),
      globalAlpha: 1,
      fillStyle: "",
      globalCompositeOperation: "source-over",
    }) as unknown as CanvasRenderingContext2D;

  beforeEach(() => {
    frames = new Map();
    observers = [];
    // jsdom has no WebGL2: the 3D renderer must report itself unavailable.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((
      kind: string,
    ) => (kind === "2d" ? fake2d() : null)) as never);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextId += 1;
      frames.set(nextId, callback);
      return nextId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    // W7: the presence starts once the page is idle; here, at once.
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 });
      return 0;
    });
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.removeItem(Q_MOTION_STORAGE_KEY);
  });

  const runFrames = (count: number) => {
    for (let i = 0; i < count; i += 1) {
      const pending = [...frames.values()];
      frames = new Map();
      for (const callback of pending) callback(performance.now() + i * 16);
    }
  };

  it("draws the 2D swarm where WebGL2 is unavailable", async () => {
    const before = presenceStats().fallbackFrames;
    const { container } = render(<QSwarm state="IDLE" pixels={96} />);
    const canvas = container.querySelector("canvas");
    await waitFor(() => expect(canvas?.dataset["qRenderer"]).toBe("2d"));
    act(() => runFrames(3));
    expect(presenceStats().fallbackFrames).toBeGreaterThan(before);
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
  });

  it("stops asking for frames off screen, and starts again when back", async () => {
    const { container } = render(<QSwarm state="IDLE" pixels={96} />);
    const canvas = container.querySelector("canvas");
    await waitFor(() => expect(canvas?.dataset["qRenderer"]).toBe("2d"));
    act(() => runFrames(2));
    expect(frames.size).toBe(1);
    const entry = (isIntersecting: boolean) =>
      [
        { isIntersecting } as IntersectionObserverEntry,
      ] as IntersectionObserverEntry[];
    act(() => {
      for (const callback of observers) {
        callback(entry(false), {} as IntersectionObserver);
      }
    });
    act(() => runFrames(1));
    expect(frames.size).toBe(0);
    act(() => {
      for (const callback of observers) {
        callback(entry(true), {} as IntersectionObserver);
      }
    });
    expect(frames.size).toBe(1);
  });

  it("under reduced motion draws a still and schedules no animation", async () => {
    window.localStorage.setItem(Q_MOTION_STORAGE_KEY, "calm");
    const { container } = render(<QSwarm state="IDLE" pixels={96} />);
    const canvas = container.querySelector("canvas");
    await waitFor(() => expect(canvas?.dataset["qRenderer"]).toBe("2d"));
    act(() => runFrames(1));
    expect(frames.size).toBe(0);
    expect(canvas?.dataset["qFigure"]).toBe("CLOUD");
  });

  it("shows the face on the Q page's 200 px stage while Q speaks, and lets it go when speech ends (P11)", async () => {
    window.localStorage.setItem(Q_MOTION_STORAGE_KEY, "calm");
    const { container, rerender } = render(
      <QSwarm state="LISTENING" pixels={200} face />,
    );
    const canvas = container.querySelector("canvas");
    await waitFor(() => expect(canvas?.dataset["qRenderer"]).toBe("2d"));
    act(() => runFrames(1));
    expect(canvas?.dataset["qFigure"]).toBe("ATTENTIVE");
    // No timer: the still presence changes only because the state did.
    rerender(<QSwarm state="SPEAKING" pixels={200} face />);
    act(() => runFrames(1));
    expect(canvas?.dataset["qFigure"]).toBe("FACE");
    act(() => runFrames(20));
    expect(canvas?.dataset["qFigure"]).toBe("FACE");
    rerender(<QSwarm state="IDLE" pixels={200} face />);
    act(() => runFrames(1));
    expect(canvas?.dataset["qFigure"]).toBe("CLOUD");
    // Under 160 px, or off the Q page, the same speech has no face.
    const small = render(<QSwarm state="SPEAKING" pixels={120} face />);
    act(() => runFrames(1));
    expect(small.container.querySelector("canvas")?.dataset["qFigure"]).toBe(
      "WAVE",
    );
  });
});
