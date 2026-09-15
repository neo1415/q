"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useConversation } from "@elevenlabs/react";

import type {
  VoiceSessionClient,
  VoiceSessionEvents,
  VoiceSessionStart,
  VoiceState,
  VoiceTranscriptLine,
} from "../session";

/**
 * ElevenLabs as the browser's voice transport (CQ-Q-VOICE-001 C §33,
 * §41; D §46-§48). The ONLY browser file that imports the ElevenLabs SDK;
 * the boundary lint keeps it that way.
 *
 * What the SDK does here: opens the WebRTC session with the ephemeral
 * credential the Q API issued, captures the microphone, plays Q's speech,
 * and reports transcripts, mode changes and interruptions. What it never
 * does: decide anything. Every word Q says came from the Q API over the
 * Speech Engine channel; nothing here has a prompt, a tool or a memory.
 *
 * Errors are reduced to one plain sentence. The provider's own messages
 * are not shown: they name transports and codes, not what a person can do.
 */

const PLAIN_ERRORS = {
  microphone:
    "I can't hear you: the microphone isn't available. You can keep typing.",
  connection:
    "The voice connection dropped. You can keep typing, or try again.",
  generic: "Voice paused. You can keep typing, or try again.",
} as const;

function newId(): string {
  return crypto.randomUUID();
}

function level(data: Uint8Array): number {
  if (data.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const value of data) {
    sum += value;
  }
  return Math.min(1, sum / data.length / 255);
}

export function useElevenLabsVoiceSession(
  events: VoiceSessionEvents = {},
): VoiceSessionClient {
  const [state, setState] = useState<VoiceState>("IDLE");
  const [transcript, setTranscript] = useState<readonly VoiceTranscriptLine[]>(
    [],
  );
  const [muted, setMutedState] = useState(false);
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);
  const endedRef = useRef<"ended" | "error" | "dropped" | null>(null);

  const addLine = useCallback((role: "user" | "q", text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }
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

  const conversation = useConversation({
    micMuted: muted,
    onConnect: () => {
      setState("LISTENING");
    },
    onDisconnect: (details) => {
      const reason: "ended" | "error" | "dropped" =
        details.reason === "user"
          ? "ended"
          : details.reason === "error"
            ? "error"
            : "dropped";
      endedRef.current = reason;
      setState(reason === "ended" ? "IDLE" : "ERROR");
      if (reason !== "ended") {
        eventsRef.current.onError?.(PLAIN_ERRORS.connection);
      }
      eventsRef.current.onEnded?.(reason);
    },
    onError: (message) => {
      // The provider's wording is for logs, not for people.
      setState("ERROR");
      eventsRef.current.onError?.(
        /microphone|getUserMedia|permission|NotAllowed|NotFound/i.test(message)
          ? PLAIN_ERRORS.microphone
          : PLAIN_ERRORS.generic,
      );
    },
    onModeChange: ({ mode }) => {
      setState(mode === "speaking" ? "Q_SPEAKING" : "LISTENING");
    },
    onMessage: ({ message, source }) => {
      addLine(source === "user" ? "user" : "q", message);
      if (source === "user") {
        setState("THINKING");
      }
    },
    onInterruption: () => {
      setState("INTERRUPTED");
      eventsRef.current.onInterrupted?.();
    },
    onVadScore: ({ vadScore }) => {
      setState((current) =>
        current === "LISTENING" && vadScore > 0.6
          ? "USER_SPEAKING"
          : current === "USER_SPEAKING" && vadScore < 0.3
            ? "LISTENING"
            : current,
      );
    },
  });

  const start = useCallback(
    async ({ credential, firstMessage }: VoiceSessionStart) => {
      endedRef.current = null;
      setTranscript([]);
      setState("CONNECTING");
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setState("ERROR");
        eventsRef.current.onError?.(PLAIN_ERRORS.microphone);
        return;
      }
      try {
        conversation.startSession({
          conversationToken: credential.token,
          connectionType: "webrtc",
          ...(firstMessage === undefined
            ? {}
            : { overrides: { agent: { firstMessage } } }),
        });
      } catch {
        setState("ERROR");
        eventsRef.current.onError?.(PLAIN_ERRORS.generic);
      }
    },
    [conversation],
  );

  const end = useCallback(async () => {
    endedRef.current = "ended";
    conversation.endSession();
    setState("IDLE");
    await Promise.resolve();
  }, [conversation]);

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return;
      }
      conversation.sendUserMessage(trimmed);
      addLine("user", trimmed);
      setState("THINKING");
    },
    [conversation, addLine],
  );

  const setMuted = useCallback(
    (next: boolean) => {
      setMutedState(next);
      conversation.setMuted(next);
    },
    [conversation],
  );

  const setVolume = useCallback(
    (volume: number) => {
      conversation.setVolume({ volume: Math.min(1, Math.max(0, volume)) });
    },
    [conversation],
  );

  const inputLevel = useCallback(
    () =>
      conversation.status === "connected"
        ? level(conversation.getInputByteFrequencyData())
        : 0,
    [conversation],
  );
  const outputLevel = useCallback(
    () =>
      conversation.status === "connected"
        ? level(conversation.getOutputByteFrequencyData())
        : 0,
    [conversation],
  );

  return useMemo(
    () => ({
      state,
      connected: conversation.status === "connected",
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
      conversation.status,
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
