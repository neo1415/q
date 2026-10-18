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
/**
 * How far `end`'s bottom edge sits below the scroller's visible bottom
 * (negative: above it). For a thread whose end is not the scroller's end.
 */
function endOffset(end: HTMLElement, scroller: HTMLElement): number {
  const visibleBottom =
    scroller === document.scrollingElement
      ? window.innerHeight
      : scroller.getBoundingClientRect().bottom;
  return end.getBoundingClientRect().bottom - visibleBottom;
}

export function useFollowNewest(
  endRef: RefObject<HTMLElement | null>,
  newest: string,
  force: boolean,
  /**
   * "element": follow `endRef` itself, not the scroller's end. The Q panel
   * keeps its Board below the current exchange, so its end is not the
   * scroller's: following the scroller's end pushed a new answer out of
   * view behind older cards (premiere v5 run, 16 Oct).
   */
  anchor: "scroller" | "element" = "scroller",
): void {
  const pinned = useRef(true);
  useEffect(() => {
    const end = endRef.current;
    if (end === null) return;
    const scroller = scrollerOf(end);
    const target: HTMLElement | Window =
      scroller === document.scrollingElement ? window : scroller;
    const onScroll = () => {
      pinned.current =
        anchor === "element"
          ? Math.abs(endOffset(end, scroller)) <= AT_BOTTOM_SLACK_PX
          : isNearBottom(scroller);
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
    };
  }, [endRef, anchor]);
  useEffect(() => {
    const end = endRef.current;
    if (end === null) return;
    // Nothing to follow (no conversation yet): leave the scroller where the
    // page put it. Following here scrolled the Q page's welcome past Q's
    // own presence on a phone (live 2026-10-03: the swarm cut off at the top).
    if (newest === "" && !force) return;
    if (pinned.current || force) {
      // The thread's own scroller only: scrollIntoView would also move
      // the page around it.
      const scroller = scrollerOf(end);
      scroller.scrollTop =
        anchor === "element"
          ? scroller.scrollTop + endOffset(end, scroller)
          : scroller.scrollHeight;
      pinned.current = true;
    }
  }, [endRef, newest, force, anchor]);
}

/**
 * Brings the person's newest question to the top of its scroller, once per
 * question, and then leaves the scroll alone while the answer arrives.
 *
 * Owner 2026-10-17: in the Q panel beside a page, following the newest line
 * kept dragging the reader down through a long answer, away from where it
 * starts. Reading an answer begins at the question, like a page, not at
 * whatever streamed last. `key` changes only when a new question is asked.
 */
export function useAnchorQuestion(
  questionRef: RefObject<HTMLElement | null>,
  key: string | undefined,
): void {
  useEffect(() => {
    const question = questionRef.current;
    if (question === null || key === undefined) return;
    const scroller = scrollerOf(question);
    const top =
      scroller === document.scrollingElement
        ? 0
        : scroller.getBoundingClientRect().top;
    const offset = question.getBoundingClientRect().top - top - 12;
    scroller.scrollTo({ top: scroller.scrollTop + offset, behavior: "smooth" });
  }, [questionRef, key]);
}
