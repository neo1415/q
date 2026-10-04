"use client";

import dynamic from "next/dynamic";
import { useRef, type ReactNode } from "react";

import { useInView } from "./use-in-view";

/**
 * The landing's three client islands, each a separate chunk fetched only
 * when its section nears the viewport. Until then the server HTML holds a
 * box of the same size, so loading one never shifts the page.
 */

const HeroPresence = dynamic(
  () => import("./hero-presence").then((m) => m.HeroPresence),
  { ssr: false },
);
const WatchQWork = dynamic(
  () => import("./watch-q-work").then((m) => m.WatchQWork),
  { ssr: false },
);
const GateQDemo = dynamic(
  () => import("./gateq-demo-form").then((m) => m.GateQDemoForm),
  { ssr: false },
);

const ThemeToggle = dynamic(
  () => import("../appearance/theme-toggle").then((m) => m.ThemeToggle),
  { ssr: false },
);

/** The demos fetch a screen or so ahead, so a fast scroll meets them ready. */
const AHEAD = "1200px 0px";

function Island({
  className,
  rootMargin,
  fallback,
  children,
}: {
  readonly className: string;
  readonly rootMargin?: string;
  readonly fallback?: ReactNode;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, rootMargin === undefined ? {} : { rootMargin });
  return (
    <div ref={ref} className={className} data-island-loaded={seen || undefined}>
      {seen ? children : fallback}
    </div>
  );
}

/** Q, beside the headline. Decorative: the headline carries the meaning. */
export function HeroPresenceIsland() {
  return (
    <Island
      className="cq-landing-presence"
      fallback={
        <span className="cq-landing-presence-rest" aria-hidden="true" />
      }
    >
      <HeroPresence />
    </Island>
  );
}

export function WatchQWorkIsland({
  fallback,
}: {
  readonly fallback: ReactNode;
}) {
  return (
    <Island className="cq-landing-watch" rootMargin={AHEAD} fallback={fallback}>
      <WatchQWork />
    </Island>
  );
}

export function GateQDemoIsland({
  fallback,
}: {
  readonly fallback: ReactNode;
}) {
  return (
    <Island className="cq-landing-gateq" rootMargin={AHEAD} fallback={fallback}>
      <GateQDemo />
    </Island>
  );
}

/**
 * The visible theme choice (ADR 0017 F4), in the footer. Its tooltips
 * bring a popover library, so it loads with the footer, not the hero.
 */
export function ThemeToggleIsland() {
  return (
    <Island className="cq-landing-theme">
      <ThemeToggle display="icons" size="touch" />
    </Island>
  );
}
