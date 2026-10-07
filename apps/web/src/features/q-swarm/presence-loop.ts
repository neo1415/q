import type { QApertureState } from "../q-aperture/aperture-state";
import type { QMotion } from "../q-aperture/aperture-frame";
import { FINE_FIGURES } from "./presence-figures";
import { figureForState, presenceFor, SMALL_PIXELS } from "./presence-machine";
import { createPresenceSim, MAX_DT } from "./presence-dynamics";
import {
  budgetSettings,
  createBudget,
  FRAME_BUDGET_MS,
  scaledParticleCount,
  stepBudget,
} from "./presence-budget";
import { drawPresence, type Rgb } from "./presence-gl";
import { presenceUniforms, stepLean, type Lean } from "./presence-uniforms";

/**
 * Q room W7: the presence's frame loop, apart from React. Nothing here
 * reads the page: the host hands in what the page knows (state, colour,
 * levels, the cursor's lean target) and hears back what a test reads
 * (figure, renderer), so the loop is tested on its own.
 *
 * W7 cost: the loop draws at most PRESENCE_FPS frames a second -- the
 * swarm's integration step is capped at 1/30 s, so more frames than that
 * only repeat work -- and a still presence (reduced motion) draws only
 * when something it shows changes. Off screen or in a hidden tab, nothing
 * runs.
 */

export const PRESENCE_FPS = 30;
/** A frame comes at most this often (a little under 1/30 s, for jitter). */
export const PRESENCE_FRAME_MS = 1000 / PRESENCE_FPS - 2;
/**
 * Work per frame read as a 60 fps interval for the budget: past about
 * 8.4 ms of work (18.4 ms, the budget's slow line) a frame counts as slow.
 */
const WORK_TO_INTERVAL = 2.2;

export type PresenceInputs = {
  readonly state: QApertureState;
  readonly showsFace: boolean;
  readonly showing: boolean;
  readonly motion: QMotion;
  readonly bloom: boolean;
};

export type PresenceRenderer = "pending" | "3d" | "2d";

type Draw3d = typeof import("./presence-3d").drawPresence3d;

/** The canvas the loop draws into (a test passes a stand-in). */
type Surface = Pick<HTMLCanvasElement, "width" | "height"> & {
  getContext(kind: "2d"): unknown;
};

