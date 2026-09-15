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
  generic: "Voice isn't working right now. You can keep typing.",
} as const;

const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;

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
        addLine(role, message.content);
        if (role === "user") setState("THINKING");
      });
      session.on("user-started-speaking", () => {
        player.interrupt();
        if (speakingRef.current) {
          speakingRef.current = false;
          setState("INTERRUPTED");
          eventsRef.current.onInterrupted?.();
        } else {
          setState("USER_SPEAKING");
        }
      });
      session.on("agent-thinking", () => {
        setState("THINKING");
      });
      session.on("agent-started-speaking", () => {
        speakingRef.current = true;
        setState("Q_SPEAKING");
      });
      session.on("audio", (chunk) => {
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
      session.on("error", (message) => {
        // The provider's wording is for logs, not for people.
        setState("ERROR");
        eventsRef.current.onError?.(PLAIN_ERRORS.generic);
        console.warn("voice agent error", message.code);
      });
      session.on("disconnected", (reason) => {
        const wasLive = liveRef.current === live;
        if (wasLive) liveRef.current = null;
        try {
          microphone.stop();
          player.dispose();
        } catch {
          // Already gone.
        }
        setConnected(false);
        const clean = /client|user|normal/i.test(reason);
        setState(clean ? "IDLE" : "ERROR");
        if (!clean) eventsRef.current.onError?.(PLAIN_ERRORS.connection);
        eventsRef.current.onEnded?.(clean ? "ended" : "dropped");
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
