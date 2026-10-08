"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";

import { cx } from "@capital-q/ui";

/**
 * The arrival room (Zino, 2026-10-08: "what if they appeared by the sides
 * of the Q -- right and left of Q if there are many; if there's no space,
 * bring them down"). The Q stage places two empty columns either side of
 * Q's presence; the briefing, wherever it is rendered, puts its cards into
 * them on a wide screen and below Q otherwise. Browser-only, per page.
 */

type Slots = {
  readonly left: HTMLElement | null;
  readonly right: HTMLElement | null;
  /** The briefing has cards in the columns (the stage widens for them). */
  readonly filled: boolean;
};

let slots: Slots = { left: null, right: null, filled: false };
const listeners = new Set<() => void>();
const EMPTY: Slots = { left: null, right: null, filled: false };

function set(next: Partial<Slots>): void {
  slots = { ...slots, ...next };
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function useRoomSlots(): Slots {
  return useSyncExternalStore(
    subscribe,
    () => slots,
    () => EMPTY,
  );
}

/** The briefing says whether its cards are in the columns. */
export function setRoomFilled(filled: boolean): void {
  if (slots.filled !== filled) set({ filled });
}

/** One column beside Q's presence; empty until the briefing fills it. */
export function RoomSlot({
  side,
  className,
}: {
  readonly side: "left" | "right";
  readonly className?: string | undefined;
}) {
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      set(side === "left" ? { left: node } : { right: node });
    },
    [side],
  );
  return (
    <div
      ref={ref}
      className={cx("flex min-w-0 flex-col gap-3", className)}
      data-q-room-slot={side}
    />
  );
}

/**
 * Q's presence with a column either side. The columns take space only
 * while the briefing fills them, and only on a wide screen.
 */
export function ArrivalRoom({ children }: { readonly children: ReactNode }) {
  const { filled } = useRoomSlots();
  return (
    <div
      className={cx(
        "flex w-full flex-col items-center",
        filled &&
          "lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-8",
      )}
      data-q-room={filled ? "filled" : "empty"}
    >
      <RoomSlot side="left" className="hidden lg:flex" />
      <div className="flex flex-col items-center gap-6">{children}</div>
      <RoomSlot side="right" className="hidden lg:flex" />
    </div>
  );
}
