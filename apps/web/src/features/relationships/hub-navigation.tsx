"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { cx } from "@capital-q/ui";

import { useQControlGroup } from "@/features/q/control/q-control";
import { QPageState } from "@/features/q/q-section";

import {
  hubDestinations,
  hubTabs,
  type HubSide,
  type HubView,
} from "./hub-view";

/**
 * The CRM workspace's tab strip. Links own the state, so refresh, back and
 * forward recover the same area. The workspace's own views come first as
 * tabs; the modules a relationship's work continues in (GateQ, Capital,
 * Q Work, Discover) follow as plainer links. On a phone the strip scrolls
 * sideways and keeps the open tab in view; the page itself never does.
 *
 * Q's ids are unchanged from the Hub (control catalog): Reports keeps
 * `button.hub-results`, so Q's existing moves to Results still resolve.
 */
export function HubNavigation({
  side,
  view,
}: {
  readonly side: HubSide;
  readonly view: HubView;
}) {
  const ref = useRef<HTMLElement>(null);
  useQControlGroup({
    kind: "TAB",
    ref,
    ids: {
      "tab.overview": '[data-hub-view="overview"]',
      "tab.pipeline": '[data-hub-view="pipeline"]',
      "tab.relationships": '[data-hub-view="relationships"]',
    },
  });
  useQControlGroup({
    kind: "BUTTON",
    ref,
    ids: {
      "button.hub-discover": '[data-hub-link="discover"]',
      "button.hub-gateq": '[data-hub-link="gateq"]',
      "button.hub-capital": '[data-hub-link="capital"]',
      "button.hub-work": '[data-hub-link="work"]',
      "button.hub-results": '[data-hub-link="results"]',
    },
  });

  // Keep the open tab in view on a narrow, scrolling strip.
  useEffect(() => {
    const strip = ref.current;
    const open = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (strip === null || strip === undefined || open === null) return;
    if (open === undefined) return;
    const right = open.offsetLeft - strip.offsetLeft + open.offsetWidth;
    if (right > strip.clientWidth)
      strip.scrollLeft = right - strip.clientWidth + 16;
  }, [view]);

  const destinations = hubDestinations(side);
  return (
    <nav
      ref={ref}
      aria-label="CRM"
      className="-mx-4 flex items-stretch gap-1 overflow-x-auto border-b border-(--cq-border-subtle) px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <QPageState
        {...(view === "overview" ? { tab: "overview" as const } : {})}
        filters={{ view }}
      />
      {hubTabs(side).map((entry) => {
        const open = view === entry.view;
        return (
          <Link
            key={entry.view}
            href={entry.href}
            data-hub-view={entry.view}
            {...(entry.view === "reports"
              ? { "data-hub-link": "results" }
              : {})}
            aria-current={open ? "page" : undefined}
            className={cx(
              "cq-body-sm -mb-px inline-flex min-h-11 flex-none items-center border-b-2 px-3 whitespace-nowrap transition-colors duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
              open
                ? "border-(--cq-accent) font-semibold text-(--cq-text-primary)"
                : "border-transparent font-medium text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
            )}
          >
            {entry.label}
          </Link>
        );
      })}
      {destinations.length === 0 ? null : (
        <span
          aria-hidden="true"
          className="mx-2 my-3 w-px flex-none bg-(--cq-border-subtle)"
        />
      )}
      {destinations.map((entry) => (
        <Link
          key={entry.id}
          href={entry.href}
          data-hub-link={entry.id}
          className="cq-body-sm -mb-px inline-flex min-h-11 flex-none items-center border-b-2 border-transparent px-3 whitespace-nowrap text-(--cq-text-secondary) transition-colors duration-(--cq-motion-fast) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
        >
          {entry.label}
        </Link>
      ))}
    </nav>
  );
}
