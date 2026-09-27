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
  layer = "page",
}: {
  readonly children: ReactNode;
  readonly align?: "start" | "center" | "end" | undefined;
  readonly className?: string | undefined;
  /**
   * `modal` for a menu opened from inside a dialog: the menu is portalled
   * to the body, so on the page layer it would open behind the dialog.
   */
  readonly layer?: "page" | "modal" | undefined;
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        align={align}
        sideOffset={6}
        className={
          layer === "modal" ? "z-(--cq-z-modal-popover)" : "z-(--cq-z-popover)"
        }
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
        "flex min-h-11 cursor-default select-none items-center gap-2 rounded-sm px-2.5 cq-body-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-(--cq-surface-subtle)",
        tone === "danger" ? "text-(--cq-danger)" : "text-(--cq-text-primary)",
      )}
    >
      {children}
    </BaseMenu.Item>
  );
}

/**
 * A one-of-several choice inside a menu (the theme, for instance): radio
 * semantics, so assistive technology hears which option is current, and
 * a check mark beside it, so the choice never rests on colour alone.
 */
export function MenuRadioGroup({
  value,
  onValueChange,
  children,
  label,
}: {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly children: ReactNode;
  readonly label?: string | undefined;
}) {
  return (
    <BaseMenu.RadioGroup
      value={value}
      onValueChange={(next: unknown) => {
        if (typeof next === "string") onValueChange(next);
      }}
      aria-label={label}
    >
      {children}
    </BaseMenu.RadioGroup>
  );
}

export function MenuRadioItem({
  value,
  children,
  indicator,
}: {
  readonly value: string;
  readonly children: ReactNode;
  /** The mark shown beside the current option. */
  readonly indicator: ReactNode;
}) {
  return (
    <BaseMenu.RadioItem
      value={value}
      closeOnClick
      className="flex min-h-11 cursor-default select-none items-center gap-2 rounded-sm px-2.5 cq-body-sm text-(--cq-text-primary) outline-none data-[highlighted]:bg-(--cq-surface-subtle)"
    >
      {children}
      <BaseMenu.RadioItemIndicator className="ml-auto inline-flex text-(--cq-text-primary)">
        {indicator}
      </BaseMenu.RadioItemIndicator>
    </BaseMenu.RadioItem>
  );
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="my-1 h-px bg-(--cq-border-subtle)" />;
}
