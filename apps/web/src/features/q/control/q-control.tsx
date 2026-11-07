"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";

import type { QControlKind } from "@capital-q/contracts";

import type { ApprovalAction, ApprovalClass } from "./approval";
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
  approval,
  confirmSummary,
  action,
}: {
  readonly id: string;
  readonly kind: QControlKind;
  readonly ref: RefObject<HTMLElement | null>;
  readonly onAct?: ControlHandler | undefined;
  /** LIST: the page's own count, when the DOM holds only the first few. */
  readonly count?: number | undefined;
  /**
   * W5.1: what acting on it means (approval.ts). A button, toggle, input
   * or list item without one is never operated by Q.
   */
  readonly approval?: ApprovalClass | undefined;
  /** CONFIRM: what the person confirms, in the page's words. */
  readonly confirmSummary?: (() => string) | undefined;
  /** APPROVAL: what Q prepares for the person's approval. */
  readonly action?: ApprovalAction | undefined;
}): void {
  // The latest handler and count, without re-registering on every render.
  const latest = useRef({ onAct, count, confirmSummary, action });
  useEffect(() => {
    latest.current = { onAct, count, confirmSummary, action };
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
        approval,
        confirmSummary: () =>
          latest.current.confirmSummary?.() ??
          "Q would like to do this on the page.",
        // The action as it is now: its prepare() reads the page's latest draft.
        ...(action === undefined
          ? {}
          : {
              action: {
                id: action.id,
                summary: (payload) =>
                  (latest.current.action ?? action).summary(payload),
                prepare: () => (latest.current.action ?? action).prepare(),
                execute: (payload, key) =>
                  (latest.current.action ?? action).execute(payload, key),
              },
            }),
      }),
    // A change of class re-registers; the action's own changes are read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `action` is read through `latest`
    [id, kind, ref, approval, action === undefined],
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
  approval,
}: {
  readonly kind: QControlKind;
  readonly ref: RefObject<HTMLElement | null>;
  readonly ids: Readonly<Record<string, string>>;
  /** W5.1: one class for every control in the group (approval.ts). */
  readonly approval?: ApprovalClass | undefined;
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
        approval,
      }),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [key, kind, ref, approval]);
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
  approval,
  children,
}: {
  readonly id: string;
  readonly kind: QControlKind;
  readonly count?: number | undefined;
  /** W5.1: required for a clickable kind (approval.ts). */
  readonly approval?: ApprovalClass | undefined;
  readonly children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useQControl({ id, kind, ref, count, approval });
  return (
    <div ref={ref} data-q-control={id} className="contents">
      {children}
    </div>
  );
}
