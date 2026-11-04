import { matchWakePhrase, type WakePhraseId } from "./phrases";
import {
  recognitionConstructor,
  recognitionLanguage,
  supportsProcessLocally,
  type Recognition,
  type RecognitionResultEvent,
} from "./support";
import type { WakeProcessing } from "./wake-status";

export { recognitionLanguage };

/**
 * The shipped wake-word detector (ADR 0058): the browser's own speech
 * recogniser, run only inside a window the local gate opened, and stopped
 * when the window closes. A trained on-device model replaces this behind
 * the same three calls once one meets the bar.
 *
 * Privacy: where the browser offers on-device recognition for the
 * language (`processLocally`, ADR 0058 addendum 2026-11-04) and the caller
 * checked it is installed, the recogniser is told to stay on the device.
 * Otherwise, in Chrome and Safari it may send the window's audio to the
 * browser vendor's speech service. Capital Q never receives it either way;
 * the transcript is matched here and dropped.
 */

export type WakeDetector = {
  readonly start: () => void;
  readonly stop: () => void;
  readonly dispose: () => void;
};

export type DetectorFailure = "blocked" | "unavailable";

/** The phrase in any alternative of any result from `resultIndex` on. */
export function wakeInResults(
  event: RecognitionResultEvent,
): WakePhraseId | null {
  for (let r = event.resultIndex; r < event.results.length; r += 1) {
    const result = event.results[r];
    if (result === undefined) continue;
    for (let a = 0; a < result.length; a += 1) {
      const transcript = result[a]?.transcript;
      if (transcript === undefined) continue;
      const phrase = matchWakePhrase(transcript);
      if (phrase !== null) return phrase;
    }
  }
  return null;
}

export function createSpeechDetector(input: {
  readonly onWake: (phrase: WakePhraseId) => void;
  readonly onFailure: (failure: DetectorFailure) => void;
  /**
   * Ask for on-device recognition. Honoured only where the recogniser has
   * the attribute; the caller checks `available()` said "available".
   */
  readonly processLocally?: boolean | undefined;
  /** Where the words are recognised, said at creation and on any change. */
  readonly onProcessing?: ((processing: WakeProcessing) => void) | undefined;
}): WakeDetector | null {
  const Ctor = recognitionConstructor();
  if (Ctor === null) return null;
  let recognition: Recognition | null = null;
  let local = input.processLocally === true && supportsProcessLocally(Ctor);
  input.onProcessing?.(local ? "DEVICE" : "SERVICE");

  const stop = () => {
    const current = recognition;
    recognition = null;
    if (current === null) return;
    current.onresult = null;
    current.onerror = null;
    current.onend = null;
    // abort, not stop: nothing more is wanted from this window.
    current.abort();
  };

  const start = () => {
    if (recognition !== null) return;
    const next = new Ctor();
    next.lang = recognitionLanguage(navigator.language);
    next.continuous = true;
    next.interimResults = true;
    next.maxAlternatives = 3;
    if (local) next.processLocally = true;
    next.onresult = (event) => {
      const phrase = wakeInResults(event);
      if (phrase === null) return;
      stop();
      input.onWake(phrase);
    };
    next.onerror = (event) => {
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        stop();
        input.onFailure("blocked");
      } else if (event.error === "language-not-supported") {
        stop();
        if (local) {
          // The on-device pack went away (removed, or not yet usable).
          // Today's behaviour resumes, and the indicator says so at once,
          // under the disclosure shown before the toggle was turned on.
          local = false;
          input.onProcessing?.("SERVICE");
        } else {
          input.onFailure("unavailable");
        }
      }
      // "no-speech", "aborted", "network": the window just ends.
    };
    // Ended on its own (silence, a network blip): the gate opens a new
    // window when speech comes again.
    next.onend = () => {
      if (recognition === next) recognition = null;
    };
    recognition = next;
    try {
      next.start();
    } catch {
      recognition = null;
    }
  };

  return { start, stop, dispose: stop };
}
