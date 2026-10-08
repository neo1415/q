"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { cx } from "@capital-q/ui";

/**
 * The arrival room (Zino, 2026-10-08: "what if they appeared by the sides
 * of the Q -- right and left of Q if there are many; if there's no space,
 * bring them down"). The Q stage places a column either side of Q's
 * presence, and a place below it; the stage layer (arrival-stage.tsx)
 * puts its cards into them: beside Q on a wide screen, below otherwise.
 * Browser-only, per page.
 *
 * RECOVERY-2026-10 E1 (audit E-01): the columns exist while the person
 * talks with Q too, not only before the first word, so the cards stay
 * beside Q while it speaks. Each column has three zones, so what Q did
 * sits above the decisions and new matches below them, in a fixed order
 * whichever mounts first.
 */

type Slots = {
  /** The decisions' zone of each column (the card sequence portals here). */
  readonly left: HTMLElement | null;
  readonly right: HTMLElement | null;
  readonly leftTop: HTMLElement | null;
  readonly rightTop: HTMLElement | null;
  readonly leftBottom: HTMLElement | null;
  readonly rightBottom: HTMLElement | null;
  /** Below Q: where the cards go when there is no room beside it. */
  readonly below: HTMLElement | null;
  /** The briefing has cards in the columns (the stage widens for them). */
  readonly filled: boolean;
};

const EMPTY: Slots = {
  left: null,
  right: null,
  leftTop: null,
  rightTop: null,
  leftBottom: null,
  rightBottom: null,
  below: null,
  filled: false,
};
let slots: Slots = EMPTY;
const listeners = new Set<() => void>();

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

/** Who has cards in the columns now (the decisions, what Q did, matches). */
const fillers = new Set<string>();

/** One part of the stage says whether its cards are in the columns. */
export function setRoomFilled(filled: boolean, owner = "needs"): void {
  if (filled) fillers.add(owner);
  else fillers.delete(owner);
  const next = fillers.size > 0;
  if (slots.filled !== next) set({ filled: next });
}

/**
 * How much of the stage the cards may take right now, set by the Q page:
 * FULL beside (or below) Q; STRIP when an answer holds the centre or the
 * thread is the view, so the cards step aside into one line below Q and
 * come back when the centre is free.
 */
export type StageMode = "FULL" | "STRIP";
const StageModeContext = createContext<StageMode>("FULL");
export const StageModeProvider = StageModeContext.Provider;
export function useStageMode(): StageMode {
  return useContext(StageModeContext);
}

function useSlotRef(key: keyof Omit<Slots, "filled">) {
  return useCallback(
    (node: HTMLDivElement | null) => {
      set({ [key]: node });
    },
    [key],
  );
}

/** One column beside Q's presence; empty until the stage fills it. */
export function RoomSlot({
  side,
  className,
}: {
  readonly side: "left" | "right";
  readonly className?: string | undefined;
}) {
  const top = useSlotRef(side === "left" ? "leftTop" : "rightTop");
  const middle = useSlotRef(side);
  const bottom = useSlotRef(side === "left" ? "leftBottom" : "rightBottom");
  return (
    <div
      className={cx("flex min-w-0 flex-col gap-3", className)}
      data-q-room-slot={side}
    >
      <div ref={top} className="flex flex-col gap-3 empty:hidden" />
      <div ref={middle} className="flex flex-col gap-3 empty:hidden" />
      <div ref={bottom} className="flex flex-col gap-3 empty:hidden" />
    </div>
  );
}

/** The place below Q for the cards when the columns are not in use. */
export function RoomBelow({
  className,
}: {
  readonly className?: string | undefined;
}) {
  const ref = useSlotRef("below");
  return (
    <div
      ref={ref}
      className={cx("flex w-full flex-col gap-3 empty:hidden", className)}
      data-q-room-below
    />
  );
}

/**
 * Q's presence with a column either side. The columns take space only
 * while the briefing fills them, and only on a wide screen. `wide` gives
 * the centre a reading width (the stage while conversing) rather than
 * the presence's own size.
 */
export function ArrivalRoom({
  children,
  wide = false,
}: {
  readonly children: ReactNode;
  readonly wide?: boolean | undefined;
}) {
  const { filled } = useRoomSlots();
  return (
    <div
      className={cx(
        "flex w-full flex-col items-center",
        filled &&
          (wide
            ? "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,40rem)_minmax(0,1fr)] lg:items-start lg:gap-8"
            : "lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-8"),
      )}
      data-q-room={filled ? "filled" : "empty"}
    >
      <RoomSlot side="left" className="hidden lg:flex" />
      <div
        className={cx(
          "flex flex-col items-center gap-6",
          wide && "w-full min-w-0",
        )}
      >
        {children}
      </div>
      <RoomSlot side="right" className="hidden lg:flex" />
    </div>
  );
}
