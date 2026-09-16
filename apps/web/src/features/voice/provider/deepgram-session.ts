"use client";

import { AgentMicrophone, AgentPlayer, AgentSession } from "@deepgram/agents";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  VoiceSessionClient,
  VoiceSessionEvents,
  VoiceSessionStart,
  VoiceState,
  VoiceTranscriptLine,
} from "../session";

/**
 * The Deepgram Voice Agent as the browser's transport (CQ-Q-VOICE-001
 * rework). The session token and the agent settings come from the Q API;
 * every "think" the agent makes goes back to the Q API's own endpoint, so
 * what the person hears is Q. This adapter owns the microphone, the
 * speaker and the socket, and nothing else: no words are decided here.
 */

const PLAIN_ERRORS = {
  microphone:
    "Q can't hear you: the microphone isn't available. Check the browser's permission and try again.",
  connection:
    "The voice connection dropped. You can keep typing, or try again.",
  generic: "I lost the line there. Give me a second and I'll pick it back up.",
} as const;

const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;

/**
 * Telling a cough from a sentence. The provider reports "user started
 * speaking" on any sound; playback is cut only when the sound keeps going
 * across a short window. When Q was cut and no words followed within
 * a moment, the browser asks Q to carry on with a cue the server treats
 * as "go on" and the transcript never shows.
 */
const SUSTAINED_WINDOW_MS = 260;
const SUSTAINED_SAMPLE_MS = 40;
const SUSTAINED_LEVEL = 0.02;
const SUSTAINED_FRACTION = 0.3;
const FALSE_INTERRUPTION_MS = 1_600;
const RECENT_AUDIO_MS = 900;
const CONTINUE_SIGNAL = "[continue]";

let counter = 0;
const newId = () => `dg-${String(Date.now())}-${String((counter += 1))}`;

type Live = {
  readonly session: AgentSession;
  readonly microphone: AgentMicrophone;
  readonly player: AgentPlayer;
};

