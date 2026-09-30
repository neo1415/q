"use client";

import { useEffect, useRef } from "react";

import type { QVoiceTurnState } from "@capital-q/contracts";

import type { VoiceSessionClient } from "./session";

/**
 * Follow where Q is taking the person.
 *
 * A destination or a screen action is followed the moment the turn names
 * it; the voice line is above every page, so Q's sentence carries on
 * while the page changes. A handoff back to typing waits until Q is no
 * longer speaking or thinking (a floor so speech has started, a ceiling so
 * a silent turn still moves on), since it closes the line. Each turn is
 * followed at most once.
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
    if (
      turn.navigate === null &&
      turn.handoff === null &&
      (turn.clientAction ?? null) === null
    ) {
      return;
    }
    followed.current = turn.sequence;
    // Founder direction 2026-09-30: moving is instant. The voice line lives
    // above every page, so Q keeps talking while the screen changes under
    // it; only handing back to typing waits for Q to finish the sentence.
    if (turn.handoff === null) {
      followRef.current(turn);
      return;
    }
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
