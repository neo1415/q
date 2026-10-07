"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { VoiceConversation } from "@elevenlabs/react";

import { loadWire } from "../../q/wire";

import {
  transcriptLineFor,
  type VoiceSessionClient,
  type VoiceSessionEvents,
  type VoiceSessionStart,
  type VoiceState,
  type VoiceTranscriptLine,
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
 * The imperative client is used rather than the React provider so the
 * session belongs to the interview that started it and ends with it.
 * Errors are reduced to one plain sentence; the provider's own messages
 * name transports and codes, not what a person can do.
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
  const [connected, setConnected] = useState(false);
  const [transcript, setTranscript] = useState<readonly VoiceTranscriptLine[]>(
    [],
  );
  const [muted, setMutedState] = useState(false);
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);
  const conversationRef = useRef<VoiceConversation | null>(null);
  /** The last line shown: the same utterance or reply continues it. */
  const lastLineRef = useRef<VoiceTranscriptLine | null>(null);

  // Whatever is open when the interview unmounts is closed with it.
  useEffect(
    () => () => {
      const open = conversationRef.current;
      conversationRef.current = null;
      void open?.endSession().catch(() => undefined);
    },
    [],
  );

  const addLine = useCallback((role: "user" | "q", text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    const previous = lastLineRef.current;
    const line = transcriptLineFor(previous, role, trimmed, newId, Date.now());
    lastLineRef.current = line;
    setTranscript((current) =>
      line.id === previous?.id
        ? current.map((item) => (item.id === line.id ? line : item))
        : [...current, line],
    );
    eventsRef.current.onLine?.(line);
  }, []);

  const start = useCallback(
    async ({ credential, firstMessage }: VoiceSessionStart) => {
      setTranscript([]);
      lastLineRef.current = null;
      setState("CONNECTING");
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setState("ERROR");
        eventsRef.current.onError?.(PLAIN_ERRORS.microphone);
        return;
      }
      try {
        // P9: the SDK (and its WebRTC stack) loads when a call starts, not
        // with every page; it was the shell's largest chunk. A failed load
        // lands in the same plain error as a failed connect below.
        // W7: the silence ladder's tables come with the wire's contracts.
        const [{ Conversation }, { stripSilenceBeats }] = await Promise.all([
          import("@elevenlabs/react"),
          loadWire(),
        ]);
        const conversation = await Conversation.startSession({
          conversationToken: credential.token,
          connectionType: "webrtc",
          textOnly: false,
          ...(firstMessage === undefined
            ? {}
            : { overrides: { agent: { firstMessage } } }),
          onConnect: () => {
            setConnected(true);
            setState("LISTENING");
          },
          onDisconnect: (details) => {
            const reason: "ended" | "error" | "dropped" =
              details.reason === "user"
                ? "ended"
                : details.reason === "error"
                  ? "error"
                  : "dropped";
            conversationRef.current = null;
            setConnected(false);
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
              /microphone|getUserMedia|permission|NotAllowed|NotFound/i.test(
                message,
              )
                ? PLAIN_ERRORS.microphone
                : PLAIN_ERRORS.generic,
            );
          },
          onModeChange: ({ mode }) => {
            setState(mode === "speaking" ? "Q_SPEAKING" : "LISTENING");
          },
          onMessage: ({ message, source }) => {
            // W4b: the silence ladder's beats are voiced while Q works,
            // never a line of the conversation (nor of the saved transcript).
            addLine(
              source === "user" ? "user" : "q",
              source === "user" ? message : stripSilenceBeats(message),
            );
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
        conversationRef.current = conversation;
        conversation.setMicMuted(muted);
      } catch {
        setState("ERROR");
        eventsRef.current.onError?.(PLAIN_ERRORS.generic);
      }
    },
    [addLine, muted],
  );

  const end = useCallback(async () => {
    const conversation = conversationRef.current;
    conversationRef.current = null;
    setConnected(false);
    setState("IDLE");
    if (conversation !== null) {
      // The provider's transport logs its own closing; a session that is
      // already gone is not an error here.
      await conversation.endSession().catch(() => undefined);
    }
  }, []);

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const conversation = conversationRef.current;
      if (trimmed.length === 0 || conversation === null) {
        return;
      }
      conversation.sendUserMessage(trimmed);
      addLine("user", trimmed);
      setState("THINKING");
    },
    [addLine],
  );

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    conversationRef.current?.setMicMuted(next);
  }, []);

  const setVolume = useCallback((volume: number) => {
    conversationRef.current?.setVolume({
      volume: Math.min(1, Math.max(0, volume)),
    });
  }, []);

  const inputLevel = useCallback(() => {
    const conversation = conversationRef.current;
    return conversation === null || !conversation.isOpen()
      ? 0
      : level(conversation.getInputByteFrequencyData());
  }, []);
  const outputLevel = useCallback(() => {
    const conversation = conversationRef.current;
    return conversation === null || !conversation.isOpen()
      ? 0
      : level(conversation.getOutputByteFrequencyData());
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
