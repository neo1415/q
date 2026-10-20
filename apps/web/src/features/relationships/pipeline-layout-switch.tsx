"use client";

import Link from "next/link";
import { useRef } from "react";

import { cx } from "@capital-q/ui";

import { LinkPending } from "@/components/link-pending";
import { useQControlGroup } from "@/features/q/control/q-control";

import type { PipelineLayout } from "./hub-view";
import { useT } from "@/features/i18n/language";

const LABELS: Readonly<Record<PipelineLayout, string>> = {
  list: "List",
  table: "Table",
  board: "Board",
};

/**
 * The Pipeline's three layouts of the same records (design 2026-10-20:
 * one list, three layouts): List (each relationship with its next step),
 * Table (more columns) and Board (by state), as a segmented switch. Links
 * own the state, so refresh and Back recover it.
 */
export function PipelineLayoutSwitch({
  layout,
  hrefs,
}: {
  readonly layout: PipelineLayout;
  readonly hrefs: Readonly<Record<PipelineLayout, string>>;
}) {
  const t = useT();

  const ref = useRef<HTMLDivElement>(null);
  useQControlGroup({
    kind: "TAB",
    ref,
    ids: {
      "tab.pipeline-list": "[data-pipeline-layout=list]",
      "tab.pipeline-table": "[data-pipeline-layout=table]",
      "tab.pipeline-board": "[data-pipeline-layout=board]",
    },
  });
  return (
    <div
      ref={ref}
      role="group"
      aria-label={t("Layout")}
      className="inline-flex flex-none gap-0.5 self-start rounded-[10px] bg-(--cq-surface-strong) p-[3px]"
      data-pipeline-layouts
    >
      {(["list", "table", "board"] as const).map((entry) => (
        <Link
          key={entry}
          href={hrefs[entry]}
          data-pipeline-layout={entry}
          aria-current={layout === entry ? "page" : undefined}
          className={cx(
            "relative inline-flex min-h-11 items-center rounded-(--cq-radius-md) px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring) lg:min-h-[38px]",
            layout === entry
              ? "bg-(--cq-surface-raised) text-(--cq-text-primary) shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_1px_var(--cq-border-subtle)]"
              : "text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
          )}
        >
          {t(LABELS[entry])}
          <LinkPending />
        </Link>
      ))}
    </div>
  );
}
