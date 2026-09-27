"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import {
  useRef,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { cx } from "../primitives/class-names.js";

/**
 * Centred modal dialog on Base UI, for decisions that need the user's full
 * attention (an approval, a confirmation). Focus is trapped and returned by
 * the primitive; Escape closes. On phones it fills the width comfortably
 * rather than shrinking to a desktop modal.
 */

export function DialogRoot({
  children,
  open,
  onOpenChange,
}: {
  readonly children: ReactNode;
  readonly open?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </BaseDialog.Root>
  );
}

export function DialogTrigger({
  children,
}: {
  readonly children: ReactElement;
}) {
  return <BaseDialog.Trigger render={children} />;
}

export function DialogContent({
  title,
  description,
  children,
  actions,
  className,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly children?: ReactNode | undefined;
  readonly actions?: ReactNode | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-(--cq-z-modal) bg-(--cq-overlay) transition-opacity duration-(--cq-motion-base) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <BaseDialog.Popup
        className={cx(
          "fixed top-1/2 left-1/2 z-(--cq-z-modal) flex w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5 shadow-(--cq-shadow-overlay) outline-none transition-[opacity,transform] duration-(--cq-motion-base) data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0",
          className,
        )}
      >
        <div className="flex flex-col gap-1">
          <BaseDialog.Title className="cq-title-md text-(--cq-text-primary)">
            {title}
          </BaseDialog.Title>
          {description !== undefined ? (
            <BaseDialog.Description className="cq-body-sm text-(--cq-text-secondary)">
              {description}
            </BaseDialog.Description>
          ) : null}
        </div>
        {children !== undefined ? (
          <div className="cq-body-sm text-(--cq-text-primary)">{children}</div>
        ) : null}
        {actions !== undefined ? (
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            {actions}
          </div>
        ) : null}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

/**
 * Whether a downward drag on a phone sheet should close it.
 *
 * Distance or speed, not distance alone: a quick flick is as clear an
 * intent as a long pull, and making somebody drag a third of the screen to
 * close something is the sheet arguing with them. Upward and sideways
 * movement never closes.
 */
export const SWIPE_DISMISS_DISTANCE = 120;
export const SWIPE_DISMISS_VELOCITY = 0.5; // px per ms

export function shouldSwipeDismiss(dy: number, elapsedMs: number): boolean {
  if (dy <= 0) return false;
  if (dy >= SWIPE_DISMISS_DISTANCE) return true;
  return elapsedMs > 0 && dy >= 24 && dy / elapsedMs >= SWIPE_DISMISS_VELOCITY;
}

const PHONE = "(max-width: 639px)";

function isPhone(): boolean {
  try {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia(PHONE).matches
    );
  } catch {
    return false;
  }
}

/**
 * A large reading modal (a document, a deck): nearly the whole viewport on
 * a large screen, the whole screen as a sheet on a phone. The content
 * supplies its own heading and close control; the title is still given to
 * assistive technology. Escape and the backdrop close it, and the
 * primitive traps focus, locks the page's scroll and returns focus to the
 * control that opened it.
 *
 * With `onSwipeDismiss`, a phone can also pull it down to close, from the
 * handle or from any part of the content marked `data-cq-sheet-drag` (the
 * viewer's header). Only there, so reading and scrolling the document is
 * never mistaken for a dismissal. The sheet follows the finger; under
 * reduced motion the snap back and the exit are instant (global rule).
 */
export function DialogViewerContent({
  title,
  children,
  className,
  onSwipeDismiss,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly onSwipeDismiss?: (() => void) | undefined;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    readonly id: number;
    readonly y: number;
    readonly at: number;
    dy: number;
  } | null>(null);

  const setOffset = (dy: number, settle: boolean) => {
    const popup = popupRef.current;
    if (popup === null) return;
    popup.style.transition = settle ? "" : "none";
    popup.style.transform = dy === 0 ? "" : `translateY(${String(dy)}px)`;
  };

  const swipe =
    onSwipeDismiss === undefined
      ? {}
      : {
          onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
            if (!isPhone() || event.button !== 0) return;
            const target = event.target;
            if (
              !(target instanceof Element) ||
              target.closest("[data-cq-sheet-drag]") === null ||
              target.closest("button, a, input, select, textarea") !== null
            ) {
              return;
            }
            drag.current = {
              id: event.pointerId,
              y: event.clientY,
              at: event.timeStamp,
              dy: 0,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          },
          onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
            const active = drag.current;
            if (active?.id !== event.pointerId) return;
            active.dy = Math.max(0, event.clientY - active.y);
            setOffset(active.dy, false);
          },
          onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
            const active = drag.current;
            if (active?.id !== event.pointerId) return;
            drag.current = null;
            if (shouldSwipeDismiss(active.dy, event.timeStamp - active.at)) {
              onSwipeDismiss();
            } else {
              setOffset(0, true);
            }
          },
          onPointerCancel: () => {
            drag.current = null;
            setOffset(0, true);
          },
        };

  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-(--cq-z-modal) bg-(--cq-overlay) transition-opacity duration-(--cq-motion-base) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <BaseDialog.Popup
        ref={popupRef}
        {...swipe}
        className={cx(
          // Phone: the whole screen, rising from the bottom edge it can be
          // pulled back down to.
          "fixed inset-0 z-(--cq-z-modal) flex flex-col overflow-hidden bg-(--cq-surface-raised) outline-none transition-[opacity,transform,translate,scale] duration-(--cq-motion-emphasis) ease-(--cq-ease) data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full",
          // Larger screens: a centred reading modal.
          "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[calc(100dvh-64px)] sm:w-[calc(100vw-64px)] sm:max-w-5xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:shadow-(--cq-shadow-overlay) sm:duration-(--cq-motion-base) sm:data-[ending-style]:-translate-y-1/2 sm:data-[ending-style]:scale-[0.98] sm:data-[ending-style]:opacity-0 sm:data-[starting-style]:-translate-y-1/2 sm:data-[starting-style]:scale-[0.98] sm:data-[starting-style]:opacity-0",
          className,
        )}
      >
        <BaseDialog.Title className="sr-only">{title}</BaseDialog.Title>
        {onSwipeDismiss === undefined ? null : (
          <div
            aria-hidden="true"
            data-cq-sheet-drag
            className="flex h-5 shrink-0 touch-none items-center justify-center sm:hidden"
          >
            <span className="h-1 w-10 rounded-full bg-(--cq-border-strong)" />
          </div>
        )}
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogClose({ children }: { readonly children: ReactElement }) {
  return <BaseDialog.Close render={children} />;
}
