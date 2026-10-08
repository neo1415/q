"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";

import type { DocumentsTab } from "@capital-q/contracts";

import { useQControlGroup } from "@/features/q/control/q-control";

/**
 * The Documents tab bar for founders (2026-10-08; design
 * docs/design/2026-10-08/founder-docs): My documents, Requested, Data room.
 * Each tab is its own URL (`/documents?tab=`), so back and forward move
 * between tabs and a notification can open one. ARIA tabs with a roving
 * tabindex, like Capital's. A count is neutral, never red, and is read
 * with the tab's name.
 */

const TABS: readonly { readonly key: DocumentsTab; readonly label: string }[] =
  [
    { key: "mine", label: "My documents" },
    { key: "requested", label: "Requested" },
    { key: "data-room", label: "Data room" },
  ];

/** Q's ids for the tabs (literal, for the capability parity matrix). */
const Q_DOCUMENTS_TABS: Readonly<Record<string, string>> = {
  "tab.mine": '[data-tab="mine"]',
  "tab.requested": '[data-tab="requested"]',
  "tab.data-room": '[data-tab="data-room"]',
} satisfies Record<`tab.${DocumentsTab}`, string>;

export function documentsTabHref(tab: DocumentsTab): string {
  return tab === "mine" ? "/documents" : `/documents?tab=${tab}`;
}

export function DocumentsTabBar({
  active,
  counts,
}: {
  readonly active: DocumentsTab;
  /** Shown beside each tab's name; "3 open" on Requested. */
  readonly counts: Partial<Record<DocumentsTab, string>>;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // RECOVERY-2026-10 (C1): each tab, for Q, by its own data-tab marker.
  useQControlGroup({ kind: "TAB", ref: listRef, ids: Q_DOCUMENTS_TABS });
  const [pick, setPick] = useState<{
    readonly tab: DocumentsTab;
    readonly from: DocumentsTab;
  } | null>(null);
  const chosen = pick !== null && pick.from === active ? pick.tab : active;

  function onKeyDown(event: KeyboardEvent<HTMLAnchorElement>) {
    const tabs = Array.from(
      listRef.current?.querySelectorAll<HTMLAnchorElement>('[role="tab"]') ??
        [],
    );
    const at = tabs.indexOf(event.currentTarget);
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? at === last
          ? 0
          : at + 1
        : event.key === "ArrowLeft"
          ? at === 0
            ? last
            : at - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next !== null) {
      event.preventDefault();
      tabs[next]?.focus();
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      event.currentTarget.click();
    }
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Documents"
      className="-mx-4 flex gap-1 overflow-x-auto border-b border-(--cq-border-subtle) px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      data-documents-tabs
    >
      {TABS.map((tab) => {
        const selected = tab.key === chosen;
        const count = counts[tab.key];
        return (
          <Link
            key={tab.key}
            id={`documents-tab-${tab.key}`}
            data-tab={tab.key}
            href={documentsTabHref(tab.key)}
            scroll={false}
            role="tab"
            aria-selected={selected}
            aria-controls="documents-panel"
            tabIndex={selected ? 0 : -1}
            onKeyDown={onKeyDown}
            onClick={() => setPick({ tab: tab.key, from: active })}
            className={`cq-body-sm -mb-px inline-flex min-h-11 flex-none items-center gap-2 border-b-2 px-3 whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring) ${selected ? "border-(--cq-accent) font-semibold text-(--cq-text-primary)" : "border-transparent font-medium text-(--cq-text-secondary) hover:text-(--cq-text-primary)"}`}
          >
            {tab.label}
            {count === undefined ? null : (
              <span className="cq-caption rounded-full bg-(--cq-surface-subtle) px-2 py-px font-medium text-(--cq-text-secondary) tabular-nums">
                <span className="sr-only">, </span>
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
