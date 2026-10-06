import {
  DEFAULT_GATE_CONFIG,
  initialGate,
  stepGate,
  type GateEffect,
  type GateState,
} from "./gate";
import type { WakePhraseId } from "./phrases";
import { createSpeechDetector, type DetectorFailure } from "./speech-detector";

/**
 * The "Hey Q" engine (D1/D2, ADR 0058), loaded as its own chunk only when
 * the person has turned the wake word on (`wake-word.tsx` imports it
 * dynamically). Microphone → AudioWorklet (16 kHz, one loudness number per
 * 32 ms) → local gate (gate.ts) → detector, only inside the gate's window.
 */

export const CAPTURE_WORKLET_URL = "/wake/capture-worklet.js";

export type EngineFailure = DetectorFailure | "microphone";

export type WakeEngine = { readonly stop: () => Promise<void> };

export type WakeEngineInput = {
  readonly onWake: (phrase: WakePhraseId) => void;
  readonly onFailure: (failure: EngineFailure) => void;
  /** The gate opened or closed: the indicator may show "Hearing you". */
  readonly onWindow?: ((open: boolean) => void) | undefined;
};

/** Run the gate's effects against a detector; pure enough to test. */
export function applyGateEffects(
  effects: readonly GateEffect[],
  target: {
    readonly start: () => void;
    readonly stop: () => void;
    readonly wake: () => void;
  },
): void {
  for (const effect of effects) {
    if (effect === "detector-start") target.start();
    else if (effect === "detector-stop") target.stop();
    else target.wake();
  }
}

export async function startWakeEngine(
  input: WakeEngineInput,
): Promise<WakeEngine> {
  let gate: GateState = initialGate(DEFAULT_GATE_CONFIG);
  let pending: WakePhraseId | null = null;
  let stopped = false;

  const detector = createSpeechDetector({
    onWake: (phrase) => {
      pending = phrase;
      feed({ type: "match", at: performance.now() });
    },
    onFailure: (failure) => input.onFailure(failure),
  });
  if (detector === null) {
    input.onFailure("unavailable");
    return { stop: () => Promise.resolve() };
  }

  function feed(event: Parameters<typeof stepGate>[1]) {
    if (stopped || detector === null) return;
    const step = stepGate(gate, event, DEFAULT_GATE_CONFIG);
    gate = step.state;
    applyGateEffects(step.effects, {
      start: () => {
        detector.start();
        input.onWindow?.(true);
      },
      stop: () => {
        detector.stop();
        input.onWindow?.(false);
      },
      wake: () => {
        if (pending !== null) input.onWake(pending);
        pending = null;
      },
    });
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch {
    detector.dispose();
    input.onFailure("microphone");
    return { stop: () => Promise.resolve() };
  }

  const context = new AudioContext();
  // Safari starts an AudioContext suspended until a tap; the first tap or
  // key anywhere resumes it.
  const resume = () => {
    void context.resume().catch(() => undefined);
  };
  window.addEventListener("pointerdown", resume, { once: true });
  window.addEventListener("keydown", resume, { once: true });

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("pointerdown", resume);
    window.removeEventListener("keydown", resume);
    detector.dispose();
    input.onWindow?.(false);
    for (const track of stream.getTracks()) track.stop();
    await context.close().catch(() => undefined);
  };

  try {
    await context.audioWorklet.addModule(CAPTURE_WORKLET_URL);
    if (stopped) return { stop };
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "cq-wake-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.port.onmessage = (message: MessageEvent<unknown>) => {
      if (typeof message.data !== "number") return;
      feed({ type: "frame", at: performance.now(), rms: message.data });
    };
    source.connect(node);
    // Silent: the worklet writes zeros. The connection keeps it running.
    node.connect(context.destination);
    resume();
  } catch {
    await stop();
    input.onFailure("unavailable");
  }
  return { stop };
}
