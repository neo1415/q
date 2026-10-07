"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { useQSessionOptional } from "../q/q-session";
import { endHum, humPlaying, playSound, startHum } from "./sound-engine";
import { useSoundPreference } from "./sound-preference";
import {
  cueForTransition,
  isWorkingState,
  soundAllowed,
  WORKING_TONE_AFTER_MS,
  type QSound,
  type SoundContext,
} from "./sound-rules";

/**
 * Q's sounds for the signed-in app (I2), from the one Q session the dock
 * and the Q page share, so a change of state sounds once however many Q
 * surfaces show it. Mounted once, in the global Q provider. Renders
 * nothing; plays only what `soundAllowed` lets through.
 */
export function QSounds() {
  const session = useQSessionOptional();
  const pathname = usePathname();
  const mode = useSoundPreference();
  const state = session?.presence?.state ?? "IDLE";
  // What the person just sent: the newest of their turns the server has
  // not confirmed yet. A conversation loaded from the server sends nothing.
  const sending = session?.turns.findLast(
    (turn) => turn.kind === "PERSON" && turn.unconfirmed,
  )?.id;

  const working = isWorkingState(state);
  const previous = useRef<typeof state | null>(null);
  const lastAt = useRef<number | null>(null);
  const sent = useRef<string | undefined>(undefined);

  useEffect(() => {
    const media = (query: string) =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(query).matches;
    const context = (): SoundContext => ({
      mode,
      speaking: state === "SPEAKING",
      pathname,
      reducedMotion: media("(prefers-reduced-motion: reduce)"),
      reducedTransparency: media("(prefers-reduced-transparency: reduce)"),
      now: performance.now(),
      lastAt: lastAt.current,
    });
    const play = (sound: Exclude<QSound, "hum">) => {
      const now = context();
      if (!soundAllowed(sound, now)) return;
      lastAt.current = now.now;
      playSound(sound);
    };

    const cue = cueForTransition(previous.current, state);
    previous.current = state;
    if (cue.hum === "STOP" || !soundAllowed("hum", context())) endHum();
    if (cue.play !== null && cue.play !== "hum") play(cue.play);
    if (
      cue.hum === "START" &&
      !humPlaying() &&
      soundAllowed("hum", context())
    ) {
      startHum();
    }

    // The person sent something: one light tick.
    if (sending !== undefined && sending !== sent.current) play("sent");
    sent.current = sending;
  }, [state, pathname, mode, sending]);

  // ADR 0062, the silence ladder's first rung: Q has been working 0.7 s
  // and is still at it, so one soft tone, under the same rules as every
  // other sound (Off, Quiet, speaking, the swipe path).
  useEffect(() => {
    if (!working) return;
    const timer = window.setTimeout(() => {
      const now = performance.now();
      const allowed = soundAllowed("working", {
        mode,
        speaking: false,
        pathname,
        reducedMotion: false,
        reducedTransparency: false,
        now,
        lastAt: lastAt.current,
      });
      if (!allowed) return;
      lastAt.current = now;
      playSound("working");
    }, WORKING_TONE_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
    };
    // Once per wait: a move between thinking and working is the same wait.
  }, [working, mode, pathname]);

  // Leaving the signed-in app (or this provider) ends the hum.
  useEffect(() => endHum, []);

  return null;
}
