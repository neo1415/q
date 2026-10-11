"use client";

import { useEffect } from "react";

const MARK = "data-daily-focused";
const ANCHOR = /^#((?:story|section)-[A-Za-z0-9_-]{1,64})$/u;

/**
 * P4: Q opened this edition at a story or section ("open it"). Scrolls to
 * that element and marks it for a few seconds (the page's stylesheet shows
 * the mark; reduced motion gets the mark without smooth scrolling). The
 * route change was client-side, so the hash may land a moment after this
 * mounts: it is looked for briefly, then left alone. Renders nothing.
 */
export function DailyAnchorFocus() {
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let clear: number | undefined;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const focusHash = (tries: number) => {
      if (cancelled) return;
      const id = ANCHOR.exec(window.location.hash)?.[1];
      const element = id === undefined ? null : document.getElementById(id);
      if (element === null) {
        if (id !== undefined && tries < 20) {
          timer = window.setTimeout(() => focusHash(tries + 1), 50);
        }
        return;
      }
      element.scrollIntoView({
        block: "start",
        behavior: reduced ? "auto" : "smooth",
      });
      element.setAttribute(MARK, "");
      window.clearTimeout(clear);
      clear = window.setTimeout(() => element.removeAttribute(MARK), 4_000);
    };
    focusHash(0);
    const onHash = () => focusHash(0);
    window.addEventListener("hashchange", onHash);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(clear);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  return null;
}
