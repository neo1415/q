"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/** Quiet this long (and ready) and the restored thread is in its final place. */
export const SETTLE_QUIET_MS = 120;
/** Shown by now whatever is still loading (never hidden for long). */
export const SETTLE_MAX_MS = 1500;

/**
 * Whether a restored conversation is still settling (CLS, batch 7: on a
 * phone, `/home?c=` restored its history; the rows, then earlier answers'
 * lazily loaded cards above them, then the follow-to-newest scroll landed
 * over several frames, and the latest answer jumped down: CLS 0.55).
 *
 * When `count` goes from none to several at once (history arriving), or
 * (settleOnMount) the thread mounts with several rows already, it is kept
 * hidden until its size has been still for
 * SETTLE_QUIET_MS and `isReady` says nothing it holds is still loading; at
 * most SETTLE_MAX_MS. A question being asked (none, then one) is never
 * hidden. Hidden content cannot shift.
 */
export function useSettledReveal(
  ref: RefObject<HTMLElement | null>,
  count: number,
  isReady: (element: HTMLElement) => boolean = () => true,
  /**
   * Also settle a thread that mounts with rows already (the Workspace pane,
   * drawn once after hydration). Off where the thread remounts on every
   * visit with its cards' code already loaded (it would only flash).
   */
  settleOnMount = false,
): boolean {
  const [settling, setSettling] = useState(() => settleOnMount && count >= 2);
  const [seen, setSeen] = useState(count);
  if (seen !== count) {
    setSeen(count);
    if (seen === 0 && count >= 2) setSettling(true);
  }
  useLayoutEffect(() => {
    if (!settling) return;
    const element = ref.current;
    let quiet = 0;
    const finish = () => {
      window.clearTimeout(quiet);
      window.clearTimeout(cap);
      observer?.disconnect();
      setSettling(false);
    };
    const cap = window.setTimeout(finish, SETTLE_MAX_MS);
    const check = () => {
      if (element === null || isReady(element)) finish();
      else quiet = window.setTimeout(check, SETTLE_QUIET_MS);
    };
    const restart = () => {
      window.clearTimeout(quiet);
      quiet = window.setTimeout(check, SETTLE_QUIET_MS);
    };
    const observer =
      element === null || typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(restart);
    if (element !== null) observer?.observe(element);
    restart();
    return () => {
      window.clearTimeout(quiet);
      window.clearTimeout(cap);
      observer?.disconnect();
    };
    // isReady is a pure check read at each quiet moment, not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settling, ref]);
  return settling;
}

/**
 * Ready when every answer-card block in the thread has drawn its canvas
 * (the canvas code is loaded lazily, and its cards are tall).
 */
export function answerCardsDrawn(element: HTMLElement): boolean {
  for (const block of element.querySelectorAll("[data-q-static-cards]")) {
    if (block.querySelector("[data-ac]") === null) return false;
  }
  return true;
}
