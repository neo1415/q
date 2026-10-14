"use client";

import Link from "next/link";
import { useRef } from "react";

import { cx } from "@capital-q/ui";

import { useQControlGroup } from "@/features/q/control/q-control";
import { QPageState } from "@/features/q/q-section";

import { hubDestinations, type HubSide, type HubView } from "./hub-view";

/** Links own the state, so refresh, back and forward recover the same area. */
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
  return (
    <nav
      ref={ref}
      aria-label="Relationship Hub"
      className="flex flex-wrap gap-2 border-b border-(--cq-border-subtle) pb-3"
    >
      <QPageState
        {...(view === "overview" ? { tab: "overview" as const } : {})}
        filters={{ view }}
      />
      {(["overview", "relationships"] as const).map((entry) => (
        <Link
          key={entry}
          href={`/relationships?view=${entry}`}
          data-hub-view={entry}
          aria-current={view === entry ? "page" : undefined}
          className={cx(
            "cq-body-sm inline-flex min-h-11 items-center rounded-(--cq-radius-md) px-3 focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)",
            view === entry
              ? "bg-(--cq-surface-strong) font-semibold text-(--cq-text-primary)"
              : "text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle)",
          )}
        >
          {entry === "overview" ? "Overview" : "Relationships"}
        </Link>
      ))}
      {hubDestinations(side).map((entry) => (
        <Link
          key={entry.id}
          href={entry.href}
          data-hub-link={entry.id}
          className="cq-body-sm inline-flex min-h-11 items-center px-3 text-(--cq-text-secondary) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        >
          {entry.label}
        </Link>
      ))}
    </nav>
  );
}