export function useDeepgramVoiceSession(
  events: VoiceSessionEvents = {},
): VoiceSessionClient {
  const [state, setState] = useState<VoiceState>("IDLE");
  const [connected, setConnected] = useState(false);
  const [transcript, setTranscript] = useState<readonly VoiceTranscriptLine[]>(
    [],
  );
  const [muted, setMutedState] = useState(false);
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);
  const liveRef = useRef<Live | null>(null);
  const speakingRef = useRef(false);
  const lastAudioAtRef = useRef(0);
  const lastUserTextAtRef = useRef(0);

  const teardown = useCallback(() => {
    const live = liveRef.current;
    liveRef.current = null;
    if (live === null) return;
    try {
      live.microphone.stop();
    } catch {
      // Already stopped.
    }
    try {
      live.player.dispose();
    } catch {
      // Already disposed.
    }
    try {
      live.session.disconnect();
    } catch {
      // Already closed.
    }
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const addLine = useCallback((role: "user" | "q", text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const line: VoiceTranscriptLine = {
      id: newId(),
      role,
      text: trimmed,
      partial: false,
      at: Date.now(),
    };
    setTranscript((current) => [...current, line]);
    eventsRef.current.onLine?.(line);
  }, []);

  const start = useCallback(
    async ({ credential }: VoiceSessionStart) => {
      const settings = credential.deepgram;
      if (credential.provider !== "deepgram" || settings === undefined) {
        setState("ERROR");
        eventsRef.current.onError?.(PLAIN_ERRORS.generic);
        return;
      }
      teardown();
      setTranscript([]);
      setState("CONNECTING");
      speakingRef.current = false;

      const token = credential.token;
      const session = new AgentSession({
        auth: { tokenFactory: () => Promise.resolve(token) },
        agent: settings.agent,
        audio: {
          input: { encoding: "linear16", sampleRate: INPUT_SAMPLE_RATE },
          output: { encoding: "linear16", sampleRate: OUTPUT_SAMPLE_RATE },
        },
      });
      const player = new AgentPlayer({ sampleRate: OUTPUT_SAMPLE_RATE });
      const microphone = new AgentMicrophone(
        (data) => {
          session.sendAudio(data);
        },
        { sampleRate: INPUT_SAMPLE_RATE, echoCancellation: true },
      );
      const live: Live = { session, microphone, player };
      liveRef.current = live;

      session.on("connected", () => {
        setConnected(true);
        setState("LISTENING");
      });
      session.on("conversation-text", (message) => {
        const role = message.role === "user" ? "user" : "q";
        if (role === "user") {
          lastUserTextAtRef.current = Date.now();
          if (message.content.trim() === CONTINUE_SIGNAL) return;
        }
        addLine(role, message.content);
        if (role === "user") setState("THINKING");
      });
      const sustained = async (): Promise<boolean> => {
        const samples = Math.max(
          1,
          Math.round(SUSTAINED_WINDOW_MS / SUSTAINED_SAMPLE_MS),
        );
        let loud = 0;
        for (let i = 0; i < samples; i += 1) {
          await new Promise((resolve) =>
            window.setTimeout(resolve, SUSTAINED_SAMPLE_MS),
          );
          if (liveRef.current !== live) return false;
          if (microphone.getInputVolume() >= SUSTAINED_LEVEL) loud += 1;
        }
        return loud / samples >= SUSTAINED_FRACTION;
      };
      const repairFalseInterruption = () => {
        const startedAt = Date.now();
        window.setTimeout(() => {
          if (liveRef.current !== live) return;
          const wordsFollowed = lastUserTextAtRef.current >= startedAt;
          const stillSpeaking =
            Date.now() - lastAudioAtRef.current < RECENT_AUDIO_MS;
          if (wordsFollowed || stillSpeaking) return;
          session.injectUserMessage(CONTINUE_SIGNAL);
          setState("THINKING");
        }, FALSE_INTERRUPTION_MS);
      };
      session.on("user-started-speaking", () => {
        if (!speakingRef.current) {
          setState("USER_SPEAKING");
          return;
        }
        // Q is talking: cut playback for a sound that keeps going. The
        // window is short and the threshold low, because failing to stop
        // when a person speaks is far worse than stopping for a cough —
        // a false stop resumes itself a moment later.
        void sustained().then((real) => {
          if (liveRef.current !== live || !speakingRef.current) return;
          if (!real) return;
          player.interrupt();
          speakingRef.current = false;
          setState("INTERRUPTED");
          eventsRef.current.onInterrupted?.();
          repairFalseInterruption();
        });
      });
      session.on("agent-thinking", () => {
        setState("THINKING");
      });
      session.on("agent-started-speaking", () => {
        speakingRef.current = true;
        setState("Q_SPEAKING");
      });
      session.on("audio", (chunk) => {
        lastAudioAtRef.current = Date.now();
        player.queue(chunk);
      });
      session.on("agent-audio-done", () => {
        const remaining = Math.max(0, player.getRemainingPlaybackTime());
        window.setTimeout(
          () => {
            if (liveRef.current !== live) return;
            speakingRef.current = false;
            setState((current) =>
              current === "Q_SPEAKING" ? "LISTENING" : current,
            );
          },
          Math.min(8_000, remaining * 1000 + 150),
        );
      });
      /**
       * A line that has failed is finished, and the person should be
       * picked back up rather than left reading about it.
       *
       * Both an agent error and an unclean disconnect end the session the
       * same way — teardown, one plain sentence, then `dropped`, which is
       * what the reconnect upstairs listens for. An agent error used to
       * set an error state and stop there, so a failed turn stranded the
       * person behind a banner while a dropped socket healed itself.
       *
       * Called at most once: whichever event arrives first claims the
       * session, and the other finds it already gone.
       */
      const fail = (line: string) => {
        if (liveRef.current !== live) {
          return;
        }
        liveRef.current = null;
        try {
          microphone.stop();
          player.dispose();
        } catch {
          // Already gone.
        }
        setConnected(false);
        setState("ERROR");
        eventsRef.current.onError?.(line);
        eventsRef.current.onEnded?.("dropped");
      };

      session.on("error", (message) => {
        // The provider's code and wording are for our logs. A person is
        // told what happened to them, in one sentence, with no code in it:
        // "(FAILED_TO_THINK)" told them nothing and read like a crash.
        console.warn("voice agent error", message.code, message.description);
        fail(PLAIN_ERRORS.generic);
      });
      session.on("disconnected", (reason) => {
        const clean = /client|user|normal/i.test(reason);
        if (!clean) {
          fail(PLAIN_ERRORS.connection);
          return;
        }
        if (liveRef.current === live) {
          liveRef.current = null;
        }
        try {
          microphone.stop();
          player.dispose();
        } catch {
          // Already gone.
        }
        setConnected(false);
        setState("IDLE");
        eventsRef.current.onEnded?.("ended");
      });

      try {
        await microphone.start();
      } catch {
        liveRef.current = null;
        setState("ERROR");
        eventsRef.current.onError?.(PLAIN_ERRORS.microphone);
        return;
      }
      if (muted) microphone.mute();
      try {
        await session.connect();
      } catch {
        teardown();
        setState("ERROR");
        eventsRef.current.onError?.(PLAIN_ERRORS.connection);
      }
    },
    [addLine, muted, teardown],
  );

  const end = useCallback(async () => {
    const live = liveRef.current;
    liveRef.current = null;
    setConnected(false);
    setState("IDLE");
    if (live !== null) {
      try {
        live.microphone.stop();
        live.player.dispose();
        live.session.disconnect();
      } catch {
        // Already closed.
      }
    }
    await Promise.resolve();
  }, []);

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const live = liveRef.current;
      if (trimmed.length === 0 || live === null) return;
      live.session.injectUserMessage(trimmed);
      addLine("user", trimmed);
      setState("THINKING");
    },
    [addLine],
  );

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    const live = liveRef.current;
    if (live === null) return;
    if (next) live.microphone.mute();
    else live.microphone.unmute();
  }, []);

  const setVolume = useCallback((volume: number) => {
    liveRef.current?.player.setVolume(Math.min(1, Math.max(0, volume)));
  }, []);

  const inputLevel = useCallback(() => {
    const live = liveRef.current;
    return live === null
      ? 0
      : Math.min(1, live.microphone.getInputVolume() * 3);
  }, []);
  const outputLevel = useCallback(() => {
    const live = liveRef.current;
    return live === null ? 0 : Math.min(1, live.player.getOutputVolume() * 3);
  }, []);

  return useMemo(
    () => ({
      state,
      connected,
      muted,
      transcript,
      start,
      end,
      sendText,
      setMuted,
      setVolume,
      inputLevel,
      outputLevel,
    }),
    [
      state,
      connected,
      muted,
      transcript,
      start,
      end,
      sendText,
      setMuted,
      setVolume,
      inputLevel,
      outputLevel,
    ],
  );
}
