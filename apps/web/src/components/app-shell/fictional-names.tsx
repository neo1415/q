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
 * showed a marked name. Runs after hydration, so the server's HTML and
 * React's agree; later text (a streamed answer, a loaded list) is handled
 * as it arrives.
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

/** Strips the mark from text under `root`; true if any was found. */
export function stripFictionalMarks(root: Node): boolean {
  let found = false;
  const visit = (node: Node) => {
    const value = node.nodeValue;
    if (value === null || !/\(fictional\)/i.test(value) || skip(node)) return;
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
  return document.querySelector("main [data-fictional]") !== null;
}

/**
 * The page's text is the store: subscribing strips what is there and
 * watches what arrives (a streamed answer, a loaded list, a navigation).
 */
function subscribe(onChange: () => void): () => void {
  stripFictionalMarks(document.body);
  onChange();
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
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => observer.disconnect();
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
