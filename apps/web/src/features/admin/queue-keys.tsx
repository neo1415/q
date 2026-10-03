"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Keyboard review for an admin queue (design-48; Linear triage): J and K
 * move between items, and a letter presses the current item's decision
 * button that carries it (data-shortcut). The button only opens its
 * dialog: every decision still needs its written basis and a confirm, so
 * a stray key decides nothing. Keys are ignored while typing, with a
 * modifier, or while a dialog is open.
 */
export function QueueKeys({
  hint,
  children,
}: {
  /** What each key does here, shown on large screens. */
  readonly hint: string;
  readonly children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const currentRef = useRef(0);

  useEffect(() => {
    const items = () => [
      ...(root.current?.querySelectorAll<HTMLElement>("[data-queue-item]") ??
        []),
    ];
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      if (document.querySelector("[role=dialog]") !== null) return;
      const list = items();
      if (list.length === 0) return;
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") {
        event.preventDefault();
        const next = Math.min(
          list.length - 1,
          Math.max(0, currentRef.current + (key === "j" ? 1 : -1)),
        );
        currentRef.current = next;
        setCurrent(next);
        const item = list[next];
        item?.focus();
        item?.scrollIntoView({ block: "nearest" });
        return;
      }
      const button = list[
        Math.min(currentRef.current, list.length - 1)
      ]?.querySelector<HTMLButtonElement>(`button[data-shortcut="${key}"]`);
      if (button !== null && button !== undefined && !button.disabled) {
        event.preventDefault();
        button.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Marks the current item for sight as well as for assistive tech.
  useEffect(() => {
    const list = [
      ...(root.current?.querySelectorAll<HTMLElement>("[data-queue-item]") ??
        []),
    ];
    list.forEach((item, index) => {
      if (index === current) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    });
  }, [current, children]);

  return (
    <div ref={root} className="flex flex-col gap-3" data-queue-keys>
      <p className="cq-caption text-(--cq-text-tertiary) max-lg:hidden">
        {hint}
      </p>
      {children}
    </div>
  );
}

/**
 * The decisions for one item: a bar that stays above the bottom navigation
 * on a phone while its item is on screen, and a plain row on a large
 * screen.
 */
export function DecisionBar({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className="flex gap-2 max-lg:sticky max-lg:bottom-[calc(var(--cq-bottom-nav-height)+var(--cq-safe-bottom)+0.5rem)] max-lg:z-(--cq-z-sticky) max-lg:rounded-(--cq-radius-lg) max-lg:border max-lg:border-(--cq-border-subtle) max-lg:bg-(--cq-surface-raised) max-lg:p-2 max-lg:shadow-(--cq-shadow-sm) lg:flex-wrap"
      data-decision-bar
    >
      {children}
    </div>
  );
}

/** The item wrapper's attributes: focusable for J/K, marked when current. */
export const QUEUE_ITEM = {
  "data-queue-item": "",
  tabIndex: -1,
  className:
    "outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--cq-focus-ring) aria-[current=true]:lg:border-l-2 aria-[current=true]:lg:border-(--cq-accent) aria-[current=true]:lg:pl-3",
} as const;
