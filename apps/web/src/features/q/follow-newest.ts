"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * A thread follows its newest message only while the reader is at the
 * bottom (founder report 2026-10-01: chats "not arranged properly"). Every
 * thread used to jump to the end on each new word, which pulled a person
 * reading an earlier answer away from it. Now: at the bottom, it follows;
 * scrolled up, it stays put; the person's own new message always brings
 * them back down.
 */

/** Within this many pixels of the end counts as "at the bottom". */
export const AT_BOTTOM_SLACK_PX = 96;

export function isNearBottom(
  scroller: {
    readonly scrollHeight: number;
    readonly scrollTop: number;
    readonly clientHeight: number;
  },
  slack: number = AT_BOTTOM_SLACK_PX,
): boolean {
  return (
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= slack
  );
}

function scrollerOf(element: HTMLElement): HTMLElement {
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    const overflow = getComputedStyle(at).overflowY;
    if (overflow === "auto" || overflow === "scroll") return at;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

/**
 * Keeps `endRef` in view when `newest` changes, if the reader was at the
 * bottom or `force` is true (their own message). `endRef` is an element at
 * the end of the thread.
 */
export function useFollowNewest(
  endRef: RefObject<HTMLElement | null>,
  newest: string,
  force: boolean,
): void {
  const pinned = useRef(true);
  useEffect(() => {
    const end = endRef.current;
    if (end === null) return;
    const scroller = scrollerOf(end);
    const target: HTMLElement | Window =
      scroller === document.scrollingElement ? window : scroller;
    const onScroll = () => {
      pinned.current = isNearBottom(scroller);
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
    };
  }, [endRef]);
  useEffect(() => {
    const end = endRef.current;
    if (end === null) return;
    if (pinned.current || force) {
      // The thread's own scroller only: scrollIntoView would also move
      // the page around it.
      const scroller = scrollerOf(end);
      scroller.scrollTop = scroller.scrollHeight;
      pinned.current = true;
    }
  }, [endRef, newest, force]);
}
