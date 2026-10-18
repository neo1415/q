"use client";

import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import type { ReactElement, ReactNode } from "react";

/**
 * Context menu on Base UI: opened by a right click, a long press, or the
 * keyboard's context-menu key / Shift+F10 on anything inside the trigger.
 * Its items and surface are the dropdown menu's (`MenuContent`,
 * `MenuItem`, `MenuSeparator` from `./menu`), so there is one menu
 * language, not two.
 */

export function ContextMenuRoot({
  children,
  open,
  onOpenChange,
}: {
  readonly children: ReactNode;
  readonly open?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  return (
    <BaseContextMenu.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined
        ? {}
        : { onOpenChange: (next: boolean) => onOpenChange(next) })}
    >
      {children}
    </BaseContextMenu.Root>
  );
}

export function ContextMenuTrigger({
  children,
}: {
  readonly children: ReactElement;
}) {
  return <BaseContextMenu.Trigger render={children} />;
}
