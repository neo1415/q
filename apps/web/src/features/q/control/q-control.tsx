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
 * the capability parity matrix (scripts/capability-parity/generate.mjs)
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
 * Several controls of one part at once -- a tab bar's tabs -- each found
 * in the part by the page's own marker, so the bar's markup is untouched.
 * `ids` maps each control id to the selector of its element inside `ref`.
 */
export function useQControlGroup({
  kind,
  ref,
  ids,
}: {
  readonly kind: QControlKind;
  readonly ref: RefObject<HTMLElement | null>;
  readonly ids: Readonly<Record<string, string>>;
}): void {
  const key = JSON.stringify(ids);
  useEffect(() => {
    const entries = Object.entries(JSON.parse(key) as Record<string, string>);
    const stops = entries.map(([id, selector]) =>
      registerControl({
        id,
        kind,
        element: () =>
          ref.current?.querySelector<HTMLElement>(selector) ?? null,
      }),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [key, kind, ref]);
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