export type PresenceLoopHost = {
  readonly canvas: Surface;
  /** CSS pixels; never changes for one loop. */
  readonly pixels: number;
  readonly dpr: number;
  readonly cores: number | undefined;
  readonly allow3d: boolean;
  readonly inputs: PresenceInputs;
  readonly colour: Rgb;
  readonly dark: boolean;
  /** The microphone and speaker levels, raw (0..1). */
  readonly levels: () => { readonly input: number; readonly output: number };
  /** Where the cursor pulls the swarm, -1..1 each way. */
  readonly leanTarget: () => { readonly x: number; readonly y: number };
  readonly hidden: () => boolean;
  readonly note: (key: "qFigure" | "qRenderer", value: string) => void;
  readonly load3d: () => Promise<typeof import("./presence-3d")>;
  readonly requestFrame: (callback: (now: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly now: () => number;
  /**
   * W7: when the first frame (and the 3D renderer's load) may start; the
   * page passes "once it is idle", so the presence never competes with
   * the page's own start. Returns a cancel. Absent: at once.
   */
  readonly begin?: ((start: () => void) => () => void) | undefined;
};

export type PresenceLoop = {
  readonly set: (inputs: PresenceInputs) => void;
  readonly setColour: (colour: Rgb, dark: boolean) => void;
  readonly setOnScreen: (onScreen: boolean) => void;
  readonly redraw: () => void;
  readonly dispose: () => void;
};

export function startPresenceLoop(host: PresenceLoopHost): PresenceLoop | null {
  const { canvas, pixels } = host;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (context === null) return null;
  let device = 0;
  const fit = (dprScale: number) => {
    // The canvas's CSS size never changes: a lower DPR is no layout shift.
    device = Math.max(1, Math.round(pixels * host.dpr * dprScale));
    canvas.width = device;
    canvas.height = device;
  };
  fit(1);
  let inputs = host.inputs;
  const small = pixels < SMALL_PIXELS;
  const sim = createPresenceSim({
    count: scaledParticleCount(pixels, host.cores),
    // A surface opens already in its state's shape: no flourish on mount.
    initial: figureForState(inputs.state, small, inputs.showsFace),
    seed: pixels * 7 + 3,
  });

  let renderer: PresenceRenderer = host.allow3d ? "pending" : "2d";
  let draw3d: Draw3d | null = null;
  let disposed = false;
  const setRenderer = (next: PresenceRenderer) => {
    renderer = next;
    host.note("qRenderer", next);
  };
  setRenderer(renderer);

  let colour = host.colour;
  let dark = host.dark;
  const eased = { input: 0, output: 0 };
  let figure = "";
  const note = (next: string) => {
    if (next === figure) return;
    figure = next;
    host.note("qFigure", next);
  };

  // The cursor lean: where the pointer is, relative to Q, on a spring.
  const lean: Lean = { x: 0, y: 0, vx: 0, vy: 0 };
  let budget = createBudget();
  let raf = 0;
  let onScreen = true;
  let last = 0;
  let lastDrawn = 0;
  let clock = 0;
  let core = 1;
  let stepped = 0;

  const frame = (now: number) => {
    raf = 0;
    const moving = inputs.motion === "full";
    // W7: at most PRESENCE_FPS frames a second; the next one waits.
    if (moving && lastDrawn !== 0 && now - lastDrawn < PRESENCE_FRAME_MS) {
      if (onScreen && !host.hidden()) raf = host.requestFrame(frame);
      return;
    }
    lastDrawn = now;
    const began = host.now();
    const view = presenceFor({
      state: inputs.state,
      small,
      face: inputs.showsFace,
      showing: inputs.showing,
    });
    const interval = last === 0 ? 0 : now - last;
    if (moving) {
      sim.setFigure(view.figure);
      // The swarm's own clock advances by the step it integrates, so a
      // slow device sees the same swarm, slower -- never one whose
      // particles trail a figure that runs on ahead in real time.
      const dt = Math.min(MAX_DT, last === 0 ? 1 / 60 : interval / 1000);
      last = now;
      clock += dt;
      stepped = dt;
      const raw = host.levels();
      sim.step(clock, dt, raw);
      const k = (was: number, next: number) =>
        1 - Math.exp(-Math.min(dt, 1 / 30) * (next > was ? 26 : 8));
      eased.input += (raw.input - eased.input) * k(eased.input, raw.input);
      eased.output += (raw.output - eased.output) * k(eased.output, raw.output);
      const aim = host.leanTarget();
      stepLean(lean, aim.x, aim.y, dt);
    } else if (sim.figure() !== view.figure || figure === "") {
      // Reduced motion: each figure drawn still, no flow between.
      sim.settle(view.figure, clock, { input: 0, output: 0 });
    }
    note(view.figure);
    const target = presenceUniforms({
      state: inputs.state,
      figure: sim.figure(),
      input: moving ? eased.input : 0,
      output: moving ? eased.output : 0,
      leanX: lean.x,
      leanY: lean.y,
      t: clock,
      motion: inputs.motion,
      dim: view.dim,
      keep: budgetSettings(budget).keep,
    });
    // The white core follows the particles, not the figure's name: it
    // fades in as a glyph flows back into the cloud, never ahead of it.
    core = moving
      ? core + (target.core - core) * (1 - Math.exp(-stepped * 1.8))
      : target.core;
    const uniforms = { ...target, core };
    if (renderer === "3d" && draw3d !== null) {
      const drawn = draw3d(context, sim, {
        pixels: device,
        colour,
        dark,
        bloom: inputs.bloom,
        uniforms,
      });
      // A lost context: the 2D swarm from here on.
      if (!drawn) setRenderer("2d");
    }
    if (renderer === "2d") {
      drawPresence(context, sim, {
        pixels: device,
        colour,
        dim: view.dim,
        fine: FINE_FIGURES.has(sim.figure()),
      });
    }
    if (moving && renderer !== "pending") {
      const before = budget.level;
      // The budget reads intervals against a 60 fps frame; at the cap a
      // frame is due every 1/PRESENCE_FPS s, so the interval is scaled to
      // match: a frame later than the cap counts as slow. So does a frame
      // whose own work is more than a quarter of the cap's frame (about
      // 8 ms): the cap keeps such a device on time, but the swarm would
      // still take a quarter of its main thread, so it steps down too.
      const work = host.now() - began;
      budget = stepBudget(
        budget,
        Math.max(
          interval * ((FRAME_BUDGET_MS * PRESENCE_FPS) / 1000),
          work * WORK_TO_INTERVAL,
        ),
        work,
      );
      if (budget.level !== before) fit(budgetSettings(budget).dprScale);
    }
    if (moving && onScreen && !host.hidden()) {
      raf = host.requestFrame(frame);
    } else {
      last = 0;
      lastDrawn = 0;
    }
  };
  const redraw = () => {
    if (disposed || !started) return;
    if (raf !== 0) host.cancelFrame(raf);
    lastDrawn = 0;
    raf = host.requestFrame(frame);
  };

  const start = () => {
    if (disposed) return;
    if (renderer === "pending") load3d();
    redraw();
  };
  const load3d = () => {
    host
      .load3d()
      .then((module) => {
        if (disposed) return;
        if (module.presence3dAvailable()) {
          draw3d = module.drawPresence3d;
          setRenderer("3d");
        } else {
          setRenderer("2d");
        }
        redraw();
      })
      .catch(() => {
        if (disposed) return;
        setRenderer("2d");
        redraw();
      });
  };
  // Nothing is drawn before the start; a change of state before then is
  // drawn by the start itself.
  let started = false;
  const cancelBegin = (
    host.begin ?? ((run: () => void) => (run(), () => undefined))
  )(() => {
    started = true;
    start();
  });

  return {
    set: (next) => {
      inputs = next;
      redraw();
    },
    setColour: (nextColour, nextDark) => {
      colour = nextColour;
      dark = nextDark;
      redraw();
    },
    setOnScreen: (next) => {
      onScreen = next;
      if (next) redraw();
    },
    redraw,
    dispose: () => {
      disposed = true;
      cancelBegin();
      if (raf !== 0) host.cancelFrame(raf);
      raf = 0;
    },
  };
}
