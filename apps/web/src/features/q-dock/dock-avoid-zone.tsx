"use client";

import { useRef, type ReactNode } from "react";

import { useDockAvoid } from "./dock-avoid";

/**
 * A server-rendered group of controls registered with the dock (ADR 0017
 * F1): the dock never covers what is inside.
 */
export function DockAvoidZone({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDockAvoid(ref);
  return (
    <div ref={ref} className={className} data-dock-avoid>
      {children}
    </div>
  );
}
