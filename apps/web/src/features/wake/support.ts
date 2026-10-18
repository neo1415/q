/**
 * Whether this browser can run "Hey Q" (ADR 0058). Cheap and import-free,
 * so Settings can say so without loading the engine. Where it cannot, the
 * toggle says so rather than shipping a detector that does not work
 * (Firefox has no speech recogniser).
 */

/** The minimal slice of SpeechRecognition the detector uses. */
export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export type RecognitionResultEvent = {
  readonly resultIndex: number;
  readonly results: ArrayLike<ArrayLike<{ readonly transcript: string }>>;
};

export type RecognitionConstructor = new () => Recognition;

function isConstructor(value: unknown): value is RecognitionConstructor {
  return typeof value === "function";
}

/** The browser's recogniser, or null where there is none. */
export function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const standard: unknown = Reflect.get(window, "SpeechRecognition");
  if (isConstructor(standard)) return standard;
  const prefixed: unknown = Reflect.get(window, "webkitSpeechRecognition");
  return isConstructor(prefixed) ? prefixed : null;
}

export function wakeSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof Reflect.get(window, "AudioWorkletNode") === "function" &&
    recognitionConstructor() !== null
  );
}
