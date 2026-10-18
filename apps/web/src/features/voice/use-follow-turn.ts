"use client";

import { useEffect, useRef } from "react";

import type { QVoiceTurnState } from "@capital-q/contracts";

import { performClientAction } from "../q/client-actions";
import {
  navigationFailureMessage,
  type NavigationFailure,
} from "../q/control/navigation-lifecycle";
import {
  onNavigationOutcome,
  requestMove,
  type NavigationOutcome,
} from "../q/ui-act-controller";
import { noteToLine } from "./line-cards";
import { destinationPath } from "./destinations";
import type { VoiceSessionClient } from "./session";

/**
 * RECOVERY-2026-10 (C2, with workstream C): a spoken answer's whole chain
 * of client actions, in order ("open Capital, the readiness tab, scroll
 * to the risks"), not only the last. A move is announced to the UI-act
 * controller first, so acts meant for the new page wait for it and their
 * receipts are confirmed there. Returns the turn left for the caller: its
 * move (and hand-off), with the actions already performed.
 */
/** What Q says when a move it made never opened (C's FAILED receipt). */
export const MOVE_FAILED_LINE =
  "That page didn't open on your screen. Want me to try again?";

/**
 * With workstream C: a spoken move is reported through the same hook as a
 * typed one (`expectNavigation` -> the router's DONE, or FAILED when it
 * never settles -> the receipt reporter), so the next turn knows. And the
 * line is told at once when it FAILED, so Q never lets "it's open" stand
 * for a page that did not open.
 */
export function spokenMoveFailedNote(reason: NavigationFailure): string {
  return `Screen note (data, not the person's words): the page you just moved them to did NOT open on their screen (FAILED: ${reason}). Tell them briefly, in your own words: "${navigationFailureMessage(reason)}" Never say it is open.`;
}

export function watchSpokenMove(
  path: string,
  onFailed: (reason: NavigationFailure) => void = (reason) => {
    // A move Q replaced with a newer one is not news to the person.
    if (reason === "SUPERSEDED") return;
    noteToLine(
      spokenMoveFailedNote(reason),
      true,
      reason === "NOT_LANDED"
        ? MOVE_FAILED_LINE
        : navigationFailureMessage(reason),
    );
  },
  subscribe: (
    listener: (outcome: NavigationOutcome) => void,
  ) => () => void = onNavigationOutcome,
): void {
  const stop = subscribe((outcome) => {
    if (outcome.expected !== path) return;
    stop();
    if (outcome.status === "FAILED") onFailed(outcome.reason);
  });
}

/** The board's move, made through the one navigation lifecycle. */
export function moveForTurn(path: string): void {
  requestMove({ path });
}

/**
 * R3: the follower that reads the board makes its move (`move`), before
 * the chain, so the chain's UI acts wait for the page it moves to. A
 * surface that must do something first (end the line, then move) passes
 * null and makes the move itself with `requestMove`.
 */
export function performTurnChain(
  turn: QVoiceTurnState,
  perform: (action: unknown) => boolean = performClientAction,
  move: ((path: string) => void) | null = moveForTurn,
  watch: (path: string) => void = watchSpokenMove,
): QVoiceTurnState {
  const chain =
    turn.clientActions !== undefined && turn.clientActions.length > 0
      ? turn.clientActions
      : turn.clientAction === undefined || turn.clientAction === null
        ? []
        : [turn.clientAction];
  const path = destinationPath(turn.navigate);
  // Every move gets its receipt, even to where they already are (VERIFIED
  // at once): the GPT-Live voice waits for it before it speaks.
  if (path !== null && typeof window !== "undefined") {
    watch(path);
    move?.(path);
  }
  for (const action of chain) perform(action);
  return { ...turn, clientAction: null, clientActions: [] };
}

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
  /**
   * Who makes the board's move: the chain (default; the follow callback
   * must not push it again), or the caller's own callback (a surface that
   * ends its line before it moves).
   */
  moves: "CHAIN" | "CALLER" = "CHAIN",
): void {
  const movesRef = useRef(moves);
  useEffect(() => {
    movesRef.current = moves;
  }, [moves]);
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
    // voice-cards: a new line starts its board at sequence 1 (the turn is
    // cleared to null between lines); the old line's count would otherwise
    // swallow the new line's first moves -- "take me to ..." said early on
    // a second line in the same page life was never followed.
    if (turn === null) {
      followed.current = 0;
      return;
    }
    if (turn.sequence <= followed.current) return;
    if (
      turn.navigate === null &&
      turn.handoff === null &&
      (turn.clientAction ?? null) === null &&
      (turn.clientActions?.length ?? 0) === 0
    ) {
      return;
    }
    followed.current = turn.sequence;
    // Founder direction 2026-09-30: moving is instant. The voice line lives
    // above every page, so Q keeps talking while the screen changes under
    // it; only handing back to typing waits for Q to finish the sentence.
    const chain = (followedTurn: QVoiceTurnState) =>
      performTurnChain(
        followedTurn,
        performClientAction,
        movesRef.current === "CHAIN" ? moveForTurn : null,
      );
    if (turn.handoff === null) {
      followRef.current(chain(turn));
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
        followRef.current(chain(turn));
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
