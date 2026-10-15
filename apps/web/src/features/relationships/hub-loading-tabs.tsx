"use client";

import { useSearchParams } from "next/navigation";

import { cx } from "@capital-q/ui";

import { hubTabs, hubViewOf } from "./hub-view";

/**
 * The CRM's tab strip while a tab loads (owner 2026-10-16: tab switching
 * felt slow). The loading shape already carries the new address, so the
 * tab just chosen is underlined at once, in the same place and size as the
 * real strip; the real strip replaces it when the page arrives. Drawn
 * only, never a second set of links.
 */
export function HubLoadingTabs() {
  const view = hubViewOf(useSearchParams().get("view") ?? undefined);
  return (
    <span
      aria-hidden="true"
      className="-mx-4 flex items-stretch gap-1 overflow-hidden border-b border-(--cq-border-subtle) px-4 sm:mx-0 sm:px-0"
    >
      {hubTabs().map((entry) => (
        <span
          key={entry.view}
          className={cx(
            "cq-body-sm -mb-px inline-flex min-h-11 flex-none items-center border-b-2 px-3 whitespace-nowrap",
            entry.view === view
              ? "border-(--cq-accent) font-semibold text-(--cq-text-primary)"
              : "border-transparent font-medium text-(--cq-text-secondary)",
          )}
        >
          {entry.label}
        </span>
      ))}
    </span>
  );
}
