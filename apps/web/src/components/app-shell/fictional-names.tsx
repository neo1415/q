"use client";

import { useSyncExternalStore } from "react";

/**
 * Demo data names every invented company and person "… (fictional)"
 * (seed rule: fictional accounts only). Repeated in every name it read as
 * noise (demo audit 2026-10-03); the founder chose to say it once, at the
 * foot of the page.
 *
 * Display only: the stored names are unchanged, inputs and editable text
 * are left alone, and the note appears only on a page that actually
 * showed a marked name.
 *
 * Only text React has already hydrated is touched (QA demo pass: React
 * error #418 on Capital, Rehearsals, interest, a company profile and
 * Discover -- the shell hydrated first, then this stripped names in a
 * streamed part of the page React had not hydrated yet, so the server's
 * text no longer matched). Text not yet hydrated is left until it is, and
 * swept again shortly after.
 */
export const FICTIONAL_MARK = /\s*\(fictional\)/gi;

export function withoutFictionalMark(text: string): string {
  return text.replace(FICTIONAL_MARK, "");
}

function skip(node: Node): boolean {
  for (let at = node.parentElement; at !== null; at = at.parentElement) {
    if (at.isContentEditable) return true;
    const tag = at.tagName;
    if (tag === "TEXTAREA" || tag === "SCRIPT" || tag === "STYLE") return true;
  }
  return false;
}

/**
 * Whether React has taken this element over: hydrated from the server's
 * HTML, or rendered on the client. React keys its instance on the element
 * itself; server HTML it has not hydrated yet carries none.
 */
export function hydratedByReact(element: Element | null): boolean {
  if (element === null) return false;
  for (const key in element) {
    if (key.startsWith("__reactFiber$")) return true;
  }
  return false;
}

/** Marked text React has not hydrated yet: left for a later sweep. */
let waiting = false;

/** Strips the mark from text under `root`; true if any was found. */
export function stripFictionalMarks(root: Node): boolean {
  let found = false;
  const visit = (node: Node) => {
    const value = node.nodeValue;
    if (value === null || !/\(fictional\)/i.test(value) || skip(node)) return;
    // Never ahead of hydration: changing server HTML React has yet to
    // hydrate makes its text disagree with the server's (error #418).
    if (!hydratedByReact(node.parentElement)) {
      waiting = true;
      return;
    }
    node.nodeValue = withoutFictionalMark(value);
    // Marked so the note knows a name on this page carried it, even after
    // the text itself no longer does.
    node.parentElement?.setAttribute("data-fictional", "");
    found = true;
  };
  if (root.nodeType === Node.TEXT_NODE) {
    visit(root);
    return found;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    visit(node);
  }
  return found;
}

/** Whether the page in view shows a name that carried the mark. */
function pageShowsOne(): boolean {
  return (
    document.querySelector(
      "main [data-fictional], [data-fictional-scope] [data-fictional]",
    ) !== null
  );
}

/**
 * The page's text is the store: subscribing strips what is there and
 * watches what arrives (a streamed answer, a loaded list, a navigation).
 */
const SWEEP_MS = 250;
const SWEEPS_MAX = 40;

function subscribe(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sweeps = 0;
  // Hydration itself changes no text, so text left waiting is swept again
  // shortly, a bounded number of times after each change.
  const sweep = () => {
    timer = null;
    waiting = false;
    stripFictionalMarks(document.body);
    onChange();
    if (waiting && sweeps < SWEEPS_MAX) {
      sweeps += 1;
      timer = setTimeout(sweep, SWEEP_MS);
    }
  };
  const soon = () => {
    sweeps = 0;
    if (timer === null) timer = setTimeout(sweep, SWEEP_MS);
  };
  sweep();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") {
        stripFictionalMarks(record.target);
      }
      for (const added of record.addedNodes) {
        stripFictionalMarks(added);
      }
    }
    // Navigation replaces the page: the note follows what is shown now.
    onChange();
    if (waiting) soon();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => {
    observer.disconnect();
    if (timer !== null) clearTimeout(timer);
  };
}

export function FictionalNames() {
  const seen = useSyncExternalStore(subscribe, pageShowsOne, () => false);
  if (!seen) return null;
  return (
    <p
      className="cq-caption px-4 pt-6 pb-4 text-center text-(--cq-text-tertiary)"
      data-fictional-note
    >
      Companies, investors and people named here are fictional, for
      demonstration.
    </p>
  );
}
