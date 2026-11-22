"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { VoiceSessionClient, VoiceSessionEvents } from "./session";
import type { useVoiceInterview, VoiceInterview } from "./use-voice-interview";
import { useVoicePreference } from "./voice-preference";

/**
 * W3-C (enterprise audit finding 6): voice off the always-on app shell.
 *
 * The voice hook, its providers and transports are a chunk of their own,
 * fetched on the first sign the person means to talk: hover, focus or a
 * press on a talk control, or Control/Command+K, which opens Q and its
 * microphone. Until it arrives, the session holds this stub: idle, not
 * connected, nothing heard. A `talk` (or a voice choice) made before then
 * waits for the chunk and goes through the real voice the moment it is
 * mounted, so nothing the person asks for is dropped; ending a line that
 * never opened has nothing to end.
 *
 * The real hook runs inside `VoiceEngine`, which the session draws
 * (`voice.engine`); once loaded it stays mounted for the tab's life, so a
 * line held across navigation is exactly as before.
 */

type VoiceModule = typeof import("./voice-engine");

let loading: Promise<VoiceModule> | null = null;
let loaded: VoiceModule | null = null;
const listeners = new Set<() => void>();

/** The chunk, once in, for every session in the tab (an external store). */
function subscribeVoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const loadedVoice = (): VoiceModule | null => loaded;
const notYetOnServer = (): VoiceModule | null => null;

