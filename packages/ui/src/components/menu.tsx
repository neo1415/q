"use client";

import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactElement, ReactNode } from "react";

import { cx } from "../primitives/class-names.js";

/**
 * Dropdown menu on Base UI. Keyboard navigation, typeahead, focus return and
 * escape handling come from the primitive; Capital Q supplies the surface.
 */

export function MenuRoot({ children }: { readonly children: ReactNode }) {
  return <BaseMenu.Root>{children}</BaseMenu.Root>;
}

export function MenuTrigger({ children }: { readonly children: ReactElement }) {
  return <BaseMenu.Trigger render={children} />;
}

export function MenuContent({
  children,
  align = "start",
  className,
}: {
  readonly children: ReactNode;
  readonly align?: "start" | "center" | "end" | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        align={align}
        sideOffset={6}
        className="z-(--cq-z-popover)"
      >
        <BaseMenu.Popup
          className={cx(
            "min-w-48 rounded-md border border-(--cq-border) bg-(--cq-surface-raised) p-1 shadow-(--cq-shadow-overlay) outline-none transition-[opacity,transform] duration-(--cq-motion-fast) data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0",
            className,
          )}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export function MenuItem({
  children,
  onClick,
  disabled,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly onClick?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
  readonly tone?: "neutral" | "danger" | undefined;
}) {
  return (
    <BaseMenu.Item
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "flex min-h-10 cursor-default select-none items-center gap-2 rounded-sm px-2.5 cq-body-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-(--cq-surface-subtle)",
        tone === "danger" ? "text-(--cq-danger)" : "text-(--cq-text-primary)",
      )}
    >
      {children}
    </BaseMenu.Item>
  );
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="my-1 h-px bg-(--cq-border-subtle)" />;
}
