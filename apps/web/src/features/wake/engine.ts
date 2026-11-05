import {
  DEFAULT_GATE_CONFIG,
  initialGate,
  stepGate,
  type GateEffect,
  type GateState,
} from "./gate";
import { keepContextRunning } from "./context-keeper";
import { microphoneFailure } from "./microphone";
import type { WakePhraseId } from "./phrases";
import { createSpeechDetector, type DetectorFailure } from "./speech-detector";
import type { WakeProcessing } from "./wake-status";

/**
 * The "Hey Q" engine (D1/D2, ADR 0058), loaded as its own chunk only when
 * the person has turned the wake word on (`wake-word.tsx` imports it
 * dynamically). Microphone → AudioWorklet (16 kHz, one loudness number per
 * 32 ms) → local gate (gate.ts) → detector, only inside the gate's window.
 */

export const CAPTURE_WORKLET_URL = "/wake/capture-worklet.js";

/**
 * "microphone": refused, the person must allow it. "interrupted": the
 * microphone was busy, ended (unplugged, taken by another capture) or the
 * capture worklet failed to load; the listener retries on its own.
 */
export type EngineFailure = DetectorFailure | "microphone" | "interrupted";

export type WakeEngine = { readonly stop: () => Promise<void> };

export type WakeEngineInput = {
  readonly onWake: (phrase: WakePhraseId) => void;
  readonly onFailure: (failure: EngineFailure) => void;
  /** The gate opened or closed: the indicator may show "Hearing you". */
  readonly onWindow?: ((open: boolean) => void) | undefined;
  /** Recognise on this device: only when `available()` said "available". */
  readonly processLocally?: boolean | undefined;
  /** Where the words are recognised, at start and on any change. */
  readonly onProcessing?: ((processing: WakeProcessing) => void) | undefined;
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
    processLocally: input.processLocally,
    onProcessing: input.onProcessing,
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
  } catch (error) {
    detector.dispose();
    input.onFailure(microphoneFailure(error));
    return { stop: () => Promise.resolve() };
  }

  const context = new AudioContext();
  // Suspended until a tap (autoplay rules), or interrupted by other audio:
  // a suspended context delivers no frames and the gate never opens.
  const releaseContext = keepContextRunning(context);
  // The track ends when the device goes away or another capture takes it
  // (iOS mutes the first capture): nothing more would ever be heard.
  const onTrackEnded = () => {
    if (stopped) return;
    void stop();
    input.onFailure("interrupted");
  };
  for (const track of stream.getTracks()) {
    track.addEventListener("ended", onTrackEnded);
  }

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    releaseContext();
    detector.dispose();
    input.onWindow?.(false);
    for (const track of stream.getTracks()) {
      track.removeEventListener("ended", onTrackEnded);
      track.stop();
    }
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
  } catch {
    // The worklet did not load (a network blip on its file): try again.
    await stop();
    input.onFailure("interrupted");
  }
  return { stop };
}
