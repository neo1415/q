"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { cx } from "@capital-q/ui";
import { ArrowUpRight, ICON_SIZE } from "@capital-q/ui/icons";

import { useQControlGroup } from "@/features/q/control/q-control";
import { QPageState } from "@/features/q/q-section";
import { LinkPending } from "@/components/link-pending";

import {
  hubDestinations,
  hubTabs,
  type HubSide,
  type HubView,
} from "./hub-view";
import { useT } from "@/features/i18n/language";

/**
 * The CRM workspace's own tabs. Links own the state, so refresh, back and
 * forward recover the same area. Only the workspace's views are tabs; the
 * modules a relationship's work continues in are HubRelated links beside
 * the title (redesign 2026-10-15: they read as tabs and were not). On a
 * phone the strip scrolls sideways and keeps the open tab in view.
 */
export function HubNavigation({ view }: { readonly view: HubView }) {
  const t = useT();

  const ref = useRef<HTMLElement>(null);
  useQControlGroup({
    kind: "TAB",
    ref,
    ids: {
      "tab.overview": '[data-hub-view="overview"]',
      "tab.pipeline": '[data-hub-view="pipeline"]',
      // Capital is the CRM's own tab (owner 2026-10-16).
      "tab.capital": '[data-hub-view="capital"]',
      // Kept for Q (catalog-stable): the Relationships tab became the
      // Pipeline's List layout, so its id selects the Pipeline tab.
      "tab.relationships": '[data-hub-view="pipeline"]',
    },
  });

  // Keep the open tab in view on a narrow, scrolling strip.
  useEffect(() => {
    const strip = ref.current;
    const open = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (strip === null || strip === undefined || open === null) return;
    if (open === undefined) return;
    // Measured on screen, so it holds right to left (Arabic) as well:
    // a relative scrollLeft step moves the same way in both directions.
    const box = open.getBoundingClientRect();
    const frame = strip.getBoundingClientRect();
    if (box.right > frame.right)
      strip.scrollLeft += box.right - frame.right + 16;
    else if (box.left < frame.left)
      strip.scrollLeft -= frame.left - box.left + 16;
  }, [view]);

  return (
    <nav
      ref={ref}
      aria-label={t("CRM")}
      className="relative -mx-4 flex items-stretch gap-1 overflow-x-auto border-b border-(--cq-border-subtle) px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <QPageState
        {...(view === "overview" ? { tab: "overview" as const } : {})}
        filters={{ view }}
      />
      {hubTabs().map((entry) => {
        // The tapped tab's pending mark is LinkPending (perf lane): one
        // mechanism for instant tab feedback across the CRM.
        const open = view === entry.view;
        return (
          <Link
            key={entry.view}
            href={entry.href}
            data-hub-view={entry.view}
            aria-current={open ? "page" : undefined}
            className={cx(
              "cq-body-sm relative -mb-px inline-flex min-h-11 flex-none items-center border-b-2 px-3 whitespace-nowrap transition-colors duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
              open
                ? "border-(--cq-accent) font-semibold text-(--cq-text-primary)"
                : "border-transparent font-medium text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
            )}
          >
            {t(entry.label)}
            <LinkPending />
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Where a relationship's work continues outside the CRM (GateQ): a quiet
 * link beside the title, marked as leaving the workspace. Q keeps
 * `button.hub-gateq`; the sidebar's own entries are not repeated here.
 */
export function HubRelated({ side }: { readonly side: HubSide }) {
  const t = useT();

  const ref = useRef<HTMLElement>(null);
  useQControlGroup({
    kind: "BUTTON",
    ref,
    ids: {
      "button.hub-gateq": '[data-hub-link="gateq"]',
    },
  });
  const destinations = hubDestinations(side);
  if (destinations.length === 0) return null;
  return (
    <nav
      ref={ref}
      aria-label={t("Related")}
      className="flex flex-wrap items-center gap-x-1"
    >
      {destinations.map((entry) => (
        <Link
          key={entry.id}
          href={entry.href}
          data-hub-link={entry.id}
          className="cq-body-sm inline-flex min-h-11 items-center gap-1 px-2 text-(--cq-text-secondary) transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        >
          {t(entry.label)}
          <ArrowUpRight
            size={ICON_SIZE.compact}
            aria-hidden="true"
            className="text-(--cq-text-tertiary)"
          />
        </Link>
      ))}
    </nav>
  );
}
