"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ReactElement, ReactNode } from "react";

import { cx } from "../primitives/class-names.js";

/** Popover on Base UI, for small contextual detail anchored to a control. */

export function PopoverRoot({ children }: { readonly children: ReactNode }) {
  return <BasePopover.Root>{children}</BasePopover.Root>;
}

export function PopoverTrigger({
  children,
}: {
  readonly children: ReactElement;
}) {
  return <BasePopover.Trigger render={children} />;
}

export function PopoverContent({
  title,
  children,
  className,
}: {
  readonly title?: string | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner sideOffset={8} className="z-(--cq-z-popover)">
        <BasePopover.Popup
          className={cx(
            "w-72 max-w-[calc(100vw-32px)] rounded-lg border border-(--cq-border) bg-(--cq-surface-raised) p-4 shadow-(--cq-shadow-overlay) outline-none transition-[opacity,transform] duration-(--cq-motion-base) data-[ending-style]:translate-y-1 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-1 data-[starting-style]:opacity-0",
            className,
          )}
        >
          {title !== undefined ? (
            <BasePopover.Title className="cq-body pb-1 font-medium text-(--cq-text-primary)">
              {title}
            </BasePopover.Title>
          ) : null}
          <div className="cq-body-sm text-(--cq-text-secondary)">
            {children}
          </div>
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}
