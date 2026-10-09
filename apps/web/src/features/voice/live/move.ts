import {
  onNavigationOutcome,
  type NavigationOutcome,
} from "../../q/ui-act-controller";

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

/**
 * Follow a delegated run's move now and wait for its receipt. PENDING:
 * no receipt within the wait (the page is still loading).
 */
export function followMoveNow(
  options: {
    readonly dispatch?: (() => void) | undefined;
    readonly subscribe?:
      | ((listener: (outcome: NavigationOutcome) => void) => () => void)
      | undefined;
    readonly waitMs?: number | undefined;
  } = {},
): Promise<MoveOutcome> {
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
      finish(outcome.status);
    });
    const timer = setTimeout(() => {
      finish("PENDING");
    }, options.waitMs ?? MOVE_RECEIPT_WAIT_MS);
    (
      options.dispatch ??
      (() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(VOICE_TURN_NOW_EVENT));
        }
      })
    )();
  });
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
