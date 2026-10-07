"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

import type { QScreenRoute } from "@capital-q/contracts";
import { Eye, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import { manifestVersion, seeingNow, subscribeManifest } from "./manifest";
import { screenOf } from "./screen";

/**
 * Q room R1: a subtle "Q can see: …" line on the Q page and in the dock,
 * so the person knows what Q is looking at. Built from the page's own
 * labels in this browser; what Q itself receives is ids only.
 */

const ROUTE_WORDS: Readonly<Record<QScreenRoute, string>> = {
  HOME: "Q room",
  DISCOVER: "Discover",
  CAPITAL: "Capital",
  PROFILE: "your profile",
  COMPANY_VISIBILITY: "visibility",
  COMPANY_INTEREST: "investor interest",
  COMPANY: "a company profile",
  PITCH: "your pitch",
  RELATIONSHIPS: "Relationships",
  RELATIONSHIP_COMPANY: "a relationship",
  RELATIONSHIP_INVESTOR: "a relationship",
  VERIFICATION: "Verification",
  ONBOARDING: "setup",
  DAILY: "The Q Daily",
  DOCUMENTS: "your documents",
  WORK: "Work",
  OTHER: "this page",
};

/**
 * W7: what the page itself changes -- a part hidden from Q or shown again,
 * a window opened or closed that no code registered -- is seen from the
 * DOM's own mutations, not a timer. Only these attributes are watched.
 */
const WATCHED_ATTRIBUTES = [
  "data-q-hidden",
  "hidden",
  "role",
  "aria-label",
  "aria-labelledby",
];
const RELEVANT = '[data-q-hidden], [role="dialog"], [role="alertdialog"]';

/** Whether a DOM change can change the line (cheap: no layout read). */
export function seeingMutation(record: MutationRecord): boolean {
  if (record.type === "attributes") return true;
  for (const list of [record.addedNodes, record.removedNodes]) {
    for (const node of list) {
      if (!(node instanceof Element)) continue;
      if (node.matches(RELEVANT) || node.querySelector(RELEVANT) !== null) {
        return true;
      }
    }
  }
  return false;
}

export function seeingLine(
  route: QScreenRoute,
  parts: readonly string[],
  window: string | null,
): string {
  const shown =
    parts.length === 0 && route === "HOME" ? ["nothing open"] : parts;
  return [
    ROUTE_WORDS[route],
    ...shown.slice(0, 3),
    ...(shown.length > 3 ? [`${String(shown.length - 3)} more`] : []),
    ...(window === null ? [] : [`window: ${window}`]),
  ].join(" · ");
}

/** Moves when the page is looked at again for windows (R9: memo key). */
let look = 0;

function subscribeSeeing(onChange: () => void): () => void {
  const stop = subscribeManifest(onChange);
  // W7: a relevant mutation is looked at once on the next frame (many
  // mutations in one frame are one look), so a hidden part or a window
  // shows in the line at once rather than up to 1.5 s later.
  let frame: number | null = null;
  const lookAgain = () => {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      look += 1;
      onChange();
    });
  };
  const observer =
    typeof MutationObserver === "function"
      ? new MutationObserver((records) => {
          if (records.some(seeingMutation)) lookAgain();
        })
      : null;
  observer?.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: WATCHED_ATTRIBUTES,
  });
  return () => {
    stop();
    observer?.disconnect();
    if (frame !== null) window.cancelAnimationFrame(frame);
  };
}

/** The line, read from the page once per change, not once per render. */
let memo: { readonly key: string; readonly line: string } | null = null;

function seeingSnapshot(pathname: string): string {
  const key = `${String(manifestVersion())}:${String(look)}:${pathname}`;
  if (memo?.key !== key) {
    const now = seeingNow();
    memo = {
      key,
      line: seeingLine(screenOf(pathname).route, now.parts, now.window),
    };
  }
  return memo.line;
}

export function QCanSee({ className }: { readonly className?: string }) {
  const pathname = usePathname();
  // The line is a string, so React compares it by value: it re-renders
  // only when what Q can see has changed. Nothing on the server render.
  const line = useSyncExternalStore(
    subscribeSeeing,
    () => seeingSnapshot(pathname),
    () => null,
  );
  if (line === null) return null;
  return (
    <p
      className={`cq-caption flex min-w-0 items-center gap-1.5 text-(--cq-text-tertiary) ${className ?? ""}`}
      data-q-self
      data-q-can-see
    >
      <Eye
        aria-hidden="true"
        size={ICON_SIZE.compact}
        strokeWidth={ICON_STROKE}
        className="flex-none"
      />
      <span className="flex-none">Q can see:</span>
      <span className="min-w-0 truncate">{line}</span>
    </p>
  );
}
