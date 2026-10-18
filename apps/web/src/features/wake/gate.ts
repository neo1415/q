/**
 * D2: the local voice-activity gate in front of the wake-word detector.
 *
 * Pure and clock-free (every event carries its time), so it is tested
 * frame by frame. The gate decides when the detector may hear anything:
 * while the room is quiet nothing runs past it, and nothing leaves the
 * device. When speech starts it opens a short, capped window; a wake in
 * that window fires once and is followed by a cooldown.
 *
 * Privacy caps, because the shipped detector sends what it hears in a
 * window to the browser's speech service (ADR 0058): a window closes
 * `windowMs` after the last speech and never lasts past `maxOpenMs`;
 * windows are spaced by `restMs`; at most `maxWindowsPerMinute` open in
 * any minute, so a noisy room cannot keep the detector running.
 */

export type GateConfig = {
  /** Below this RMS a frame is never speech, whatever the floor. */
  readonly minRms: number;
  /** A frame is speech when its RMS exceeds the noise floor by this factor. */
  readonly onsetRatio: number;
  /** Consecutive speech frames before the gate opens. */
  readonly onsetFrames: number;
  /** How fast the noise floor follows quiet frames (0..1). */
  readonly floorAlpha: number;
  /** How fast it follows loud frames, so a steady noise is learned. */
  readonly floorAlphaLoud: number;
  readonly windowMs: number;
  readonly maxOpenMs: number;
  readonly restMs: number;
  readonly cooldownMs: number;
  readonly maxWindowsPerMinute: number;
};

export const DEFAULT_GATE_CONFIG: GateConfig = {
  minRms: 0.015,
  onsetRatio: 3,
  onsetFrames: 3,
  floorAlpha: 0.05,
  floorAlphaLoud: 0.002,
  windowMs: 3500,
  maxOpenMs: 8000,
  restMs: 1000,
  cooldownMs: 3000,
  maxWindowsPerMinute: 6,
};

export type GateState =
  | {
      readonly kind: "idle";
      readonly floor: number;
      readonly loud: number;
      readonly restUntil: number;
      readonly opened: readonly number[];
    }
  | {
      readonly kind: "open";
      readonly floor: number;
      readonly openedAt: number;
      readonly lastSpeechAt: number;
      readonly opened: readonly number[];
    }
  | {
      readonly kind: "cooldown";
      readonly floor: number;
      readonly until: number;
      readonly opened: readonly number[];
    };

export type GateEvent =
  | { readonly type: "frame"; readonly at: number; readonly rms: number }
  | { readonly type: "match"; readonly at: number };

export type GateEffect = "detector-start" | "detector-stop" | "wake";

export type GateStep = {
  readonly state: GateState;
  readonly effects: readonly GateEffect[];
};

export function initialGate(
  config: GateConfig = DEFAULT_GATE_CONFIG,
): GateState {
  return {
    kind: "idle",
    floor: config.minRms / config.onsetRatio,
    loud: 0,
    restUntil: 0,
    opened: [],
  };
}

export function speechThreshold(floor: number, config: GateConfig): number {
  return Math.max(config.minRms, floor * config.onsetRatio);
}

const MINUTE_MS = 60_000;

export function stepGate(
  state: GateState,
  event: GateEvent,
  config: GateConfig = DEFAULT_GATE_CONFIG,
): GateStep {
  if (event.type === "match") {
    // A late result after the window closed is ignored: the detector was
    // told to stop, and a wake must come from a window the gate opened.
    if (state.kind !== "open") return { state, effects: [] };
    return {
      state: {
        kind: "cooldown",
        floor: state.floor,
        until: event.at + config.cooldownMs,
        opened: state.opened,
      },
      effects: ["detector-stop", "wake"],
    };
  }

  const { at, rms } = event;
  const loud = rms > speechThreshold(state.floor, config);

  switch (state.kind) {
    case "cooldown": {
      if (at < state.until) return { state, effects: [] };
      return {
        state: {
          kind: "idle",
          floor: state.floor,
          loud: 0,
          restUntil: at,
          opened: state.opened,
        },
        effects: [],
      };
    }
    case "open": {
      const lastSpeechAt = loud ? at : state.lastSpeechAt;
      if (
        at - lastSpeechAt >= config.windowMs ||
        at - state.openedAt >= config.maxOpenMs
      ) {
        return {
          state: {
            kind: "idle",
            floor: state.floor,
            loud: 0,
            restUntil: at + config.restMs,
            opened: state.opened,
          },
          effects: ["detector-stop"],
        };
      }
      return { state: { ...state, lastSpeechAt }, effects: [] };
    }
    case "idle": {
      const alpha = loud ? config.floorAlphaLoud : config.floorAlpha;
      const floor = state.floor + (rms - state.floor) * alpha;
      const count = loud ? state.loud + 1 : 0;
      const opened = state.opened.filter((t) => at - t < MINUTE_MS);
      if (
        count >= config.onsetFrames &&
        at >= state.restUntil &&
        opened.length < config.maxWindowsPerMinute
      ) {
        return {
          state: {
            kind: "open",
            floor,
            openedAt: at,
            lastSpeechAt: at,
            opened: [...opened, at],
          },
          effects: ["detector-start"],
        };
      }
      return {
        state: {
          kind: "idle",
          floor,
          loud: count,
          restUntil: state.restUntil,
          opened,
        },
        effects: [],
      };
    }
  }
}
