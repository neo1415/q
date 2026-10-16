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
 * The Pipeline's three layouts of the same records (research 2026-10-15
 * §3.1: one list, several layouts): List (each relationship with its one
 * next step), Table (columns, saved views) and Board (by stage). Links own
 * the state, so refresh and Back recover it.
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
      className="inline-flex self-start border border-(--cq-border) bg-(--cq-surface-raised) p-0.5"
      data-pipeline-layouts
    >
      {(["list", "table", "board"] as const).map((entry) => (
        <Link
          key={entry}
          href={hrefs[entry]}
          data-pipeline-layout={entry}
          aria-current={layout === entry ? "page" : undefined}
          className={cx(
            "cq-body-sm relative inline-flex min-h-11 items-center px-3 transition-colors duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) lg:min-h-10",
            layout === entry
              ? "bg-(--cq-surface-strong) font-semibold text-(--cq-text-primary)"
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
