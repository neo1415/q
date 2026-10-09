import type {
  QClientActionIntent,
  QVoiceDestination,
} from "@capital-q/contracts";

import {
  recordPagePath,
  settingsPath,
  setupPath,
} from "../../q/client-actions";
import {
  onNavigationOutcome,
  type NavigationOutcome,
} from "../../q/ui-act-controller";
import { destinationPath } from "../destinations";

/**
 * V (founder live 2026-10-09: Q said "I've opened their page"; the founder:
 * "It's not open yet"). A GPT-Live delegation whose Q run moved the screen
 * (a NAVIGATE or OPEN_RECORD_PAGE intent on the run's turn) is followed at
 * once, before the voice speaks: the voice surface is told to read its turn
 * board now (it otherwise polls every 1.5 s), and its existing follow path
 * moves the screen and reports C's receipt (`expectNavigation` -> DONE or
 * FAILED). The bridge waits for that receipt, so the voice is only ever
 * told the page is open when the router has landed on it.
 */

/** The voice surface reads its turn board now (use-voice-interview.ts). */
export const VOICE_TURN_NOW_EVENT = "cq:voice-turn-now";

/** How long the voice waits for the move's receipt before speaking. */
export const MOVE_RECEIPT_WAIT_MS = 6_000;

export type MoveOutcome = "DONE" | "FAILED" | "PENDING";

/** The route move a delegated run made (q-api's LiveMove). */
export type LiveMove = {
  readonly navigate: QVoiceDestination | null;
  readonly action: QClientActionIntent | null;
};

/**
 * The route the screen lands on for a run's move: its last route-moving
 * action (performed after the destination), else its destination. Null
 * when it has no route (a data-room document opens in the viewer; an
 * interview or form destination is a handoff), so no receipt is awaited.
 */
export function movePath(move: LiveMove): string | null {
  const action = move.action;
  // Only route moves get a receipt; every other action leaves the route.
  if (
    action?.kind === "OPEN_RECORD_PAGE" &&
    action.page !== "DATA_ROOM_DOCUMENT"
  ) {
    return recordPagePath(action.page, action.id);
  }
  if (action?.kind === "OPEN_SETUP") return setupPath(action.journey);
  if (action?.kind === "OPEN_SETTINGS") return settingsPath(action.section);
  return destinationPath(move.navigate);
}

/**
 * Follow a delegated run's move now and wait for the receipt of THIS
 * move's route (`path`): a receipt for any other route (an earlier move
 * landing late) never answers it. PENDING: no receipt within the wait
 * (the page is still loading).
 */
export function followMoveNow(options: {
  readonly path: string;
  readonly dispatch?: (() => void) | undefined;
  readonly subscribe?:
    | ((listener: (outcome: NavigationOutcome) => void) => () => void)
    | undefined;
  readonly waitMs?: number | undefined;
}): Promise<MoveOutcome> {
  const subscribe = options.subscribe ?? onNavigationOutcome;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: MoveOutcome) => {
      if (settled) return;
      settled = true;
      stop();
      clearTimeout(timer);
      resolve(outcome);
    };
    // Subscribed before the move is asked for: a fast landing is not missed.
    const stop = subscribe((outcome) => {
      if (outcome.expected === options.path) finish(outcome.status);
    });
    const timer = setTimeout(() => {
      finish("PENDING");
    }, options.waitMs ?? MOVE_RECEIPT_WAIT_MS);
    (options.dispatch ?? readTurnNow)();
  });
}

/** The voice surface reads its board now (a move without a route). */
export function readTurnNow(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(VOICE_TURN_NOW_EVENT));
  }
}

/**
 * Before a delegated result is spoken: follow its move, and return what
 * the voice must know from the receipt (null: no route move to report).
 */
export async function noteForMove(
  move: LiveMove | undefined,
  follow: (path: string) => Promise<MoveOutcome> = (path) =>
    followMoveNow({ path }),
): Promise<string | null> {
  if (move === undefined) return null;
  const path = movePath(move);
  if (path === null) {
    readTurnNow();
    return null;
  }
  return moveNote(await follow(path));
}

/** What the voice is told about the screen, from the receipt. */
export function moveNote(outcome: MoveOutcome): string {
  switch (outcome) {
    case "DONE":
      return "The page is open on their screen now (confirmed).";
    case "FAILED":
      return "The page did NOT open on their screen. Say briefly that it didn't open and offer to try again; never say it is open.";
    case "PENDING":
      return "The page is still loading on their screen: do not say it is open; say it is coming up.";
  }
}

/**
 * The receipt for a move the app makes itself (C's fast path: the screen
 * is pushed before Q Brain is asked). Listening starts when this is called,
 * before the move; `for(path)` waits for that path's receipt.
 */
export function receiptListener(
  subscribe: (
    listener: (outcome: NavigationOutcome) => void,
  ) => () => void = onNavigationOutcome,
): {
  readonly for: (path: string, waitMs?: number) => Promise<MoveOutcome>;
  readonly stop: () => void;
} {
  const seen: NavigationOutcome[] = [];
  const waiting = new Set<(outcome: NavigationOutcome) => void>();
  const stop = subscribe((outcome) => {
    seen.push(outcome);
    for (const wake of waiting) wake(outcome);
  });
  return {
    stop,
    for: (path, waitMs = MOVE_RECEIPT_WAIT_MS) =>
      new Promise<MoveOutcome>((resolve) => {
        const matches = (outcome: NavigationOutcome) =>
          outcome.expected === path;
        const finish = (outcome: MoveOutcome) => {
          clearTimeout(timer);
          waiting.delete(wake);
          stop();
          resolve(outcome);
        };
        const wake = (outcome: NavigationOutcome) => {
          if (matches(outcome)) finish(outcome.status);
        };
        const timer = setTimeout(() => {
          finish("PENDING");
        }, waitMs);
        const earlier = seen.find(matches);
        if (earlier !== undefined) {
          finish(earlier.status);
          return;
        }
        // Already there: no move was needed, so no receipt will come.
        if (
          typeof window !== "undefined" &&
          `${window.location.pathname}${window.location.search}` === path
        ) {
          finish("DONE");
          return;
        }
        waiting.add(wake);
      }),
  };
}
