"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

import type { QScreenRoute } from "@capital-q/contracts";
import { Eye, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import { seeingNow, subscribeManifest } from "./manifest";
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

/** Open windows are found in the page itself; looked at again this often. */
const WINDOW_LOOK_MS = 1_500;

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

function subscribeSeeing(onChange: () => void): () => void {
  const stop = subscribeManifest(onChange);
  const timer = window.setInterval(onChange, WINDOW_LOOK_MS);
  return () => {
    stop();
    window.clearInterval(timer);
  };
}

export function QCanSee({ className }: { readonly className?: string }) {
  const pathname = usePathname();
  // The line is a string, so React compares it by value: it re-renders
  // only when what Q can see has changed. Nothing on the server render.
  const line = useSyncExternalStore(
    subscribeSeeing,
    () => {
      const now = seeingNow();
      return seeingLine(screenOf(pathname).route, now.parts, now.window);
    },
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
