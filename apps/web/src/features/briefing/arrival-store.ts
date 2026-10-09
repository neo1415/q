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

const NAME_KEY = "cq.q.first-name";

function set(next: ArrivalStatus): void {
  status = next;
  // Remembered so a call that opens before the briefing lands can still
  // greet them by name (a per-browser convenience; blocked storage is fine).
  if (next.kind === "READY" && next.data.firstName !== null) {
    try {
      window.localStorage.setItem(NAME_KEY, next.data.firstName);
    } catch {
      // Not remembered; the hello goes without the name.
    }
  }
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
    // No cards on this page load, but a call is still the person asking to
    // be briefed: read it now, quietly, so the call opens with it (live
    // 2026-10-09: every call after the first opened "What's on your
    // mind?" because the read took longer than the call waits).
    prefetchForVoice(loader, gate.since);
  } else {
    void load(loader, gate.since, false);
  }
  // Back on this page after two hours away: a new arrival.
  onReturn((again) => {
    void load(loader, again.since, false);
  });
}

function currentStatus(): ArrivalStatus {
  return status;
}

/**
 * A call is starting: the briefing's data, read now if this page load has
 * none (the gate gives the cards once per browser session, but a call is
 * the person asking to be briefed; live 2026-10-08 11:13 a call opened
 * "What would you like to work on today?" because the gate had said no).
 * What it reads is put on screen too, so the cards Q names are there to
 * decide. Null when nothing could be read in time.
 */
export async function arrivalForVoice(
  loader: ArrivalLoader,
  timeoutMs: number,
): Promise<ArrivalData | null> {
  let data: ArrivalData | null;
  if (status.kind === "READY") {
    data = status.data;
  } else {
    const reading =
      prefetched !== null && Date.now() - prefetched.at < PREFETCH_FRESH_MS
        ? prefetched.read
        : loader(decideArrival().since).catch(() => null);
    prefetched = null;
    // A read that lands after the call opened is still put on screen; the
    // stage then hands its words to the line (E-05). It used to be
    // dropped, so a slow read meant no briefing at all.
    void reading.then(publishForVoice);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    data = await Promise.race([reading, late]);
    clearTimeout(timer);
  }
  if (data === null) return null;
  return {
    ...data,
    cards: data.cards.filter((card) => !handled.has(card.key)),
  };
}

/** How long a quietly read briefing still counts as this visit's. */
const PREFETCH_FRESH_MS = 10 * 60_000;
let prefetched: {
  readonly at: number;
  readonly read: Promise<ArrivalData | null>;
} | null = null;

function prefetchForVoice(loader: ArrivalLoader, since: string | null): void {
  prefetched = {
    at: Date.now(),
    read: loader(since).catch(() => null),
  };
}

/** A briefing read for a call: on screen once, unless one already is. */
function publishForVoice(data: ArrivalData | null): void {
  if (data === null || currentStatus().kind === "READY") return;
  started = true;
  round += 1;
  set({ kind: "READY", data, round, nudge: false });
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

/**
 * E-05: a call opens at once, with the briefing's words when they are
 * ready. When they were not, the stage hands them to the line once they
 * land; this says whether the line already has them.
 */
let saidOnLine = false;
export function markArrivalSaid(said: boolean): void {
  saidOnLine = said;
}
export function arrivalSaidOnLine(): boolean {
  return saidOnLine;
}

/** Whether this page load gives a briefing (decided, or about to be). */
export function arrivalPending(): boolean {
  return status.kind === "PENDING" && started;
}

/** Their first name as the last briefing in this browser gave it. */
export function knownFirstName(): string | null {
  try {
    return window.localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
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

/**
 * A line said just before the cards are read again (a retry's outcome),
 * kept for the next sequence to show: re-reading never swallows it.
 */
let carried: string | null = null;
export function carryStatus(text: string | null): void {
  carried = text;
}
export function takeCarriedStatus(): string | null {
  const text = carried;
  carried = null;
  return text;
}

/** For the dev harness and tests: start over. */
export function resetArrival(): void {
  status = { kind: "PENDING" };
  started = false;
  spoken = null;
  handled.clear();
  leftRound = -1;
  greetedRound = -1;
  carried = null;
  saidOnLine = false;
  prefetched = null;
}
