"use client";

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

/**
 * Tooltip on Base UI. Hover/focus enhancement only (doc 18 §54): the
 * trigger must already carry its own accessible name; the tooltip adds
 * detail, never the name.
 */

export function TooltipProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <BaseTooltip.Provider delay={400}>{children}</BaseTooltip.Provider>;
}

export type TooltipProps = {
  readonly content: ReactNode;
  readonly children: ReactElement;
  readonly side?: "top" | "bottom" | "left" | "right" | undefined;
};

export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          side={side}
          sideOffset={6}
          className="z-(--cq-z-popover)"
        >
          <BaseTooltip.Popup className="max-w-64 rounded-sm bg-(--cq-text-primary) px-2.5 py-1.5 cq-caption text-(--cq-text-inverse) shadow-(--cq-shadow-overlay) transition-opacity duration-(--cq-motion-fast) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
