"use client";

import { useEffect, useRef } from "react";

import type { QVoiceTurnState } from "@capital-q/contracts";

import type { VoiceSessionClient } from "./session";

/**
 * Follow where Q is taking the person, after Q has finished saying so.
 *
 * The turn state names a destination before Q's sentence is spoken; acting
 * on it at once cuts the goodbye. So a destination waits until the client
 * is no longer speaking or thinking, with a floor so speech has started
 * and a ceiling so a silent turn still moves on. Each turn is followed at
 * most once, and a later turn without a destination does not cancel one
 * already waiting.
 */

const SPEECH_FLOOR_MS = 1_500;
/** A destination named while Q is silent or only thinking moves on by then. */
const SPEECH_CEILING_MS = 12_000;
/** While Q is audibly speaking the goodbye, the screen waits much longer. */
const SPEAKING_CEILING_MS = 90_000;
const CHECK_MS = 250;

export function useFollowTurn(
  turn: QVoiceTurnState | null,
  client: Pick<VoiceSessionClient, "state">,
  follow: (turn: QVoiceTurnState) => void,
): void {
  const followed = useRef(0);
  const timer = useRef<number | null>(null);
  const followRef = useRef(follow);
  const stateRef = useRef(client.state);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);
  useEffect(() => {
    stateRef.current = client.state;
  }, [client.state]);

  useEffect(() => {
    if (turn === null || turn.sequence <= followed.current) return;
    if (turn.navigate === null && turn.handoff === null) return;
    followed.current = turn.sequence;
    const at = Date.now();
    if (timer.current !== null) window.clearTimeout(timer.current);
    const check = () => {
      const state = stateRef.current;
      const quiet =
        state !== "Q_SPEAKING" &&
        state !== "THINKING" &&
        state !== "CONNECTING";
      const elapsed = Date.now() - at;
      const ceiling =
        state === "Q_SPEAKING" ? SPEAKING_CEILING_MS : SPEECH_CEILING_MS;
      if ((quiet && elapsed >= SPEECH_FLOOR_MS) || elapsed >= ceiling) {
        timer.current = null;
        followRef.current(turn);
        return;
      }
      timer.current = window.setTimeout(check, CHECK_MS);
    };
    timer.current = window.setTimeout(check, SPEECH_FLOOR_MS);
  }, [turn]);

  // Only leaving the screen cancels a destination still waiting.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
}
