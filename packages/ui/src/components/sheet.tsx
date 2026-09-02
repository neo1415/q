"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ReactElement, ReactNode } from "react";

import { ICON_SIZE, ICON_STROKE, X } from "../icons/index.js";
import { cx } from "../primitives/class-names.js";
import { IconButton } from "./button.js";

/**
 * Sheet on Base UI's modal dialog. Mobile-first: a bottom sheet with
 * safe-area padding by default, a full-height sheet for deeper content, and
 * a side panel that only exists from the desktop breakpoint up -- a desktop
 * drawer is never squeezed onto a phone.
 */

export type SheetSide = "bottom" | "full" | "side";

export function SheetRoot({
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

export function SheetTrigger({
  children,
}: {
  readonly children: ReactElement;
}) {
  return <BaseDialog.Trigger render={children} />;
}

const sideClass: Record<SheetSide, string> = {
  bottom:
    "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full",
  full: "inset-0 data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full",
  side: "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full lg:inset-y-0 lg:right-0 lg:left-auto lg:h-full lg:max-h-none lg:w-[420px] lg:rounded-none lg:rounded-l-xl lg:data-[ending-style]:translate-x-full lg:data-[ending-style]:translate-y-0 lg:data-[starting-style]:translate-x-full lg:data-[starting-style]:translate-y-0",
};

export function SheetContent({
  title,
  description,
  side = "bottom",
  children,
  className,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly side?: SheetSide | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-(--cq-z-sheet) bg-(--cq-overlay) transition-opacity duration-(--cq-motion-base) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <BaseDialog.Popup
        className={cx(
          "fixed z-(--cq-z-sheet) flex flex-col overflow-hidden bg-(--cq-surface-raised) pb-(--cq-safe-bottom) shadow-(--cq-shadow-overlay) outline-none transition-transform duration-(--cq-motion-slow) ease-(--cq-ease)",
          sideClass[side],
          className,
        )}
      >
        <div className="flex items-start gap-3 px-4 pt-4 pb-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <BaseDialog.Title className="cq-title-md text-(--cq-text-primary)">
              {title}
            </BaseDialog.Title>
            {description !== undefined ? (
              <BaseDialog.Description className="cq-body-sm text-(--cq-text-secondary)">
                {description}
              </BaseDialog.Description>
            ) : null}
          </div>
          <BaseDialog.Close
            render={
              <IconButton aria-label="Close" variant="quiet">
                <X
                  aria-hidden="true"
                  size={ICON_SIZE.prominent}
                  strokeWidth={ICON_STROKE}
                />
              </IconButton>
            }
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {children}
        </div>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function SheetClose({ children }: { readonly children: ReactElement }) {
  return <BaseDialog.Close render={children} />;
}
