"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";

import type { QControlKind } from "@capital-q/contracts";

import { registerControl, type ControlHandler } from "./registry";

/**
 * RECOVERY-2026-10 (C1): registers one of the page's own controls for Q,
 * by a stable semantic id ("tab.readiness", "section.risks",
 * "list.investors"), while it is mounted.
 *
 * Registration only: the control looks and behaves exactly as before, and
 * Q's act runs through the element's own click (or `onAct`, the page's own
 * handler, for acts a click cannot express, such as a filter's value).
 * Ids are code's names, never page text; they must be string literals so
 * the capability parity matrix (scripts/recovery/capability-parity.mjs)
 * can list them.
 */
export function useQControl({
  id,
  kind,
  ref,
  onAct,
  count,
}: {
  readonly id: string;
  readonly kind: QControlKind;
  readonly ref: RefObject<HTMLElement | null>;
  readonly onAct?: ControlHandler | undefined;
  /** LIST: the page's own count, when the DOM holds only the first few. */
  readonly count?: number | undefined;
}): void {
  // The latest handler and count, without re-registering on every render.
  const latest = useRef({ onAct, count });
  useEffect(() => {
    latest.current = { onAct, count };
  });
  useEffect(
    () =>
      registerControl({
        id,
        kind,
        element: () => ref.current,
        onAct: (intent) =>
          latest.current.onAct === undefined
            ? "NOT_APPLICABLE"
            : latest.current.onAct(intent),
        count: () => latest.current.count,
      }),
    [id, kind, ref],
  );
}

/**
 * The same, around a part a server component renders: a `display:
 * contents` marker (no box, so no layout change) whose act goes to the
 * first interactive element inside it -- a tab's link, a menu's button --
 * or, for a section or list, the part itself.
 */
export function QControl({
  id,
  kind,
  count,
  children,
}: {
  readonly id: string;
  readonly kind: QControlKind;
  readonly count?: number | undefined;
  readonly children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useQControl({ id, kind, ref, count });
  return (
    <div ref={ref} data-q-control={id} className="contents">
      {children}
    </div>
  );
}
