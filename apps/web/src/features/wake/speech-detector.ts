import { matchWakePhrase, type WakePhraseId } from "./phrases";
import {
  recognitionConstructor,
  type Recognition,
  type RecognitionResultEvent,
} from "./support";

/**
 * The shipped wake-word detector (ADR 0058): the browser's own speech
 * recogniser, run only inside a window the local gate opened, and stopped
 * when the window closes. A trained on-device model replaces this behind
 * the same three calls once one meets the bar.
 *
 * Privacy: in Chrome and Safari the recogniser may send the window's audio
 * to the browser vendor's speech service. Capital Q never receives it; the
 * transcript is matched here and dropped.
 */

export type WakeDetector = {
  readonly start: () => void;
  readonly stop: () => void;
  readonly dispose: () => void;
};

export type DetectorFailure = "blocked" | "unavailable";

/** The wake words are English; an English device keeps its own accent. */
export function recognitionLanguage(language: string | undefined): string {
  return language?.toLowerCase().startsWith("en") === true ? language : "en-US";
}

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
}): WakeDetector | null {
  const Ctor = recognitionConstructor();
  if (Ctor === null) return null;
  let recognition: Recognition | null = null;

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
        input.onFailure("unavailable");
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
