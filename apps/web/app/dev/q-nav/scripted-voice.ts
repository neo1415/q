"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  QConversationIdSchema,
  type QVoiceChoice,
  type QVoiceTurnState,
} from "@capital-q/contracts";

import type { VoiceSessionEvents } from "@/features/voice/session";
import type { VoiceInterview } from "@/features/voice/use-voice-interview";

/**
 * A scripted voice line for the navigation harness: it opens without a
 * provider, says what the test pushes (`cq:dev-voice-line` events) and
 * counts how often it was opened, so the browser suite can tell a line
 * that carried on from one that reconnected. Development only.
 */

export const DEV_VOICE_LINE_EVENT = "cq:dev-voice-line";
const CONVERSATION = QConversationIdSchema.parse(
  "c0ffee00-0000-4000-8000-000000000001",
);

type DevWindow = Window & { cqDevVoiceOpens?: number };

export function useScriptedVoice(
  events: VoiceSessionEvents = {},
): VoiceInterview {
  const [active, setActive] = useState(false);
  const [turn, setTurn] = useState<QVoiceTurnState | null>(null);
  const onLine = useRef(events.onLine);
  useEffect(() => {
    onLine.current = events.onLine;
  }, [events.onLine]);

  useEffect(() => {
    const listener = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (
        typeof detail !== "object" ||
        detail === null ||
        !("text" in detail) ||
        typeof detail.text !== "string"
      ) {
        return;
      }
      const role = "role" in detail && detail.role === "user" ? "user" : "q";
      onLine.current?.({
        id: `dev-${String(Date.now())}-${Math.random().toString(36).slice(2, 7)}`,
        role,
        text: detail.text,
        partial: false,
        at: Date.now(),
      });
    };
    window.addEventListener(DEV_VOICE_LINE_EVENT, listener);
    return () => window.removeEventListener(DEV_VOICE_LINE_EVENT, listener);
  }, []);

  const talk = useCallback(async () => {
    const own = window as DevWindow;
    own.cqDevVoiceOpens = (own.cqDevVoiceOpens ?? 0) + 1;
    setActive(true);
    setTurn({
      sequence: 1,
      asking: null,
      navigate: null,
      handoff: null,
      degraded: false,
      conversationId: CONVERSATION,
    });
    await Promise.resolve();
  }, []);
  const end = useCallback(async () => {
    setActive(false);
    await Promise.resolve();
  }, []);
  const noop = useCallback(() => undefined, []);
  const client = useMemo(
    () => ({
      state: active ? ("LISTENING" as const) : ("IDLE" as const),
      connected: active,
      muted: false,
      transcript: [],
      start: () => Promise.resolve(),
      end,
      sendText: noop,
      setMuted: noop,
      setVolume: noop,
      inputLevel: () => 0,
      outputLevel: () => 0,
    }),
    [active, end, noop],
  );
  const voice: QVoiceChoice = "FEMALE";
  return {
    client,
    active,
    voice,
    notice: null,
    talk,
    end,
    chooseVoice: () => Promise.resolve(),
    clearNotice: noop,
    turn,
  };
}
