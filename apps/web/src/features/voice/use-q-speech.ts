"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { QVoiceChoice } from "@capital-q/contracts";

import { Q_SPEECH_MAX_CHARS } from "../q/wire-constants";

/**
 * Hearing Q, without talking to it (Q-FIRST-RUN-TTS-001).
 *
 * One-way: the server synthesises a line and the browser plays it. There
 * is no microphone anywhere in this file, and that is the point — asking
 * somebody for a microphone in order to play them audio is the permission
 * prompt that teaches people to refuse every permission prompt. The
 * two-way interview still exists and still asks, when somebody chooses it.
 *
 * Every state here is a state a real browser puts this in:
 *
 * **Blocked.** A page may not play audio before the person has interacted
 * with it, and `play()` rejects when it may not. That is not a failure to
 * report — it is the browser's rule working — so it becomes an offer to
 * press, and pressing it is the gesture that makes the same audio play.
 *
 * **Unavailable.** The provider refused, the build has no voice, or the
 * network did not cooperate. Silence, and nothing on screen waits for it.
 *
 * **Muted.** A choice, remembered per viewer, and the one thing here that
 * is allowed to outlive the page. Nothing else is stored: the audio is
 * fetched again next time rather than kept.
 *
 * Whatever happens, the words are already on the screen. Speech is how
 * this is read, never whether it can be.
 */

const MUTED_KEY = "cq.q.speech.muted";

export type QSpeechStatus =
  | "idle"
  | "loading"
  | "speaking"
  /** The browser refused to start audio without a gesture; offer one. */
  | "blocked"
  /** No audio this time. Never a reason to hold anything else up. */
  | "unavailable";

export type QSpeech = {
  readonly status: QSpeechStatus;
  readonly muted: boolean;
  /** Synthesise and play, unless muted. Never throws, never blocks a caller. */
  readonly say: (text: string, voice?: QVoiceChoice) => Promise<void>;
  /**
   * Turn latency row 18: one more piece of the same answer, said after
   * whatever is playing or still being fetched. Its audio is fetched at
   * once, so the next sentence is ready when the last one ends. `say`
   * and `stop` clear what is queued.
   */
  readonly queue: (text: string, voice?: QVoiceChoice) => void;
  /** Play what was already fetched. Call from a real user gesture. */
  readonly play: () => void;
  readonly stop: () => void;
  readonly toggleMuted: () => void;
};

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  } catch {
    // A preference that cannot be kept is simply not kept.
  }
}

export function useQSpeech(): QSpeech {
  const [status, setStatus] = useState<QSpeechStatus>("idle");
  const [muted, setMuted] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  /** Pieces fetched or being fetched, in the order they are said. */
  const pending = useRef<Promise<Blob | null>[]>([]);
  /** A new say/stop/mute makes every older queued piece stale. */
  const generation = useRef(0);
  const playing = useRef(false);

  useEffect(() => {
    // A per-viewer preference, read after mount so the server and the
    // first client render agree, one microtask later so the read belongs
    // to the load rather than to the render that scheduled it.
    void Promise.resolve().then(() => {
      setMuted(readMuted());
    });
  }, []);

  const release = useCallback(() => {
    generation.current += 1;
    pending.current = [];
    playing.current = false;
    audio.current?.pause();
    audio.current = null;
    if (objectUrl.current !== null) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
  }, []);

  useEffect(() => release, [release]);

  const start = useCallback((element: HTMLAudioElement) => {
    setStatus("speaking");
    element.play().then(
      () => undefined,
      () => {
        // Almost always the autoplay rule rather than a broken file. The
        // audio is fetched and ready; it needs a gesture to begin.
        setStatus("blocked");
      },
    );
  }, []);

  const fetchLine = useCallback(
    async (line: string, voice: QVoiceChoice): Promise<Blob | null> => {
      try {
        const response = await fetch("/api/q-speech", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: line, voice }),
        });
        if (!response.ok) return null;
        const blob = await response.blob();
        return blob.size === 0 ? null : blob;
      } catch {
        return null;
      }
    },
    [],
  );

  /** Plays the queue's next piece once it has arrived; stops when empty. */
  const playNext = useCallback(async () => {
    const mine = generation.current;
    const next = pending.current.shift();
    if (next === undefined) {
      playing.current = false;
      setStatus((was) => (was === "blocked" ? was : "idle"));
      return;
    }
    playing.current = true;
    const blob = await next;
    if (mine !== generation.current) return;
    if (blob === null) {
      // One piece without audio: the next one is still said.
      void playNext();
      return;
    }
    if (objectUrl.current !== null) URL.revokeObjectURL(objectUrl.current);
    const url = URL.createObjectURL(blob);
    objectUrl.current = url;
    const element = new Audio(url);
    element.onended = () => {
      if (mine === generation.current) void playNext();
    };
    element.onerror = () => {
      if (mine === generation.current) void playNext();
    };
    audio.current = element;
    setStatus("speaking");
    element.play().then(
      () => undefined,
      () => {
        // The autoplay rule: the rest waits for the person's gesture.
        if (mine === generation.current) setStatus("blocked");
      },
    );
  }, []);

  const queue = useCallback(
    (text: string, voice: QVoiceChoice = "FEMALE") => {
      const line = text.trim();
      if (line.length === 0 || line.length > Q_SPEECH_MAX_CHARS) return;
      if (readMuted()) return;
      pending.current.push(fetchLine(line, voice));
      if (!playing.current) {
        setStatus("loading");
        void playNext();
      }
    },
    [fetchLine, playNext],
  );

  const say = useCallback(
    async (text: string, voice: QVoiceChoice = "FEMALE") => {
      const line = text.trim();
      if (line.length === 0 || line.length > Q_SPEECH_MAX_CHARS) {
        // The contract would refuse it anyway; do not spend a request
        // finding that out.
        setStatus("unavailable");
        return;
      }
      if (readMuted()) {
        setStatus("idle");
        return;
      }
      release();
      setStatus("loading");
      let blob: Blob;
      try {
        const response = await fetch("/api/q-speech", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: line, voice }),
        });
        if (!response.ok) {
          setStatus("unavailable");
          return;
        }
        blob = await response.blob();
      } catch {
        setStatus("unavailable");
        return;
      }
      if (blob.size === 0) {
        setStatus("unavailable");
        return;
      }
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      const element = new Audio(url);
      element.onended = () => {
        setStatus("idle");
      };
      element.onerror = () => {
        setStatus("unavailable");
      };
      audio.current = element;
      start(element);
    },
    [release, start],
  );

  const play = useCallback(() => {
    const element = audio.current;
    if (element === null) {
      return;
    }
    start(element);
  }, [start]);

  const stop = useCallback(() => {
    release();
    setStatus("idle");
  }, [release]);

  const toggleMuted = useCallback(() => {
    // Read from where it is kept rather than from component state: an
    // updater is called for React's benefit and may be called twice, and
    // stopping the audio is not something to do twice.
    const next = !readMuted();
    writeMuted(next);
    setMuted(next);
    if (next) {
      release();
      setStatus("idle");
    }
  }, [release]);

  return { status, muted, say, queue, play, stop, toggleMuted };
}