/** Start fetching the voice chunk; every caller shares one fetch. */
export function preloadVoice(): Promise<VoiceModule> {
  loading ??= import("./voice-engine").then(
    (arrived) => {
      loaded = arrived;
      for (const listener of listeners) listener();
      return arrived;
    },
    (error: unknown) => {
      // A failed fetch may be tried again on the next intent.
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** What a talk control is: these, or anything inside them. */
export const VOICE_INTENT_SELECTOR =
  '[data-q-control="talk"], [data-work-mic], [data-q-voice-start]';

/** The intents that fetch the chunk, read once for the whole document. */
export function voiceIntentOf(event: Event): boolean {
  if (event instanceof KeyboardEvent) {
    // Control/Command+K opens Q (q-shortcut.ts), where its microphone is.
    return (
      !event.altKey &&
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === "k"
    );
  }
  const target = event.target;
  return (
    target instanceof Element && target.closest(VOICE_INTENT_SELECTOR) !== null
  );
}

const INTENTS = ["pointerover", "focusin", "pointerdown", "keydown"] as const;

function useVoiceIntent(): void {
  useEffect(() => {
    if (loaded !== null) return;
    const onIntent = (event: Event) => {
      if (!voiceIntentOf(event)) return;
      void preloadVoice().catch(() => undefined);
      for (const type of INTENTS) {
        document.removeEventListener(type, onIntent, true);
      }
    };
    for (const type of INTENTS) {
      document.addEventListener(type, onIntent, {
        capture: true,
        passive: true,
      });
    }
    return () => {
      for (const type of INTENTS) {
        document.removeEventListener(type, onIntent, true);
      }
    };
  }, []);
}

const IDLE_CLIENT: VoiceSessionClient = {
  state: "IDLE",
  connected: false,
  muted: false,
  transcript: [],
  start: () => Promise.resolve(),
  end: () => Promise.resolve(),
  sendText: () => undefined,
  setMuted: () => undefined,
  setVolume: () => undefined,
  inputLevel: () => 0,
  outputLevel: () => 0,
};

const NO_OUTCOMES: NonNullable<VoiceInterview["turnOutcomes"]> = {};

/**
 * The client's state, not its identity: the engine hands its value up on
 * every render, and a new object with the same state draws nothing new.
 */
function sameClient(a: VoiceSessionClient, b: VoiceSessionClient): boolean {
  return (
    a.state === b.state &&
    a.connected === b.connected &&
    a.muted === b.muted &&
    a.pausedAway === b.pausedAway &&
    a.transcript === b.transcript &&
    a.narrate === b.narrate &&
    a.brief === b.brief &&
    a.echoCancelled === b.echoCancelled &&
    a.hush === b.hush
  );
}

/** Whether the real voice's value says something new to draw. */
function sameState(a: VoiceInterview, b: VoiceInterview): boolean {
  return (
    sameClient(a.client, b.client) &&
    a.active === b.active &&
    a.voice === b.voice &&
    a.notice === b.notice &&
    a.linkStatus === b.linkStatus &&
    a.turnOutcomes === b.turnOutcomes &&
    a.turn === b.turn
  );
}

export function useLazyVoiceInterview(
  events: VoiceSessionEvents = {},
): VoiceInterview {
  useVoiceIntent();
  const preferred = useVoicePreference();
  // The chunk may arrive from any intent, here or elsewhere in the tab.
  const chunk = useSyncExternalStore(
    subscribeVoice,
    loadedVoice,
    notYetOnServer,
  );
  const [real, setReal] = useState<VoiceInterview | null>(null);
  const latest = useRef<VoiceInterview | null>(null);
  const ready = useRef(new Set<(voice: VoiceInterview) => void>());

  const onValue = useCallback((voice: VoiceInterview) => {
    const before = latest.current;
    latest.current = voice;
    if (before === null || !sameState(before, voice)) setReal(voice);
    for (const resolve of ready.current) resolve(voice);
    ready.current.clear();
  }, []);

  /** The real voice: now, or once its chunk is in and mounted. */
  const realVoice = useCallback((): Promise<VoiceInterview> => {
    if (latest.current !== null) return Promise.resolve(latest.current);
    void preloadVoice().catch(() => undefined);
    return new Promise((resolve) => {
      ready.current.add(resolve);
    });
  }, []);

  const talk = useCallback<VoiceInterview["talk"]>(
    async (input) => (await realVoice()).talk(input),
    [realVoice],
  );
  const end = useCallback<VoiceInterview["end"]>(
    // Nothing opened before the chunk arrived, so nothing to end.
    async (detail) => latest.current?.end(detail),
    [],
  );
  const chooseVoice = useCallback<VoiceInterview["chooseVoice"]>(
    async (voice) => (await realVoice()).chooseVoice(voice),
    [realVoice],
  );
  const clearNotice = useCallback(() => {
    latest.current?.clearNotice();
  }, []);

  const engine: ReactNode =
    chunk === null ? null : (
      <chunk.VoiceEngine events={events} onValue={onValue} />
    );
  // The functions always reach the newest real value, never a stale one.
  const client = useMemo<VoiceSessionClient>(() => {
    if (real === null) return IDLE_CLIENT;
    const now = () => latest.current?.client ?? real.client;
    return {
      ...real.client,
      start: (input) => now().start(input),
      end: (detail) => now().end(detail),
      sendText: (text) => {
        now().sendText(text);
      },
      setMuted: (muted) => {
        now().setMuted(muted);
      },
      setVolume: (volume) => {
        now().setVolume(volume);
      },
      inputLevel: () => now().inputLevel(),
      outputLevel: () => now().outputLevel(),
    };
  }, [real]);
  const shown = real ?? {
    client: IDLE_CLIENT,
    active: false,
    voice: preferred,
    notice: null,
    linkStatus: null,
    turnOutcomes: NO_OUTCOMES,
    turn: null,
  };
  return {
    ...shown,
    client,
    talk,
    end,
    chooseVoice,
    clearNotice,
    engine,
  };
}

/**
 * Which voice the Q session uses: the real one, loaded on first intent,
 * everywhere in the product. Only a development harness provides another
 * (a scripted line, so the browser suite can hold a line open across
 * navigation without a provider). The value is a hook and never changes
 * within a tree.
 */
export const VoiceInterviewSource = createContext<typeof useVoiceInterview>(
  useLazyVoiceInterview,
);
