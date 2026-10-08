"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { ArrivalData } from "./arrival";
import { decideArrival, onReturn } from "./arrival-gate";

/**
 * The arrival briefing's data for this page load, shared by the Q page
 * and the dock (whichever is on screen gives it), and what Q says first on
 * voice. Browser-only; nothing here persists.
 */

export type ArrivalLoader = (
  since: string | null,
) => Promise<ArrivalData | null>;

export type ArrivalStatus =
  | { readonly kind: "PENDING" }
  /** No briefing on this page load (not an arrival, or nothing read). */
  | { readonly kind: "NONE" }
  | {
      readonly kind: "READY";
      readonly data: ArrivalData;
      readonly round: number;
      /** Cards that came in later (no greeting, a gentle nudge). */
      readonly nudge: boolean;
    };

let status: ArrivalStatus = { kind: "PENDING" };
let started = false;
let round = 0;
const subscribers = new Set<() => void>();
/** Q's first words on voice when the briefing is given (greeting, lowdown, first card). */
let spoken: string | null = null;
/**
 * What this page load already went through: cards decided or put off, the
 * person leaving the sequence, the round already greeted. Moving between
 * pages never greets twice or brings a decided card back.
 */
const handled = new Set<string>();
let leftRound = -1;
let greetedRound = -1;

function set(next: ArrivalStatus): void {
  status = next;
  for (const notify of subscribers) notify();
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

const PENDING: ArrivalStatus = { kind: "PENDING" };

async function load(
  loader: ArrivalLoader,
  since: string | null,
  nudge: boolean,
): Promise<void> {
  const data = await loader(since).catch(() => null);
  round += 1;
  if (data === null) {
    if (!nudge) set({ kind: "NONE" });
    return;
  }
  set({ kind: "READY", data, round, nudge });
}

/** Starts this page load's briefing once; later calls share it. */
export function startArrival(loader: ArrivalLoader): void {
  if (started) return;
  started = true;
  const gate = decideArrival();
  if (!gate.give) {
    set({ kind: "NONE" });
  } else {
    void load(loader, gate.since, false);
  }
  // Back on this page after two hours away: a new arrival.
  onReturn((again) => {
    void load(loader, again.since, false);
  });
}

/** New decisions arrived later (an agent needs them): the cards again. */
export function refreshArrival(loader: ArrivalLoader): void {
  void load(loader, null, true);
}

export function useArrival(loader: ArrivalLoader): ArrivalStatus {
  useEffect(() => {
    startArrival(loader);
  }, [loader]);
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => PENDING,
  );
}

/** The briefing's state, without starting it (for surfaces around it). */
export function useArrivalStatus(): ArrivalStatus {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => PENDING,
  );
}

export function setArrivalSpoken(words: string | null): void {
  spoken = words;
}

/** What Q says first on voice when the briefing was given; null otherwise. */
export function arrivalSpoken(): string | null {
  return spoken;
}

/** Whether this page load gives a briefing (decided, or about to be). */
export function arrivalPending(): boolean {
  return status.kind === "PENDING" && started;
}

/** A card decided or put off on this page load. */
export function markHandled(key: string): void {
  handled.add(key);
}

export function isHandled(key: string): boolean {
  return handled.has(key);
}

/** The person left the sequence for this round. */
export function markLeft(round: number): void {
  leftRound = round;
}

export function leftIn(round: number): boolean {
  return leftRound === round;
}

/** Greets once per round; true the first time it is asked for a round. */
export function claimGreeting(round: number): boolean {
  if (greetedRound === round) return false;
  greetedRound = round;
  return true;
}

/** For the dev harness and tests: start over. */
export function resetArrival(): void {
  status = { kind: "PENDING" };
  started = false;
  spoken = null;
  handled.clear();
  leftRound = -1;
  greetedRound = -1;
}
