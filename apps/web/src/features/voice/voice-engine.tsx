"use client";

import { useEffect } from "react";

import type { VoiceSessionEvents } from "./session";
import { useVoiceInterview, type VoiceInterview } from "./use-voice-interview";

/**
 * W3-C (audit finding 6): the real voice, loaded on the person's first
 * intent to talk (lazy-voice-interview.tsx). It draws nothing; it runs
 * the voice hook and hands its value up on every render, where the stub
 * keeps only what changed.
 */
export function VoiceEngine({
  events,
  onValue,
}: {
  readonly events: VoiceSessionEvents;
  readonly onValue: (voice: VoiceInterview) => void;
}) {
  const voice = useVoiceInterview(events);
  // After the hook's own effects, so its refs (talk, the client) are set
  // before anyone can call through this value.
  useEffect(() => {
    onValue(voice);
  });
  return null;
}
